// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "./MarenVault.sol";
import {ISortedTroves} from "./interfaces/ISortedTroves.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";

/**
 * @title MarenAutoKeeper
 * @notice The two keeper repairs that stop borrowing, made permissionless and bounded.
 *
 * WHY THIS EXISTS. Borrowing on the pooled trove stops for two unrelated reasons, and both
 * repairs sat behind MarenVault's KEEPER_ROLE, held by one human key:
 *
 *   1. The trove's ICR falls under the vault's own 180% floor because collateral sits IDLE
 *      in the vault instead of in the trove (a deposit whose push failed, usually on a stale
 *      oracle). Only collateral inside the trove counts, so the vault refuses every borrow
 *      while 0.2 BTC of perfectly good collateral waits beside it. Repair: topUpCollateral.
 *   2. Mezo freezes a trove's `maxBorrowingCapacity` at the price it opened at, and only
 *      `refinance()` raises it. Repair: refinancePooledTrove.
 *
 * Twice, borrowing sat dead for days waiting for someone to type a keystore password.
 * This contract holds KEEPER_ROLE and exposes exactly those two repairs to anyone, each
 * sized and gated ON-CHAIN, so there is nothing a caller can choose that the vault would
 * not have wanted. It cannot liquidate, open a trove, deleverage or touch user balances:
 * it has no code path to any other keeper function.
 *
 * WHAT A CALLER CONTROLS. Only the SortedTroves hints, which affect gas and never the
 * outcome (BorrowerOperations validates them and searches from them). Zero hints fall back
 * to the vault's current neighbours.
 */
contract MarenAutoKeeper {
    /// @notice Push enough idle collateral that the full ceiling could be borrowed while the
    ///         trove stays at 125% of the 180% floor. The same sizing `topup-collateral.mjs`
    ///         used by hand: below it the trove ratio binds and the ceiling is unreachable;
    ///         far above it the extra BTC only makes withdrawals pull from the trove.
    uint256 public constant MARGIN_BPS = 12_500;

    /// @notice `refinance` is allowed once trove debt has used this share of the ceiling.
    ///         Each refinance charges a fee to the protocol's own position, so it must not be
    ///         callable while there is headroom; after one, the ceiling resets at the current
    ///         price and the gate closes again until borrowing has used it up.
    uint256 public constant REFINANCE_AT_BPS = 9_000;

    MarenVault public immutable vault;
    ITroveManager public immutable troveManager;
    ISortedTroves public immutable sortedTroves;

    event Rebalanced(address indexed caller, uint256 amount, uint256 troveCollAfter);
    event RefinancedCeiling(address indexed caller, uint256 ceilingBefore, uint256 ceilingAfter);

    error NothingToRebalance();
    error CeilingHasHeadroom(uint256 debt, uint256 ceiling);
    error TroveNotOpen();

    constructor(MarenVault vault_, ISortedTroves sortedTroves_) {
        vault = vault_;
        troveManager = vault_.troveManager();
        sortedTroves = sortedTroves_;
    }

    // ------------------------------------------------------------------ //
    //                               Views                                //
    // ------------------------------------------------------------------ //

    /// @notice How much idle BTC `rebalance()` would push right now. Zero means nothing to do.
    /// @dev Reverts if Mezo's oracle is stale (fetchPrice is strict), exactly as the push
    ///      itself would.
    function rebalanceAmount() public view returns (uint256) {
        if (!vault.troveOpen()) return 0;
        uint256 idle = vault.idleCollateral();
        if (idle == 0) return 0;
        uint256 price = vault.priceFeed().fetchPrice();
        uint256 ceiling = troveManager.getTroveMaxBorrowingCapacity(address(vault));
        uint256 target = (ceiling * vault.MIN_TROVE_CR() / price) * MARGIN_BPS / 10_000;
        uint256 coll = troveManager.getTroveColl(address(vault));
        if (coll >= target) return 0;
        uint256 need = target - coll;
        return need < idle ? need : idle;
    }

    /// @notice Whether `refinance()` is currently allowed.
    function refinanceAllowed() public view returns (bool) {
        if (!vault.troveOpen()) return false;
        uint256 ceiling = troveManager.getTroveMaxBorrowingCapacity(address(vault));
        uint256 debt = troveManager.getTroveDebt(address(vault));
        return debt * 10_000 >= ceiling * REFINANCE_AT_BPS;
    }

    // ------------------------------------------------------------------ //
    //                          Permissionless repairs                    //
    // ------------------------------------------------------------------ //

    /// @notice Move idle BTC into the pooled trove, only as much as the trove needs.
    function rebalance(address upperHint, address lowerHint) external returns (uint256 amount) {
        // Bring the vault's books current first; topUpCollateral does it too, but the amount
        // is sized against `idleCollateral`, which a pending redemption can change.
        // `syncTrove`, not `reconcileRedemption`: the deployed vault (0x4625…645b) predates
        // the newer name, and the two run the same code.
        vault.syncTrove();
        amount = rebalanceAmount();
        if (amount == 0) revert NothingToRebalance();
        (upperHint, lowerHint) = _hints(upperHint, lowerHint);
        vault.topUpCollateral(amount, upperHint, lowerHint);
        emit Rebalanced(msg.sender, amount, troveManager.getTroveColl(address(vault)));
    }

    /// @notice Raise Mezo's frozen borrowing ceiling, only once borrowing has nearly used it.
    function refinance(address upperHint, address lowerHint) external {
        if (!vault.troveOpen()) revert TroveNotOpen();
        uint256 ceiling = troveManager.getTroveMaxBorrowingCapacity(address(vault));
        uint256 debt = troveManager.getTroveDebt(address(vault));
        if (debt * 10_000 < ceiling * REFINANCE_AT_BPS) revert CeilingHasHeadroom(debt, ceiling);
        (upperHint, lowerHint) = _hints(upperHint, lowerHint);
        vault.refinancePooledTrove(upperHint, lowerHint);
        emit RefinancedCeiling(msg.sender, ceiling, troveManager.getTroveMaxBorrowingCapacity(address(vault)));
    }

    function _hints(address upperHint, address lowerHint) private view returns (address, address) {
        if (upperHint != address(0) || lowerHint != address(0)) return (upperHint, lowerHint);
        return (sortedTroves.getPrev(address(vault)), sortedTroves.getNext(address(vault)));
    }
}
