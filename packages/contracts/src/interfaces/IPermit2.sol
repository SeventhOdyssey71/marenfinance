// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IPermit2
 * @notice The `SignatureTransfer` half of Uniswap's canonical Permit2, at
 *         0x000000000022D473030F116dDEE9F6B43aC78BA3.
 *
 * VERIFIED LIVE 2026-08-15: 9,152 bytes of code at that address on BOTH matsnet (31611)
 * and Mezo mainnet (31612); `DOMAIN_SEPARATOR()` returns
 * 0x67100699b7257d6bf80d795e5fa8e6e86f992565e6aa51b579cfcde7073064f7 on matsnet.
 *
 * @dev Maren supports this so that MarenPay INTEROPERATES with Mezo's own x402 payment rail
 *      (settlement proxy 0x402085c248EeA27D92E8b30b2C58ed07f9E20001, facilitator
 *      facilitator.vativ.io) rather than competing with it: an x402 buyer who has already
 *      approved Permit2 once can pay through Maren with a single EIP-712 signature and no
 *      approval transaction.
 *
 *      Only `permitTransferFrom` is declared. Maren never uses Permit2's AllowanceTransfer
 *      side, which grants a standing allowance — signature transfer is single-use and
 *      strictly scoped to one amount and one recipient.
 */
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Transfers `transferDetails.requestedAmount` of `permit.permitted.token` from
    ///         `owner` to `transferDetails.to`, authorised by `owner`'s EIP-712 signature.
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
