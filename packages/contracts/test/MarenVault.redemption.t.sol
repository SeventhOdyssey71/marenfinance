// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../src/MarenVault.sol";
import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {MockMusdProtocol} from "./mocks/MockMusdProtocol.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";

/**
 * @title MarenVaultRedemptionTest
 * @notice The redemption splitter: what happens to a pooled trove when somebody else's MUSD
 *         reaches into it.
 *
 * A redemption is the only event that changes the pooled trove without any user or keeper
 * asking. It removes collateral and removes exactly the same VALUE of debt. The question the
 * whole pooled design has to answer is who those two halves belong to, and these tests are
 * the answer: pro rata by debt shares, so every debtor loses collateral worth precisely the
 * debt they stopped owing, and a depositor with no debt loses nothing at all.
 *
 * What is asserted throughout:
 *   1. VALUE NEUTRALITY. `collateral * price - debt` is unchanged for every account at the
 *      instant of the redemption.
 *   2. CONSERVATION. What every account can claim never exceeds what the trove holds.
 *   3. NO STALE WINDOW. A user cannot act on a pre-redemption entitlement, because every
 *      mutation reconciles before it reads anything.
 *   4. ROUNDING DIRECTION. Dust lands in the pool, never in a withdrawer's pocket.
 */
contract MarenVaultRedemptionTest is VaultTestBase {
    address internal redeemer = makeAddr("redeemer");

    function setUp() public {
        _deployVault();
        _openPooledTrove();
    }

    /// @dev Two users with deliberately uneven positions, plus the vault's own seed position
    ///      carrying the origination fee. Three shareholders, none of them equal.
    function _seedTwoBorrowers() internal {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18);
        _deposit(bob, 0.5 ether);
        _borrow(bob, 5_000e18);
    }

    function _netValue(address who) internal view returns (int256) {
        return int256((vault.collateralOf(who) * BTC_PRICE) / 1e18) - int256(vault.debtOf(who));
    }

    /**
     * @dev The contract's own documented rounding bound, in wei: one wei of error in a
     *      per-share quantity is worth `totalDebtShares / 1e18` across every holder. Tests
     *      assert against this rather than against a number somebody picked, so a change in
     *      rounding DIRECTION fails even though a change in rounding MAGNITUDE of this size
     *      is expected.
     */
    function _roundingBound() internal view returns (uint256) {
        return vault.totalDebtShares() / 1e18 + 4;
    }

    // ------------------------------------------------------------------ //
    //                           The pro rata math                        //
    // ------------------------------------------------------------------ //

    /**
     * @notice Every position's debt falls by the same fraction, and every position gives up
     *         collateral worth exactly the debt it stopped owing.
     */
    function test_redemption_splitsProRataByDebtShares() public {
        _seedTwoBorrowers();

        uint256 aliceDebtBefore = vault.debtOf(alice);
        uint256 bobDebtBefore = vault.debtOf(bob);
        uint256 vaultDebtBefore = vault.debtOf(address(vault));
        uint256 aliceCollBefore = vault.collateralOf(alice);
        uint256 bobCollBefore = vault.collateralOf(bob);
        int256 aliceValueBefore = _netValue(alice);
        int256 bobValueBefore = _netValue(bob);

        assertGt(aliceDebtBefore, bobDebtBefore, "the two positions are deliberately uneven");

        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        uint256 aliceRelief = aliceDebtBefore - vault.debtOf(alice);
        uint256 bobRelief = bobDebtBefore - vault.debtOf(bob);
        uint256 vaultRelief = vaultDebtBefore - vault.debtOf(address(vault));

        // The three reliefs sum to the redemption, and each is in proportion to the debt held.
        // The tolerance is the rounding bound the contract documents: one wei of index or of
        // per-share error, worth `totalDebtShares / 1e18` wei across every holder.
        assertApproxEqAbs(
            aliceRelief + bobRelief + vaultRelief, 2_000e18, _roundingBound(), "relief sums to the redemption"
        );
        assertApproxEqAbs(
            (aliceRelief * 1e18) / aliceDebtBefore,
            (bobRelief * 1e18) / bobDebtBefore,
            1e9,
            "both positions were relieved by the same fraction"
        );

        // And each account's collateral fell by exactly that relief, valued at the oracle.
        // Exactly, to within the same wei-of-per-share rounding, and on the side that leaves
        // the wei in the pool.
        assertApproxEqAbs(
            aliceCollBefore - vault.collateralOf(alice),
            (aliceRelief * 1e18) / BTC_PRICE,
            _roundingBound(),
            "alice gave up collateral worth exactly the debt she stopped owing"
        );
        assertApproxEqAbs(
            bobCollBefore - vault.collateralOf(bob),
            (bobRelief * 1e18) / BTC_PRICE,
            _roundingBound(),
            "and so did bob"
        );

        // Which is the same statement as: nobody is richer or poorer for it.
        int256 tolerance = int256((_roundingBound() * BTC_PRICE) / 1e18 + 1);
        assertApproxEqAbs(
            _netValue(alice), aliceValueBefore, uint256(tolerance), "alice's net position value is unchanged"
        );
        assertApproxEqAbs(
            _netValue(bob), bobValueBefore, uint256(tolerance), "bob's net position value is unchanged"
        );
    }

    /// @notice A depositor with no debt is handed no relief, so they surrender no collateral.
    ///         This is the reason the split is by debt shares and not by collateral.
    function test_redemption_leavesDebtFreeDepositorsUntouched() public {
        _seedTwoBorrowers();
        _deposit(carol, 2 ether); // carol never borrows

        uint256 carolBefore = vault.collateralOf(carol);
        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        assertEq(vault.collateralOf(carol), carolBefore, "a lender-free depositor pays nothing");
        assertEq(vault.debtOf(carol), 0);
        assertLt(vault.collateralOf(alice), 1 ether, "the debtors paid it");
    }

    /// @notice A redemption improves every position's collateral ratio, exactly as it does for
    ///         a standalone trove that gets redeemed.
    function test_redemption_improvesCollateralRatios() public {
        _seedTwoBorrowers();
        uint256 aliceCrBefore = vault.collateralRatioOf(alice);
        uint256 troveCrBefore = protocol.getCurrentICR(address(vault), BTC_PRICE);

        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        assertGt(vault.collateralRatioOf(alice), aliceCrBefore, "alice is safer than she was");
        assertGt(protocol.getCurrentICR(address(vault), BTC_PRICE), troveCrBefore, "so is the pooled trove");
    }

    /// @notice The books match the trove again once the redemption is reconciled. Before it,
    ///         they do not, and the vault says so rather than pretending otherwise.
    function test_redemption_reconciliationRestoresTheCustodyInvariant() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);

        assertGt(vault.pendingRedemptionCollateral(), 0, "the vault can see the gap before anyone acts");
        assertGt(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "the books are ahead of the trove until reconciled"
        );

        vault.reconcileRedemption();

        assertEq(vault.pendingRedemptionCollateral(), 0);
        assertEq(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "credited collateral equals trove collateral plus idle again"
        );
        assertGe(vault.totalCollateral(), _sumClaimableCollateral(), "and it covers every claim");
    }

    /// @notice Reconciliation is permissionless, like `syncTrove()`, and needs no price. It
    ///         still works while Mezo's oracle is down, which is when a redemption is most
    ///         likely to land.
    function test_redemption_anyoneCanReconcileEvenWithTheOracleDown() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);
        priceFeed.setStale(true);

        vm.prank(makeAddr("passing_stranger"));
        vault.reconcileRedemption();

        assertEq(vault.pendingRedemptionCollateral(), 0, "reconciled without ever reading a price");
        assertGt(vault.totalCollateralRedeemed(), 0);
    }

    /// @notice `syncTrove()` is the same mechanism under its original name, so a keeper that
    ///         predates this change keeps working.
    function test_redemption_syncTroveReconcilesToo() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);

        vault.syncTrove();

        assertEq(vault.pendingRedemptionCollateral(), 0);
    }

    function test_redemption_emitsReconciledWithMeasuredAmounts() public {
        _seedTwoBorrowers();
        uint256 accountedBefore = vault.accountedDebt();
        _redeem(redeemer, 2_000e18);

        uint256 expectedColl = (2_000e18 * 1e18) / BTC_PRICE;
        uint256 expectedDebt = accountedBefore - vault.outstandingDebt();

        vm.recordLogs();
        vault.reconcileRedemption();

        // The event carries what was MEASURED off the trove, not what was passed in.
        assertApproxEqAbs(vault.totalCollateralRedeemed(), expectedColl, 1, "collateral removed");
        assertApproxEqAbs(vault.totalDebtRedeemed(), expectedDebt, 1, "debt removed");
    }

    // ------------------------------------------------------------------ //
    //                    No user action sees stale books                 //
    // ------------------------------------------------------------------ //

    /**
     * @notice The attack this mechanism exists to stop: withdraw the pre-redemption balance
     *         before anybody reconciles, and leave the shortfall to whoever comes last.
     * @dev No `reconcileRedemption()` call anywhere in this test. `withdraw` does it, before
     *      it reads a single byte of alice's ledger.
     */
    function test_redemption_withdrawCannotTakeThePreRedemptionEntitlement() public {
        _seedTwoBorrowers();
        _deposit(carol, 1 ether);
        uint256 aliceLedgerBefore = vault.collateral(alice);

        _redeem(redeemer, 12_000e18);

        // The raw mapping still shows the old number. The claimable number does not.
        assertEq(vault.collateral(alice), aliceLedgerBefore, "the ledger has not been touched yet");
        uint256 claimable = vault.collateralOf(alice);
        assertLt(claimable, aliceLedgerBefore, "but the claim is already smaller");

        // Repay everything so the 180% floor is not what is doing the work here, then try to
        // walk away with the stale entitlement.
        deal(address(musd), alice, 20_000e18);
        vm.prank(alice);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.repay(type(uint256).max, address(0), address(0));

        assertEq(vault.collateral(alice), claimable, "the repay reconciled her first");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.InsufficientCollateral.selector, aliceLedgerBefore, claimable)
        );
        vault.withdraw(aliceLedgerBefore, address(0), address(0));

        // What she can take is exactly the post-redemption entitlement, and taking it leaves
        // the pool whole for everyone else.
        vm.prank(alice);
        vault.withdraw(claimable, address(0), address(0));

        assertEq(vault.collateral(alice), 0);
        assertGe(vault.totalCollateral(), _sumClaimableCollateral(), "carol and bob are still covered");
        assertEq(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "and the books still match the trove"
        );
    }

    /// @notice Every user-facing mutation reconciles first, with no keeper in the loop.
    function test_redemption_isReconciledByEveryMutation() public {
        // deposit
        _seedTwoBorrowers();
        _redeem(redeemer, 1_000e18);
        _deposit(carol, 1 ether);
        assertEq(vault.pendingRedemptionCollateral(), 0, "deposit reconciled");

        // borrow
        _redeem(redeemer, 1_000e18);
        _borrow(carol, 100e18);
        assertEq(vault.pendingRedemptionCollateral(), 0, "borrow reconciled");

        // repay
        _redeem(redeemer, 1_000e18);
        _repay(carol, 10e18);
        assertEq(vault.pendingRedemptionCollateral(), 0, "repay reconciled");

        // withdraw
        _redeem(redeemer, 1_000e18);
        _withdraw(carol, 0.1 ether);
        assertEq(vault.pendingRedemptionCollateral(), 0, "withdraw reconciled");
    }

    /// @notice Views are honest in the window between the redemption landing and anyone
    ///         transacting. A UI must not show a number the next transaction will erase.
    function test_redemption_viewsAreHonestBeforeAnyoneReconciles() public {
        _seedTwoBorrowers();
        uint256 debtBefore = vault.previewDebtOf(alice);
        uint256 collBefore = vault.collateralOf(alice);

        _redeem(redeemer, 2_000e18);

        assertLt(vault.previewDebtOf(alice), debtBefore, "debt relief shows immediately");
        assertLt(vault.collateralOf(alice), collBefore, "and so does the collateral it cost");
        assertGt(vault.pendingRedemptionDebitOf(alice), 0);

        uint256 previewedDebt = vault.previewDebtOf(alice);
        uint256 previewedColl = vault.collateralOf(alice);

        vault.reconcileRedemption();

        assertEq(vault.debtOf(alice), previewedDebt, "the view predicted the settled debt exactly");
        assertEq(vault.collateralOf(alice), previewedColl, "and the settled collateral exactly");
    }

    // ------------------------------------------------------------------ //
    //                      Ordering and composition                      //
    // ------------------------------------------------------------------ //

    /// @notice Redemptions compose. Three of them, settled once at the end, leave the same
    ///         books as settling after each one.
    function test_redemption_sequentialRedemptionsCompose() public {
        _seedTwoBorrowers();

        _redeem(redeemer, 1_000e18);
        vault.reconcileRedemption();
        uint256 aliceMid = vault.collateralOf(alice);

        _redeem(redeemer, 1_500e18);
        _redeem(redeemer, 500e18); // two in a row with no reconciliation between them
        vault.reconcileRedemption();

        assertLt(vault.collateralOf(alice), aliceMid, "the later two also reached her");
        assertApproxEqAbs(
            vault.totalDebtRedeemed(), 3_000e18, _roundingBound(), "all three are accounted for"
        );
        assertEq(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "books still match the trove after three"
        );
        assertGe(vault.totalCollateral(), _sumClaimableCollateral());
    }

    /**
     * @notice A user who deposits AFTER a redemption is not charged for it. The snapshot is
     *         what makes this true, and getting it wrong is how a lazy accumulator usually
     *         breaks.
     */
    function test_redemption_thenDepositIsNotChargedForTheEarlierRedemption() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);

        _deposit(carol, 1 ether);
        _borrow(carol, 1_000e18);

        assertEq(vault.pendingRedemptionDebitOf(carol), 0, "carol owes nothing for a redemption she missed");
        assertEq(vault.collateralOf(carol), 1 ether);

        // But she does pay her share of the next one.
        uint256 carolDebt = vault.debtOf(carol);
        _redeem(redeemer, 1_000e18);
        vault.reconcileRedemption();

        assertGt(vault.debtOf(carol), 0);
        assertLt(vault.debtOf(carol), carolDebt, "carol got relief from the second");
        assertLt(vault.collateralOf(carol), 1 ether, "and paid for it");
    }

    /// @notice Borrowing after a redemption mints shares at the re-pegged index, so the new
    ///         borrower is not handed a discount and does not subsidise anyone either.
    function test_redemption_thenBorrowPricesSharesAtTheNewIndex() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        _deposit(carol, 1 ether);
        _borrow(carol, 1_000e18);

        assertApproxEqAbs(vault.debtOf(carol), 1_000e18, 2e18, "carol owes what she borrowed, plus the fee");
        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "the pool still covers the trove");
    }

    // ------------------------------------------------------------------ //
    //                        Rounding and dust                           //
    // ------------------------------------------------------------------ //

    /**
     * @notice Dust from the per-share division stays in the pool. The sum of what everyone can
     *         claim is never more than what the trove holds, and the gap is at most a wei per
     *         shareholder.
     */
    function test_redemption_dustFavoursThePool() public {
        // Deliberately ugly numbers so the divisions do not come out even.
        _deposit(alice, 0.333333333333333333 ether);
        _borrow(alice, 3_333.333333333333333333e18);
        _deposit(bob, 0.777777777777777777 ether);
        _borrow(bob, 1_111.111111111111111111e18);

        _redeem(redeemer, 1_234.567890123456789e18);
        vault.reconcileRedemption();

        uint256 claimable = _sumClaimableCollateral();
        assertLe(claimable, vault.totalCollateral(), "claims never exceed the ledger total");
        assertLe(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "and the ledger total never exceeds the trove"
        );
        // The gap is dust, not a leak: it is bounded by one wei of per-share error across
        // every holder, and it is the pool that keeps it.
        assertGe(claimable + _roundingBound(), vault.totalCollateral(), "the dust is dust, not a leak");
        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "debt rounding still favours the protocol");
    }

    /// @notice The index moves down by the measured relief and not a wei more, so shareholders
    ///         still owe at least what the trove owes.
    function test_redemption_indexScalesDownButDebtStillCoversTheTrove() public {
        _seedTwoBorrowers();
        uint256 indexBefore = vault.interestIndex();

        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        assertLt(vault.interestIndex(), indexBefore, "the one place the index is allowed to fall");
        assertGe(vault.accountedDebt(), vault.outstandingDebt(), "and it never falls too far");
        assertGe(_sumTrackedDebt(), vault.outstandingDebt());
    }

    /// @notice Interest that accrued but had not been folded into the index yet is still owed
    ///         after a redemption. The redemption cancels debt; it does not cancel interest
    ///         nobody had accrued yet.
    function test_redemption_doesNotEraseUnaccruedInterest() public {
        _seedTwoBorrowers();
        vm.warp(block.timestamp + 180 days);

        uint256 outstandingWithInterest = vault.outstandingDebt();
        assertGt(outstandingWithInterest, vault.accountedDebt(), "interest is owed but not yet accrued");

        _redeem(redeemer, 2_000e18);
        vault.reconcileRedemption();

        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "the pool still covers the trove");
        assertApproxEqAbs(
            vault.accountedDebt(),
            outstandingWithInterest - 2_000e18,
            1e15,
            "relief is the redemption, no more"
        );
    }

    /**
     * @notice A redemption large enough to cancel almost all pooled user debt, followed by a
     *         borrow. The index is re-pegged to near its floor, so every share minted after
     *         that is enormous, and the per-share collateral debit has to stay exact anyway.
     * @dev This is the case that set `REDEMPTION_PRECISION` to 1e36. At 1e18 the rounding on a
     *      share count of this size was worth thousands of BTC. The invariant suite found it;
     *      this test pins it.
     */
    function test_redemption_nearTotalRedemptionKeepsTheBooksSane() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18);

        // Redeem everything the pool's users owe, bar a wei.
        _redeem(redeemer, vault.outstandingDebt() - 1);
        vault.reconcileRedemption();

        assertLt(vault.interestIndex(), 1e12, "the index is re-pegged to almost nothing");
        assertGe(vault.interestIndex(), 1, "but never to zero, or the next borrow divides by it");
        assertLe(vault.debtOf(alice), 1e6, "alice owes essentially nothing now");
        assertApproxEqAbs(
            vault.collateralOf(alice),
            1 ether - (10_008e18 * 1e18) / BTC_PRICE,
            0.0001 ether,
            "and paid for it in collateral worth what she stopped owing"
        );

        // Now borrow again against the collapsed index, which mints an enormous share count.
        _deposit(bob, 1 ether);
        _borrow(bob, 5_000e18);
        assertGt(vault.debtShares(bob), 1e30, "shares are minted against a near-zero index");

        uint256 bobCollBefore = vault.collateralOf(bob);
        _redeem(redeemer, 1_000e18);
        vault.reconcileRedemption();

        // The debit on that huge share count is still the right size, to the satoshi.
        assertApproxEqAbs(
            bobCollBefore - vault.collateralOf(bob),
            (1_000e18 * 1e18) / BTC_PRICE,
            1e10,
            "the per-share debit survives a collapsed index"
        );
        assertLe(
            _sumClaimableCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral() + vault.redemptionShortfall(),
            "and conservation holds through all of it"
        );
    }

    /**
     * @notice KNOWN LIMIT, pinned rather than buried (audit H-2). When a redemption cancels
     *         MORE trove debt than the pool's users actually owe, users are charged the full
     *         collateral that left the trove but are handed only the relief they could use.
     * @dev `outstandingDebt = troveNetDebt - reserveMUSD`, so the gap opens exactly when
     *      `reserveMUSD` is non-zero and the redemption exceeds what is left after subtracting
     *      it. The excess relief lands in the reserve, which no user has a claim on. The loss
     *      is bounded by `reserveMUSD` at the instant the redemption lands, which is what this
     *      asserts alongside the loss itself.
     *
     *      Reaching a large reserve is not exotic: `_pushRepayment` is best effort and tolerates
     *      a stale oracle, so every repayment made during an oracle outage piles up there until
     *      a keeper deleverages. That is the sequence below.
     *
     *      This test asserts the CURRENT behaviour, including the part that is wrong. Fixing it
     *      means deciding who absorbs the excess, the protocol's own position or the pool,
     *      and that is a governance call, not a rounding one. When it is made, this test is the
     *      one to invert.
     */
    function test_redemption_reliefIsCappedByTheReserveWhileTheCollateralDebitIsNot() public {
        _deposit(alice, 2 ether);
        _borrow(alice, 30_000e18);
        _deposit(bob, 2 ether);
        _borrow(bob, 10_000e18);

        // The oracle goes down. Repayments still settle; they just cannot reach the trove.
        priceFeed.setStale(true);
        _repay(alice, 25_000e18);
        priceFeed.setStale(false);

        uint256 reserve = vault.reserveMUSD();
        assertGt(reserve, 0, "the stalled repayment is sitting in the reserve");
        assertEq(
            vault.outstandingDebt(),
            _troveNetDebt() - reserve,
            "and it is exactly what separates trove debt from user debt"
        );

        uint256 debtBefore = vault.debtOf(alice) + vault.debtOf(bob) + vault.debtOf(address(vault));
        uint256 collBefore = _sumClaimableCollateral();

        // A redemption larger than the pool's users owe, but not large enough to close the trove.
        _redeem(redeemer, 25_000e18);
        vault.reconcileRedemption();

        uint256 relief = debtBefore - (vault.debtOf(alice) + vault.debtOf(bob) + vault.debtOf(address(vault)));
        uint256 charged = collBefore - _sumClaimableCollateral();
        uint256 chargedValue = (charged * BTC_PRICE) / 1e18;

        assertGt(chargedValue, relief, "users paid more collateral value than the relief they received");
        assertLe(chargedValue - relief, reserve, "and the gap is bounded by the reserve, as documented");
        assertApproxEqRel(
            chargedValue - relief,
            25_000e18 - relief,
            0.01e18,
            "the gap is the redemption the reserve absorbed"
        );
        assertGt(
            vault.reserveMUSD(),
            _troveNetDebt(),
            "the vault now holds more MUSD than the trove owes, credited to nobody"
        );
    }

    // ------------------------------------------------------------------ //
    //                   Redemption is not liquidation                    //
    // ------------------------------------------------------------------ //

    /**
     * @notice A liquidated pooled trove removes collateral WITHOUT cancelling user debt. On
     *         the collateral ledger alone it is indistinguishable from a redemption, and
     *         treating it as one would hand users relief the pool never received.
     */
    function test_liquidatedTroveHaltsMutationsInsteadOfMisattributing() public {
        _seedTwoBorrowers();
        uint256 aliceDebtBefore = vault.debtOf(alice);

        protocol.liquidateTrove(address(vault));

        bytes memory expected = abi.encodeWithSelector(MarenVault.TroveNoLongerActive.selector, 3);

        vm.prank(alice);
        vm.expectRevert(expected);
        vault.withdraw(0.1 ether, address(0), address(0));

        vm.prank(alice);
        vm.expectRevert(expected);
        vault.borrow(1e18, address(0), address(0));

        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(expected);
        vault.deposit{value: 1 ether}(address(0), address(0));

        vm.prank(alice);
        vm.expectRevert(expected);
        vault.repay(1e18, address(0), address(0));

        vm.expectRevert(expected);
        vault.reconcileRedemption();

        assertEq(vault.debtOf(alice), aliceDebtBefore, "nobody was handed phantom debt relief");
        assertEq(vault.totalCollateralRedeemed(), 0, "and nothing was booked as a redemption");
    }

    /// @notice A redemption large enough to consume the trove closes it too, and halts for the
    ///         same reason: the collateral left is in the CollSurplusPool, not the trove, and
    ///         paying claims out of what remains first-come-first-served is the failure mode
    ///         this whole mechanism exists to prevent.
    function test_fullyRedeemedTroveHaltsMutations() public {
        _seedTwoBorrowers();
        protocol.fullyRedeemTrove(address(vault));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MarenVault.TroveNoLongerActive.selector, 4));
        vault.withdraw(0.1 ether, address(0), address(0));
    }

    /// @notice A partial redemption leaves the trove active, which is what makes it a
    ///         redemption rather than an ending.
    function test_partialRedemptionLeavesTheTroveActive() public {
        _seedTwoBorrowers();
        _redeem(redeemer, 2_000e18);
        assertEq(protocol.getTroveStatus(address(vault)), 1, "still active");
        vault.reconcileRedemption();
        _withdraw(alice, 0.01 ether); // and business continues
    }

    // ------------------------------------------------------------------ //
    //                     The underwater edge case                       //
    // ------------------------------------------------------------------ //

    /**
     * @notice When a position is already worth less than it owes, its share of a redemption
     *         can exceed every wei it holds. The debit is capped at what it has and the
     *         remainder is RECORDED, not spread silently onto the other users.
     * @dev Reaching this requires a position below 100%, which means the vault already has
     *      bad debt by any measure. It is here because an auditor will ask, not because it is
     *      expected.
     */
    function test_redemption_shortfallIsRecordedNotSocialised() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 30_000e18);
        _deposit(carol, 5 ether); // a large, debt-free depositor who must not be touched
        uint256 carolBefore = vault.collateralOf(carol);

        // BTC falls far enough to put alice under water.
        priceFeed.setPrice(BTC_PRICE / 3);
        assertLt(vault.collateralRatioOf(alice), 1e18, "alice is below 100%");

        _redeem(redeemer, 25_000e18);
        vault.reconcileRedemption();
        assertEq(vault.collateralOf(alice), 0, "her whole balance is owed and then some");
        assertEq(vault.redemptionShortfall(), 0, "but nothing is RECORDED until she is settled");

        // Anyone can flush her ledger, which is what turns the gap into a recorded number.
        vault.settleRedemption(alice);

        assertEq(vault.collateral(alice), 0, "alice's collateral covered what it could");
        assertGt(vault.redemptionShortfall(), 0, "and the rest is recognised, loudly");

        // Carol, who never borrowed, is untouched by any of it.
        assertEq(vault.collateralOf(carol), carolBefore, "the shortfall was not spread onto her");
    }

    /**
     * @notice REGRESSION (audit H-1). A recognised shortfall must not be re-read as a fresh
     *         redemption.
     * @dev `_recogniseShortfall` credits the uncollectable debit back to `totalCollateral` so
     *      the per-account ledger still sums to it. That leaves the books permanently above
     *      what the trove holds, by exactly the shortfall. The redemption detector reads that
     *      same difference. Before the fix it therefore saw the shortfall as a brand new
     *      redemption on the very next sync: `pendingRedemptionCollateral()` reported it, and
     *      `reconcileRedemption()` booked it into `totalCollateralRedeemed` and charged it pro
     *      rata to everyone still holding debt shares, with no debt relief to go with it.
     *
     *      The precondition is only that some position is under 100%, and both
     *      `settleRedemption` and `reconcileRedemption` are permissionless, so any passer-by
     *      could drive the loop.
     */
    function test_redemption_recognisedShortfallIsNotReReadAsAFreshRedemption() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 30_000e18);
        _deposit(bob, 10 ether);
        _borrow(bob, 1_000e18); // a healthy debtor: the one who was being charged

        priceFeed.setPrice(BTC_PRICE / 3);
        _redeem(redeemer, 25_000e18);
        vault.reconcileRedemption();

        // Flushing alice's ledger turns the uncollectable part of her debit into a number.
        vault.settleRedemption(alice);
        uint256 shortfall = vault.redemptionShortfall();
        assertGt(shortfall, 0, "alice was under water, so part of her debit could not be charged");

        // The books now sit exactly `shortfall` above the trove, deliberately. That gap is NOT
        // a redemption and must not read as one.
        assertEq(
            vault.totalCollateral() - vault.idleCollateral() - shortfall,
            protocol.getTroveColl(address(vault)),
            "the gap between books and trove is the shortfall and nothing else"
        );
        assertEq(vault.pendingRedemptionCollateral(), 0, "and it is not reported as a pending redemption");

        uint256 bobClaim = vault.collateralOf(bob);
        uint256 protocolClaim = vault.collateralOf(address(vault));
        uint256 bobDebt = vault.debtOf(bob);
        uint256 redeemedBefore = vault.totalCollateralRedeemed();

        // Nothing has happened on chain. Grind the two permissionless entrypoints anyway.
        for (uint256 i; i < 10; ++i) {
            vault.reconcileRedemption();
            vault.settleRedemption(alice);
            vault.settleRedemption(bob);
        }

        assertEq(vault.totalCollateralRedeemed(), redeemedBefore, "no phantom redemption was booked");
        assertEq(vault.collateralOf(bob), bobClaim, "the healthy debtor paid nothing for it");
        assertEq(vault.collateral(bob), bobClaim, "and his ledger balance is untouched too");
        assertEq(vault.debtOf(bob), bobDebt, "and was handed no phantom relief either");
        assertEq(vault.collateralOf(address(vault)), protocolClaim, "nor was the protocol's own position");
        assertEq(vault.redemptionShortfall(), shortfall, "the shortfall stayed exactly one shortfall");
    }

    /**
     * @notice REGRESSION (audit H-1). A genuine redemption arriving AFTER a recognised
     *         shortfall is still measured correctly, and is measured on top of it.
     * @dev The fix subtracts `redemptionShortfall` from the books before comparing them with
     *      the trove. This pins that it subtracts it once and does not swallow real
     *      redemptions along with it.
     */
    function test_redemption_afterAShortfallIsStillMeasuredExactly() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 30_000e18);
        _deposit(bob, 10 ether);
        _borrow(bob, 5_000e18);

        priceFeed.setPrice(BTC_PRICE / 3);
        _redeem(redeemer, 25_000e18);
        vault.reconcileRedemption();
        vault.settleRedemption(alice);
        assertGt(vault.redemptionShortfall(), 0, "the shortfall exists before the second redemption");

        uint256 shortfall = vault.redemptionShortfall();
        uint256 redeemedBefore = vault.totalCollateralRedeemed();
        uint256 bobDebtBefore = vault.debtOf(bob);
        uint256 bobCollBefore = vault.collateralOf(bob);

        uint256 second = 2_000e18;
        _redeem(redeemer, second);
        uint256 expectedColl = (second * 1e18) / (BTC_PRICE / 3);
        assertApproxEqAbs(
            vault.pendingRedemptionCollateral(), expectedColl, 4, "the second redemption is seen at full size"
        );

        vault.reconcileRedemption();
        assertApproxEqAbs(
            vault.totalCollateralRedeemed() - redeemedBefore, expectedColl, 4, "and booked at full size"
        );
        assertEq(vault.redemptionShortfall(), shortfall, "without disturbing the recorded shortfall");

        // Bob still pays for exactly the debt he stopped owing, at the current price.
        uint256 reliefValue = ((bobCollBefore - vault.collateralOf(bob)) * (BTC_PRICE / 3)) / 1e18;
        assertApproxEqAbs(
            reliefValue, bobDebtBefore - vault.debtOf(bob), 1e15, "value neutrality survives the shortfall"
        );
    }

    // ------------------------------------------------------------------ //
    //                Keeper visibility: the silent no-ops                //
    // ------------------------------------------------------------------ //

    /// @notice `deleverage()` used to emit `Deleveraged(0, ...)` when the trove was already at
    ///         the protocol's 1,800 MUSD floor and there was no room to repay into it. That
    ///         reads as a success to a keeper watching events during a drawdown.
    function test_deleverage_revertsWhenTheTroveHasNoRoomLeft() public {
        uint256 room = _troveNetDebt() - vault.MIN_NET_DEBT();
        assertGt(room, 0, "the seed's origination fee is the only room there is");

        vm.prank(keeper);
        vault.deleverage(room, address(0), address(0));
        assertEq(_troveNetDebt(), vault.MIN_NET_DEBT(), "the trove is now flat on the floor");

        vm.prank(keeper);
        vm.expectRevert(MarenVault.NothingRepaid.selector);
        vault.deleverage(1e18, address(0), address(0));
    }

    /// @notice And when there IS room, it still works and reports what actually moved.
    function test_deleverage_movesWhatItSaysItMoves() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18); // pushes trove debt well above the floor
        _stallRepaymentIntoReserve(alice, 5_000e18);

        uint256 reserveBefore = vault.reserveMUSD();
        assertGt(reserveBefore, 0);

        uint256 troveDebtBefore = _troveNetDebt();
        vm.prank(keeper);
        vault.deleverage(1_000e18, address(0), address(0));

        assertEq(vault.reserveMUSD(), reserveBefore - 1_000e18, "the reserve fell by what was pushed");
        assertEq(_troveNetDebt(), troveDebtBefore - 1_000e18, "and the trove's debt fell with it");
    }

    /// @notice A stale oracle makes `deleverage` revert loudly rather than report a zero push,
    ///         and the failed push says why, by selector.
    function test_deleverage_revertsWhenTheOracleIsDown() public {
        _deposit(alice, 1 ether);
        _borrow(alice, 10_000e18);
        _stallRepaymentIntoReserve(alice, 5_000e18);

        priceFeed.setStale(true);
        vm.prank(keeper);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MarenVault.RepaymentPushFailed(1_000e18, MockPriceFeed.PriceStale.selector);
        vm.expectRevert(MarenVault.NothingRepaid.selector);
        vault.deleverage(1_000e18, address(0), address(0));
    }

    /// @dev Repays while the oracle is down, so the MUSD settles the user's debt but stays in
    ///      the reserve instead of being pushed into the trove. That is the state a keeper
    ///      deleverages out of, and it is the only way to hold a reserve while the trove has
    ///      room for it.
    function _stallRepaymentIntoReserve(address who, uint256 amount) internal {
        priceFeed.setStale(true);
        _repay(who, amount);
        priceFeed.setStale(false);
    }

    /**
     * @notice A deposit that cannot reach the trove now says WHY, by selector. "Held idle"
     *         alone cannot tell a keeper whether to wait for the oracle or to page someone.
     */
    function test_collateralPushFailureCarriesTheRevertSelector() public {
        priceFeed.setStale(true);

        vm.deal(alice, 1 ether);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MarenVault.CollateralPushFailed(1 ether, MockPriceFeed.PriceStale.selector);
        vm.prank(alice);
        vault.deposit{value: 1 ether}(address(0), address(0));

        assertEq(vault.idleCollateral(), 1 ether, "and the deposit still worked");
        assertEq(vault.collateral(alice), 1 ether);
    }

    // ------------------------------------------------------------------ //
    //                              Fuzz                                  //
    // ------------------------------------------------------------------ //

    /**
     * @notice CONSERVATION. Whatever the redemption sizes, the sum of what every account can
     *         claim never exceeds what the trove actually holds, and shareholders never owe
     *         less than the trove owes.
     */
    function testFuzz_redemption_claimsNeverExceedTroveReality(
        uint256 aliceColl,
        uint256 aliceDebt,
        uint256 bobColl,
        uint256 bobDebt,
        uint256 firstRedemption,
        uint256 secondRedemption
    ) public {
        aliceColl = bound(aliceColl, 0.001 ether, 5 ether);
        bobColl = bound(bobColl, 0.001 ether, 5 ether);
        // Stay inside the 180% borrow floor, which is the vault's own rule, not this test's,
        // and inside the seed trove's frozen `maxBorrowingCapacity`, which is Mezo's.
        aliceDebt = bound(aliceDebt, 1e18, _borrowCeiling(aliceColl));
        bobDebt = bound(bobDebt, 1e18, _borrowCeiling(bobColl));

        _deposit(alice, aliceColl);
        _borrow(alice, aliceDebt);
        _deposit(bob, bobColl);
        _borrow(bob, bobDebt);

        uint256 redeemable = vault.outstandingDebt();
        firstRedemption = bound(firstRedemption, 1e18, (redeemable * 4) / 5);
        _redeem(redeemer, firstRedemption);
        vault.reconcileRedemption();

        _assertConservation();

        uint256 stillRedeemable = vault.outstandingDebt();
        vm.assume(stillRedeemable > 1);
        secondRedemption = bound(secondRedemption, 1, stillRedeemable - 1);
        _redeem(redeemer, secondRedemption);
        // Deliberately NOT reconciled here: the views have to hold up on their own.
        _assertConservation();

        vault.reconcileRedemption();
        _assertConservation();
    }

    /// @dev The most a position of this size may borrow here: the 180% floor, capped so that
    ///      two of them together stay under the seed trove's frozen borrowing ceiling.
    function _borrowCeiling(uint256 coll) internal pure returns (uint256 ceiling) {
        ceiling = (coll * BTC_PRICE) / 2e18;
        if (ceiling > 20_000e18) ceiling = 20_000e18;
    }

    function _assertConservation() internal view {
        uint256 held = protocol.getTroveColl(address(vault)) + vault.idleCollateral();
        assertLe(
            _sumClaimableCollateral(),
            held + vault.redemptionShortfall(),
            "claims exceeded what the trove and the idle balance actually hold"
        );
        assertGe(_sumTrackedDebt(), vault.outstandingDebt(), "shareholders owe less than the trove does");
        assertGe(address(vault).balance, vault.idleCollateral(), "idle collateral must actually be here");
    }
}
