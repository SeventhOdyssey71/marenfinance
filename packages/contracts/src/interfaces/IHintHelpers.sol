// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IHintHelpers
 * @notice Verified live on matsnet 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 on 2026-08-15:
 *         computeNominalCR(1e18, 2000e18) -> 5e16, confirming NICR is scaled by 1e20.
 * @dev Off-chain / test use only. `getApproxHint` performs `_numTrials` random walks over
 *      SortedTroves and must never be called from a production transaction.
 */
interface IHintHelpers {
    /// @return NICR = _coll * 1e20 / _debt.
    function computeNominalCR(uint256 _coll, uint256 _debt) external pure returns (uint256);

    function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed)
        external
        view
        returns (address hintAddress, uint256 diff, uint256 latestRandomSeed);

    /**
     * @notice The hints a redeemer needs: where the walk starts, the NICR the last trove
     *         touched will end up at, and how much of `_amount` can actually be redeemed.
     * @dev Verified live on matsnet 2026-08-17. The partial NICR must match the resulting
     *      trove exactly or the protocol silently skips the final partial redemption, so a
     *      test that drives a real redemption has to read it from here rather than guess.
     */
    function getRedemptionHints(uint256 _amount, uint256 _price, uint256 _maxIterations)
        external
        view
        returns (address firstRedemptionHint, uint256 partialRedemptionHintNICR, uint256 truncatedAmount);
}
