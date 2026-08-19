// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../src/MarenVault.sol";
import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/**
 * @title MarenVaultComposedTest
 * @notice The two composed entrypoints: `depositAndBorrow` and `repayWithPermit`.
 *
 * Both exist for one reason, and it is a user-experience reason rather than an accounting one.
 * A first-time user with 0.01 BTC and no MUSD needed three signed transactions to end up
 * holding MUSD (approve, deposit, borrow), and every one of them is a place to give up.
 * These two entrypoints remove one transaction each.
 *
 * Because they exist for a UX reason, the bar they have to clear is that they change NOTHING
 * else. What is asserted throughout:
 *
 *   1. EQUIVALENCE. `depositAndBorrow` leaves the vault in a state indistinguishable from
 *      `deposit` followed by `borrow`, for the same inputs, down to the last wei of every
 *      storage slot the two touch. The fuzz test at the bottom is the real statement of this;
 *      the unit tests are the readable version of it.
 *   2. REVERT PARITY. Every guard the single calls apply still applies, in the same order, with
 *      the same error and the same arguments. A composite that silently relaxes a floor is
 *      worse than no composite.
 *   3. THE FLOOR IS POST-DEPOSIT. The 180% check counts the BTC arriving in the same call,
 *      because a borrow secured by that BTC is the entire point.
 *   4. ATOMICITY, and what it costs. The one deliberate difference from calling the two in
 *      sequence: if the borrow fails, the deposit is rolled back with it.
 *   5. THE PERMIT CANNOT BE GRIEFED, and swallowing its failure is not a bypass.
 *   6. NO STALE WINDOW. Both settle a pending redemption before reading anything, exactly like
 *      every other mutation.
 */
