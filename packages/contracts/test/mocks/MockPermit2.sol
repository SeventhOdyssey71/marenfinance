// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPermit2} from "../../src/interfaces/IPermit2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Stand-in for the canonical Permit2 at 0x000000000022D473030F116dDEE9F6B43aC78BA3.
 *
 * @dev THIS MOCK VERIFIES NOTHING CRYPTOGRAPHICALLY. It does not hash the EIP-712 struct, does
 *      not recover a signer, does not check `owner`'s signature, does not enforce the deadline
 *      and does not consume the nonce. The real Permit2 does all of that; re-implementing it
 *      here would only be testing a copy of Uniswap's code.
 *
 *      What it DOES do is the part MarenPay's correctness depends on: it records exactly what
 *      MarenPay handed it, and it moves `transferDetails.requestedAmount` of
 *      `permit.permitted.token` from `owner` straight to `transferDetails.to`. That lets the
 *      tests assert MarenPay named the right recipient and amount, and that MarenPay itself
 *      never sat in the path of the funds.
 *
 *      Because the transfer is a plain `transferFrom`, the owner must approve THIS contract on
 *      the token first, exactly as a real Permit2 user does once.
 */
contract MockPermit2 is IPermit2 {
    struct RecordedCall {
        address token;
        uint256 permittedAmount;
        uint256 nonce;
        uint256 deadline;
        address to;
        uint256 requestedAmount;
        address owner;
        bytes signature;
        address caller;
    }

    RecordedCall public lastCall;
    uint256 public callCount;

    /// @dev Set to true to make `permitTransferFrom` revert, standing in for a bad signature.
    bool public shouldRevert;

    error MockPermit2Rejected();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external override {
        if (shouldRevert) revert MockPermit2Rejected();

        lastCall = RecordedCall({
            token: permit.permitted.token,
            permittedAmount: permit.permitted.amount,
            nonce: permit.nonce,
            deadline: permit.deadline,
            to: transferDetails.to,
            requestedAmount: transferDetails.requestedAmount,
            owner: owner,
            signature: signature,
            caller: msg.sender
        });
        unchecked {
            callCount += 1;
        }

        IERC20(permit.permitted.token)
            .transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }

    function DOMAIN_SEPARATOR() external pure override returns (bytes32) {
        return keccak256("MockPermit2");
    }
}
