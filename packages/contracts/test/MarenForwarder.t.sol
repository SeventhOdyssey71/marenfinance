// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Test} from "forge-std/Test.sol";

/// @dev A target that does NOT trust the forwarder, for the untrustful-target path.
contract UntrustingTarget {
    uint256 public pokes;

    function poke() external {
        pokes += 1;
    }
}

/// @notice Unit tests for MarenForwarder: the EIP-712 domain it commits to, an end-to-end
///         sponsored transaction for a user holding zero ether, and the replay / expiry /
///         wrong-signer rejections it inherits from OpenZeppelin.
contract MarenForwarderTest is Test {
    MarenForwarder internal forwarder;
    MarenRegistry internal registry;

    address internal user;
    uint256 internal userPk;
    address internal mallory;
    uint256 internal malloryPk;
    address internal relayer = makeAddr("relayer");

    bytes32 internal constant SECRET = keccak256("secret");

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant FORWARD_REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    function setUp() public {
        (user, userPk) = makeAddrAndKey("user");
        (mallory, malloryPk) = makeAddrAndKey("mallory");

        forwarder = new MarenForwarder();
        registry = new MarenRegistry(address(forwarder));

        vm.warp(1_800_000_000);
        vm.deal(relayer, 10 ether);
        vm.deal(user, 0);
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    /// @dev The EIP-712 domain separator, computed here from first principles rather than read
    ///      off the contract, so a change to either domain string is caught.
    function _expectedDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Maren Forwarder")),
                keccak256(bytes("1")),
                block.chainid,
                address(forwarder)
            )
        );
    }

    function _signRequest(
        uint256 pk,
        address from,
        address to,
        uint256 value,
        uint256 gas,
        uint48 deadline,
        bytes memory data
    ) internal view returns (ERC2771Forwarder.ForwardRequestData memory request) {
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_REQUEST_TYPEHASH,
                from,
                to,
                value,
                gas,
                forwarder.nonces(from),
                deadline,
                keccak256(data)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _expectedDomainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        request = ERC2771Forwarder.ForwardRequestData({
            from: from,
            to: to,
            value: value,
            gas: gas,
            deadline: deadline,
            data: data,
            signature: abi.encodePacked(r, s, v)
        });
    }

    function _registerRequest(uint256 pk, address from, string memory handle)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory)
    {
        bytes memory data = abi.encodeCall(MarenRegistry.register, (handle, SECRET));
        return _signRequest(pk, from, address(registry), 0, 500_000, uint48(block.timestamp + 1 hours), data);
    }

    // ------------------------------------------------------------------ //
    //                            EIP-712 domain                          //
    // ------------------------------------------------------------------ //

    function test_DomainConstants() public view {
        assertEq(forwarder.DOMAIN_NAME(), "Maren Forwarder");
        assertEq(forwarder.DOMAIN_VERSION(), "1");
    }

    function test_Eip712DomainMatchesConstants() public view {
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = forwarder.eip712Domain();

        assertEq(fields, hex"0f");
        assertEq(name, "Maren Forwarder");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(forwarder));
        assertEq(salt, bytes32(0));
        assertEq(extensions.length, 0);
    }

    /**
     * @dev The domain separator is the root of every sponsored-transaction signature. The SDK
     *      and the relayer hardcode "Maren Forwarder"/"1"; if the deployed contract ever
     *      disagreed, every signature they produced would recover to a garbage address and
     *      no meta-transaction would execute. Proven by signing with an INDEPENDENTLY computed
     *      separator and having the real contract accept it.
     */
    function test_DomainSeparatorMatchesIndependentComputation() public {
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        ERC2771Forwarder.ForwardRequestData memory request = _registerRequest(userPk, user, "sele");
        assertTrue(forwarder.verify(request), "signature over the independent separator must verify");

        // And a signature over a WRONG domain must not verify.
        bytes32 wrongSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Maren Forwarder")),
                keccak256(bytes("2")), // wrong version
                block.chainid,
                address(forwarder)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_REQUEST_TYPEHASH,
                user,
                address(registry),
                uint256(0),
                uint256(500_000),
                forwarder.nonces(user),
                request.deadline,
                keccak256(request.data)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(userPk, keccak256(abi.encodePacked("\x19\x01", wrongSeparator, structHash)));
        request.signature = abi.encodePacked(r, s, v);
        assertFalse(forwarder.verify(request), "wrong domain version must not verify");
    }

    // ------------------------------------------------------------------ //
    //                     End-to-end sponsored transaction               //
    // ------------------------------------------------------------------ //

    /**
     * @dev THE POINT OF THE WHOLE CONTRACT: a user holding zero BTC claims a handle. If this
     *      broke, Maren's onboarding story (no gas token, no bridge, just a signature) would
     *      be gone.
     */
    function test_SponsoredRegistration_UserWithZeroEther() public {
        assertEq(user.balance, 0, "precondition: the user is broke");

        // The relayer submits the commitment (commit() is not sender-bound; the commitment
        // hash itself binds the handle to the user).
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        ERC2771Forwarder.ForwardRequestData memory request = _registerRequest(userPk, user, "sele");
        assertTrue(forwarder.verify(request));
        assertEq(forwarder.nonces(user), 0);

        vm.prank(relayer);
        forwarder.execute(request);

        assertEq(registry.resolve("sele"), user, "handle owned by the signer");
        assertTrue(registry.resolve("sele") != relayer, "not the relayer");
        assertTrue(registry.resolve("sele") != address(forwarder), "not the forwarder");
        assertEq(registry.primaryHandle(user), "sele");
        assertEq(user.balance, 0, "the user still holds zero ether");
        assertEq(forwarder.nonces(user), 1, "nonce consumed");
    }

    function test_SponsoredRegistration_TwoRequestsInSequence() public {
        vm.startPrank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        registry.commit(keccak256(abi.encode("sele_two", user, SECRET)));
        vm.stopPrank();
        vm.warp(block.timestamp + 61);

        vm.prank(relayer);
        forwarder.execute(_registerRequest(userPk, user, "sele"));
        assertEq(forwarder.nonces(user), 1);

        vm.prank(relayer);
        forwarder.execute(_registerRequest(userPk, user, "sele_two"));
        assertEq(forwarder.nonces(user), 2);

        assertEq(registry.handleCount(user), 2);
        assertEq(registry.primaryHandle(user), "sele", "first handle stays primary");
        assertEq(user.balance, 0);
    }

    /// @dev A forwarded call that reverts inside the target must revert the whole execution, so
    ///      a relayer never reports a failed sponsored action as a success.
    function test_SponsoredRegistration_InnerRevertBubblesUp() public {
        // No commitment was ever made, so register() reverts inside the registry.
        ERC2771Forwarder.ForwardRequestData memory request = _registerRequest(userPk, user, "sele");
        vm.expectRevert();
        vm.prank(relayer);
        forwarder.execute(request);

        assertEq(registry.tryResolve("sele"), address(0));
    }

    // ------------------------------------------------------------------ //
    //                              Rejections                            //
    // ------------------------------------------------------------------ //

    /// @dev SECURITY PROPERTY: replaying a mined request must fail. Without the per-signer
    ///      nonce, a relayer (or anyone reading the chain) could re-execute any signed action
    ///      arbitrarily many times.
    function testRevert_Execute_Replay() public {
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        ERC2771Forwarder.ForwardRequestData memory request = _registerRequest(userPk, user, "sele");
        vm.prank(relayer);
        forwarder.execute(request);

        assertFalse(forwarder.verify(request), "a used request must no longer verify");
        // The recovered signer is whatever the stale-nonce digest happens to recover to, so
        // only the selector is asserted.
        vm.expectPartialRevert(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector);
        vm.prank(relayer);
        forwarder.execute(request);

        assertEq(forwarder.nonces(user), 1, "nonce not consumed twice");
    }

    function testRevert_Execute_ExpiredDeadline() public {
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        uint48 deadline = uint48(block.timestamp - 1);
        bytes memory data = abi.encodeCall(MarenRegistry.register, ("sele", SECRET));
        ERC2771Forwarder.ForwardRequestData memory request =
            _signRequest(userPk, user, address(registry), 0, 500_000, deadline, data);

        assertFalse(forwarder.verify(request));
        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderExpiredRequest.selector, deadline)
        );
        vm.prank(relayer);
        forwarder.execute(request);
    }

    /// @dev SECURITY PROPERTY: `from` must equal the recovered signer. If a different key could
    ///      authorise a request, the forwarder would let anyone act as anyone.
    function testRevert_Execute_SignedByADifferentKey() public {
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        // Mallory signs, but the request claims to come from `user`.
        bytes memory data = abi.encodeCall(MarenRegistry.register, ("sele", SECRET));
        ERC2771Forwarder.ForwardRequestData memory request = _signRequest(
            malloryPk, user, address(registry), 0, 500_000, uint48(block.timestamp + 1 hours), data
        );

        assertFalse(forwarder.verify(request));
        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector, mallory, user)
        );
        vm.prank(relayer);
        forwarder.execute(request);

        assertEq(registry.tryResolve("sele"), address(0));
        assertEq(forwarder.nonces(user), 0);
    }

    function testRevert_Execute_UntrustfulTarget() public {
        UntrustingTarget target = new UntrustingTarget();
        bytes memory data = abi.encodeCall(UntrustingTarget.poke, ());
        ERC2771Forwarder.ForwardRequestData memory request =
            _signRequest(userPk, user, address(target), 0, 200_000, uint48(block.timestamp + 1 hours), data);

        assertFalse(forwarder.verify(request));
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC2771Forwarder.ERC2771UntrustfulTarget.selector, address(target), address(forwarder)
            )
        );
        vm.prank(relayer);
        forwarder.execute(request);
    }

    function testRevert_Execute_MismatchedValue() public {
        bytes memory data = abi.encodeCall(MarenRegistry.register, ("sele", SECRET));
        ERC2771Forwarder.ForwardRequestData memory request = _signRequest(
            userPk, user, address(registry), 0, 500_000, uint48(block.timestamp + 1 hours), data
        );

        vm.expectRevert(
            abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderMismatchedValue.selector, 0, 1 wei)
        );
        vm.prank(relayer);
        forwarder.execute{value: 1 wei}(request);
    }

    function testRevert_Execute_TamperedCalldata() public {
        vm.prank(relayer);
        registry.commit(keccak256(abi.encode("sele", user, SECRET)));
        vm.warp(block.timestamp + 61);

        ERC2771Forwarder.ForwardRequestData memory request = _registerRequest(userPk, user, "sele");
        // The relayer swaps the handle for one it wants instead.
        request.data = abi.encodeCall(MarenRegistry.register, ("other", SECRET));

        assertFalse(forwarder.verify(request), "calldata is covered by the signature");
        vm.expectPartialRevert(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector);
        vm.prank(relayer);
        forwarder.execute(request);
    }
}
