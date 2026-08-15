// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IStabilityPool
 * @notice Mezo's MUSD StabilityPool. Verified live on matsnet
 *         0x1CCA7E410eE41739792eA0A24e00349Dd247680e (86.23M MUSD deposited on 2026-08-15).
 *
 * @dev There are NO token emissions. Yield is liquidation gains only: depositors' MUSD is
 *      burned to absorb liquidated debt and they receive the liquidated BTC collateral at a
 *      discount. That makes the return lumpy and impossible to quote as a fixed APY.
 *
 *      Collateral gains are paid in NATIVE BTC, so any depositor contract needs `receive()`.
 *      `withdrawFromSP(0)` is the idiomatic "claim my gains without touching my deposit" call.
 */
interface IStabilityPool {
    function provideToSP(uint256 _amount) external;

    /// @notice Withdraws MUSD and always pays out any accrued BTC collateral gain.
    ///         Passing 0 claims gains only.
    function withdrawFromSP(uint256 _amount) external;

    /// @notice The depositor's MUSD after liquidation losses have been applied.
    function getCompoundedMUSDDeposit(address _depositor) external view returns (uint256);

    /// @notice Unclaimed native BTC owed to the depositor.
    function getDepositorCollateralGain(address _depositor) external view returns (uint256);

    function getTotalMUSDDeposits() external view returns (uint256);
}
