// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title IMUSD
 * @notice Mezo's MUSD stablecoin. Verified live on 2026-08-15:
 *           mainnet 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
 *           matsnet 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
 *         symbol() -> "MUSD", decimals() -> 18 on both. DOMAIN_SEPARATOR() returns a real
 *         value on matsnet (0x6f9f5c5d...474f), confirming EIP-2612 permit is live.
 *
 *         RE-VERIFIED 2026-08-18, at the bytecode rather than at the ABI, before
 *         `MarenVault.repayWithPermit` was allowed to depend on it. A live
 *         `DOMAIN_SEPARATOR()` is suggestive and not sufficient: a contract can expose one and
 *         still not implement the canonical permit, and a proxy can answer anything. On the
 *         matsnet token 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503:
 *
 *           - `cast code` returns ~6.4 KB of runtime bytecode with no delegatecall proxy
 *             preamble, so what answers is what is deployed, not an implementation behind it.
 *           - That bytecode contains the selectors 0xd505accf
 *             (`permit(address,address,uint256,uint256,uint8,bytes32,bytes32)`), 0x7ecebe00
 *             (`nonces(address)`) and 0x3644e515 (`DOMAIN_SEPARATOR()`): the exact EIP-2612
 *             surface, not a near-miss variant.
 *           - `permit(...)` with a deadline of 1 reverts with 0x62791302, OpenZeppelin's
 *             `ERC2612ExpiredSignature(uint256)`. A selector that merely fell through to a
 *             fallback could not produce that error, so the function is genuinely implemented.
 *           - `eip712Domain()` returns fields 0x0f, name "Mezo USD", version "1", chainId
 *             31611, verifyingContract = the token itself, and an empty salt. That is what a
 *             signer has to reproduce, and it is what the test MockMUSD reproduces.
 *
 *         MockMUSD is therefore a faithful stand-in for the permit path specifically, and
 *         `test_fork_composedEntrypointsAgainstTheRealContracts` checks the claim end to end
 *         against the deployed token rather than resting on the mock.
 *
 * @dev The permit support is what lets a first-time user with zero BTC both approve and pay
 *      in one signed action: sign the permit, sign an ERC-2771 ForwardRequest, and Maren's
 *      relayer pays the gas. It is also why MUSD works with the canonical Permit2 at
 *      0x000000000022D473030F116dDEE9F6B43aC78BA3 (verified deployed on both networks) and
 *      therefore with Mezo's own x402 payment rail.
 */
interface IMUSD is IERC20, IERC20Permit {
    function decimals() external view returns (uint8);
}
