// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ITroveManager
 * @notice Mezo's MUSD TroveManager. Verified live on matsnet
 *         0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 on 2026-08-15 against trove
 *         0x52d033E64774F31A8B7562806aA5782CbbD29382.
 */
interface ITroveManager {
    /// @notice Native BTC collateral recorded on the trove. Excludes pending redistribution.
    function getTroveColl(address _borrower) external view returns (uint256);

    /**
     * @notice Liquity's trove lifecycle enum, ABI-encoded as a uint8 in a 32-byte word:
     *         0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation,
     *         4 closedByRedemption.
     * @dev Verified live on matsnet 2026-08-17: the getter exists and returns 1 for the
     *      active trove 0x52d033E64774F31A8B7562806aA5782CbbD29382. Decoding the enum as a
     *      uint256 is safe because the encoding pads to a full word.
     *
     *      This is how MarenVault tells a REDEMPTION (status stays 1, collateral and debt
     *      both shrink) from a LIQUIDATION or a full redemption (status leaves 1 and the
     *      trove is gone). The two look identical on the collateral ledger and must never
     *      be reconciled the same way.
     */
    function getTroveStatus(address _borrower) external view returns (uint256);

    /// @notice principal + accrued interest, INCLUDING the 200e18 MUSD gas compensation.
    ///         Excludes pending redistribution — use getEntireDebtAndColl for the true total.
    function getTroveDebt(address _borrower) external view returns (uint256);

    /**
     * @notice Mezo-only per-trove borrow ceiling, fixed at the BTC price when the trove was
     *         opened. Adding collateral does NOT raise it; only `refinance()` does. This —
     *         not an ICR-derived number — is the real borrow limit.
     */
    function getTroveMaxBorrowingCapacity(address _borrower) external view returns (uint256);

    /// @notice ICR in 1e18 fixed point. `type(uint256).max` when the trove has no debt.
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);

    function getTCR(uint256 _price) external view returns (uint256);

    /// @notice TCR < 150%. NOTE: Recovery Mode does NOT raise the 110% liquidation threshold
    ///         on Mezo; it only forces new loans open at >=150% and blocks refinance().
    function checkRecoveryMode(uint256 _price) external view returns (bool);

    /**
     * @notice Liquity v1 returns 4 values here; Mezo returns 6 because debt is split into
     *         principal and interest.
     * @return coll               collateral recorded on the trove
     * @return principal          principal debt (includes the 200e18 gas compensation)
     * @return interest           accrued interest, 1% APR simple, fixed at open
     * @return pendingCollateral  collateral owed from redistributions, not yet applied
     * @return pendingPrincipal   principal owed from redistributions, not yet applied
     * @return pendingInterest    interest owed from redistributions, not yet applied
     */
    function getEntireDebtAndColl(address _borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );

    /**
     * @notice Swaps MUSD for trove collateral at face value, walking SortedTroves from the
     *         lowest-ICR end. MarenVault NEVER calls this; it is declared so the fork tests
     *         can drive a real redemption against the pooled trove instead of simulating one.
     * @dev Liquity v1 takes a 7th `_maxFeePercentage` argument. Mezo's MUSD does NOT, exactly
     *      as with BorrowerOperations. Probed live on matsnet 2026-08-17: the 6-argument form
     *      reverts with "Requested redemption amount must be <= user's mUSD token balance",
     *      i.e. the selector exists and the call reached a logical check; the 7-argument form
     *      reverts with empty returndata, i.e. no such function.
     */
    function redeemCollateral(
        uint256 _amount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint256 _partialRedemptionHintNICR,
        uint256 _maxIterations
    ) external;

    /// @notice 1.1e18. Hardcoded `constant`, not governable.
    function MCR() external view returns (uint256);

    /// @notice 1.5e18. Hardcoded `constant`, not governable.
    function CCR() external view returns (uint256);
}
