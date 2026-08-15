// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenPay} from "../src/MarenPay.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {MarenRelayHub} from "../src/MarenRelayHub.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {SenderProbe} from "./mocks/SenderProbe.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Test} from "forge-std/Test.sol";

/**
 * @notice Asserts each of MarenRelayHub's five required properties directly, rather than
 *         inferring any of them from a payment that happened to succeed.
 */
contract MarenRelayHubTest is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    MarenRelayHub internal hub;
    MarenRegistry internal registry;
    MarenPay internal pay;
    MockMUSD internal musd;
    SenderProbe internal probe;

    address internal user;
    uint256 internal userPk;
    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");
    address internal feeRecipient = makeAddr("relayerFeeRecipient");
    address internal merchant = makeAddr("merchant");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant FEE = 0.25e18;

    function setUp() public {
        (user, userPk) = makeAddrAndKey("hubUser");

        hub = new MarenRelayHub(admin);
        registry = new MarenRegistry(address(hub));
        musd = new MockMUSD();
        pay = new MarenPay(address(musd), address(registry), address(0), address(hub));
        probe = new SenderProbe(address(hub));

        vm.startPrank(admin);
        hub.setAllowedCall(address(pay), MarenPay.pay.selector, true);
        hub.setAllowedCall(address(pay), MarenPay.payWithPermit.selector, true);
        hub.setAllowedCall(address(registry), MarenRegistry.commit.selector, true);
        hub.setAllowedCall(address(registry), MarenRegistry.register.selector, true);
        hub.setAllowedCall(address(probe), SenderProbe.record.selector, true);
        vm.stopPrank();

        vm.warp(1_800_000_000);
        vm.deal(relayer, 10 ether);
        vm.deal(user, 0); // the user holds no BTC at any point in this file
        musd.mint(user, 1_000e18);
        vm.prank(user);
        musd.approve(address(hub), type(uint256).max);
        vm.prank(user);
        musd.approve(address(pay), type(uint256).max);
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    function _build(address target, bytes memory data, uint256 feeAmount, address recipient)
        internal
        view
        returns (MarenRelayHub.RelayedCallData memory req)
    {
        req = MarenRelayHub.RelayedCallData({
            from: user,
            target: target,
            gas: 1_000_000,
            deadline: uint48(block.timestamp + 1 hours),
            data: data,
            feeToken: address(musd),
            feeAmount: feeAmount,
            feeRecipient: recipient,
            signature: ""
        });
        req.signature = _sign(req);
    }

    function _sign(MarenRelayHub.RelayedCallData memory req) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        hub.RELAYED_CALL_TYPEHASH(),
                        req.from,
                        req.target,
                        req.gas,
                        hub.nonces(req.from),
                        req.deadline,
                        keccak256(req.data),
                        req.feeToken,
                        req.feeAmount,
                        req.feeRecipient
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            hub.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }

    function _payCall(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeCall(MarenPay.pay, (merchant, amount, "invoice"));
    }

    // ------------------------------------------------------------------ //
    //     Property 4 — the end user survives to the target (asserted)    //
    // ------------------------------------------------------------------ //

    /**
     * @notice `_msgSender()` inside the target is the END USER, not the hub and not the relayer.
     * @dev Asserted directly against a probe that records exactly what it saw, rather than
     *      inferred from a payment that moved the right balances. A payment could move the
     *      right balances for the wrong reason; this cannot. If the ERC-2771 suffix were
     *      dropped, `recordedSender` would come back as the hub's address and this fails.
     */
    function test_property4_msgSenderInsideTargetIsTheEndUser() public {
        MarenRelayHub.RelayedCallData memory req =
            _build(address(probe), abi.encodeCall(SenderProbe.record, ()), FEE, feeRecipient);

        vm.prank(relayer);
        hub.executeWithFee(req);

        assertEq(probe.recordedSender(), user, "_msgSender() must be the end user");
        assertTrue(probe.recordedSender() != address(hub), "must not be the hub");
        assertTrue(probe.recordedSender() != relayer, "must not be the relayer");
        assertEq(probe.recordedRawCaller(), address(hub), "raw msg.sender is the hub, as expected");
    }

    /// @dev And the same through the fee-free inherited path.
    function test_property4_holdsOnTheFeeFreePathToo() public {
        ERC2771Forwarder.ForwardRequestData memory request =
            _forwardRequest(address(probe), abi.encodeCall(SenderProbe.record, ()));
        vm.prank(relayer);
        hub.execute(request);
        assertEq(probe.recordedSender(), user);
    }

    /**
     * @notice A target that does not trust the hub is refused outright.
     * @dev Otherwise the target would read the hub as `msg.sender` and treat the appended user
     *      address as trailing garbage — a confused deputy with the hub's authority behind it.
     */
    function test_property4_targetThatDoesNotTrustTheHubIsRefused() public {
        SenderProbe untrusting = new SenderProbe(address(0xdead));
        vm.prank(admin);
        hub.setAllowedCall(address(untrusting), SenderProbe.record.selector, true);

        MarenRelayHub.RelayedCallData memory req =
            _build(address(untrusting), abi.encodeCall(SenderProbe.record, ()), 0, feeRecipient);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(MarenRelayHub.TargetDoesNotTrustHub.selector, address(untrusting))
        );
        hub.executeWithFee(req);
    }

    // ------------------------------------------------------------------ //
    //                        Property 1 — atomicity                      //
    // ------------------------------------------------------------------ //

    /// @notice Fee and work settle together.
    function test_property1_feeAndWorkSettleTogether() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);

        vm.prank(relayer);
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(merchant), 10e18, "work happened");
        assertEq(musd.balanceOf(feeRecipient), FEE, "fee settled");
        assertEq(musd.balanceOf(address(hub)), 0, "the hub never holds anything");
        assertEq(user.balance, 0, "user still holds zero BTC");
    }

    /**
     * @notice A reverting inner call reverts the fee. THIS is the property `executeBatch`
     *         could not provide and the reason this contract exists.
     */
    function test_property1_revertingWorkRevertsTheFee() public {
        // `pay` to the zero address reverts inside MarenPay.
        MarenRelayHub.RelayedCallData memory req =
            _build(address(pay), abi.encodeCall(MarenPay.pay, (address(0), 10e18, "bad")), FEE, feeRecipient);

        uint256 balanceBefore = musd.balanceOf(user);

        vm.prank(relayer);
        vm.expectRevert(MarenPay.ZeroAddress.selector);
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(feeRecipient), 0, "no fee for work that reverted");
        assertEq(musd.balanceOf(user), balanceBefore, "user is untouched");
        assertEq(hub.nonces(user), 0, "the nonce is rolled back with everything else");
    }

    /// @dev The inner revert reason reaches the relayer intact, so it can tell a real failure
    ///      (bad input) from a chain condition (a stale Mezo oracle) and decide whether to retry.
    function test_property1_innerRevertReasonIsBubbled() public {
        MarenRelayHub.RelayedCallData memory req =
            _build(address(pay), abi.encodeCall(MarenPay.pay, (merchant, 0, "zero")), FEE, feeRecipient);

        vm.prank(relayer);
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        hub.executeWithFee(req);
    }

    /// @notice `executeBatch` is unreachable through Maren's forwarder.
    function test_property1_executeBatchIsDisabled() public {
        ERC2771Forwarder.ForwardRequestData[] memory batch = new ERC2771Forwarder.ForwardRequestData[](1);
        batch[0] = _forwardRequest(address(probe), abi.encodeCall(SenderProbe.record, ()));

        vm.prank(relayer);
        vm.expectRevert(MarenRelayHub.BatchExecutionDisabled.selector);
        hub.executeBatch(batch, payable(address(0)));
    }

    // ------------------------------------------------------------------ //
    //             Property 2 — the fee is inside the signature           //
    // ------------------------------------------------------------------ //

    /**
     * @notice A relayer cannot raise the fee after the user has signed.
     * @dev The failure this prevents: a relayer quotes 0.25 MUSD, the user signs, the relayer
     *      submits 500 MUSD. Because `feeAmount` is in the EIP-712 digest, editing it makes
     *      recovery return a different address and the call reverts.
     */
    function test_property2_relayerCannotRaiseTheFee() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        req.feeAmount = 500e18; // tampered after signing

        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(feeRecipient), 0);
    }

    /// @notice Nor redirect it to itself.
    function test_property2_relayerCannotRedirectTheFee() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        req.feeRecipient = attacker;

        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(attacker), 0);
    }

    /// @notice Nor swap the fee token for something else the user holds.
    function test_property2_relayerCannotSwapTheFeeToken() public {
        MockMUSD other = new MockMUSD();
        other.mint(user, 1_000e18);
        vm.prank(user);
        other.approve(address(hub), type(uint256).max);

        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        req.feeToken = address(other);

        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req);

        assertEq(other.balanceOf(feeRecipient), 0);
    }

    /// @notice Nor alter the work itself.
    function test_property2_relayerCannotAlterTheCalldata() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        req.data = abi.encodeCall(MarenPay.pay, (attacker, 900e18, "stolen"));

        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(attacker), 0);
    }

    function test_property2_signedRequestCannotBeReplayed() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);

        vm.prank(relayer);
        hub.executeWithFee(req);
        assertEq(hub.nonces(user), 1);

        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(feeRecipient), FEE, "charged exactly once");
    }

    /// @dev The nonce counter is shared with the inherited `execute`, so a request signed for
    ///      one entrypoint cannot be replayed through the other.
    function test_property2_nonceIsSharedAcrossBothEntrypoints() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        vm.prank(relayer);
        hub.executeWithFee(req);

        ERC2771Forwarder.ForwardRequestData memory request =
            _forwardRequest(address(probe), abi.encodeCall(SenderProbe.record, ()));
        vm.prank(relayer);
        hub.execute(request);

        assertEq(hub.nonces(user), 2, "one counter, both paths");
    }

    function test_property2_expiredRequestIsRefused() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        vm.warp(block.timestamp + 2 hours);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MarenRelayHub.RelayExpired.selector, req.deadline));
        hub.executeWithFee(req);
    }

    /// @notice A first-time user with no allowance pays in one signed action.
    function test_property2_feeWorksWithPermitForAFirstTimeUser() public {
        (address fresh, uint256 freshPk) = makeAddrAndKey("freshUser");
        musd.mint(fresh, 100e18);
        vm.deal(fresh, 0);

        // No approval to the hub at all.
        assertEq(musd.allowance(fresh, address(hub)), 0);

        uint256 permitDeadline = block.timestamp + 1 hours;
        bytes32 permitDigest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                musd.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(PERMIT_TYPEHASH, fresh, address(hub), FEE, musd.nonces(fresh), permitDeadline)
                )
            )
        );
        (uint8 pv, bytes32 pr, bytes32 ps) = vm.sign(freshPk, permitDigest);

        MarenRelayHub.RelayedCallData memory req = MarenRelayHub.RelayedCallData({
            from: fresh,
            target: address(probe),
            gas: 1_000_000,
            deadline: uint48(block.timestamp + 1 hours),
            data: abi.encodeCall(SenderProbe.record, ()),
            feeToken: address(musd),
            feeAmount: FEE,
            feeRecipient: feeRecipient,
            signature: ""
        });
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        hub.RELAYED_CALL_TYPEHASH(),
                        req.from,
                        req.target,
                        req.gas,
                        hub.nonces(req.from),
                        req.deadline,
                        keccak256(req.data),
                        req.feeToken,
                        req.feeAmount,
                        req.feeRecipient
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(freshPk, digest);
        req.signature = abi.encodePacked(r, s, v);

        vm.prank(relayer);
        hub.executeWithFeeAndPermit(req, permitDeadline, pv, pr, ps);

        assertEq(musd.balanceOf(feeRecipient), FEE, "fee paid with no prior transaction");
        assertEq(probe.recordedSender(), fresh);
        assertEq(fresh.balance, 0, "and no BTC was ever needed");
    }

    /// @notice The digest helper the SDK and relayer are told to use agrees with a signature
    ///         built independently, so nobody has to transcribe the type string.
    function test_property2_relayedCallDigestMatchesAnIndependentBuild() public view {
        MarenRelayHub.RelayedCallData memory req = MarenRelayHub.RelayedCallData({
            from: user,
            target: address(pay),
            gas: 1_000_000,
            deadline: uint48(block.timestamp + 1 hours),
            data: _payCall(10e18),
            feeToken: address(musd),
            feeAmount: FEE,
            feeRecipient: feeRecipient,
            signature: ""
        });

        bytes32 expected = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(
                    abi.encode(
                        keccak256(
                            "RelayedCall(address from,address target,uint256 gas,uint256 nonce,uint48 deadline,bytes data,address feeToken,uint256 feeAmount,address feeRecipient)"
                        ),
                        req.from,
                        req.target,
                        req.gas,
                        uint256(0),
                        req.deadline,
                        keccak256(req.data),
                        req.feeToken,
                        req.feeAmount,
                        req.feeRecipient
                    )
                )
            )
        );
        assertEq(hub.relayedCallDigest(req), expected);
    }

    // ------------------------------------------------------------------ //
    //           Property 3 — exactly one trusted forwarder               //
    // ------------------------------------------------------------------ //

    /// @notice The hub IS the forwarder the Maren contracts trust — there is no second path.
    function test_property3_hubIsTheSingleTrustedForwarder() public view {
        assertTrue(pay.isTrustedForwarder(address(hub)));
        assertTrue(registry.isTrustedForwarder(address(hub)));
        assertEq(hub.DOMAIN_NAME(), "Maren Forwarder");
        assertEq(hub.DOMAIN_VERSION(), "1");
    }

    // ------------------------------------------------------------------ //
    //            Property 5 — target and selector allowlisting           //
    // ------------------------------------------------------------------ //

    /// @notice The hub is not a laundering path to an arbitrary contract.
    function test_property5_unallowlistedTargetIsRefused() public {
        MockMUSD rogue = new MockMUSD();
        MarenRelayHub.RelayedCallData memory req =
            _build(address(rogue), abi.encodeCall(MockMUSD.mint, (attacker, 1_000_000e18)), 0, feeRecipient);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRelayHub.CallNotAllowed.selector, address(rogue), MockMUSD.mint.selector
            )
        );
        hub.executeWithFee(req);
    }

    /// @notice Allowlisting is per selector, not per contract, so a newly added function on an
    ///         already-trusted contract is not automatically relayable.
    function test_property5_unallowlistedSelectorOnAnAllowedTargetIsRefused() public {
        MarenRelayHub.RelayedCallData memory req =
            _build(address(pay), abi.encodeCall(MarenPay.cancelRequest, (1)), 0, feeRecipient);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRelayHub.CallNotAllowed.selector, address(pay), MarenPay.cancelRequest.selector
            )
        );
        hub.executeWithFee(req);
    }

    /// @notice The allowlist also binds the inherited fee-free path. Without this the hub would
    ///         be an open relay to any contract on Mezo, routing around the relayer's control.
    function test_property5_allowlistBindsTheFeeFreePathToo() public {
        MockMUSD rogue = new MockMUSD();
        ERC2771Forwarder.ForwardRequestData memory request =
            _forwardRequest(address(rogue), abi.encodeCall(MockMUSD.mint, (attacker, 1e18)));

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MarenRelayHub.CallNotAllowed.selector, address(rogue), MockMUSD.mint.selector
            )
        );
        hub.execute(request);
    }

    function test_property5_revokingAnEntryStopsFurtherRelays() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        vm.prank(relayer);
        hub.executeWithFee(req);

        vm.prank(admin);
        hub.setAllowedCall(address(pay), MarenPay.pay.selector, false);

        MarenRelayHub.RelayedCallData memory req2 = _build(address(pay), _payCall(10e18), FEE, feeRecipient);
        vm.prank(relayer);
        vm.expectRevert();
        hub.executeWithFee(req2);
    }

    function testRevert_setAllowedCall_withoutRole() public {
        bytes32 role = hub.RELAY_ADMIN_ROLE();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role)
        );
        hub.setAllowedCall(address(pay), MarenPay.pay.selector, true);
    }

    function test_setAllowedCalls_batchesSelectors() public {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = MarenPay.split.selector;
        selectors[1] = MarenPay.createLink.selector;

        vm.prank(admin);
        hub.setAllowedCalls(address(pay), selectors, true);

        assertTrue(hub.allowedCall(address(pay), MarenPay.split.selector));
        assertTrue(hub.allowedCall(address(pay), MarenPay.createLink.selector));
    }

    // ------------------------------------------------------------------ //
    //                        Value is never relayed                      //
    // ------------------------------------------------------------------ //

    /// @dev Sponsoring a BTC-bearing call would mean the relayer funding a user's deposit.
    function test_valueBearingRequestsAreRejected() public {
        ERC2771Forwarder.ForwardRequestData memory request =
            _forwardRequest(address(probe), abi.encodeCall(SenderProbe.record, ()));
        request.value = 1 ether;

        vm.deal(relayer, 2 ether);
        vm.prank(relayer);
        vm.expectRevert(MarenRelayHub.ValueNotRelayable.selector);
        hub.execute{value: 1 ether}(request);
    }

    function testRevert_calldataTooShortToHaveASelector() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), hex"1234", 0, feeRecipient);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MarenRelayHub.CalldataTooShort.selector, 2));
        hub.executeWithFee(req);
    }

    /// @notice A zero fee is legal — that is Maren's sponsored-onboarding allowance.
    function test_zeroFeeIsAllowed() public {
        MarenRelayHub.RelayedCallData memory req = _build(address(pay), _payCall(10e18), 0, feeRecipient);

        vm.prank(relayer);
        hub.executeWithFee(req);

        assertEq(musd.balanceOf(merchant), 10e18);
        assertEq(musd.balanceOf(feeRecipient), 0);
    }

    // ------------------------------------------------------------------ //
    //                        Forward-request helper                      //
    // ------------------------------------------------------------------ //

    function _forwardRequest(address to, bytes memory data)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory request)
    {
        uint48 deadline = uint48(block.timestamp + 1 hours);
        uint256 gas = 1_000_000;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
                ),
                user,
                to,
                uint256(0),
                gas,
                hub.nonces(user),
                deadline,
                keccak256(data)
            )
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
}
