// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title MarenRegistry
 * @author Maren Finance
 * @notice `@handle` -> address, with commit-reveal registration.
 *
 * @dev WHY COMMIT-REVEAL: `register("sele")` in a public mempool is a free option for anyone
 *      watching it. They copy the calldata, pay more gas, and take the name. The commitment
 *      binds the handle to the registrant's address and a secret, so a copied commitment is
 *      worthless — it can only be revealed by the address it was made for. `MIN_COMMITMENT_AGE`
 *      forces the commitment to be at least one block old, and `MAX_COMMITMENT_AGE` keeps the
 *      commitment set from becoming a permanent squatting reservation.
 *
 *      This does NOT prevent a determined squatter from committing to many names up front.
 *      Registration is deliberately cheap and unpriced; anti-squatting, if it is ever needed,
 *      belongs in a pricing/renewal layer above this contract, not inside it.
 *
 *      ERC-2771 so a user with zero BTC can claim a handle through Maren's relayer. Every
 *      authorisation check uses `_msgSender()`, never `msg.sender`.
 *
 *      Entrypoints are intentionally small and independently callable — `commit`, `register`,
 *      `setPrimaryHandle` — so an EIP-7702-delegated account can batch them in one
 *      transaction. Nothing here assumes it is the only call in its transaction.
 */
