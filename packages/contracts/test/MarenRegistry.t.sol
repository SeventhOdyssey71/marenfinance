// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Unit tests for MarenRegistry: commit-reveal registration, handle validation,
///         ownership/primary-handle bookkeeping, resolution, and ERC-2771 sender handling.
contract MarenRegistryTest is Test {
    MarenForwarder internal forwarder;
    MarenRegistry internal registry;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant SECRET = keccak256("secret");

    event Committed(bytes32 indexed commitment, uint256 committedAt);
    event HandleRegistered(bytes32 indexed node, address indexed owner, string handle);
    event HandleTransferred(bytes32 indexed node, address indexed from, address indexed to, string handle);
    event HandleReleased(bytes32 indexed node, address indexed owner, string handle);
    event PrimaryHandleSet(address indexed owner, bytes32 indexed node, string handle);
    event PrimaryHandleCleared(address indexed owner, bytes32 indexed node);

    function setUp() public {
        forwarder = new MarenForwarder();
        registry = new MarenRegistry(address(forwarder));
        // Start well past the epoch so `block.timestamp - MAX_COMMITMENT_AGE` style maths in
        // the tests never underflows.
        vm.warp(1_800_000_000);
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    function _commitment(string memory handle, address owner, bytes32 secret)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(handle, owner, secret));
    }

    /// @dev Full commit -> warp -> register happy path for `owner`.
    function _claim(address owner, string memory handle, bytes32 secret) internal {
        vm.prank(owner);
        registry.commit(_commitment(handle, owner, secret));
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(owner);
        registry.register(handle, secret);
    }

    // ------------------------------------------------------------------ //
    //                            Happy paths                             //
    // ------------------------------------------------------------------ //

    function test_Constructor_TrustsForwarder() public view {
        assertTrue(registry.isTrustedForwarder(address(forwarder)));
        assertFalse(registry.isTrustedForwarder(alice));
    }

    function test_Constants_MatchDocumentedValues() public view {
        assertEq(registry.MIN_COMMITMENT_AGE(), 60);
        assertEq(registry.MAX_COMMITMENT_AGE(), 7 days);
        assertEq(registry.MIN_HANDLE_LENGTH(), 3);
        assertEq(registry.MAX_HANDLE_LENGTH(), 32);
    }

    function test_Commit_StoresTimestampAndEmits() public {
        bytes32 c = _commitment("sele", alice, SECRET);

        vm.expectEmit(true, false, false, true, address(registry));
        emit Committed(c, block.timestamp);

        vm.prank(alice);
        registry.commit(c);

        assertEq(registry.commitments(c), block.timestamp);
    }

    /// @dev The commitment is opaque: it must not leak the handle to an observer.
    function test_Commit_IsOpaque() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        assertTrue(c != registry.namehash("sele"));
        assertTrue(c != keccak256(bytes("sele")));
    }

    function test_Register_HappyPath() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);

        vm.warp(block.timestamp + 61);

        bytes32 node = registry.namehash("sele");
        vm.expectEmit(true, true, false, true, address(registry));
        emit HandleRegistered(node, alice, "sele");
        vm.expectEmit(true, true, false, true, address(registry));
        emit PrimaryHandleSet(alice, node, "sele");

        vm.prank(alice);
        registry.register("sele", SECRET);

        assertEq(registry.resolve("sele"), alice, "forward resolution");
        assertEq(registry.ownerOfNode(node), alice, "ownerOfNode");
        assertEq(registry.primaryHandle(alice), "sele", "reverse resolution");
        assertEq(registry.primaryNode(alice), node, "primary node");
        assertEq(registry.handleCount(alice), 1, "handle count");
        assertFalse(registry.available("sele"), "no longer available");
        // The commitment is burned on reveal.
        assertEq(registry.commitments(c), 0, "commitment cleared");
    }

    function test_Register_ExactlyAtMinAgeSucceeds() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(alice);
        registry.register("sele", SECRET);
        assertEq(registry.resolve("sele"), alice);
    }

    function test_Register_ExactlyAtMaxAgeSucceeds() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);
        vm.warp(block.timestamp + registry.MAX_COMMITMENT_AGE());
        vm.prank(alice);
        registry.register("sele", SECRET);
        assertEq(registry.resolve("sele"), alice);
    }

    function test_Register_SecondHandleDoesNotChangePrimary() public {
        _claim(alice, "sele", SECRET);
        _claim(alice, "sele_two", keccak256("s2"));

        assertEq(registry.handleCount(alice), 2);
        assertEq(registry.primaryHandle(alice), "sele", "primary stays the first handle");
        assertEq(registry.resolve("sele_two"), alice);
    }

    function test_Register_AcceptsFullAllowedCharset() public {
        _claim(alice, "abc_012_xyz789", SECRET);
        assertEq(registry.resolve("abc_012_xyz789"), alice);
    }

    function test_Register_AcceptsBoundaryLengths() public {
        _claim(alice, "abc", keccak256("min"));
        // 32 chars exactly.
        _claim(bob, "abcdefghijabcdefghijabcdefghijab", keccak256("max"));
        assertEq(registry.resolve("abc"), alice);
        assertEq(registry.resolve("abcdefghijabcdefghijabcdefghijab"), bob);
    }

    // ------------------------------------------------------------------ //
    //                     Commit-reveal revert paths                     //
    // ------------------------------------------------------------------ //

    function testRevert_Register_CommitmentNotFound() public {
        bytes32 expected = _commitment("sele", alice, SECRET);
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.CommitmentNotFound.selector, expected));
        vm.prank(alice);
        registry.register("sele", SECRET);
    }

    function testRevert_Register_WrongSecretIsCommitmentNotFound() public {
        vm.prank(alice);
        registry.commit(_commitment("sele", alice, SECRET));
        vm.warp(block.timestamp + 61);

        bytes32 wrong = _commitment("sele", alice, keccak256("wrong"));
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.CommitmentNotFound.selector, wrong));
        vm.prank(alice);
        registry.register("sele", keccak256("wrong"));
    }

    function testRevert_Register_CommitmentTooNew() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);

        uint256 committedAt = block.timestamp;
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRegistry.CommitmentTooNew.selector,
                committedAt,
                committedAt + registry.MIN_COMMITMENT_AGE()
            )
        );
        vm.prank(alice);
        registry.register("sele", SECRET);
    }

    function testRevert_Register_CommitmentTooNewOneSecondEarly() public {
        vm.prank(alice);
        registry.commit(_commitment("sele", alice, SECRET));
        uint256 committedAt = block.timestamp;

        vm.warp(committedAt + registry.MIN_COMMITMENT_AGE() - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRegistry.CommitmentTooNew.selector,
                committedAt,
                committedAt + registry.MIN_COMMITMENT_AGE()
            )
        );
        vm.prank(alice);
        registry.register("sele", SECRET);
    }

    function testRevert_Register_CommitmentExpired() public {
        vm.prank(alice);
        registry.commit(_commitment("sele", alice, SECRET));
        uint256 committedAt = block.timestamp;

        vm.warp(committedAt + registry.MAX_COMMITMENT_AGE() + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRegistry.CommitmentExpired.selector,
                committedAt,
                committedAt + registry.MAX_COMMITMENT_AGE()
            )
        );
        vm.prank(alice);
        registry.register("sele", SECRET);
    }

    function testRevert_Commit_CommitmentAlreadyExists() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);

        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.CommitmentAlreadyExists.selector, c));
        vm.prank(alice);
        registry.commit(c);
    }

    function test_Commit_MayBeRemadeOnceExpired() public {
        bytes32 c = _commitment("sele", alice, SECRET);
        vm.prank(alice);
        registry.commit(c);
        uint256 first = block.timestamp;

        vm.warp(first + registry.MAX_COMMITMENT_AGE() + 1);
        vm.prank(alice);
        registry.commit(c);
        assertEq(registry.commitments(c), block.timestamp);

        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        registry.register("sele", SECRET);
        assertEq(registry.resolve("sele"), alice);
    }

    function testRevert_Register_HandleTaken() public {
        _claim(alice, "sele", SECRET);

        bytes32 c = _commitment("sele", bob, keccak256("bob"));
        vm.prank(bob);
        registry.commit(c);
        vm.warp(block.timestamp + 61);

        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleTaken.selector, "sele"));
        vm.prank(bob);
        registry.register("sele", keccak256("bob"));
    }

    // ------------------------------------------------------------------ //
    //                        Handle validation                           //
    // ------------------------------------------------------------------ //

    function testRevert_Register_HandleTooShort() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleTooShort.selector, uint256(2)));
        vm.prank(alice);
        registry.register("ab", SECRET);
    }

    function testRevert_Register_HandleTooLong() public {
        // 33 characters.
        string memory long = "abcdefghijabcdefghijabcdefghijabc";
        assertEq(bytes(long).length, 33);
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleTooLong.selector, uint256(33)));
        vm.prank(alice);
        registry.register(long, SECRET);
    }

    function testRevert_Register_HandleInvalidCharacterUppercase() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.HandleInvalidCharacter.selector, uint256(0), bytes1("S"))
        );
        vm.prank(alice);
        registry.register("Sele", SECRET);
    }

    function testRevert_Register_HandleInvalidCharacterDash() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.HandleInvalidCharacter.selector, uint256(4), bytes1("-"))
        );
        vm.prank(alice);
        registry.register("sele-x", SECRET);
    }

    function testRevert_Register_HandleInvalidCharacterDot() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.HandleInvalidCharacter.selector, uint256(4), bytes1("."))
        );
        vm.prank(alice);
        registry.register("sele.eth", SECRET);
    }

    function testRevert_Register_HandleInvalidCharacterSpace() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.HandleInvalidCharacter.selector, uint256(4), bytes1(" "))
        );
        vm.prank(alice);
        registry.register("sele x", SECRET);
    }

    /// @dev A multi-byte character must be rejected at its FIRST byte. If it were not, a
    ///      homograph of an existing handle could be registered and used to impersonate it.
    function testRevert_Register_HandleInvalidCharacterMultiByteUtf8() public {
        string memory h = unicode"selé"; // 's','e','l',0xC3,0xA9
        assertEq(bytes(h).length, 5);
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.HandleInvalidCharacter.selector, uint256(3), bytes1(0xC3))
        );
        vm.prank(alice);
        registry.register(h, SECRET);
    }

    function test_IsValidHandle() public view {
        assertTrue(registry.isValidHandle("sele"));
        assertTrue(registry.isValidHandle("abc"));
        assertTrue(registry.isValidHandle("a_0"));
        assertTrue(registry.isValidHandle("abcdefghijabcdefghijabcdefghijab"), "32 chars");
        assertFalse(registry.isValidHandle("ab"), "too short");
        assertFalse(registry.isValidHandle("abcdefghijabcdefghijabcdefghijabc"), "33 chars");
        assertFalse(registry.isValidHandle(""), "empty");
        assertFalse(registry.isValidHandle("Sele"), "uppercase");
        assertFalse(registry.isValidHandle("sele-x"), "dash");
        assertFalse(registry.isValidHandle("sele.eth"), "dot");
        assertFalse(registry.isValidHandle("sele x"), "space");
        assertFalse(registry.isValidHandle(unicode"selé"), "multi-byte");
    }

    function test_Available_FalseForInvalidHandle() public view {
        assertTrue(registry.available("sele"));
        assertFalse(registry.available("ab"), "invalid handles are never available");
        assertFalse(registry.available("Sele"));
    }

    function test_Available_FalseOnceRegistered() public {
        _claim(alice, "sele", SECRET);
        assertFalse(registry.available("sele"));
    }

    // ------------------------------------------------------------------ //
    //                        THE FRONT-RUNNING PROPERTY                  //
    // ------------------------------------------------------------------ //

    /**
     * @dev SECURITY PROPERTY: a commitment is bound to the registrant's address, so copying
     *      the victim's `commit(bytes32)` calldata out of the mempool is worthless.
     *
     *      If this test failed, `register("sele")` would be a free option for every searcher
     *      watching the mempool: they would replay the commitment, reveal it first, and take
     *      every handle anyone ever tried to claim. The whole reason the registry is
     *      commit-reveal instead of a single `register` call would be gone.
     */
    function test_Security_CopiedCommitmentCannotBeRevealedByAttacker() public {
        bytes32 victimCommitment = _commitment("sele", alice, SECRET);

        // Victim broadcasts commit(victimCommitment). The attacker sees the raw calldata.
        vm.prank(alice);
        registry.commit(victimCommitment);

        // Replaying the identical commitment does not even land: it is already stored.
        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.CommitmentAlreadyExists.selector, victimCommitment)
        );
        vm.prank(attacker);
        registry.commit(victimCommitment);

        vm.warp(block.timestamp + 61);

        // Even granting the attacker the handle AND the secret (the worst case, i.e. they also
        // saw the victim's reveal), the stored commitment is bound to `alice`, so the
        // attacker's own reveal hashes to a commitment that was never made.
        bytes32 attackerCommitment = _commitment("sele", attacker, SECRET);
        assertTrue(attackerCommitment != victimCommitment, "commitment must be address-bound");
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.CommitmentNotFound.selector, attackerCommitment));
        vm.prank(attacker);
        registry.register("sele", SECRET);

        // And the victim's own reveal still works.
        vm.prank(alice);
        registry.register("sele", SECRET);
        assertEq(registry.resolve("sele"), alice, "victim keeps the handle");
        assertEq(registry.handleCount(attacker), 0, "attacker got nothing");
    }

    /**
     * @dev SECURITY PROPERTY: the reveal transaction discloses (handle, secret), but an
     *      attacker who commits after seeing it cannot register in the same block, because
     *      MIN_COMMITMENT_AGE forces the commitment to age first. Without this the reveal
     *      itself would be front-runnable.
     */
    function test_Security_AttackerCannotCommitAndRevealInSameBlock() public {
        vm.prank(alice);
        registry.commit(_commitment("sele", alice, SECRET));
        vm.warp(block.timestamp + 61);

        // Attacker sees alice's pending register("sele", SECRET) and races it.
        vm.prank(attacker);
        registry.commit(_commitment("sele", attacker, SECRET));
        uint256 committedAt = block.timestamp;

        vm.expectRevert(
            abi.encodeWithSelector(MarenRegistry.CommitmentTooNew.selector, committedAt, committedAt + 60)
        );
        vm.prank(attacker);
        registry.register("sele", SECRET);

        vm.prank(alice);
        registry.register("sele", SECRET);
        assertEq(registry.resolve("sele"), alice);
    }

    // ------------------------------------------------------------------ //
    //                             Management                             //
    // ------------------------------------------------------------------ //

    /// @dev `handleCount` is updated with unchecked arithmetic, so a self-transfer (decrement
    ///      then increment on the SAME slot) is the one ordering that could underflow. It must
    ///      be a clean no-op.
    function test_TransferHandle_ToSelfIsANoOp() public {
        _claim(alice, "sele", SECRET);
        vm.prank(alice);
        registry.transferHandle("sele", alice);

        assertEq(registry.resolve("sele"), alice);
        assertEq(registry.handleCount(alice), 1, "count must not underflow");
        assertEq(registry.primaryHandle(alice), "sele", "primary cleared then re-adopted");
    }

    /// @dev Documents a sharp edge worth knowing about: giving away the handle that happens to
    ///      be your primary leaves you with NO reverse resolution even though you still own
    ///      other handles. Nothing is lost — `setPrimaryHandle` fixes it — but a UI should.
    function test_TransferHandle_PrimaryGoesBlankEvenIfOtherHandlesRemain() public {
        _claim(alice, "sele", SECRET);
        _claim(alice, "sele_two", keccak256("s2"));
        vm.prank(alice);
        registry.setPrimaryHandle("sele_two");

        vm.prank(alice);
        registry.transferHandle("sele_two", bob);

        assertEq(registry.handleCount(alice), 1, "alice still owns a handle");
        assertEq(registry.primaryHandle(alice), "", "but has no primary");

        vm.prank(alice);
        registry.setPrimaryHandle("sele");
        assertEq(registry.primaryHandle(alice), "sele");
    }

    function test_TransferHandle_ClearsSenderPrimaryAndRecipientAdopts() public {
        _claim(alice, "sele", SECRET);
        bytes32 node = registry.namehash("sele");

        vm.expectEmit(true, true, false, false, address(registry));
        emit PrimaryHandleCleared(alice, node);
        vm.expectEmit(true, true, true, true, address(registry));
        emit HandleTransferred(node, alice, bob, "sele");
        vm.expectEmit(true, true, false, true, address(registry));
        emit PrimaryHandleSet(bob, node, "sele");

        vm.prank(alice);
        registry.transferHandle("sele", bob);

        assertEq(registry.resolve("sele"), bob);
        assertEq(registry.primaryHandle(alice), "", "sender primary cleared");
        assertEq(registry.primaryNode(alice), bytes32(0));
        assertEq(registry.primaryHandle(bob), "sele", "recipient adopted it");
        assertEq(registry.handleCount(alice), 0);
        assertEq(registry.handleCount(bob), 1);
    }

    function test_TransferHandle_DoesNotOverwriteRecipientExistingPrimary() public {
        _claim(alice, "sele", SECRET);
        _claim(bob, "bobby", keccak256("bob"));

        vm.prank(alice);
        registry.transferHandle("sele", bob);

        assertEq(registry.resolve("sele"), bob);
        assertEq(registry.primaryHandle(bob), "bobby", "bob's own primary is untouched");
        assertEq(registry.handleCount(bob), 2);
    }

    function test_TransferHandle_NonPrimaryLeavesSenderPrimaryIntact() public {
        _claim(alice, "sele", SECRET);
        _claim(alice, "sele_two", keccak256("s2"));

        vm.prank(alice);
        registry.transferHandle("sele_two", bob);

        assertEq(registry.primaryHandle(alice), "sele", "primary untouched");
        assertEq(registry.handleCount(alice), 1);
        assertEq(registry.resolve("sele_two"), bob);
    }

    function testRevert_TransferHandle_ZeroAddress() public {
        _claim(alice, "sele", SECRET);
        vm.expectRevert(MarenRegistry.ZeroAddress.selector);
        vm.prank(alice);
        registry.transferHandle("sele", address(0));
    }

    function testRevert_TransferHandle_NotHandleOwner() public {
        _claim(alice, "sele", SECRET);
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.NotHandleOwner.selector, bob, alice));
        vm.prank(bob);
        registry.transferHandle("sele", carol);
    }

    function testRevert_TransferHandle_HandleNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleNotRegistered.selector, "nope"));
        vm.prank(alice);
        registry.transferHandle("nope", bob);
    }

    function test_ReleaseHandle_ThenReRegisterByAnotherAddress() public {
        _claim(alice, "sele", SECRET);
        bytes32 node = registry.namehash("sele");

        vm.expectEmit(true, true, false, false, address(registry));
        emit PrimaryHandleCleared(alice, node);
        vm.expectEmit(true, true, false, true, address(registry));
        emit HandleReleased(node, alice, "sele");

        vm.prank(alice);
        registry.releaseHandle("sele");

        assertEq(registry.handleCount(alice), 0);
        assertEq(registry.primaryHandle(alice), "");
        assertTrue(registry.available("sele"));
        assertEq(registry.tryResolve("sele"), address(0));

        _claim(bob, "sele", keccak256("bob"));
        assertEq(registry.resolve("sele"), bob);
        assertEq(registry.primaryHandle(bob), "sele");
        assertEq(registry.handleCount(bob), 1);
    }

    function testRevert_ReleaseHandle_NotHandleOwner() public {
        _claim(alice, "sele", SECRET);
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.NotHandleOwner.selector, bob, alice));
        vm.prank(bob);
        registry.releaseHandle("sele");
    }

    function testRevert_ReleaseHandle_HandleNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleNotRegistered.selector, "nope"));
        vm.prank(alice);
        registry.releaseHandle("nope");
    }

    function test_SetPrimaryHandle_SwitchesBetweenTwoOwnedHandles() public {
        _claim(alice, "sele", SECRET);
        _claim(alice, "sele_two", keccak256("s2"));
        assertEq(registry.primaryHandle(alice), "sele");

        bytes32 node2 = registry.namehash("sele_two");
        vm.expectEmit(true, true, false, true, address(registry));
        emit PrimaryHandleSet(alice, node2, "sele_two");
        vm.prank(alice);
        registry.setPrimaryHandle("sele_two");

        assertEq(registry.primaryHandle(alice), "sele_two");
        assertEq(registry.primaryNode(alice), node2);

        vm.prank(alice);
        registry.setPrimaryHandle("sele");
        assertEq(registry.primaryHandle(alice), "sele");
    }

    function testRevert_SetPrimaryHandle_NotHandleOwner() public {
        _claim(alice, "sele", SECRET);
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.NotHandleOwner.selector, bob, alice));
        vm.prank(bob);
        registry.setPrimaryHandle("sele");
    }

    function testRevert_SetPrimaryHandle_HandleNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleNotRegistered.selector, "nope"));
        vm.prank(alice);
        registry.setPrimaryHandle("nope");
    }

    // ------------------------------------------------------------------ //
    //                             Resolution                             //
    // ------------------------------------------------------------------ //

    /// @dev SECURITY-ADJACENT: `resolve` must revert rather than return address(0), or a typo'd
    ///      handle in a payment UI would burn the funds at the zero address.
    function testRevert_Resolve_HandleNotRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleNotRegistered.selector, "ghost"));
        registry.resolve("ghost");
    }

    function test_TryResolve_ReturnsZeroWithoutReverting() public {
        assertEq(registry.tryResolve("ghost"), address(0));
        _claim(alice, "sele", SECRET);
        assertEq(registry.tryResolve("sele"), alice);
    }

    function test_PrimaryHandle_EmptyForUnknownAddress() public view {
        assertEq(registry.primaryHandle(carol), "");
        assertEq(registry.primaryNode(carol), bytes32(0));
        assertEq(registry.handleCount(carol), 0);
    }

    function test_Namehash_IsPlainKeccakOfBytes() public view {
        assertEq(registry.namehash("sele"), keccak256(bytes("sele")));
        assertTrue(registry.namehash("sele") != registry.namehash("Sele"));
    }

    function test_OwnerOfNode_ZeroForUnknownNode() public view {
        assertEq(registry.ownerOfNode(keccak256("nothing")), address(0));
    }

    // ------------------------------------------------------------------ //
    //                              ERC-2771                              //
    // ------------------------------------------------------------------ //

    /**
     * @dev SECURITY PROPERTY: the 20-byte sender suffix is honoured ONLY when the call arrives
     *      from the trusted forwarder. If a direct caller could append someone else's address
     *      and have it believed, anyone could register handles as, transfer handles from, or
     *      re-point the primary handle of any address on the chain.
     */
    function test_ERC2771_ForwarderSuffixIsTheSenderButOnlyFromTheForwarder() public {
        // Alice commits herself (a real relayer flow would forward this too).
        vm.prank(alice);
        registry.commit(_commitment("sele", alice, SECRET));
        vm.warp(block.timestamp + 61);

        bytes memory innerCall = abi.encodeCall(MarenRegistry.register, ("sele", SECRET));
        bytes memory spoofed = abi.encodePacked(innerCall, alice);

        // 1. A non-forwarder cannot spoof alice, even with a byte-identical suffix.
        vm.prank(attacker);
        (bool okAttacker,) = address(registry).call(spoofed);
        assertFalse(okAttacker, "suffix from a random caller must not be trusted");
        assertEq(registry.tryResolve("sele"), address(0), "nothing registered by the spoof");

        // 2. The same calldata from the trusted forwarder registers to alice, not the forwarder.
        vm.prank(address(forwarder));
        (bool okForwarder,) = address(registry).call(spoofed);
        assertTrue(okForwarder, "forwarded call should succeed");

        assertEq(registry.resolve("sele"), alice, "owner is the appended address");
        assertTrue(registry.resolve("sele") != address(forwarder), "never the forwarder");
        assertEq(registry.handleCount(alice), 1);
        assertEq(registry.handleCount(address(forwarder)), 0);
        assertEq(registry.primaryHandle(alice), "sele");
    }

    function test_ERC2771_ForwardedManagementUsesAppendedSender() public {
        _claim(alice, "sele", SECRET);

        // Forwarded transferHandle on alice's behalf.
        bytes memory inner = abi.encodeCall(MarenRegistry.transferHandle, ("sele", bob));
        vm.prank(address(forwarder));
        (bool ok,) = address(registry).call(abi.encodePacked(inner, alice));
        assertTrue(ok);
        assertEq(registry.resolve("sele"), bob);

        // The forwarder relaying an unauthorised sender still fails the ownership check.
        bytes memory bad = abi.encodeCall(MarenRegistry.releaseHandle, ("sele"));
        vm.prank(address(forwarder));
        (bool ok2,) = address(registry).call(abi.encodePacked(bad, carol));
        assertFalse(ok2, "the forwarder cannot launder an unauthorised sender");
        assertEq(registry.resolve("sele"), bob);
    }

    function test_ERC2771_DirectCallWithoutSuffixUsesMsgSender() public {
        _claim(alice, "sele", SECRET);
        assertEq(registry.resolve("sele"), alice);
    }
}