contract MarenVaultComposedTest is VaultTestBase {
    /// @dev Same derivation forge-std uses for `makeAddr`, so this key belongs to the `alice`
    ///      the base fixture already knows about.
    uint256 internal alicePk;
    uint256 internal bobPk;

    address internal redeemer = makeAddr("redeemer");

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        (, alicePk) = makeAddrAndKey("alice");
        (, bobPk) = makeAddrAndKey("bob");
        _deployVault();
        _openPooledTrove();
    }

    function _signPermit(uint256 pk, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, address(vault), value, musd.nonces(owner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _depositAndBorrow(address who, uint256 value, uint256 amount) internal {
        vm.deal(who, value);
        vm.prank(who);
        vault.depositAndBorrow{value: value}(amount, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                    depositAndBorrow: the happy path                //
    // ------------------------------------------------------------------ //

    /**
     * @notice The reason this entrypoint exists, as an executable assertion: a user who has
     *         never touched Maren holds MUSD after ONE transaction.
     */
    function test_depositAndBorrow_aBrandNewUserHoldsMusdAfterOneTransaction() public {
        assertEq(vault.collateral(alice), 0, "precondition: alice has no position");
        assertEq(musd.balanceOf(alice), 0);

        _depositAndBorrow(alice, 0.01 ether, 200e18);

        assertEq(vault.collateral(alice), 0.01 ether, "the deposit landed");
        assertEq(vault.debtOf(alice), 200e18, "and so did the borrow");
        assertEq(musd.balanceOf(alice), 200e18, "alice is holding MUSD");
        assertEq(vault.idleCollateral(), 0, "the BTC went into the pooled trove");
        assertGe(vault.collateralRatioOf(alice), vault.MIN_BORROW_CR());
    }

    /// @dev No new event. An indexer that already understands `Deposited` and `Borrowed`
    ///      understands this call without a single line of change, and it sees them in the
    ///      order they happened.
    function test_depositAndBorrow_emitsDepositedThenBorrowed() public {
        vm.deal(alice, 0.01 ether);

        vm.expectEmit(true, false, false, true, address(vault));
        emit MarenVault.Deposited(alice, 0.01 ether, 0.01 ether, true);
        vm.expectEmit(true, false, false, true, address(vault));
        emit MarenVault.Borrowed(alice, 200e18, 200e18, 200e18, true);

        vm.prank(alice);
        vault.depositAndBorrow{value: 0.01 ether}(200e18, address(0), address(0));
    }

    /**
     * @notice THE point of composing them: the 180% floor is measured on the position INCLUDING
     *         the BTC arriving in this call.
     * @dev Alice deposits nothing beforehand. The same borrow against her standing position
     *      (which is empty) is impossible; against the post-deposit position it is comfortable.
     *      If this test ever fails the entrypoint is useless, because the only user it serves
     *      is one who has no collateral yet.
     */
    function test_depositAndBorrow_theFloorIsMeasuredOnThePostDepositPosition() public {
        // The standing position cannot support this borrow: there is no standing position.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MarenVault.InsufficientCollateralRatio.selector, 0, 1.8e18));
        vault.borrow(200e18, address(0), address(0));

        // The same borrow, with the collateral supplied in the same call, is fine.
        _depositAndBorrow(alice, 0.01 ether, 200e18);
        assertEq(vault.debtOf(alice), 200e18);
    }

    /// @dev A user who already has a position keeps it. The composite adds to both sides rather
    ///      than replacing either.
    function test_depositAndBorrow_addsToAnExistingPosition() public {
        _deposit(alice, 0.05 ether);
        _borrow(alice, 300e18);

        _depositAndBorrow(alice, 0.05 ether, 200e18);

        assertEq(vault.collateral(alice), 0.1 ether, "both deposits are hers");
        assertEq(vault.debtOf(alice), 500e18, "both borrows are hers");
        assertEq(musd.balanceOf(alice), 500e18);
    }

    /// @dev The reserve is drained first and the origination fee is charged only on what
    ///      actually comes out of the trove, exactly as in a standalone `borrow`. Composing must
    ///      not change where the MUSD comes from.
    function test_depositAndBorrow_beyondTheReserveDrawsFromTheTroveAndChargesTheFee() public {
        uint256 reserve = vault.reserveMUSD();
        uint256 amount = reserve + 500e18;
        uint256 troveDebtBefore = _troveNetDebt();

        _depositAndBorrow(alice, 1 ether, amount);

        assertEq(vault.reserveMUSD(), 0, "reserve drained first");
        assertEq(musd.balanceOf(alice), amount);
        assertEq(vault.debtOf(alice), amount + (500e18 * 1e15) / 1e18, "fee only on the drawn portion");
        assertGt(_troveNetDebt(), troveDebtBefore);
    }

    // ------------------------------------------------------------------ //
    //                depositAndBorrow: the floor boundaries              //
    // ------------------------------------------------------------------ //

    /**
     * @notice Exactly at 180%, to the wei. The contract's own `collateralRequiredForDebt` quotes
     *         the collateral, and the borrow it quotes for has to be accepted. A quote the
     *         contract will not honour is a bug in one of the two.
     */
    function test_depositAndBorrow_atTheExact180PercentFloor() public {
        uint256 debt = 1000e18;
        uint256 collAtFloor = vault.collateralRequiredForDebt(debt, vault.MIN_BORROW_CR());

        _depositAndBorrow(alice, collAtFloor, debt);

        uint256 cr = vault.collateralRatioOf(alice);
        assertGe(cr, vault.MIN_BORROW_CR(), "the quoted collateral is accepted at the floor");
        // `collateralRequiredForDebt` rounds UP, so it can overshoot by less than one unit of
        // price/debt. Anything more than that would mean it is quoting a padded figure.
        assertLt(cr - vault.MIN_BORROW_CR(), BTC_PRICE / debt + 1, "and it is not over-quoting");
    }

    /// @dev One wei less collateral for the same debt, and it must be refused. This is the other
    ///      half of the boundary: the floor is a floor, not a suggestion.
    function testRevert_depositAndBorrow_oneWeiBelowTheFloor() public {
        uint256 debt = 1000e18;
        uint256 collAtFloor = vault.collateralRequiredForDebt(debt, vault.MIN_BORROW_CR());

        vm.deal(alice, collAtFloor);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenVault.InsufficientCollateralRatio.selector,
                ((collAtFloor - 1) * BTC_PRICE) / debt,
                vault.MIN_BORROW_CR()
            )
        );
        vault.depositAndBorrow{value: collAtFloor - 1}(debt, address(0), address(0));
    }

    /// @dev The minimum deposit is a boundary too. Exactly 0.001 BTC is accepted; one wei less
    ///      is the same `DepositBelowMinimum` a standalone `deposit` gives.
    function test_depositAndBorrow_atTheExactMinimumDeposit() public {
        _depositAndBorrow(alice, vault.MIN_DEPOSIT(), 10e18);
        assertEq(vault.collateral(alice), 0.001 ether);
        assertEq(vault.debtOf(alice), 10e18);
    }

    // ------------------------------------------------------------------ //
    //              depositAndBorrow: every revert path there is          //
    // ------------------------------------------------------------------ //

    function testRevert_depositAndBorrow_belowMinimumDeposit() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.DepositBelowMinimum.selector, 0.0009 ether, 0.001 ether)
        );
        vault.depositAndBorrow{value: 0.0009 ether}(100e18, address(0), address(0));
    }

    function testRevert_depositAndBorrow_whenDepositsArePaused() public {
        vm.prank(guardian);
        vault.setDepositsPaused(true);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.DepositsArePaused.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    /// @dev The deposit leg's guards are checked first, so a call that is bad on BOTH legs
    ///      reports the deposit's reason, which is what the sequential pair would report,
    ///      because the deposit is what a user would have sent first.
    function testRevert_depositAndBorrow_reportsTheDepositReasonWhenBothLegsAreBad() public {
        vm.prank(guardian);
        vault.setDepositsPaused(true);
        vm.prank(guardian);
        vault.setBorrowingPaused(true);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.DepositsArePaused.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    function testRevert_depositAndBorrow_overTheDepositCap() public {
        vm.prank(admin);
        vault.setDepositCap(SEED_COLLATERAL + 1 ether);
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenVault.DepositCapExceeded.selector, SEED_COLLATERAL + 2 ether, SEED_COLLATERAL + 1 ether
            )
        );
        vault.depositAndBorrow{value: 2 ether}(100e18, address(0), address(0));
    }

    function testRevert_depositAndBorrow_whenBorrowingIsPaused() public {
        vm.prank(guardian);
        vault.setBorrowingPaused(true);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.BorrowingIsPaused.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    function testRevert_depositAndBorrow_zeroBorrowAmount() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.ZeroAmount.selector);
        vault.depositAndBorrow{value: 1 ether}(0, address(0), address(0));
    }

    /// @dev With no pooled trove there is nothing to borrow against, and the call fails before
    ///      it takes the caller's BTC. A standalone `deposit` would have succeeded and held the
    ///      BTC idle; this is the atomicity difference, and it is the safe direction.
    function testRevert_depositAndBorrow_whenTheTroveIsNotOpen() public {
        _deployVault(); // a fresh vault, deliberately left unopened

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.TroveNotOpen.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));

        assertEq(vault.collateral(alice), 0, "no BTC was taken");
        assertEq(alice.balance, 1 ether, "and none left her wallet");
    }

    /// @dev A stale Mezo oracle surfaces as the named error, not as an opaque revert from three
    ///      contracts deep. The same guarantee a standalone `borrow` gives.
    function testRevert_depositAndBorrow_whenTheOracleIsStale() public {
        priceFeed.setStale(true);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    function testRevert_depositAndBorrow_whenTheOracleReturnsZero() public {
        priceFeed.setZero();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    /**
     * @notice The POOLED trove's own 180% floor, which is a separate check from the user's and
     *         binds in a case the user's does not.
     * @dev Constructed deliberately. At $1,500 the pooled trove is at 150% (2 BTC against
     *      2,001.8 MUSD of gross debt including the 200 gas compensation) while alice, at 1 BTC
     *      against 500 MUSD, is at 300%. She is individually healthy and the pool is not, so the
     *      borrow is refused on the pool's behalf rather than on hers. This is the check that
     *      keeps the shared trove away from the protocol's 110% cliff.
     */
    function testRevert_depositAndBorrow_whenThePooledTroveWouldSitBelow180() public {
        priceFeed.setPrice(1500e18);

        // 1,800 net + 1.8 origination fee + 200 gas compensation, all of it inside the trove.
        uint256 troveGrossDebt = 2001.8e18;
        uint256 expectedTroveCr = (2 ether * 1500e18) / troveGrossDebt;
        assertLt(expectedTroveCr, 1.8e18, "the pooled trove is the thing that is short here");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.TroveCollateralRatioTooLow.selector, expectedTroveCr, 1.8e18)
        );
        vault.depositAndBorrow{value: 1 ether}(500e18, address(0), address(0));
    }

    /// @dev A dead pooled trove halts this like every other mutation, and it halts on the shared
    ///      `_syncState` rather than on anything the composite invented.
    function testRevert_depositAndBorrow_whenTheTroveHasLeftTheActiveState() public {
        protocol.liquidateTrove(address(vault));

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenVault.TroveNoLongerActive.selector, protocol.STATUS_CLOSED_BY_LIQUIDATION()
            )
        );
        vault.depositAndBorrow{value: 1 ether}(100e18, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                  depositAndBorrow: revert parity                   //
    // ------------------------------------------------------------------ //

    /**
     * @notice The composite's revert is byte-identical to the single call's, argument values
     *         included. Asserting the selector alone would let a wrong `resultingCr` through,
     *         and the UI renders that number.
     */
    function test_depositAndBorrow_revertDataIsIdenticalToTheSingleCall() public {
        // Route A: deposit succeeds, then the standalone borrow fails. Capture the exact bytes.
        _deposit(alice, 0.01 ether);
        bytes memory sequentialRevert;
        vm.prank(alice);
        try vault.borrow(1000e18, address(0), address(0)) {
            revert("the borrow was supposed to fail");
        } catch (bytes memory err) {
            sequentialRevert = err;
        }

        // Route B: the same deposit and the same borrow, composed, from a clean account.
        bytes memory composedRevert;
        vm.deal(bob, 0.01 ether);
        vm.prank(bob);
        try vault.depositAndBorrow{value: 0.01 ether}(1000e18, address(0), address(0)) {
            revert("the composite was supposed to fail");
        } catch (bytes memory err) {
            composedRevert = err;
        }

        assertEq(composedRevert, sequentialRevert, "same error, same arguments, same bytes");
        assertEq(
            bytes4(composedRevert), MarenVault.InsufficientCollateralRatio.selector, "and it is the CR floor"
        );
    }

    /**
     * @notice The two orderings where the composite's revert reason is NOT the one the two
     *         separate calls would have produced (audit I-1).
     * @dev `depositAndBorrow` runs BOTH guard sets before either leg, which is what stops a
     *      doomed borrow from paying for an `addColl` the revert is about to undo. The price is
     *      that a borrow-leg guard now beats a deposit-leg failure that only surfaces at or
     *      after the state sync, and there are exactly two of those: `DepositCapExceeded`,
     *      measured after the sync, and `TroveNoLongerActive`, raised inside it.
     *
     *      Nothing executes in either case, so what a caller loses is diagnosis, not state.
     *      This is pinned rather than fixed because reordering the guards to restore parity
     *      would reintroduce the wasted `addColl`, which is the worse trade.
     */
    function test_depositAndBorrow_revertParityBreaksInExactlyTwoOrderings() public {
        // 1. Over the deposit cap AND a zero borrow. `deposit` alone reports the cap.
        uint256 tightCap = vault.totalCollateral() + 0.5 ether;
        vm.prank(admin);
        vault.setDepositCap(tightCap);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectPartialRevert(MarenVault.DepositCapExceeded.selector);
        vault.deposit{value: 1 ether}(address(0), address(0));

        vm.prank(alice);
        vm.expectRevert(MarenVault.ZeroAmount.selector);
        vault.depositAndBorrow{value: 1 ether}(0, address(0), address(0));

        // 2. A frozen pooled trove AND borrowing paused. `deposit` alone reports the freeze.
        vm.prank(admin);
        vault.setDepositCap(DEPOSIT_CAP);
        vm.prank(guardian);
        vault.setBorrowingPaused(true);
        protocol.liquidateTrove(address(vault));

        vm.prank(alice);
        vm.expectPartialRevert(MarenVault.TroveNoLongerActive.selector);
        vault.deposit{value: 1 ether}(address(0), address(0));

        vm.prank(alice);
        vm.expectRevert(MarenVault.BorrowingIsPaused.selector);
        vault.depositAndBorrow{value: 1 ether}(1e18, address(0), address(0));
    }

    /**
     * @notice THE ONE DELIBERATE DIFFERENCE, asserted rather than left to be discovered.
     * @dev Sequentially, a failed borrow leaves the deposit standing: the user is now a
     *      depositor who did not want to be one. Composed, the deposit is rolled back with it.
     *      That is strictly what the caller asked for ("deposit this AND draw that"), and it is
     *      the reason to prefer the composite, but an auditor comparing the two paths needs to
     *      see that the STATE differs even though the revert reason does not.
     */
    function test_depositAndBorrow_isAtomic_whereTheSequentialPairIsNot() public {
        // Sequential: the deposit survives its own success.
        _deposit(alice, 0.01 ether);
        vm.prank(alice);
        vm.expectPartialRevert(MarenVault.InsufficientCollateralRatio.selector);
        vault.borrow(1000e18, address(0), address(0));
        assertEq(vault.collateral(alice), 0.01 ether, "sequential: alice is stuck as a depositor");

        // Composed: nothing survives.
        uint256 totalBefore = vault.totalCollateral();
        vm.deal(bob, 0.01 ether);
        vm.prank(bob);
        vm.expectPartialRevert(MarenVault.InsufficientCollateralRatio.selector);
        vault.depositAndBorrow{value: 0.01 ether}(1000e18, address(0), address(0));

        assertEq(vault.collateral(bob), 0, "composed: bob is not a depositor");
        assertEq(bob.balance, 0.01 ether, "his BTC never left his wallet");
        assertEq(vault.totalCollateral(), totalBefore, "and the pool is untouched");
    }

    // ------------------------------------------------------------------ //
    //             depositAndBorrow: pending redemption first             //
    // ------------------------------------------------------------------ //

    /**
     * @notice A redemption that has landed but nobody has reconciled must be settled against
     *         this account BEFORE the composite reads its collateral, exactly like every other
     *         mutation. Otherwise a user could borrow against an entitlement the redemption
     *         already took.
     */
    function test_depositAndBorrow_settlesAPendingRedemptionFirst() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18);

        _redeem(redeemer, 2_000e18);
        assertGt(vault.pendingRedemptionCollateral(), 0, "precondition: a redemption is pending");
        uint256 debitOwed = vault.pendingRedemptionDebitOf(alice);
        assertGt(debitOwed, 0, "and alice owes part of it");
        uint256 stale = vault.collateral(alice);
        uint256 claimable = vault.collateralOf(alice);
        assertLt(claimable, stale, "the ledger is stale, the view is not");

        _depositAndBorrow(alice, 0.5 ether, 100e18);

        assertEq(vault.pendingRedemptionCollateral(), 0, "the composite reconciled it");
        assertEq(vault.pendingRedemptionDebitOf(alice), 0, "and settled alice's share of it");
        assertEq(vault.collateral(alice), claimable + 0.5 ether, "she was charged the debit, then credited");
        assertEq(vault.collateral(alice), vault.collateralOf(alice), "ledger and view now agree");
        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "the pool still covers the trove");
    }

    /// @dev And the 180% check afterwards is against the POST-settlement, post-deposit position,
    ///      not the stale one. A borrow that only fits if the redemption is ignored must fail.
    function test_depositAndBorrow_theFloorUsesThePostRedemptionCollateral() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 30_000e18); // deliberately close to the 180% floor

        uint256 headroomBefore = vault.maxBorrowable(alice);
        _redeem(redeemer, 5_000e18);

        // A redemption improves the ratio, so the headroom grows. What must NOT happen is the
        // headroom being computed from collateral the redemption already took.
        uint256 headroomAfter = vault.maxBorrowable(alice);
        _depositAndBorrow(alice, 0.001 ether, headroomAfter);

        assertGe(vault.collateralRatioOf(alice), vault.MIN_BORROW_CR(), "still at or above the floor");
        assertGt(headroomAfter, headroomBefore, "the redemption cancelled debt, so headroom grew");
    }

    // ------------------------------------------------------------------ //
    //                repayWithPermit: the approve-less repay             //
    // ------------------------------------------------------------------ //

    /// @dev The whole point: a user with an outstanding loan and zero allowance clears it in ONE
    ///      transaction, with no separate `approve` in front of it.
    function test_repayWithPermit_zeroPriorAllowanceRepaysInOneTransaction() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        assertEq(musd.allowance(alice, address(vault)), 0, "precondition: no allowance");

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 300e18, "the repayment landed");
        assertEq(musd.balanceOf(alice), 300e18);
        assertEq(musd.allowance(alice, address(vault)), 0, "the permit allowance was fully spent");
    }

    function test_repayWithPermit_emitsRepaid() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.expectEmit(true, false, false, true, address(vault));
        emit MarenVault.Repaid(alice, 200e18, 300e18);

        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
    }

    /**
     * @notice SECURITY PROPERTY: a permit signature sits in the public mempool and ANYONE can
     *         lift it and submit it straight to MUSD first, consuming the nonce.
     * @dev If `repayWithPermit` let that revert, a griefer could brick every approve-less
     *      repayment in the mempool for the price of gas, and repayments are an exit, which
     *      this contract will not let anyone close. The allowance the front-runner created is
     *      exactly the one the user signed for, so the repayment must still go through.
     */
    function test_repayWithPermit_survivesAPermitFrontRun() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        // The griefer front-runs, submitting the permit straight to MUSD. Nonce consumed.
        vm.prank(carol);
        musd.permit(alice, address(vault), 200e18, deadline, v, r, s);
        assertEq(musd.allowance(alice, address(vault)), 200e18);
        assertEq(musd.nonces(alice), 1, "the nonce is spent, so the signature is now dead");

        // The now-useless signature still reaches the vault. The repayment must not be bricked.
        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 300e18, "repaid anyway");
        assertEq(musd.allowance(alice, address(vault)), 0, "and the allowance was consumed");
    }

    /// @dev The same signature submitted to the vault twice. The second one's permit is dead, so
    ///      it is swallowed, and with no allowance left the transfer underneath refuses. A
    ///      replay repays once, never twice.
    function testRevert_repayWithPermit_replayFindsNoAllowanceLeft() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
        assertEq(vault.debtOf(alice), 300e18);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, 200e18
            )
        );
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 300e18, "the replay changed nothing");
    }

    /**
     * @notice The swallowed permit failure must NOT become a way to repay on someone else's
     *         behalf, or out of an account that never authorised it.
     * @dev With garbage signature bytes and no allowance, the `transferFrom` underneath still
     *      has to revert with MUSD's own error. The allowance IS the authorisation; the permit
     *      is only a way of creating one.
     */
    function testRevert_repayWithPermit_garbageSignatureWithNoAllowance() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, 200e18
            )
        );
        vault.repayWithPermit(
            200e18,
            block.timestamp + 1 hours,
            27,
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            address(0),
            address(0)
        );
    }

    /// @dev An expired permit is swallowed the same way an already-consumed one is, and lands on
    ///      the same allowance check. There is no separate expiry path to get wrong.
    function testRevert_repayWithPermit_expiredPermitWithNoAllowance() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);
        vm.warp(deadline + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, 200e18
            )
        );
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
    }

    /// @dev A permit signed by the wrong key is a permit that never worked, not a permit that
    ///      was front-run, and it lands in the same place: no allowance, no repayment.
    function testRevert_repayWithPermit_signedByADifferentKey() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        // Bob's key over alice's permit struct. MUSD rejects it; the vault swallows that.
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(bobPk, alice, 200e18, deadline);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(vault), 0, 200e18
            )
        );
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
    }

    function testRevert_repayWithPermit_withNoDebt() public {
        _deposit(alice, 0.5 ether);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.prank(alice);
        vm.expectRevert(MarenVault.NoDebt.selector);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
    }

    function testRevert_repayWithPermit_zeroAmount() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 0, deadline);

        vm.prank(alice);
        vm.expectRevert(MarenVault.ZeroAmount.selector);
        vault.repayWithPermit(0, deadline, v, r, s, address(0), address(0));
    }

    /**
     * @notice Repaying more than you owe repays exactly what you owe, and the permit only ever
     *         authorised what the transfer actually took.
     */
    function test_repayWithPermit_moreThanOwedRepaysExactlyWhatIsOwed() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        musd.mint(alice, 1_000e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 900e18, deadline);

        vm.prank(alice);
        vault.repayWithPermit(900e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 0);
        assertEq(vault.debtShares(alice), 0);
        assertEq(musd.balanceOf(alice), 1_000e18, "only the 500 she owed was taken");
        assertEq(musd.allowance(alice, address(vault)), 400e18, "the unspent permit allowance remains");
    }

    /**
     * @notice THE CAVEAT, asserted rather than left in a comment: closing out with
     *         `type(uint256).max` means signing a permit for `type(uint256).max`, and MUSD, like
     *         every OpenZeppelin ERC-20, treats a maximum allowance as infinite and never
     *         decrements it. The close-out works and takes only the debt, but it leaves this
     *         contract permanently approved.
     * @dev A user who does not want that signs for the exact figure instead, which the previous
     *      test is. The natspec on `repayWithPermit` says so; this is the proof it is true.
     */
    function test_repayWithPermit_maxAmountClosesOutButLeavesAStandingApproval() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, type(uint256).max, deadline);

        vm.prank(alice);
        vault.repayWithPermit(type(uint256).max, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 0, "the position is closed out");
        assertEq(musd.balanceOf(alice), 0, "exactly the debt was taken, no more");
        assertEq(
            musd.allowance(alice, address(vault)),
            type(uint256).max,
            "and an infinite approval outlives the call - this is the documented cost"
        );
    }

    /// @dev Repayment needs no price, so it must keep working while Mezo's oracle is down. The
    ///      permit does not change that: it is a signature check, not a price read.
    function test_repayWithPermit_worksWhileTheOracleIsDown() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);
        priceFeed.setStale(true);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(alice), 300e18, "an exit stays open with the oracle down");
    }

    /// @dev Repayment is an exit, and exits are never pausable. A guardian who has halted both
    ///      entries cannot halt this one either.
    function test_repayWithPermit_isNotPausable() public {
        _deposit(alice, 0.5 ether);
        _borrow(alice, 500e18);

        vm.prank(guardian);
        vault.setDepositsPaused(true);
        vm.prank(guardian);
        vault.setBorrowingPaused(true);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 200e18, deadline);

        vm.prank(alice);
        vault.repayWithPermit(200e18, deadline, v, r, s, address(0), address(0));
        assertEq(vault.debtOf(alice), 300e18);
    }

    /// @dev And it reconciles a pending redemption first, like every other mutation.
    function test_repayWithPermit_settlesAPendingRedemptionFirst() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18);

        _redeem(redeemer, 2_000e18);
        assertGt(vault.pendingRedemptionCollateral(), 0, "precondition: a redemption is pending");
        uint256 claimable = vault.collateralOf(alice);
        uint256 relievedDebt = vault.previewDebtOf(alice);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, 500e18, deadline);
        vm.prank(alice);
        vault.repayWithPermit(500e18, deadline, v, r, s, address(0), address(0));

        assertEq(vault.pendingRedemptionCollateral(), 0, "reconciled");
        assertEq(vault.pendingRedemptionDebitOf(alice), 0, "and alice's share settled");
        assertEq(vault.collateral(alice), claimable, "she paid the redemption debit");
        // The repayment came off the POST-redemption debt, not the stale pre-redemption one.
        // Not exact, and the direction is the point: shares burn DOWN, so the repayer keeps the
        // rounding dust as debt rather than being credited with more than she paid. A wei in the
        // other direction would be the solvency bug.
        assertGe(vault.debtOf(alice), relievedDebt - 500e18, "the dust stays with the repayer");
        assertApproxEqAbs(vault.debtOf(alice), relievedDebt - 500e18, 2, "repaid against the relieved debt");
    }

    // ------------------------------------------------------------------ //
    //                    The equivalence, fuzzed                         //
    // ------------------------------------------------------------------ //

    /**
     * @notice `depositAndBorrow(v, a)` and `deposit{value: v}()` then `borrow(a)` must leave the
     *         vault in the SAME state, for the same inputs.
     * @dev This is the assertion the whole refactor rests on, and it is the one that cannot be
     *      made by reading the code. The two paths share their internals precisely so that this
     *      holds, and this test is what notices if somebody ever un-shares them.
     *
     *      Both routes run from a snapshot of one identical starting state, which already has a
     *      standing position in it so the composite is exercised against a live ledger and not
     *      only against an empty one. The inputs are bounded so that BOTH routes succeed: where
     *      the borrow leg fails the two routes legitimately differ, and that difference is
     *      `test_depositAndBorrow_isAtomic_whereTheSequentialPairIsNot`, not a bug for this test
     *      to find.
     */
    function testFuzz_depositAndBorrow_isIdenticalToDepositThenBorrow(uint96 rawColl, uint96 rawDebt) public {
        uint256 depositAmount = bound(uint256(rawColl), vault.MIN_DEPOSIT(), 5 ether);
        // The reserve holds 1,800 less the 300 already drawn below, so this stays inside it and
        // inside the 180% floor on a position that has at least 0.501 BTC behind it.
        uint256 borrowAmount = bound(uint256(rawDebt), 1, 1_500e18);

        _deposit(alice, 0.5 ether);
        _borrow(alice, 300e18);

        uint256 snap = vm.snapshotState();

        // Route A: the two single calls, in sequence.
        vm.deal(alice, depositAmount);
        vm.prank(alice);
        vault.deposit{value: depositAmount}(address(0), address(0));
        vm.prank(alice);
        vault.borrow(borrowAmount, address(0), address(0));
        bytes32 sequential = _stateFingerprint();

        vm.revertToState(snap);

        // Route B: the composite.
        vm.deal(alice, depositAmount);
        vm.prank(alice);
        vault.depositAndBorrow{value: depositAmount}(borrowAmount, address(0), address(0));
        bytes32 composed = _stateFingerprint();

        assertEq(composed, sequential, "the composite must be indistinguishable from the pair");
    }

    /// @dev The same equivalence, with an unreconciled redemption sitting on the books when the
    ///      call arrives. Both routes have to settle it, and settle it the same way.
    function testFuzz_depositAndBorrow_isIdenticalToDepositThenBorrow_withAPendingRedemption(
        uint96 rawColl,
        uint96 rawDebt,
        uint96 rawRedemption
    ) public {
        uint256 depositAmount = bound(uint256(rawColl), vault.MIN_DEPOSIT(), 5 ether);
        uint256 borrowAmount = bound(uint256(rawDebt), 1, 500e18);
        // The pooled trove owes 1,801.8 net at this point (the seed plus its origination fee;
        // alice's 1,000 came out of the reserve and never touched it), so a redemption larger
        // than that is not a thing the protocol would accept.
        uint256 redemptionAmount = bound(uint256(rawRedemption), 1e18, 1_500e18);

        _deposit(alice, 1 ether);
        _borrow(alice, 1_000e18);
        _redeem(redeemer, redemptionAmount);
        assertGt(vault.pendingRedemptionCollateral(), 0, "a redemption is waiting to be applied");

        uint256 snap = vm.snapshotState();

        vm.deal(alice, depositAmount);
        vm.prank(alice);
        vault.deposit{value: depositAmount}(address(0), address(0));
        vm.prank(alice);
        vault.borrow(borrowAmount, address(0), address(0));
        bytes32 sequential = _stateFingerprint();

        vm.revertToState(snap);

        vm.deal(alice, depositAmount);
        vm.prank(alice);
        vault.depositAndBorrow{value: depositAmount}(borrowAmount, address(0), address(0));
        bytes32 composed = _stateFingerprint();

        assertEq(composed, sequential, "the reconciliation composes the same way in both routes");
    }

    /**
     * @dev Every slot the two paths can touch, hashed. A fingerprint rather than a wall of
     *      `assertEq` so that adding a field to it is one line and cannot be half-done. If a
     *      new piece of state is added to the deposit or borrow path it belongs here, and until
     *      it does this test is silent about it.
     */
    function _stateFingerprint() internal view returns (bytes32) {
        // Split in three purely to stay inside the EVM's stack window without `via_ir`, the
        // same reason MarenVault uses a `Liquidation` struct.
        bytes32 perAccount = keccak256(
            abi.encode(
                vault.collateral(alice),
                vault.debtShares(alice),
                vault.redemptionSnapshot(alice),
                vault.collateral(address(vault)),
                vault.debtShares(address(vault)),
                musd.balanceOf(alice),
                alice.balance
            )
        );
        bytes32 pooled = keccak256(
            abi.encode(
                vault.totalCollateral(),
                vault.totalDebtShares(),
                vault.interestIndex(),
                vault.idleCollateral(),
                vault.reserveMUSD(),
                vault.outstandingDebt()
            )
        );
        bytes32 redemptionAndChain = keccak256(
            abi.encode(
                vault.redemptionCollateralPerShare(),
                vault.totalCollateralRedeemed(),
                vault.totalDebtRedeemed(),
                vault.redemptionShortfall(),
                musd.balanceOf(address(vault)),
                address(vault).balance,
                protocol.getTroveColl(address(vault)),
                protocol.getTroveDebt(address(vault))
            )
        );
        return keccak256(abi.encode(perAccount, pooled, redemptionAndChain));
    }
}