contract MarenRegistry is ERC2771Context {
    // ------------------------------------------------------------------ //
    //                             Constants                              //
    // ------------------------------------------------------------------ //

    /// @notice Minimum age of a commitment before it may be revealed.
    /// @dev One minute is comfortably more than one Mezo block, which is all that is needed
    ///      to make front-running impossible, while keeping registration a two-step flow a
    ///      human will sit through.
    uint256 public constant MIN_COMMITMENT_AGE = 60;

    /// @notice Commitments older than this are dead and must be remade.
    uint256 public constant MAX_COMMITMENT_AGE = 7 days;

    uint256 public constant MIN_HANDLE_LENGTH = 3;
    uint256 public constant MAX_HANDLE_LENGTH = 32;

    // ------------------------------------------------------------------ //
    //                              Storage                               //
    // ------------------------------------------------------------------ //

    /// @notice commitment => timestamp it was made. Zero means "not committed".
    mapping(bytes32 commitment => uint256 committedAt) public commitments;

    /// @dev keccak256(handle) => owner. Zero means available.
    mapping(bytes32 node => address owner) private _owners;

    /// @dev keccak256(handle) => the handle string, for reverse resolution.
    mapping(bytes32 node => string handle) private _handles;

    /// @dev owner => node of their primary handle. Zero means none set.
    mapping(address owner => bytes32 node) private _primaryNode;

    /// @notice How many handles an address owns. Used only for UI and invariant checks.
    mapping(address owner => uint256 count) public handleCount;

    // ------------------------------------------------------------------ //
    //                               Events                               //
    // ------------------------------------------------------------------ //

    event Committed(bytes32 indexed commitment, uint256 committedAt);
    event HandleRegistered(bytes32 indexed node, address indexed owner, string handle);
    event HandleTransferred(bytes32 indexed node, address indexed from, address indexed to, string handle);
    event HandleReleased(bytes32 indexed node, address indexed owner, string handle);
    event PrimaryHandleSet(address indexed owner, bytes32 indexed node, string handle);
    event PrimaryHandleCleared(address indexed owner, bytes32 indexed node);

    // ------------------------------------------------------------------ //
    //                               Errors                               //
    // ------------------------------------------------------------------ //

    error HandleTooShort(uint256 length);
    error HandleTooLong(uint256 length);
    error HandleInvalidCharacter(uint256 index, bytes1 character);
    error HandleTaken(string handle);
    error HandleNotRegistered(string handle);
    error NotHandleOwner(address caller, address owner);
    error CommitmentNotFound(bytes32 commitment);
    error CommitmentTooNew(uint256 committedAt, uint256 revealableAt);
    error CommitmentExpired(uint256 committedAt, uint256 expiredAt);
    error CommitmentAlreadyExists(bytes32 commitment);
    error ZeroAddress();

    constructor(address trustedForwarder_) ERC2771Context(trustedForwarder_) {}

    // ------------------------------------------------------------------ //
    //                            Registration                            //
    // ------------------------------------------------------------------ //

    /**
     * @notice Step 1. Publish a hiding, binding commitment to a handle.
     * @dev The commitment is opaque on-chain, so watching this transaction tells an observer
     *      nothing about which handle is being claimed.
     */
    function commit(bytes32 commitment) external {
        uint256 existing = commitments[commitment];
        // Re-committing an identical (handle, owner, secret) triple before it expires would
        // reset the clock, which is harmless, but silently overwriting it hides bugs. Allow
        // it only once the old one is dead.
        if (existing != 0 && block.timestamp <= existing + MAX_COMMITMENT_AGE) {
            revert CommitmentAlreadyExists(commitment);
        }
        commitments[commitment] = block.timestamp;
        emit Committed(commitment, block.timestamp);
    }

    /**
     * @notice Step 2. Reveal and take the handle.
     * @param handle Lowercase, 3-32 chars, `[a-z0-9_]` only. Validated on-chain.
     * @param secret The same secret used to build the commitment.
     * @dev Sets the caller's primary handle if they do not have one yet, so the common case
     *      is a single transaction.
     */
    function register(string calldata handle, bytes32 secret) external {
        address owner = _msgSender();
        _validateHandle(handle);

        bytes32 commitment = makeCommitment(handle, owner, secret);
        uint256 committedAt = commitments[commitment];
        if (committedAt == 0) revert CommitmentNotFound(commitment);
        if (block.timestamp < committedAt + MIN_COMMITMENT_AGE) {
            revert CommitmentTooNew(committedAt, committedAt + MIN_COMMITMENT_AGE);
        }
        if (block.timestamp > committedAt + MAX_COMMITMENT_AGE) {
            revert CommitmentExpired(committedAt, committedAt + MAX_COMMITMENT_AGE);
        }
        delete commitments[commitment];

        bytes32 node = namehash(handle);
        if (_owners[node] != address(0)) revert HandleTaken(handle);

        _owners[node] = owner;
        _handles[node] = handle;
        unchecked {
            handleCount[owner] += 1;
        }
        emit HandleRegistered(node, owner, handle);

        if (_primaryNode[owner] == bytes32(0)) {
            _primaryNode[owner] = node;
            emit PrimaryHandleSet(owner, node, handle);
        }
    }

    /**
     * @notice Deterministic commitment digest. Pure, so clients compute it locally.
     * @dev Binds the handle to `owner`: a copied commitment cannot be revealed by anyone else.
     */
    function makeCommitment(string calldata handle, address owner, bytes32 secret)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(handle, owner, secret));
    }

    // ------------------------------------------------------------------ //
    //                             Management                             //
    // ------------------------------------------------------------------ //

    /// @notice Hands a handle to another address. The recipient adopts it as their primary
    ///         handle only if they do not already have one.
    function transferHandle(string calldata handle, address to) external {
        if (to == address(0)) revert ZeroAddress();
        bytes32 node = _requireOwner(handle);
        address from = _msgSender();

        _clearPrimaryIfSet(from, node);
        _owners[node] = to;
        unchecked {
            handleCount[from] -= 1;
            handleCount[to] += 1;
        }
        emit HandleTransferred(node, from, to, handle);

        if (_primaryNode[to] == bytes32(0)) {
            _primaryNode[to] = node;
            emit PrimaryHandleSet(to, node, handle);
        }
    }

    /// @notice Gives up a handle, returning it to the available pool immediately.
    function releaseHandle(string calldata handle) external {
        bytes32 node = _requireOwner(handle);
        address owner = _msgSender();

        _clearPrimaryIfSet(owner, node);
        delete _owners[node];
        delete _handles[node];
        unchecked {
            handleCount[owner] -= 1;
        }
        emit HandleReleased(node, owner, handle);
    }

    /// @notice Chooses which owned handle reverse-resolves to the caller.
    function setPrimaryHandle(string calldata handle) external {
        bytes32 node = _requireOwner(handle);
        address owner = _msgSender();
        _primaryNode[owner] = node;
        emit PrimaryHandleSet(owner, node, handle);
    }

    // ------------------------------------------------------------------ //
    //                              Resolution                            //
    // ------------------------------------------------------------------ //

    /// @notice Forward resolution. Reverts rather than returning `address(0)`, so a caller
    ///         cannot accidentally send funds to the zero address after a typo.
    function resolve(string calldata handle) public view returns (address) {
        address owner = _owners[namehash(handle)];
        if (owner == address(0)) revert HandleNotRegistered(handle);
        return owner;
    }

    /// @notice Non-reverting forward resolution for UIs. Returns `address(0)` if unregistered.
    function tryResolve(string calldata handle) external view returns (address) {
        return _owners[namehash(handle)];
    }

    function ownerOfNode(bytes32 node) external view returns (address) {
        return _owners[node];
    }

    /// @notice Reverse resolution. Empty string if the address has no primary handle.
    function primaryHandle(address owner) external view returns (string memory) {
        return _handles[_primaryNode[owner]];
    }

    function primaryNode(address owner) external view returns (bytes32) {
        return _primaryNode[owner];
    }

    function available(string calldata handle) external view returns (bool) {
        if (!isValidHandle(handle)) return false;
        return _owners[namehash(handle)] == address(0);
    }

    /// @notice keccak256 of the raw handle bytes. Not ENS namehash — Maren handles are a flat
    ///         namespace with no parent, so a single hash is the whole story.
    function namehash(string calldata handle) public pure returns (bytes32) {
        return keccak256(bytes(handle));
    }

    // ------------------------------------------------------------------ //
    //                             Validation                             //
    // ------------------------------------------------------------------ //

    /// @notice `true` iff the handle is 3-32 chars of `[a-z0-9_]`.
    /// @dev Uppercase is REJECTED rather than normalised. Normalising on-chain would mean
    ///      "Sele" and "sele" hash to different nodes in any client that forgets to
    ///      normalise first, which is exactly how homograph confusion starts.
    function isValidHandle(string calldata handle) public pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length < MIN_HANDLE_LENGTH || b.length > MAX_HANDLE_LENGTH) return false;
        for (uint256 i; i < b.length; ++i) {
            if (!_isAllowedChar(b[i])) return false;
        }
        return true;
    }

    function _validateHandle(string calldata handle) private pure {
        bytes calldata b = bytes(handle);
        if (b.length < MIN_HANDLE_LENGTH) revert HandleTooShort(b.length);
        if (b.length > MAX_HANDLE_LENGTH) revert HandleTooLong(b.length);
        for (uint256 i; i < b.length; ++i) {
            if (!_isAllowedChar(b[i])) revert HandleInvalidCharacter(i, b[i]);
        }
    }

    function _isAllowedChar(bytes1 c) private pure returns (bool) {
        return (c >= 0x61 && c <= 0x7a) // a-z
            || (c >= 0x30 && c <= 0x39) // 0-9
            || c == 0x5f; // _
    }

    // ------------------------------------------------------------------ //
    //                              Internals                             //
    // ------------------------------------------------------------------ //

    function _requireOwner(string calldata handle) private view returns (bytes32 node) {
        node = namehash(handle);
        address owner = _owners[node];
        if (owner == address(0)) revert HandleNotRegistered(handle);
        if (owner != _msgSender()) revert NotHandleOwner(_msgSender(), owner);
    }

    function _clearPrimaryIfSet(address owner, bytes32 node) private {
        if (_primaryNode[owner] == node) {
            delete _primaryNode[owner];
            emit PrimaryHandleCleared(owner, node);
        }
    }

    // ------------------------------------------------------------------ //
    //                          ERC-2771 plumbing                         //
    // ------------------------------------------------------------------ //

    function _msgSender() internal view override returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
