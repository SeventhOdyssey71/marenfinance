// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MarenForwarder} from "./MarenForwarder.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MarenRelayHub
 * @author Maren Finance
 * @notice The ERC-2771 forwarder Maren actually deploys. It is a `MarenForwarder` plus an
 *         atomic, signed-fee relay path.
 *
 * ============================ WHY THIS CONTRACT EXISTS ============================
 * Two obvious ways to charge a relay fee are both broken, and this contract is the third.
 *
 *  REJECTED 1 — a trailing `uint256 relayFee` on every Maren function. The parameter is
 *  covered by the ForwardRequest signature, so it looks safe, but no contract does anything
 *  with it. It is consent to a number with no settlement attached: signed but unenforced.
 *  It also drags relayer economics into `MarenPay` and `MarenVault`, which are otherwise
 *  free of fee logic entirely.
 *
 *  REJECTED 2 — a fee leg and a work leg batched through `ERC2771Forwarder.executeBatch`.
 *  This one is worse, because it looks correct and is not. OpenZeppelin's `atomic` flag —
 *  which `executeBatch` derives from `refundReceiver == address(0)` — governs REQUEST
 *  VALIDATION only: untrusted target, expired deadline, bad signature. The inner call is a
 *  raw `call` whose `success` is recorded and then used for nothing except deciding whether
 *  to refund `value`. So the fee leg settles even when the work leg reverts, in BOTH modes.
 *  That is a silent way to charge a user for nothing. Demonstrated in
 *  `test_executeBatchIsNotAtomicForInnerCallFailures`, and `executeBatch` is disabled below
 *  so nobody can reach it through Maren's forwarder.
 *
 *  THIS CONTRACT — one signature covering the work AND the fee, executed in one call frame.
 *  If the inner call reverts, the whole transaction reverts and the fee goes with it. There
 *  is no window in which a fee has moved and the work has not.
 * =================================================================================
 *
 * PROPERTIES, each asserted directly in `test/MarenRelayHub.t.sol`:
 *
 *  1. ATOMIC. `executeWithFee` takes the fee and then performs the call in the same frame,
 *     bubbling the inner revert. Fee and work settle together or neither does.
 *  2. THE FEE IS INSIDE THE SIGNED PAYLOAD. `feeToken`, `feeAmount` and `feeRecipient` are
 *     all members of the EIP-712 `RelayedCall` struct. A relayer that edits any of them
 *     invalidates the signature. It cannot raise the fee, redirect it, or swap the token
 *     after the user has signed.
 *  3. ONE TRUSTED FORWARDER. This contract IS a `MarenForwarder` — it extends it rather than
 *     sitting in front of it. Deploy this and pass ITS address as `trustedForwarder` to every
 *     Maren contract. The standalone `MarenForwarder` is superseded and must NOT also be
 *     deployed and trusted; two trusted forwarders would be two independent ways to forge a
 *     sender. `script/Deploy.s.sol` wires exactly one.
 *  4. THE END USER SURVIVES TO THE TARGET. The call appends `req.from` ERC-2771 style, so
 *     `_msgSender()` inside `MarenPay` is the user, never this hub and never the relayer.
 *     `_isTrustedByTarget` is checked first: forwarding to a target that does not trust this
 *     contract would silently make the HUB the sender, which is the single most dangerous
 *     way this could go wrong.
 *  5. ALLOWLISTED TARGET AND SELECTOR. Enforced on `executeWithFee` AND on the inherited
 *     fee-free `execute`. Without the second, the hub would be an open relay to any contract
 *     on Mezo and would route straight around the relayer's own allowlist.
 *
 * VALUE IS NEVER RELAYED. `RelayedCall` has no `value` field and `execute` rejects a non-zero
 * one. Sponsoring a BTC-bearing call would mean the relayer funding a user's deposit. This is
 * why `MarenVault.deposit()` is the only payable entrypoint and why `borrow` / `repay` /
 * `withdraw` / `closePosition` are separate non-payable externals.
 */
