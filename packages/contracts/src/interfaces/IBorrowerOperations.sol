// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IBorrowerOperations
 * @notice Mezo's MUSD BorrowerOperations. MUSD is a Threshold-USD (Liquity v1) fork with
 *         Mezo-specific divergences — every signature below was probed live against
 *         matsnet 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 on 2026-08-15 by calling it
 *         and reading the revert string, not transcribed from Liquity.
 *
 * DIVERGENCES FROM LIQUITY v1 THAT CHANGE THESE SIGNATURES:
 *  - There is NO `_maxFeePercentage` first argument anywhere. A ported Liquity ABI will
 *    silently encode the wrong selector.
 *  - Collateral is NATIVE BTC passed as `msg.value`. There is no ERC-20 approve step and
 *    no `_collAmount` argument.
 *  - Every mutating function here reads `PriceFeed.fetchPrice()`, which REVERTS when the
 *    oracle is >60s stale. Callers must treat "reverted" as possibly meaning "no price",
 *    not "bad input".
 */
interface IBorrowerOperations {
    /// @param _debtAmount Net MUSD to receive. Trove debt becomes _debtAmount + 0.1% fee + 200 gas comp.
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;

    /// @notice Adds `msg.value` native BTC to the caller's trove.
    function addColl(address _upperHint, address _lowerHint) external payable;

    /// @notice Sends `_amount` native BTC from the caller's trove back to the caller.
    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Mints `_amount` MUSD to the caller and adds `_amount` + fee to trove debt.
    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Burns `_amount` MUSD from the caller and reduces trove debt by `_amount`.
    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    /// @notice Repays the trove's entire net debt and returns all collateral to the caller.
    function closeTrove() external;

    /**
     * @notice Resets the trove's interest rate to the current global rate AND is the only
     *         way to raise `maxBorrowingCapacity` after opening. Blocked in Recovery Mode.
     */
    function refinance(address _upperHint, address _lowerHint) external;

    /// @notice Claims collateral left in CollSurplusPool after a redemption or liquidation.
    function claimCollateral() external;

    function adjustTrove(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool _isDebtIncrease,
        address _upperHint,
        address _lowerHint
    ) external payable;

    /// @notice 1,800e18 on both networks (verified live).
    function minNetDebt() external view returns (uint256);
}
