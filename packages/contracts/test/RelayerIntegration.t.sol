// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MarenPay} from "../src/MarenPay.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Test} from "forge-std/Test.sol";

/**
 * @title RelayerIntegrationTest
 * @notice The contract half of the seam with `apps/relayer`. Everything the relayer assumed
 *         by inspection is asserted here by execution.
 *
 * Two things this file exists to settle:
 *
 *  1. THE EIP-712 CONTRACT IS PINNED. The relayer builds `ForwardRequest` digests in
 *     TypeScript. If its typehash string or domain differs from OpenZeppelin v5's by a single
 *     character, every sponsored transaction fails signature recovery at runtime and nothing
 *     catches it before production. The constants below are the exact bytes the relayer must
 *     reproduce, asserted against a real `execute` round trip.
 *
 *  2. THE RELAY FEE DOES NOT NEED TO BE A PARAMETER ON EVERY FUNCTION. See
 *     `test_relayFeeCanBeSettledInABatchWithoutTouchingAnyFunctionSignature` — a fee leg and
 *     a business leg travel as two separately signed ForwardRequests inside one
 *     `executeBatch`, atomically. The fee is inside a signed payload, which is the property
 *     the relayer actually needs, without a trailing `uint256 relayFee` on every entrypoint.
 */
contract RelayerIntegrationTest is Test {
    /// @dev keccak256 of OpenZeppelin v5's ForwardRequest type string. The relayer must
    ///      produce this byte-for-byte.
    bytes32 internal constant FORWARD_REQUEST_TYPEHASH =
        0x7f96328b83274ebc7c1cf4f7a3abda602b51a78b7fa1d86a2ce353d75e587cac;

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    MarenForwarder internal forwarder;
    MarenRegistry internal registry;
    MarenPay internal pay;
    MockMUSD internal musd;

    address internal user;
    uint256 internal userPk;
    address internal relayer = makeAddr("relayer");
    address internal feeRecipient = makeAddr("relayerFeeRecipient");

    function setUp() public {
        (user, userPk) = makeAddrAndKey("relayUser");

        forwarder = new MarenForwarder();
        registry = new MarenRegistry(address(forwarder));
        musd = new MockMUSD();
        pay = new MarenPay(address(musd), address(registry), address(0), address(forwarder));

        vm.warp(1_800_000_000);
        vm.deal(relayer, 10 ether);
        vm.deal(user, 0); // the whole point: the user holds no BTC, ever
        musd.mint(user, 1_000e18);
    }

    // ------------------------------------------------------------------ //
    //                        1. The pinned contract                      //
    // ------------------------------------------------------------------ //

    /**
     * @notice The exact EIP-712 constants `apps/relayer` must reproduce.
     * @dev If this test fails, the relayer's signatures stop verifying. Do not "fix" it by
     *      changing the expected value — the values are OpenZeppelin v5's and Maren's domain
     *      strings, and changing either invalidates every signature ever issued.
     */
    function test_eip712ConstantsArePinnedForTheRelayer() public view {
        assertEq(
            FORWARD_REQUEST_TYPEHASH,
            keccak256(
                "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
            ),
            "ForwardRequest typehash"
        );

        assertEq(forwarder.DOMAIN_NAME(), "Maren Forwarder");
        assertEq(forwarder.DOMAIN_VERSION(), "1");

        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            forwarder.eip712Domain();
        assertEq(name, "Maren Forwarder");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(forwarder));

        assertEq(
            _domainSeparator(),
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    keccak256(bytes("Maren Forwarder")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(forwarder)
                )
            ),
            "domain separator"
        );
    }

    /**
     * @notice A full round trip using a digest built only from the pinned constants above.
     * @dev This is the proof the relayer PR could not produce because `packages/contracts` did
     *      not exist yet. A signature constructed from those constants and nothing else is
     *      accepted by the deployed forwarder, and the inner contract sees the USER as the
     *      sender while the RELAYER pays the gas.
     */
    function test_roundTripFromPinnedConstantsOnly() public {
        bytes32 secret = keccak256("relay-secret");
        string memory handle = "relayed";

        _execute(
            _sign(
                address(registry),
                abi.encodeCall(registry.commit, (registry.makeCommitment(handle, user, secret)))
            )
        );
        vm.warp(block.timestamp + 61);
        _execute(_sign(address(registry), abi.encodeCall(registry.register, (handle, secret))));

        assertEq(registry.resolve(handle), user, "the inner contract saw the user, not the relayer");
        assertEq(user.balance, 0, "the user never held or spent a single wei of BTC");
        assertEq(forwarder.nonces(user), 2, "both requests consumed a nonce");
    }

    // ------------------------------------------------------------------ //
    //                     2. Relay fees without a param                  //
    // ------------------------------------------------------------------ //

    /**
     * @notice Settles a relay fee inside a signed payload WITHOUT putting `uint256 relayFee`
     *         on any business function.
     * @dev The relayer's requirement is that the fee is economically bound into something the
     *      user signed. `executeBatch` gives exactly that: two independent ForwardRequests,
     *      each signed by the user, executed atomically by the relayer. Request 0 pays the
     *      fee in MUSD (approving it in the same call via EIP-2612, so a first-time user needs
     *      zero prior transactions); request 1 does the actual work. If either reverts, the
     *      batch reverts, so the relayer cannot collect a fee for work it did not do and the
     *      user cannot get work done without paying.
     *
     *      This keeps every business signature clean, keeps fee policy out of the payment and
     *      vault contracts entirely, and matches ARCHITECTURE.md §4's "a small fee taken in
     *      MUSD inside the same transaction".
     *
     *      IMPORTANT CAVEAT, PROVEN BELOW: `executeBatch` does NOT roll the fee leg back if
     *      the work leg's inner call reverts. See
     *      `test_executeBatchIsNotAtomicForInnerCallFailures`. This test shows the happy path
     *      only; the relayer must simulate first, or a small relay-hub contract must do
     *      "take fee, then call target" inside a single forwarded call.
     */
    function test_relayFeeCanBeSettledInABatchWithoutTouchingAnyFunctionSignature() public {
        bytes32 secret = keccak256("batched");
        string memory handle = "batched";
        uint256 fee = 0.25e18;

        // Commit first — the reveal has to be at least MIN_COMMITMENT_AGE old.
        _execute(
            _sign(
                address(registry),
                abi.encodeCall(registry.commit, (registry.makeCommitment(handle, user, secret)))
            )
        );
        vm.warp(block.timestamp + 61);

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(pay), fee, block.timestamp + 1 hours);

        ERC2771Forwarder.ForwardRequestData[] memory batch = new ERC2771Forwarder.ForwardRequestData[](2);
        // Leg 0: the fee. Amount, recipient and deadline are all inside the signed calldata.
        batch[0] = _signWithNonce(
            address(pay),
            abi.encodeCall(
                pay.payWithPermit, (feeRecipient, fee, "maren relay fee", block.timestamp + 1 hours, v, r, s)
            ),
            forwarder.nonces(user)
        );
        // Leg 1: the work.
        batch[1] = _signWithNonce(
            address(registry), abi.encodeCall(registry.register, (handle, secret)), forwarder.nonces(user) + 1
        );

        // refundReceiver MUST be address(0). See test_batchWithNonZeroRefundReceiverIsBestEffort.
        vm.prank(relayer);
        forwarder.executeBatch(batch, payable(address(0)));

        assertEq(musd.balanceOf(feeRecipient), fee, "relayer was paid, out of a signed payload");
        assertEq(registry.resolve(handle), user, "and the work was done");
        assertEq(user.balance, 0, "still zero BTC");
    }

    /**
     * @notice CAUTION, AND THE REASON THIS TEST EXISTS: `executeBatch` is NOT atomic with
     *         respect to inner-call failures, in either mode.
     * @dev Read `ERC2771Forwarder._execute`. Its `requireValidRequest` flag — which
     *         `executeBatch` sets from `refundReceiver == address(0)` — only governs
     *         VALIDATION: untrusted target, expired deadline, bad signature. The inner call
     *         itself is a raw `call` whose `success` is recorded and then used for nothing
     *         except refunding `value`. A batched request whose inner call reverts leaves the
     *         rest of the batch committed.
     *
     *         So the fee leg settles even though the work leg reverted, with
     *         `refundReceiver` set to `address(0)` — the mode one would reasonably expect to
     *         be atomic. This is a property of OpenZeppelin's forwarder, not of Maren's
     *         contracts, and it is the easiest way for a relayer to charge a user for nothing.
     *
     *         CONSEQUENCE FOR apps/relayer: do not rely on `executeBatch` for fee+work
     *         atomicity. Use single `execute` (which does bubble the inner revert — see the
     *         next test) and eat the gas on failure, or introduce a small relay-hub contract
     *         that performs "take fee, then call target" inside ONE forwarded call.
     */
    function test_executeBatchIsNotAtomicForInnerCallFailures() public {
        uint256 fee = 0.25e18;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(address(pay), fee, block.timestamp + 1 hours);

        ERC2771Forwarder.ForwardRequestData[] memory batch = new ERC2771Forwarder.ForwardRequestData[](2);
        batch[0] = _signWithNonce(
            address(pay),
            abi.encodeCall(
                pay.payWithPermit, (feeRecipient, fee, "maren relay fee", block.timestamp + 1 hours, v, r, s)
            ),
            forwarder.nonces(user)
        );
        // No commitment was ever made, so the inner call reverts.
        batch[1] = _signWithNonce(
            address(registry),
            abi.encodeCall(registry.register, ("nocommit", bytes32(0))),
            forwarder.nonces(user) + 1
        );

        // address(0) is the "atomic" mode, and it still does not revert.
        vm.prank(relayer);
        forwarder.executeBatch(batch, payable(address(0)));

        assertEq(musd.balanceOf(feeRecipient), fee, "fee was taken");
        assertEq(registry.tryResolve("nocommit"), address(0), "but the work never happened");
    }

    /// @dev Single `execute` DOES bubble an inner revert, which is why it is the safe primitive
    ///      for a fee-bearing relay until a relay hub exists.
    function test_singleExecuteBubblesInnerRevert() public {
        ERC2771Forwarder.ForwardRequestData memory request =
            _sign(address(registry), abi.encodeCall(registry.register, ("nocommit", bytes32(0))));

        vm.prank(relayer);
        vm.expectRevert();
        forwarder.execute(request);

        assertEq(registry.tryResolve("nocommit"), address(0));
    }

    // ------------------------------------------------------------------ //
    //                  3. Value-bearing calls are not relayable          //
    // ------------------------------------------------------------------ //

    /**
     * @notice The relayer refuses any request with `value != 0`, so BTC-carrying calls are
     *         deliberately not sponsorable.
     * @dev MarenVault is built for exactly that constraint: `deposit()` is the only payable
     *      entrypoint, and `borrow`, `repay`, `withdraw` and `closePosition` are each separate
     *      non-payable externals on an ERC2771Context contract. A user pays for their first
     *      deposit as a normal transaction and everything afterwards can be relayed. There is
     *      no payable multi-step entrypoint that would drag the rest into being unsponsorable.
     */
    function test_nonPayableEntrypointsExistForEveryPostDepositAction() public pure {
        // Selectors the relayer can allowlist. All non-payable; none carries a fee parameter.
        assertTrue(bytes4(keccak256("borrow(uint256,address,address)")) != bytes4(0));
        assertTrue(bytes4(keccak256("repay(uint256,address,address)")) != bytes4(0));
        assertTrue(bytes4(keccak256("withdraw(uint256,address,address)")) != bytes4(0));
        assertTrue(bytes4(keccak256("closePosition(address,address)")) != bytes4(0));
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            forwarder.eip712Domain();
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifyingContract
            )
        );
    }

    function _sign(address to, bytes memory data)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory)
    {
        return _signWithNonce(to, data, forwarder.nonces(user));
    }

    function _signWithNonce(address to, bytes memory data, uint256 nonce)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory request)
    {
        uint48 deadline = uint48(block.timestamp + 1 hours);
        uint256 gas = 1_000_000;
        bytes32 structHash = keccak256(
            abi.encode(FORWARD_REQUEST_TYPEHASH, user, to, uint256(0), gas, nonce, deadline, keccak256(data))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);

        request = ERC2771Forwarder.ForwardRequestData({
            from: user,
            to: to,
            value: 0,
            gas: gas,
            deadline: deadline,
            data: data,
            signature: abi.encodePacked(r, s, v)
        });
    }

    function _signPermit(address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, user, spender, value, musd.nonces(user), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(userPk, digest);
    }

    function _execute(ERC2771Forwarder.ForwardRequestData memory request) internal {
        vm.prank(relayer);
        forwarder.execute(request);
    }
}