contract MarenRelayHub is MarenForwarder, AccessControl {
    using SafeERC20 for IERC20;

    /// @notice May change the target/selector allowlist.
    bytes32 public constant RELAY_ADMIN_ROLE = keccak256("MAREN_RELAY_ADMIN_ROLE");

    /**
     * @dev EIP-712 type for a fee-bearing relayed call. Note what is bound: the target, the
     *      exact calldata, the gas, the nonce, the deadline, and all three fee fields. The
     *      relayer chooses none of it.
     *
     *      There is deliberately no `value` member — see the contract header.
     */
    bytes32 public constant RELAYED_CALL_TYPEHASH = keccak256(
        "RelayedCall(address from,address target,uint256 gas,uint256 nonce,uint48 deadline,bytes data,address feeToken,uint256 feeAmount,address feeRecipient)"
    );

    struct RelayedCallData {
        address from;
        address target;
        uint256 gas;
        uint48 deadline;
        bytes data;
        address feeToken;
        uint256 feeAmount;
        address feeRecipient;
        bytes signature;
    }

    /// @notice target => selector => allowed. Both must match; there is no wildcard.
    mapping(address target => mapping(bytes4 selector => bool)) public allowedCall;

    event RelayedCallExecuted(
        address indexed from,
        address indexed target,
        bytes4 indexed selector,
        uint256 nonce,
        address feeToken,
        uint256 feeAmount,
        address feeRecipient
    );
    event CallAllowed(address indexed target, bytes4 indexed selector, bool allowed);

    error CallNotAllowed(address target, bytes4 selector);
    error TargetDoesNotTrustHub(address target);
    error RelayExpired(uint48 deadline);
    error InvalidRelaySignature(address recovered, address expected);
    error CalldataTooShort(uint256 length);
    error ValueNotRelayable();
    error BatchExecutionDisabled();
    error ZeroFeeRecipient();

    constructor(address admin) MarenForwarder() {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RELAY_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------ //
    //                             Allowlist                              //
    // ------------------------------------------------------------------ //

    /// @notice Permit (or revoke) one `target.selector` pair. Deliberately granular: allowing
    ///         a whole contract would let a future function be relayed without review.
    function setAllowedCall(address target, bytes4 selector, bool allowed) public onlyRole(RELAY_ADMIN_ROLE) {
        allowedCall[target][selector] = allowed;
        emit CallAllowed(target, selector, allowed);
    }

    function setAllowedCalls(address target, bytes4[] calldata selectors, bool allowed)
        external
        onlyRole(RELAY_ADMIN_ROLE)
    {
        for (uint256 i; i < selectors.length; ++i) {
            setAllowedCall(target, selectors[i], allowed);
        }
    }

    // ------------------------------------------------------------------ //
    //                       Fee-bearing relayed call                     //
    // ------------------------------------------------------------------ //

    /**
     * @notice Execute a user-signed call and collect the user-signed fee, atomically.
     * @dev The fee moves `from -> feeRecipient` by `transferFrom` under the user's own
     *      allowance. This contract never holds it, and never holds user funds at all.
     */
    function executeWithFee(RelayedCallData calldata req) public {
        _executeWithFee(req);
    }

    /**
     * @notice `executeWithFee` for a user who has never approved the fee token.
     * @dev The permit is a SEPARATE signature by the same user, so it authorises itself; it is
     *      not part of the RelayedCall digest and a relayer cannot forge it. Applied in a
     *      try/catch for the standard reason: a permit sitting in the mempool can be submitted
     *      by anyone, which consumes the nonce and would otherwise brick a valid relay. If the
     *      allowance is genuinely missing, the `transferFrom` below still reverts.
     *
     *      THE REQUEST IS VALIDATED BEFORE THE PERMIT, and the order is the security property.
     *      `req.feeToken` is an arbitrary address and the permit is an outward call to it made
     *      by this contract with errors swallowed. Doing that first meant ANY caller, holding
     *      no signature at all, could make the hub call any address on Mezo with the
     *      `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` selector and
     *      largely chosen arguments. The frame reverted afterwards on the bad signature, so
     *      nothing persisted — but "the state change is undone" is not the same as "the call
     *      did not happen", and a hub-originated call carries the authority every Maren
     *      contract grants this address. `_validateRelayedCall` is a view, so the checks are
     *      simply run twice; that costs one ecrecover and buys a hub that never calls out on
     *      behalf of an unverified request.
     */
    function executeWithFeeAndPermit(
        RelayedCallData calldata req,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _validateRelayedCall(req);
        if (req.feeAmount > 0) {
            try IERC20Permit(req.feeToken)
                .permit(req.from, address(this), req.feeAmount, permitDeadline, v, r, s) {}
                catch {}
        }
        _executeWithFee(req);
    }

    /**
     * @dev Every check that must hold before this contract does anything outward on a
     *      request's behalf. Pure validation, no state change, so it is safe to run twice.
     */
    function _validateRelayedCall(RelayedCallData calldata req) private view returns (bytes4) {
        if (block.timestamp > req.deadline) revert RelayExpired(req.deadline);

        bytes4 selector = _selectorOf(req.data);
        if (!allowedCall[req.target][selector]) revert CallNotAllowed(req.target, selector);

        // Property 4. Without this, a target that does not implement ERC-2771 would see THIS
        // CONTRACT as msg.sender and the appended user address would be ignored as trailing
        // garbage — a confused-deputy hole with the hub's full authority behind it.
        if (!_isTrustedByTarget(req.target)) revert TargetDoesNotTrustHub(req.target);

        address signer = ECDSA.recover(_digestOf(req, nonces(req.from)), req.signature);
        if (signer != req.from) revert InvalidRelaySignature(signer, req.from);

        return selector;
    }

    function _executeWithFee(RelayedCallData calldata req) private {
        bytes4 selector = _validateRelayedCall(req);
        uint256 nonce = nonces(req.from);

        // Consume the nonce BEFORE the outward call, so a reentrant replay is impossible.
        // Shared with the inherited `execute` nonce sequence on purpose: one counter per user
        // means a request can never be replayed through the other entrypoint either.
        _useNonce(req.from);

        if (req.feeAmount > 0) {
            if (req.feeRecipient == address(0)) revert ZeroFeeRecipient();
            IERC20(req.feeToken).safeTransferFrom(req.from, req.feeRecipient, req.feeAmount);
        }

        // Property 1 + 4: ERC-2771 suffix, and any inner revert takes the fee down with it
        // because this is all one call frame.
        bytes memory payload = abi.encodePacked(req.data, req.from);
        uint256 reqGas = req.gas;
        address target = req.target;
        bool success;
        uint256 gasLeft;
        assembly ("memory-safe") {
            success := call(reqGas, target, 0, add(payload, 0x20), mload(payload), 0, 0)
            gasLeft := gas()
        }

        if (!success) _bubbleRevert();
        _checkRelayGas(gasLeft, reqGas);

        emit RelayedCallExecuted(
            req.from, req.target, selector, nonce, req.feeToken, req.feeAmount, req.feeRecipient
        );
    }

    // ------------------------------------------------------------------ //
    //                    Inherited forwarder, constrained                //
    // ------------------------------------------------------------------ //

    /**
     * @notice The fee-free path, for Maren's sponsored-onboarding allowance.
     * @dev Same allowlist as the fee path. `ERC2771Forwarder.execute` already reverts when the
     *      inner call fails, so this one is atomic without help. Value is rejected outright.
     */
    function execute(ForwardRequestData calldata request) public payable override {
        if (msg.value != 0 || request.value != 0) revert ValueNotRelayable();
        bytes4 selector = _selectorOf(request.data);
        if (!allowedCall[request.to][selector]) revert CallNotAllowed(request.to, selector);
        super.execute(request);
    }

    /**
     * @notice Permanently disabled.
     * @dev `ERC2771Forwarder.executeBatch` does not revert when an inner call fails, in either
     *      mode — its `atomic` flag governs validation only. Leaving it reachable would leave
     *      a path where a fee settles for work that reverted, which is the exact bug this
     *      contract was built to remove. Batch by making several `executeWithFee` calls, or
     *      via an EIP-7702 delegated account, both of which are genuinely atomic.
     */
    function executeBatch(ForwardRequestData[] calldata, address payable) public payable override {
        revert BatchExecutionDisabled();
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    /**
     * @notice The digest a user signs for `executeWithFee`, at that user's CURRENT nonce.
     * @dev Exposed so `apps/relayer` and the SDK build it from the contract rather than from a
     *      transcribed type string — the failure mode that a one-character typo in a type
     *      string produces is "every sponsored transaction fails signature recovery in
     *      production, and nothing catches it first". `req.signature` is ignored here.
     */
    function relayedCallDigest(RelayedCallData calldata req) external view returns (bytes32) {
        return _digestOf(req, nonces(req.from));
    }

    function _digestOf(RelayedCallData calldata req, uint256 nonce) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RELAYED_CALL_TYPEHASH,
                    req.from,
                    req.target,
                    req.gas,
                    nonce,
                    req.deadline,
                    keccak256(req.data),
                    req.feeToken,
                    req.feeAmount,
                    req.feeRecipient
                )
            )
        );
    }

    function _selectorOf(bytes calldata data) private pure returns (bytes4) {
        if (data.length < 4) revert CalldataTooShort(data.length);
        return bytes4(data[:4]);
    }

    function _bubbleRevert() private pure {
        assembly ("memory-safe") {
            let size := returndatasize()
            returndatacopy(0, 0, size)
            revert(0, size)
        }
    }

    /// @dev Same 63/64 insufficient-gas griefing check OpenZeppelin applies, reimplemented
    ///      because theirs is `private` and typed to `ForwardRequestData`.
    function _checkRelayGas(uint256 gasLeft, uint256 requestedGas) private pure {
        if (gasLeft < requestedGas / 63) {
            assembly ("memory-safe") {
                invalid()
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return AccessControl.supportsInterface(interfaceId);
    }
}
