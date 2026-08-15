// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISwapRouter
 * @notice Minimal native-BTC -> MUSD swap interface used by MarenEarn.
 *
 * HONEST STATUS: as of 2026-08-15 there is no DEX on Mezo that Maren has verified can
 * execute this. This interface is therefore SPECULATIVE and deliberately tiny — it is a
 * seam, not an integration. `MarenEarn.swapRouter` is the zero address at deploy time and
 * `harvest()` simply holds harvested BTC in the vault until governance sets a router it has
 * reviewed. Nothing in MarenEarn depends on a router existing.
 *
 * Whoever wires the first real router MUST confirm the adapter honours `_minAmountOut` —
 * MarenEarn passes a caller-supplied minimum and treats the router as untrusted for value,
 * but it cannot defend against a router that lies about the amount it returns beyond
 * measuring its own MUSD balance before and after (which it does).
 */
interface ISwapRouter {
    /**
     * @param _minAmountOut Minimum MUSD the vault will accept; the caller computes it.
     * @param _recipient    Who receives the MUSD.
     * @param _deadline     Unix timestamp after which the swap must revert.
     * @return amountOut    MUSD sent to `_recipient`. MarenEarn ignores this and measures
     *                      its own balance delta instead.
     */
    function swapExactBtcForMusd(uint256 _minAmountOut, address _recipient, uint256 _deadline)
        external
        payable
        returns (uint256 amountOut);
}
