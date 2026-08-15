// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IPriceFeed
 * @notice Mezo's MUSD PriceFeed. Verified live on matsnet
 *         0x86bCF0841622a5dAC14A313a15f96A95421b9366 (BTC/USD 63_068.11e18 on 2026-08-15).
 *
 * TWO THINGS THAT BREAK PORTED LIQUITY CODE:
 *  1. `fetchPrice()` is `view`, not a state-mutating update. It does not cache.
 *  2. It REVERTS if the underlying oracle is older than 60 seconds, and there is NO
 *     `lastGoodPrice()` fallback getter. The `LastGoodPriceUpdated` event is vestigial.
 *     Every borrow / adjust / liquidate / redeem path can therefore revert for reasons
 *     that have nothing to do with the caller's input.
 *
 * The oracle behind it is a NATIVE CHAIN PRECOMPILE at
 * 0x7b7c000000000000000000000000000000000015 — Skip Connect, Mezo's consensus-level
 * `x/oracle` module fed by the validator set. It is NOT Chainlink and NOT Pyth. Pyth is
 * deployed on Mezo but its feeds are ~28 days stale and ETH/USD reverts outright, so it
 * must never be used for liquidation math.
 */
interface IPriceFeed {
    /// @return BTC/USD price, 18 decimals. REVERTS when the oracle is >60s stale.
    function fetchPrice() external view returns (uint256);
}
