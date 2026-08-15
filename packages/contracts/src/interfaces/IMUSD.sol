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
 * @dev The permit support is what lets a first-time user with zero BTC both approve and pay
 *      in one signed action: sign the permit, sign an ERC-2771 ForwardRequest, and Maren's
 *      relayer pays the gas. It is also why MUSD works with the canonical Permit2 at
 *      0x000000000022D473030F116dDEE9F6B43aC78BA3 (verified deployed on both networks) and
 *      therefore with Mezo's own x402 payment rail.
 */
interface IMUSD is IERC20, IERC20Permit {
    function decimals() external view returns (uint8);
}
