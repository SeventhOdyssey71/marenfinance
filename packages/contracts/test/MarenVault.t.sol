// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../src/MarenVault.sol";
import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {MockMusdProtocol} from "./mocks/MockMusdProtocol.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract MarenVaultTest is VaultTestBase {
    function setUp() public {
        _deployVault();
        _openPooledTrove();
    }

    // ------------------------------------------------------------------ //
    //                        The reason this exists                      //
    // ------------------------------------------------------------------ //

    /**
     * @notice The whole justification for MarenVault, as an executable assertion.
     * @dev A holder of 0.01 BTC cannot open a direct trove at all — the protocol's 1,800 MUSD
     *      minimum net debt needs 0.079346 BTC at 250% (live price $63,071.83). Through the
     *      pooled trove the same holder borrows 200 MUSD. If this test ever fails, the
     *      product has no reason to exist.
     */
    function test_subMinimumHolder_cannotOpenDirectTrove_butCanBorrowPooled() public {
        uint256 smallStack = 0.01 ether;
        assertLt(smallStack, DIRECT_TROVE_COLLATERAL_AT_250, "0.01 BTC must be under the direct-trove floor");

        // Direct route: impossible. 0.01 BTC is $630.72 against a 2,001.8 MUSD minimum trove.
        vm.deal(alice, smallStack);
        vm.prank(alice);
        vm.expectRevert();
        protocol.openTrove{value: smallStack}(1800e18, address(0), address(0));

        // Pooled route: works.
        _deposit(alice, smallStack);
        _borrow(alice, 200e18);

        assertEq(musd.balanceOf(alice), 200e18, "alice received MUSD");
        assertGt(vault.collateralRatioOf(alice), vault.MIN_BORROW_CR(), "alice is above the 180% floor");
    }

    // ------------------------------------------------------------------ //
    //                               Deposit                              //
    // ------------------------------------------------------------------ //

    function test_deposit_creditsUserAndPushesIntoTrove() public {
        uint256 troveCollBefore = protocol.getTroveColl(address(vault));
        _deposit(alice, 0.5 ether);

        assertEq(vault.collateral(alice), 0.5 ether);
        assertEq(vault.totalCollateral(), SEED_COLLATERAL + 0.5 ether);
        assertEq(vault.idleCollateral(), 0, "pushed straight into the trove");
        assertEq(protocol.getTroveColl(address(vault)), troveCollBefore + 0.5 ether);
    }

    function test_deposit_minimumIsOnePointOneThousandthBtc() public {
        assertEq(vault.MIN_DEPOSIT(), 0.001 ether);
        _deposit(alice, 0.001 ether);
        assertEq(vault.collateral(alice), 0.001 ether);
    }

    function testRevert_deposit_belowMinimum() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.DepositBelowMinimum.selector, 0.0009 ether, 0.001 ether)
        );
        vault.deposit{value: 0.0009 ether}(address(0), address(0));
    }

    function testRevert_deposit_overCap() public {
        vm.prank(admin);
        vault.setDepositCap(SEED_COLLATERAL + 1 ether);
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenVault.DepositCapExceeded.selector, SEED_COLLATERAL + 2 ether, SEED_COLLATERAL + 1 ether
            )
        );
        vault.deposit{value: 2 ether}(address(0), address(0));
    }

    function testRevert_deposit_whenPaused() public {
        vm.prank(guardian);
        vault.setDepositsPaused(true);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.DepositsArePaused.selector);
        vault.deposit{value: 1 ether}(address(0), address(0));
    }

    /// @dev Deposits need no price, so a stale oracle must not stop one. The BTC is held idle
    ///      and still fully credited; a keeper pushes it in later.
    function test_deposit_succeedsWhileOracleIsStale_heldIdle() public {
        priceFeed.setStale(true);
        _deposit(alice, 0.5 ether);

        assertEq(vault.collateral(alice), 0.5 ether, "credited despite the stale oracle");
        assertEq(vault.idleCollateral(), 0.5 ether, "held idle, not in the trove");
        assertEq(address(vault).balance, 0.5 ether);

        priceFeed.setStale(false);
        vm.prank(keeper);
        vault.topUpCollateral(0.5 ether, address(0), address(0));
        assertEq(vault.idleCollateral(), 0);
    }

    // ------------------------------------------------------------------ //
    //                                Borrow                              //
    // ------------------------------------------------------------------ //

    /// @dev The core trick: a 200 MUSD loan against a protocol whose minimum is 1,800 never
    ///      touches the trove at all — it comes out of the reserve the seed debt created.
    function test_borrow_smallLoanIsServedFromReserveWithoutTouchingTrove() public {
        _deposit(alice, 0.05 ether);
        uint256 troveDebtBefore = _troveNetDebt();
        uint256 reserveBefore = vault.reserveMUSD();

        _borrow(alice, 200e18);

        assertEq(_troveNetDebt(), troveDebtBefore, "trove debt untouched");
        assertEq(vault.reserveMUSD(), reserveBefore - 200e18, "served from the reserve");
        assertEq(musd.balanceOf(alice), 200e18);
        assertEq(vault.debtOf(alice), 200e18, "no origination fee when the reserve covers it");
    }

    function test_borrow_beyondReserveDrawsFromTroveAndChargesTheFee() public {
        _deposit(alice, 0.5 ether);
        uint256 reserve = vault.reserveMUSD();
        uint256 amount = reserve + 500e18;

        uint256 troveDebtBefore = _troveNetDebt();
        _borrow(alice, amount);

        assertEq(vault.reserveMUSD(), 0, "reserve drained first");
        assertEq(musd.balanceOf(alice), amount);
        // The 0.1% fee on the drawn portion lands on the borrower, measured not modelled.
        assertEq(vault.debtOf(alice), amount + (500e18 * 1e15) / 1e18);
        assertGt(_troveNetDebt(), troveDebtBefore);
    }

    function testRevert_borrow_below180Percent() public {
        _deposit(alice, 0.05 ether); // $3,153.59
        // 180% of $3,153.59 is $1,752.00 of debt. Ask for more.
        vm.prank(alice);
        vm.expectRevert();
        vault.borrow(1800e18, address(0), address(0));
    }

    function testRevert_borrow_whenBorrowingPaused() public {
        _deposit(alice, 0.5 ether);
        vm.prank(guardian);
        vault.setBorrowingPaused(true);
        vm.prank(alice);
        vm.expectRevert(MarenVault.BorrowingIsPaused.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    /// @dev A stale Mezo oracle must surface as a named error, not as an opaque revert from
    ///      three contracts deep, so the UI can say "price feed unavailable" and mean it.
    function testRevert_borrow_whenOracleStale_namedError() public {
        _deposit(alice, 0.5 ether);
        priceFeed.setStale(true);
        vm.prank(alice);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function testRevert_borrow_whenOracleReturnsZero_namedError() public {
        _deposit(alice, 0.5 ether);
        priceFeed.setZero();
        vm.prank(alice);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function testRevert_borrow_zeroAmount() public {
        _deposit(alice, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.ZeroAmount.selector);
        vault.borrow(0, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                            Repay / exit                            //
    // ------------------------------------------------------------------ //

    function test_repay_reducesDebtAndRefillsReserve() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        uint256 outstandingBefore = vault.outstandingDebt();

        _repay(alice, 200e18);

        assertEq(vault.debtOf(alice), 300e18);
        // Outstanding is what matters, not where the MUSD sits. Some of the repayment is
        // immediately pushed into the trove (down to the protocol's 1,800 net-debt floor) and
        // the rest stays in the reserve; both reduce what the vault owes by exactly 200.
        assertEq(vault.outstandingDebt(), outstandingBefore - 200e18);
        assertGe(_troveNetDebt(), 1800e18, "never pushed below the protocol's minimum net debt");
    }

    function test_repay_moreThanOwedRepaysExactlyWhatIsOwed() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        musd.mint(alice, 1000e18);

        _repay(alice, 5000e18);

        assertEq(vault.debtOf(alice), 0);
        assertEq(vault.debtShares(alice), 0);
    }

    function testRevert_repay_withNoDebt() public {
        _deposit(alice, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.NoDebt.selector);
        vault.repay(1e18, address(0), address(0));
    }

    function test_withdraw_returnsBtc() public {
        _deposit(alice, 0.5 ether);
        uint256 balanceBefore = alice.balance;
        _withdraw(alice, 0.2 ether);

        assertEq(alice.balance, balanceBefore + 0.2 ether);
        assertEq(vault.collateral(alice), 0.3 ether);
    }

    function testRevert_withdraw_wouldBreach180Percent() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 1000e18);
        // 180% of 1,000 MUSD needs $1,800 = 0.028539 BTC. Try to leave less than that.
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(0.49 ether, address(0), address(0));
    }

    function testRevert_withdraw_moreThanDeposited() public {
        _deposit(alice, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.InsufficientCollateral.selector, 0.6 ether, 0.5 ether)
        );
        vault.withdraw(0.6 ether, address(0), address(0));
    }

    function test_closePosition_repaysAndReturnsEverything() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        musd.mint(alice, 10e18); // cover any accrued interest

        vm.warp(block.timestamp + 30 days);

        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.closePosition(address(0), address(0));

        assertEq(vault.debtOf(alice), 0);
        assertEq(vault.collateral(alice), 0);
        assertEq(alice.balance, balanceBefore + 0.5 ether);
    }

    // ------------------------------------------------------------------ //
    //          THE HARD REQUIREMENT: exits stay open when entries close   //
    // ------------------------------------------------------------------ //

    /**
     * @notice Withdrawal, repayment and closing must all keep working while BOTH deposits and
     *         borrowing are paused.
     * @dev This is the guarantee that no guardian key — compromised, coerced or merely
     *      mistaken — can trap a user's collateral. It holds structurally: there is no global
     *      pause on MarenVault and no pause modifier anywhere on an exit path. If someone
     *      later adds one, this test is what stops it reaching production.
     */
    function test_exitsStayOpenWhileEntriesArePaused() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        vm.startPrank(guardian);
        vault.setDepositsPaused(true);
        vault.setBorrowingPaused(true);
        vm.stopPrank();

        // Entries are shut.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.DepositsArePaused.selector);
        vault.deposit{value: 1 ether}(address(0), address(0));
        vm.prank(alice);
        vm.expectRevert(MarenVault.BorrowingIsPaused.selector);
        vault.borrow(1e18, address(0), address(0));

        // Exits are not.
        _repay(alice, 200e18);
        assertEq(vault.debtOf(alice), 300e18, "repay works while paused");

        uint256 balanceBefore = alice.balance;
        _withdraw(alice, 0.1 ether);
        assertEq(alice.balance, balanceBefore + 0.1 ether, "withdraw works while paused");

        musd.mint(alice, 100e18);
        vm.prank(alice);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.closePosition(address(0), address(0));
        assertEq(vault.collateral(alice), 0, "closePosition works while paused");
    }

    /// @dev A debt-free user whose BTC is idle can leave even with the oracle down, because
    ///      that path needs no price at all.
    function test_debtFreeUserCanExitWhileOracleIsStale() public {
        priceFeed.setStale(true);
        _deposit(alice, 0.5 ether); // held idle

        uint256 balanceBefore = alice.balance;
        _withdraw(alice, 0.5 ether);
        assertEq(alice.balance, balanceBefore + 0.5 ether);
    }

    // ------------------------------------------------------------------ //
    //                              Interest                              //
    // ------------------------------------------------------------------ //

    /// @dev Two borrowers of equal size must accrue equal interest, with no loop over users.
    function test_interest_accruesProRataAcrossBorrowers() public {
        _deposit(alice, 0.5 ether);
        _deposit(bob, 0.5 ether);
        _borrow(alice, 500e18);
        _borrow(bob, 500e18);

        uint256 aliceBefore = vault.debtOf(alice);
        uint256 bobBefore = vault.debtOf(bob);
        assertEq(aliceBefore, bobBefore);

        vm.warp(block.timestamp + 365 days);
        vault.syncTrove();

        uint256 aliceAfter = vault.debtOf(alice);
        uint256 bobAfter = vault.debtOf(bob);
        assertGt(aliceAfter, aliceBefore, "interest accrued");
        assertApproxEqAbs(aliceAfter, bobAfter, 2, "equal debt, equal interest");
    }

    /// @dev The index is monotonic by construction. Repaying must never push it back down and
    ///      hand accumulated rounding back to users.
    function test_interestIndex_isMonotonic() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 i0 = vault.interestIndex();
        vm.warp(block.timestamp + 90 days);
        vault.syncTrove();
        uint256 i1 = vault.interestIndex();
        assertGt(i1, i0);

        musd.mint(alice, 100e18);
        _repay(alice, 400e18);
        assertGe(vault.interestIndex(), i1, "index never decreases");

        vault.syncTrove();
        assertGe(vault.interestIndex(), i1);
    }

    /// @dev The books must track the protocol's books, always erring in the protocol's favour.
    function test_accountedDebtNeverFallsBelowOutstanding() public {
        _deposit(alice, 0.5 ether);
        _deposit(bob, 0.3 ether);
        _borrow(alice, 500e18);
        _borrow(bob, 321e18);
        vm.warp(block.timestamp + 200 days);
        vault.syncTrove();

        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "drift is in the protocol's favour");
    }

    // ------------------------------------------------------------------ //
    //                            Liquidation                             //
    // ------------------------------------------------------------------ //

    function testRevert_liquidate_healthyPosition() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        vm.prank(keeper);
        vm.expectRevert();
        vault.liquidateUser(alice, address(0), address(0));
    }

    function testRevert_liquidate_withoutKeeperRole() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        // NOTE: read KEEPER_ROLE() before the prank. A contract call inside the
        // vm.expectRevert argument list would consume the prank and the call would come from
        // the test contract instead of `bob`.
        bytes32 keeperRole = vault.KEEPER_ROLE();
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, keeperRole)
        );
        vault.liquidateUser(alice, address(0), address(0));
    }

    function test_liquidate_seizesWithFivePercentPenaltyToInsurance() public {
        _deposit(alice, 0.05 ether); // $3,153.59
        _borrow(alice, 1700e18); // CR ~185%

        // Crash BTC ~30% -> alice's CR drops under the 140% internal trigger.
        priceFeed.setPrice((BTC_PRICE * 70) / 100);
        assertTrue(vault.isLiquidatable(alice));

        musd.mint(keeper, 5000e18);
        vm.prank(keeper);
        musd.approve(address(vault), type(uint256).max);

        uint256 insuranceBefore = vault.collateral(address(vault));
        uint256 keeperBtcBefore = keeper.balance;
        uint256 debt = vault.debtOf(alice);

        vm.prank(keeper);
        vault.liquidateUser(alice, address(0), address(0));

        assertEq(vault.debtOf(alice), 0, "debt cleared");
        assertGt(keeper.balance, keeperBtcBefore, "liquidator received collateral");

        // The liquidator is made whole in collateral terms and no more; the 5% goes to the buffer.
        uint256 expectedCollForDebt = (debt * 1e18) / ((BTC_PRICE * 70) / 100);
        assertApproxEqAbs(keeper.balance - keeperBtcBefore, expectedCollForDebt, 1e6);
        uint256 penalty = vault.collateral(address(vault)) - insuranceBefore;
        assertApproxEqAbs(penalty, (expectedCollForDebt * 500) / 10_000, 1e6, "5% penalty to insurance");
        assertEq(vault.insuranceCollateralAccrued(), penalty);
    }

    /// @dev When a position is underwater beyond what its collateral covers, the shortfall is
    ///      RECORDED as bad debt, not silently spread onto other users' balances.
    function test_liquidate_underwaterPositionRecognisesBadDebt() public {
        _deposit(alice, 0.05 ether);
        _borrow(alice, 1700e18);

        priceFeed.setPrice((BTC_PRICE * 25) / 100); // catastrophic gap down

        musd.mint(keeper, 5000e18);
        vm.prank(keeper);
        musd.approve(address(vault), type(uint256).max);

        uint256 bobDebtBefore = vault.debtOf(bob);
        vm.prank(keeper);
        vault.liquidateUser(alice, address(0), address(0));

        assertGt(vault.badDebtRecognised(), 0, "shortfall recorded");
        assertEq(vault.debtOf(bob), bobDebtBefore, "never socialised onto another user");
    }

    function testRevert_liquidate_whenOracleStale_namedError() public {
        _deposit(alice, 0.05 ether);
        _borrow(alice, 1700e18);
        priceFeed.setStale(true);
        vm.prank(keeper);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.liquidateUser(alice, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                         Keeper / admin gates                       //
    // ------------------------------------------------------------------ //

    function testRevert_keeperFunctions_withoutRole() public {
        bytes memory err = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, bob, vault.KEEPER_ROLE()
        );

        vm.startPrank(bob);
        vm.expectRevert(err);
        vault.topUpCollateral(1, address(0), address(0));
        vm.expectRevert(err);
        vault.deleverage(1, address(0), address(0));
        vm.expectRevert(err);
        vault.refinancePooledTrove(address(0), address(0));
        vm.stopPrank();
    }

    function testRevert_pauseSetters_withoutGuardianRole() public {
        bytes memory err = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, bob, vault.GUARDIAN_ROLE()
        );
        vm.startPrank(bob);
        vm.expectRevert(err);
        vault.setDepositsPaused(true);
        vm.expectRevert(err);
        vault.setBorrowingPaused(true);
        vm.stopPrank();
    }

    function testRevert_setDepositCap_withoutAdminRole() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, bytes32(0))
        );
        vault.setDepositCap(1);
    }

    function testRevert_openPooledTrove_twice() public {
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(MarenVault.TroveAlreadyOpen.selector);
        vault.openPooledTrove{value: 1 ether}(SEED_DEBT, address(0), address(0));
    }

    function testRevert_openPooledTrove_belowProtocolMinimum() public {
        _deployVault(); // fresh, no trove
        vm.deal(keeper, 1 ether);
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.SeedDebtBelowProtocolMinimum.selector, 1000e18, 1800e18)
        );
        vault.openPooledTrove{value: 1 ether}(1000e18, address(0), address(0));
    }

    /// @dev Deleveraging moves reserve MUSD into the trove. It improves the trove's real ICR,
    ///      which is what the MUSD protocol liquidates on, and must leave user debt untouched.
    function test_deleverage_lowersTroveDebtWithoutChangingUserDebt() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 300e18);

        uint256 aliceDebtBefore = vault.debtOf(alice);
        uint256 outstandingBefore = vault.outstandingDebt();
        uint256 troveDebtBefore = _troveNetDebt();

        vm.prank(keeper);
        vault.deleverage(500e18, address(0), address(0));

        assertLt(_troveNetDebt(), troveDebtBefore, "trove debt actually fell");
        assertEq(vault.debtOf(alice), aliceDebtBefore, "user debt unchanged");
        assertEq(vault.outstandingDebt(), outstandingBefore, "outstanding unchanged");
    }

    function testRevert_deleverage_beyondReserve() public {
        uint256 reserve = vault.reserveMUSD();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarenVault.ReserveTooSmall.selector, 10_000e18, reserve));
        vault.deleverage(10_000e18, address(0), address(0));
    }

    function test_refinance_raisesMaxBorrowingCapacity() public {
        _deposit(alice, 5 ether);
        uint256 capBefore = vault.troveMaxBorrowingCapacity();

        vm.prank(keeper);
        vault.refinancePooledTrove(address(0), address(0));

        assertGt(vault.troveMaxBorrowingCapacity(), capBefore, "only refinance() raises the ceiling");
    }

    function test_skim_creditsStrayBtcToInsurance() public {
        uint256 before = vault.collateral(address(vault));
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 0.3 ether}("");
        assertTrue(ok);

        vm.prank(admin);
        vault.skim();

        assertEq(vault.collateral(address(vault)), before + 0.3 ether);
        assertEq(vault.insuranceCollateralAccrued(), 0.3 ether);
    }

    function testRevert_skim_whenNothingToSkim() public {
        vm.prank(admin);
        vm.expectRevert(MarenVault.NothingToSkim.selector);
        vault.skim();
    }

    function testRevert_closePooledTrove_withOutstandingUserDebt() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 300e18);
        vm.prank(admin);
        vm.expectRevert();
        vault.closePooledTrove();
    }

    /// @dev After an emergency close, users withdraw from idle BTC with no oracle dependency
    ///      whatsoever — the safest wind-down state available.
    function test_closePooledTrove_thenUsersExitWithoutAnOracle() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 300e18);
        musd.mint(alice, 10e18);
        vm.prank(alice);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.repay(type(uint256).max, address(0), address(0));

        // The admin covers the seed trove's own origination fee and interest — debt for which
        // no MUSD was ever minted to the vault. It must not come out of user collateral.
        musd.mint(admin, 100e18);
        vm.prank(admin);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(admin);
        vault.closePooledTrove();

        assertFalse(vault.troveOpen());
        assertEq(vault.idleCollateral(), vault.totalCollateral());

        priceFeed.setStale(true);
        uint256 balanceBefore = alice.balance;
        _withdraw(alice, 0.5 ether);
        assertEq(alice.balance, balanceBefore + 0.5 ether);
    }

    // ------------------------------------------------------------------ //
    //                          Views and rounding                        //
    // ------------------------------------------------------------------ //

    /// @dev Rounding discipline must match packages/sdk/src/position.ts, or the UI quotes
    ///      numbers the contract then rejects. Ratios round DOWN; required collateral and
    ///      liquidation prices round UP.
    function test_rounding_matchesSdkDiscipline() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 1000e18);

        // Required collateral rounds up: the quoted amount always reaches the target ratio.
        uint256 required = vault.collateralRequiredFor(1000e18, 2.5e18);
        assertGe((required * BTC_PRICE) / 1000e18, 2.5e18, "rounded up, never short");

        // Liquidation price rounds up: never tell a user liquidation is further away than it is.
        uint256 liqPrice = vault.liquidationPriceOf(alice);
        uint256 debt = vault.debtOf(alice);
        assertGe((0.5 ether * liqPrice) / debt, vault.LIQUIDATION_CR());

        assertEq(vault.liquidationPriceOf(bob), 0, "no debt, never liquidatable");
    }

    /**
     * @dev Pins the contract's math to the SDK's published anchor. The 0.079346 BTC figure is
     *      computed against a trove's TOTAL debt at open, not its net debt:
     *          1,800 net + 1.8 origination fee (0.1%) + 200 gas compensation = 2,001.8 MUSD
     *          2,001.8 * 2.5 / 63,071.83 = 0.0793459 BTC ($5,004.50)
     *      That decomposition also independently confirms that a trove's recorded debt
     *      INCLUDES the 200 MUSD gas compensation, which is why `_troveCollAndNetDebt`
     *      subtracts it before attributing anything to users.
     */
    function test_collateralRequiredFor_matchesTheDirectTroveAnchor() public view {
        uint256 totalDebtAtOpen = 1800e18 + 1.8e18 + 200e18;
        uint256 required = vault.collateralRequiredFor(totalDebtAtOpen, 2.5e18);
        assertApproxEqAbs(required, DIRECT_TROVE_COLLATERAL_AT_250, 1e12, "matches the SDK figure");
        assertEq(vault.MIN_DEPOSIT(), 0.001 ether);
        assertGe(required / vault.MIN_DEPOSIT(), 79, "pooled floor is ~79x lower");
    }

    /**
     * @dev Borrowing exactly `maxBorrowable` lands exactly on 180% — but only while the loan
     *      is served from the reserve. Anything drawn from the trove also carries the
     *      protocol's 0.1% origination fee, which is added to the borrower's debt and pushes
     *      them fractionally under. `maxBorrowable` deliberately does not model that fee: it
     *      is governable, so modelling it would be modelling a number that can change under
     *      us. The UI must apply its own buffer, which is why it targets 250%, not 180%.
     */
    function test_maxBorrowable_respectsThe180PercentFloor() public {
        _deposit(alice, 0.05 ether); // $3,153.59 — max borrow sits under the 1,800 reserve
        uint256 max = vault.maxBorrowable(alice);
        assertApproxEqAbs(max, (0.05 ether * BTC_PRICE) / 1.8e18, 1e12);
        assertLt(max, vault.reserveMUSD(), "served from reserve, so no origination fee");

        _borrow(alice, max);
        assertApproxEqAbs(vault.collateralRatioOf(alice), 1.8e18, 1e15);
        assertEq(vault.maxBorrowable(alice), 0);
    }

    function test_troveStatus_reportsLiveNumbers() public {
        _deposit(alice, 0.5 ether);
        (uint256 coll, uint256 netDebt, uint256 icr) = vault.troveStatus();
        assertEq(coll, SEED_COLLATERAL + 0.5 ether);
        assertEq(netDebt, _troveNetDebt());
        assertGt(icr, 1.5e18);
    }

    function testRevert_collateralRatioOf_whenOracleStale() public {
        _deposit(alice, 0.5 ether);
        priceFeed.setStale(true);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.collateralRatioOf(alice);
    }
}
