// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MarenPay} from "../src/MarenPay.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {IPermit2} from "../src/interfaces/IPermit2.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Unit tests for MarenPay: direct payments, handle payments, permit / Permit2 flows,
///         payment requests, escrowed claimable links, and splits.
contract MarenPayTest is Test {
    MockMUSD internal musd;
    MockPermit2 internal permit2;
    MarenForwarder internal forwarder;
    MarenRegistry internal registry;
    MarenPay internal pay;

    address internal alice;
    uint256 internal alicePk;
    address internal bob;
    uint256 internal bobPk;
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant ONE = 1e18;

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Paid(
        address indexed from, address indexed to, uint256 amount, bytes32 indexed memoHash, string memo
    );
    event PaidToHandle(
        bytes32 indexed node, address indexed from, address indexed to, uint256 amount, string handle
    );
    event RequestCreated(
        uint256 indexed requestId,
        address indexed requester,
        address indexed payer,
        uint256 amount,
        string memo
    );
    event RequestFulfilled(
        uint256 indexed requestId, address indexed payer, address indexed requester, uint256 amount
    );
    event RequestCancelled(uint256 indexed requestId, address indexed requester);
    event LinkCreated(
        uint256 indexed linkId,
        address indexed creator,
        address indexed linkKey,
        uint256 amount,
        uint64 expiry
    );
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 amount);
    event LinkReclaimed(uint256 indexed linkId, address indexed creator, uint256 amount);
    event SplitExecuted(
        address indexed from, uint256 total, uint256 recipientCount, bytes32 indexed memoHash
    );

    function setUp() public {
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk) = makeAddrAndKey("bob");

        musd = new MockMUSD();
        permit2 = new MockPermit2();
        forwarder = new MarenForwarder();
        registry = new MarenRegistry(address(forwarder));
        pay = new MarenPay(address(musd), address(registry), address(permit2), address(forwarder));

        vm.warp(1_800_000_000);

        musd.mint(alice, 1_000 * ONE);
        musd.mint(bob, 1_000 * ONE);
        musd.mint(carol, 1_000 * ONE);

        vm.prank(alice);
        musd.approve(address(pay), type(uint256).max);
        vm.prank(bob);
        musd.approve(address(pay), type(uint256).max);
        vm.prank(carol);
        musd.approve(address(pay), type(uint256).max);
    }

    // ------------------------------------------------------------------ //
    //                              Helpers                               //
    // ------------------------------------------------------------------ //

    function _registerHandle(address owner, string memory handle, bytes32 secret) internal {
        vm.prank(owner);
        registry.commit(keccak256(abi.encode(handle, owner, secret)));
        vm.warp(block.timestamp + registry.MIN_COMMITMENT_AGE());
        vm.prank(owner);
        registry.register(handle, secret);
    }

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, spender, value, musd.nonces(owner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ //
    //                            Construction                            //
    // ------------------------------------------------------------------ //

    function test_Constructor_WiresImmutables() public view {
        assertEq(address(pay.musd()), address(musd));
        assertEq(address(pay.registry()), address(registry));
        assertEq(address(pay.permit2()), address(permit2));
        assertTrue(pay.isTrustedForwarder(address(forwarder)));
        assertEq(pay.MAX_SPLIT_RECIPIENTS(), 64);
        assertEq(pay.nextRequestId(), 1);
        assertEq(pay.nextLinkId(), 1);
        assertEq(pay.totalEscrowed(), 0);
    }

    function testRevert_Constructor_ZeroMusd() public {
        vm.expectRevert(MarenPay.ZeroAddress.selector);
        new MarenPay(address(0), address(registry), address(permit2), address(forwarder));
    }

    function testRevert_Constructor_ZeroRegistry() public {
        vm.expectRevert(MarenPay.ZeroAddress.selector);
        new MarenPay(address(musd), address(0), address(permit2), address(forwarder));
    }

    // ------------------------------------------------------------------ //
    //                           Direct payment                           //
    // ------------------------------------------------------------------ //

    /// @dev NON-CUSTODY: `pay` must be a single payer -> recipient transferFrom. If MarenPay's
    ///      own balance ever moved here it would mean user funds transit the contract.
    function test_Pay_MovesFundsDirectlyAndEmits() public {
        uint256 amount = 25 * ONE;
        string memory memo = "coffee";

        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, bob, amount, keccak256(bytes(memo)), memo);

        vm.prank(alice);
        pay.pay(bob, amount, memo);

        assertEq(musd.balanceOf(alice), 975 * ONE);
        assertEq(musd.balanceOf(bob), 1_025 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0, "MarenPay never holds the funds");
    }

    function test_Pay_EmptyMemoHashesToEmptyStringHash() public {
        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, bob, ONE, keccak256(bytes("")), "");
        vm.prank(alice);
        pay.pay(bob, ONE, "");
    }

    function testRevert_Pay_ZeroAddress() public {
        vm.expectRevert(MarenPay.ZeroAddress.selector);
        vm.prank(alice);
        pay.pay(address(0), ONE, "x");
    }

    function testRevert_Pay_ZeroAmount() public {
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.pay(bob, 0, "x");
    }

    function testRevert_Pay_SelfPayment() public {
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.pay(alice, ONE, "x");
    }

    // ------------------------------------------------------------------ //
    //                            payToHandle                             //
    // ------------------------------------------------------------------ //

    function test_PayToHandle_ResolvesAndPays() public {
        _registerHandle(bob, "bobby", keccak256("s"));
        uint256 amount = 10 * ONE;
        string memory memo = "rent";
        bytes32 node = registry.namehash("bobby");

        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, bob, amount, keccak256(bytes(memo)), memo);
        vm.expectEmit(true, true, true, true, address(pay));
        emit PaidToHandle(node, alice, bob, amount, "bobby");

        vm.prank(alice);
        pay.payToHandle("bobby", amount, memo);

        assertEq(musd.balanceOf(bob), 1_010 * ONE);
        assertEq(musd.balanceOf(alice), 990 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0);
    }

    /// @dev A payment to an unknown handle must fail loudly rather than silently resolve to
    ///      address(0) and burn the funds.
    function testRevert_PayToHandle_UnregisteredHandle() public {
        vm.expectRevert(abi.encodeWithSelector(MarenRegistry.HandleNotRegistered.selector, "ghost"));
        vm.prank(alice);
        pay.payToHandle("ghost", ONE, "x");
    }

    function testRevert_PayToHandle_SelfPayment() public {
        _registerHandle(alice, "selfy", keccak256("s"));
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.payToHandle("selfy", ONE, "x");
    }

    // ------------------------------------------------------------------ //
    //                            payWithPermit                           //
    // ------------------------------------------------------------------ //

    /// @dev The whole point of permit: a brand new user with zero allowance pays in ONE tx.
    function test_PayWithPermit_ZeroPriorApprovalPaysInOneTransaction() public {
        (address newUser, uint256 newUserPk) = makeAddrAndKey("newUser");
        musd.mint(newUser, 100 * ONE);
        assertEq(musd.allowance(newUser, address(pay)), 0, "precondition: no allowance");

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(newUserPk, newUser, address(pay), 40 * ONE, deadline);

        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(newUser, bob, 40 * ONE, keccak256(bytes("hi")), "hi");

        vm.prank(newUser);
        pay.payWithPermit(bob, 40 * ONE, "hi", deadline, v, r, s);

        assertEq(musd.balanceOf(newUser), 60 * ONE);
        assertEq(musd.balanceOf(bob), 1_040 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0);
        assertEq(musd.allowance(newUser, address(pay)), 0, "permit allowance fully spent");
    }

    /**
     * @dev SECURITY PROPERTY: permit signatures sit in the public mempool and anyone can
     *      submit them to MUSD directly, consuming the nonce. If MarenPay let that revert the
     *      payment, a griefer could brick every sponsored payment for the price of gas. The
     *      allowance is already in place, so the payment must still go through.
     */
    function test_Security_PayWithPermit_SurvivesPermitFrontRun() public {
        (address newUser, uint256 newUserPk) = makeAddrAndKey("newUser2");
        musd.mint(newUser, 100 * ONE);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(newUserPk, newUser, address(pay), 40 * ONE, deadline);

        // The griefer front-runs, submitting the permit straight to MUSD. Nonce consumed.
        vm.prank(attacker);
        musd.permit(newUser, address(pay), 40 * ONE, deadline, v, r, s);
        assertEq(musd.allowance(newUser, address(pay)), 40 * ONE);

        // The now-useless signature still reaches MarenPay; the payment must not be bricked.
        vm.prank(newUser);
        pay.payWithPermit(bob, 40 * ONE, "hi", deadline, v, r, s);

        assertEq(musd.balanceOf(newUser), 60 * ONE);
        assertEq(musd.balanceOf(bob), 1_040 * ONE);
    }

    /// @dev The swallowed permit failure must NOT become a way to pay without authorisation:
    ///      with no allowance the transferFrom underneath still has to revert.
    function testRevert_PayWithPermit_GarbagePermitWithNoAllowance() public {
        (address newUser,) = makeAddrAndKey("newUser3");
        musd.mint(newUser, 100 * ONE);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(pay), 0, 40 * ONE
            )
        );
        vm.prank(newUser);
        pay.payWithPermit(
            bob, 40 * ONE, "hi", block.timestamp + 1 hours, 27, bytes32(uint256(1)), bytes32(uint256(2))
        );
    }

    function testRevert_PayWithPermit_SelfPayment() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(alicePk, alice, address(pay), ONE, deadline);
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.payWithPermit(alice, ONE, "x", deadline, v, r, s);
    }

    // ------------------------------------------------------------------ //
    //                           payWithPermit2                           //
    // ------------------------------------------------------------------ //

    function test_PayWithPermit2_MovesFundsOwnerToRecipient() public {
        // A Permit2 user has approved Permit2 on the token once, ever.
        vm.prank(alice);
        musd.approve(address(permit2), type(uint256).max);

        IPermit2.PermitTransferFrom memory p = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(musd), amount: 50 * ONE}),
            nonce: 7,
            deadline: block.timestamp + 1 hours
        });

        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, bob, 30 * ONE, keccak256(bytes("x402")), "x402");

        vm.prank(alice);
        pay.payWithPermit2(bob, 30 * ONE, "x402", p, hex"c0ffee");

        (
            address token,
            uint256 permittedAmount,
            uint256 nonce,
            uint256 deadline,
            address to,
            uint256 requestedAmount,
            address owner,
            bytes memory signature,
            address caller
        ) = permit2.lastCall();

        assertEq(permit2.callCount(), 1);
        assertEq(token, address(musd));
        assertEq(permittedAmount, 50 * ONE);
        assertEq(nonce, 7);
        assertEq(deadline, p.deadline);
        assertEq(to, bob, "MarenPay must name the recipient, not itself");
        assertEq(requestedAmount, 30 * ONE);
        assertEq(owner, alice);
        assertEq(signature, hex"c0ffee");
        assertEq(caller, address(pay));

        assertEq(musd.balanceOf(bob), 1_030 * ONE);
        assertEq(musd.balanceOf(alice), 970 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0, "MarenPay never held the funds");
    }

    function testRevert_PayWithPermit2_NotConfigured() public {
        MarenPay noPermit2 = new MarenPay(address(musd), address(registry), address(0), address(forwarder));

        IPermit2.PermitTransferFrom memory p = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(musd), amount: ONE}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        vm.expectRevert(MarenPay.Permit2NotConfigured.selector);
        vm.prank(alice);
        noPermit2.payWithPermit2(bob, ONE, "x", p, hex"00");
    }

    /// @dev A Permit2 signature for some OTHER token would move that token. MarenPay must
    ///      refuse rather than become a generic token mover keyed off attacker-supplied data.
    function testRevert_PayWithPermit2_WrongToken() public {
        MockMUSD other = new MockMUSD();
        IPermit2.PermitTransferFrom memory p = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(other), amount: ONE}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        vm.expectRevert(
            abi.encodeWithSelector(MarenPay.InvalidPermitToken.selector, address(other), address(musd))
        );
        vm.prank(alice);
        pay.payWithPermit2(bob, ONE, "x", p, hex"00");
        assertEq(permit2.callCount(), 0, "Permit2 must never be reached");
    }

    function testRevert_PayWithPermit2_SelfPayment() public {
        IPermit2.PermitTransferFrom memory p = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(musd), amount: ONE}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.payWithPermit2(alice, ONE, "x", p, hex"00");
    }

    function testRevert_PayWithPermit2_ZeroAmount() public {
        IPermit2.PermitTransferFrom memory p = IPermit2.PermitTransferFrom({
            permitted: IPermit2.TokenPermissions({token: address(musd), amount: ONE}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.payWithPermit2(bob, 0, "x", p, hex"00");
    }

    // ------------------------------------------------------------------ //
    //                          Payment requests                          //
    // ------------------------------------------------------------------ //

    function test_Request_CreateAndFulfill() public {
        vm.expectEmit(true, true, true, true, address(pay));
        emit RequestCreated(1, alice, bob, 15 * ONE, "invoice");
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 15 * ONE, "invoice");
        assertEq(id, 1);
        assertEq(pay.nextRequestId(), 2);

        (address requester, address payer, uint256 amount, uint64 createdAt, MarenPay.RequestStatus status) =
            pay.requests(id);
        assertEq(requester, alice);
        assertEq(payer, bob);
        assertEq(amount, 15 * ONE);
        assertEq(createdAt, uint64(block.timestamp));
        assertTrue(status == MarenPay.RequestStatus.Open);

        vm.expectEmit(true, true, true, true, address(pay));
        emit RequestFulfilled(id, bob, alice, 15 * ONE);
        vm.prank(bob);
        pay.fulfillRequest(id);

        (,,,, MarenPay.RequestStatus after_) = pay.requests(id);
        assertTrue(after_ == MarenPay.RequestStatus.Fulfilled);
        assertEq(musd.balanceOf(alice), 1_015 * ONE);
        assertEq(musd.balanceOf(bob), 985 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0, "requests never escrow");
    }

    function test_Request_AnyoneMayPayWhenPayerIsZero() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(address(0), 5 * ONE, "tip jar");

        vm.prank(carol);
        pay.fulfillRequest(id);

        assertEq(musd.balanceOf(alice), 1_005 * ONE);
        assertEq(musd.balanceOf(carol), 995 * ONE);
    }

    function test_Request_FulfillWithPermit() public {
        (address newUser, uint256 newUserPk) = makeAddrAndKey("requestPayer");
        musd.mint(newUser, 100 * ONE);

        vm.prank(alice);
        uint256 id = pay.createRequest(newUser, 20 * ONE, "invoice");

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(newUserPk, newUser, address(pay), 20 * ONE, deadline);

        vm.prank(newUser);
        pay.fulfillRequestWithPermit(id, deadline, v, r, s);

        assertEq(musd.balanceOf(alice), 1_020 * ONE);
        assertEq(musd.balanceOf(newUser), 80 * ONE);
    }

    function testRevert_Request_DoubleFulfill() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 5 * ONE, "x");
        vm.prank(bob);
        pay.fulfillRequest(id);

        vm.expectRevert(
            abi.encodeWithSelector(MarenPay.RequestNotOpen.selector, id, MarenPay.RequestStatus.Fulfilled)
        );
        vm.prank(bob);
        pay.fulfillRequest(id);
    }

    function testRevert_Request_FulfillAfterCancel() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 5 * ONE, "x");

        vm.expectEmit(true, true, false, true, address(pay));
        emit RequestCancelled(id, alice);
        vm.prank(alice);
        pay.cancelRequest(id);

        vm.expectRevert(
            abi.encodeWithSelector(MarenPay.RequestNotOpen.selector, id, MarenPay.RequestStatus.Cancelled)
        );
        vm.prank(bob);
        pay.fulfillRequest(id);
    }

    function testRevert_Request_FulfillUnknownId() public {
        vm.expectRevert(
            abi.encodeWithSelector(MarenPay.RequestNotOpen.selector, 99, MarenPay.RequestStatus.None)
        );
        vm.prank(bob);
        pay.fulfillRequest(99);
    }

    function testRevert_Request_NotRequestPayer() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 5 * ONE, "x");

        vm.expectRevert(abi.encodeWithSelector(MarenPay.NotRequestPayer.selector, carol, bob));
        vm.prank(carol);
        pay.fulfillRequest(id);
    }

    function testRevert_Request_NotRequester() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 5 * ONE, "x");

        vm.expectRevert(abi.encodeWithSelector(MarenPay.NotRequester.selector, bob, alice));
        vm.prank(bob);
        pay.cancelRequest(id);
    }

    function testRevert_Request_DoubleCancel() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(bob, 5 * ONE, "x");
        vm.prank(alice);
        pay.cancelRequest(id);

        vm.expectRevert(
            abi.encodeWithSelector(MarenPay.RequestNotOpen.selector, id, MarenPay.RequestStatus.Cancelled)
        );
        vm.prank(alice);
        pay.cancelRequest(id);
    }

    function testRevert_Request_CreateSelfPayment() public {
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.createRequest(alice, ONE, "x");
    }

    function testRevert_Request_CreateZeroAmount() public {
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.createRequest(bob, 0, "x");
    }

    /// @dev An open-to-anyone request must not be self-fulfillable by its own requester.
    function testRevert_Request_RequesterFulfillsOwnOpenRequest() public {
        vm.prank(alice);
        uint256 id = pay.createRequest(address(0), 5 * ONE, "tip jar");

        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.fulfillRequest(id);
    }

    // ------------------------------------------------------------------ //
    //                          Claimable links                           //
    // ------------------------------------------------------------------ //

    function test_Link_CreateEscrowsAndTracksTotal() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);

        vm.expectEmit(true, true, true, true, address(pay));
        emit LinkCreated(1, alice, linkKey, 100 * ONE, expiry);
        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, address(pay), 100 * ONE, keccak256(bytes("gift")), "gift");

        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");

        assertEq(linkId, 1);
        assertEq(pay.nextLinkId(), 2);
        assertEq(pay.totalEscrowed(), 100 * ONE);
        assertEq(musd.balanceOf(address(pay)), 100 * ONE, "escrow held by the contract");
        assertEq(musd.balanceOf(alice), 900 * ONE);

        (address creator, address key, uint256 amount, uint64 exp, bool claimed, bool reclaimed) =
            pay.links(linkId);
        assertEq(creator, alice);
        assertEq(key, linkKey);
        assertEq(amount, 100 * ONE);
        assertEq(exp, expiry);
        assertFalse(claimed);
        assertFalse(reclaimed);
    }

    function testRevert_Link_CreateZeroKey() public {
        vm.expectRevert(MarenPay.ZeroAddress.selector);
        vm.prank(alice);
        pay.createLink(address(0), ONE, uint64(block.timestamp + 1 days), "x");
    }

    function testRevert_Link_CreateZeroAmount() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.createLink(linkKey, 0, uint64(block.timestamp + 1 days), "x");
    }

    function testRevert_Link_CreateExpiryInThePast() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        vm.expectRevert(abi.encodeWithSelector(MarenPay.InvalidExpiry.selector, uint64(block.timestamp)));
        vm.prank(alice);
        pay.createLink(linkKey, ONE, uint64(block.timestamp), "x");
    }

    function test_Link_ClaimPaysNamedRecipient() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");

        bytes memory sig = _sign(linkPk, pay.linkClaimDigest(linkId, carol));

        vm.expectEmit(true, true, false, true, address(pay));
        emit LinkClaimed(linkId, carol, 100 * ONE);
        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, carol, 100 * ONE, bytes32(0), "");

        // Anyone may submit the claim; a relayer usually does.
        vm.prank(dave);
        pay.claimLink(linkId, carol, sig);

        assertEq(musd.balanceOf(carol), 1_100 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0);
        assertEq(pay.totalEscrowed(), 0);
        (,,,, bool claimed,) = pay.links(linkId);
        assertTrue(claimed);
    }

    function testRevert_Link_ClaimTwice() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 10 * ONE, uint64(block.timestamp + 1 days), "x");

        bytes memory sig = _sign(linkPk, pay.linkClaimDigest(linkId, carol));
        vm.prank(carol);
        pay.claimLink(linkId, carol, sig);

        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkAlreadySettled.selector, linkId));
        vm.prank(carol);
        pay.claimLink(linkId, carol, sig);
    }

    function testRevert_Link_ClaimUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkAlreadySettled.selector, 42));
        pay.claimLink(42, carol, hex"00");
    }

    function testRevert_Link_ClaimZeroRecipient() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 10 * ONE, uint64(block.timestamp + 1 days), "x");
        bytes memory sig = _sign(linkPk, pay.linkClaimDigest(linkId, address(0)));

        vm.expectRevert(MarenPay.ZeroAddress.selector);
        pay.claimLink(linkId, address(0), sig);
    }

    function testRevert_Link_ClaimAfterExpiry() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 10 * ONE, expiry, "x");
        bytes memory sig = _sign(linkPk, pay.linkClaimDigest(linkId, carol));

        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkExpired.selector, linkId, expiry));
        vm.prank(carol);
        pay.claimLink(linkId, carol, sig);
    }

    function testRevert_Link_ClaimWithWrongKey() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        (, uint256 wrongPk) = makeAddrAndKey("wrongKey");
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 10 * ONE, uint64(block.timestamp + 1 days), "x");

        bytes memory sig = _sign(wrongPk, pay.linkClaimDigest(linkId, carol));
        vm.expectRevert(MarenPay.InvalidLinkSignature.selector);
        vm.prank(carol);
        pay.claimLink(linkId, carol, sig);
    }

    function testRevert_Link_ClaimSignatureForAnotherLinkId() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        vm.prank(alice);
        uint256 first = pay.createLink(linkKey, 10 * ONE, uint64(block.timestamp + 1 days), "x");
        vm.prank(alice);
        uint256 second = pay.createLink(linkKey, 10 * ONE, uint64(block.timestamp + 1 days), "y");

        bytes memory sigForFirst = _sign(linkPk, pay.linkClaimDigest(first, carol));
        vm.expectRevert(MarenPay.InvalidLinkSignature.selector);
        pay.claimLink(second, carol, sigForFirst);
    }

    /**
     * @dev SECURITY PROPERTY — the reason links use a one-time KEYPAIR and not a hashed secret.
     *
     *      A claim transaction is public before it is mined. If the authorisation were a bearer
     *      preimage, any searcher could copy it, outbid the gas and take the money. Here the
     *      signature commits to the recipient, so a copied signature is only ever valid for the
     *      recipient it already names.
     *
     *      If this test failed, every payment link on Maren would be a race that MEV bots win,
     *      and no recipient could ever reliably claim one.
     */
    function test_Security_LinkClaimSignatureCannotBeRedirected() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, uint64(block.timestamp + 1 days), "gift");

        // Carol builds and broadcasts her claim. The attacker copies the signature.
        bytes memory carolSig = _sign(linkPk, pay.linkClaimDigest(linkId, carol));

        // Attempt 1: redirect the funds to the attacker with the stolen signature.
        vm.expectRevert(MarenPay.InvalidLinkSignature.selector);
        vm.prank(attacker);
        pay.claimLink(linkId, attacker, carolSig);

        // Attempt 2: front-run by submitting Carol's ORIGINAL transaction. The attacker pays
        // the gas and Carol still receives every last wei.
        uint256 carolBefore = musd.balanceOf(carol);
        vm.prank(attacker);
        pay.claimLink(linkId, carol, carolSig);

        assertEq(musd.balanceOf(carol) - carolBefore, 100 * ONE, "funds follow the signature");
        assertEq(musd.balanceOf(attacker), 0, "attacker gains nothing");
        assertEq(pay.totalEscrowed(), 0);
    }

    function test_Link_ReclaimAfterExpiry() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");
        assertEq(musd.balanceOf(alice), 900 * ONE);

        vm.warp(uint256(expiry) + 1);

        vm.expectEmit(true, true, false, true, address(pay));
        emit LinkReclaimed(linkId, alice, 100 * ONE);
        vm.prank(alice);
        pay.reclaimLink(linkId);

        assertEq(musd.balanceOf(alice), 1_000 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0);
        assertEq(pay.totalEscrowed(), 0);
        (,,,,, bool reclaimed) = pay.links(linkId);
        assertTrue(reclaimed);
    }

    /// @dev SECURITY PROPERTY: if the creator could reclaim before expiry they could watch the
    ///      mempool and front-run a legitimate claim — exactly the attack the keypair scheme
    ///      exists to prevent.
    function testRevert_Link_ReclaimBeforeExpiry() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");

        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkNotExpired.selector, linkId, expiry));
        vm.prank(alice);
        pay.reclaimLink(linkId);

        // Not even at the exact expiry second.
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkNotExpired.selector, linkId, expiry));
        vm.prank(alice);
        pay.reclaimLink(linkId);
    }

    function testRevert_Link_ReclaimByNonCreator() public {
        (address linkKey,) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");

        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(abi.encodeWithSelector(MarenPay.NotLinkCreator.selector, attacker, alice));
        vm.prank(attacker);
        pay.reclaimLink(linkId);
    }

    function testRevert_Link_ReclaimAfterClaim() public {
        (address linkKey, uint256 linkPk) = makeAddrAndKey("linkKey");
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 linkId = pay.createLink(linkKey, 100 * ONE, expiry, "gift");

        vm.prank(carol);
        pay.claimLink(linkId, carol, _sign(linkPk, pay.linkClaimDigest(linkId, carol)));

        vm.warp(uint256(expiry) + 1);
        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkAlreadySettled.selector, linkId));
        vm.prank(alice);
        pay.reclaimLink(linkId);
    }

    function testRevert_Link_ReclaimUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(MarenPay.LinkAlreadySettled.selector, 42));
        vm.prank(alice);
        pay.reclaimLink(42);
    }

    /// @dev The digest is domain-separated by chain id and contract address, so a signature
    ///      cannot be lifted onto another deployment.
    function test_Link_ClaimDigestIsDomainSeparated() public {
        MarenPay other = new MarenPay(address(musd), address(registry), address(permit2), address(forwarder));
        assertTrue(pay.linkClaimDigest(1, carol) != other.linkClaimDigest(1, carol), "per-contract");
        assertTrue(pay.linkClaimDigest(1, carol) != pay.linkClaimDigest(2, carol), "per-link");
        assertTrue(pay.linkClaimDigest(1, carol) != pay.linkClaimDigest(1, dave), "per-recipient");
    }

    // ------------------------------------------------------------------ //
    //                                Split                               //
    // ------------------------------------------------------------------ //

    function test_Split_PaysEveryRecipient() public {
        address[] memory recipients = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        recipients[0] = bob;
        recipients[1] = carol;
        recipients[2] = dave;
        amounts[0] = 10 * ONE;
        amounts[1] = 20 * ONE;
        amounts[2] = 30 * ONE;
        string memory memo = "dinner";
        bytes32 memoHash = keccak256(bytes(memo));

        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, bob, 10 * ONE, memoHash, memo);
        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, carol, 20 * ONE, memoHash, memo);
        vm.expectEmit(true, true, true, true, address(pay));
        emit Paid(alice, dave, 30 * ONE, memoHash, memo);
        vm.expectEmit(true, false, false, true, address(pay));
        emit SplitExecuted(alice, 60 * ONE, 3, memoHash);

        vm.prank(alice);
        uint256 total = pay.split(recipients, amounts, memo);

        assertEq(total, 60 * ONE);
        assertEq(musd.balanceOf(alice), 940 * ONE);
        assertEq(musd.balanceOf(bob), 1_010 * ONE);
        assertEq(musd.balanceOf(carol), 1_020 * ONE);
        assertEq(musd.balanceOf(dave), 30 * ONE);
        assertEq(musd.balanceOf(address(pay)), 0, "split pools nothing");
    }

    function test_Split_AtMaxRecipients() public {
        uint256 n = pay.MAX_SPLIT_RECIPIENTS();
        address[] memory recipients = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            recipients[i] = address(uint160(0x1000 + i));
            amounts[i] = ONE;
        }
        vm.prank(alice);
        uint256 total = pay.split(recipients, amounts, "many");
        assertEq(total, n * ONE);
        assertEq(musd.balanceOf(address(uint160(0x1000))), ONE);
    }

    function testRevert_Split_ArrayLengthMismatch() public {
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = bob;
        recipients[1] = carol;
        amounts[0] = ONE;

        vm.expectRevert(abi.encodeWithSelector(MarenPay.ArrayLengthMismatch.selector, 2, 1));
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
    }

    function testRevert_Split_EmptySplit() public {
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.expectRevert(MarenPay.EmptySplit.selector);
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
    }

    function testRevert_Split_TooManyRecipients() public {
        address[] memory recipients = new address[](65);
        uint256[] memory amounts = new uint256[](65);
        for (uint256 i; i < 65; ++i) {
            recipients[i] = address(uint160(0x2000 + i));
            amounts[i] = ONE;
        }
        vm.expectRevert(abi.encodeWithSelector(MarenPay.TooManyRecipients.selector, 65, 64));
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
    }

    function testRevert_Split_ZeroAddressRecipient() public {
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        recipients[0] = bob;
        recipients[1] = address(0);
        amounts[0] = ONE;
        amounts[1] = ONE;

        vm.expectRevert(MarenPay.ZeroAddress.selector);
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
        assertEq(musd.balanceOf(bob), 1_000 * ONE, "the whole split reverts atomically");
    }

    function testRevert_Split_ZeroAmountLeg() public {
        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = bob;
        amounts[0] = 0;
        vm.expectRevert(MarenPay.ZeroAmount.selector);
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
    }

    function testRevert_Split_SelfPaymentLeg() public {
        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = alice;
        amounts[0] = ONE;
        vm.expectRevert(MarenPay.SelfPayment.selector);
        vm.prank(alice);
        pay.split(recipients, amounts, "x");
    }

    // ------------------------------------------------------------------ //
    //                          Escrow accounting                         //
    // ------------------------------------------------------------------ //

    /**
     * @dev THE CUSTODY INVARIANT. Every non-link entrypoint must be a pass-through, and every
     *      wei the contract holds must be earmarked to an unsettled link. If the balance ever
     *      exceeded `totalEscrowed` because of a pass-through path, MarenPay would be silently
     *      custodial; if it were ever less, some link would be unclaimable.
     */
    function test_Invariant_BalanceEqualsTotalEscrowedAfterMixedActivity() public {
        _registerHandle(bob, "bobby", keccak256("s"));
        (address key1, uint256 pk1) = makeAddrAndKey("k1");
        (address key2,) = makeAddrAndKey("k2");
        (address key3,) = makeAddrAndKey("k3");

        vm.prank(alice);
        pay.pay(bob, 5 * ONE, "a");
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        vm.prank(alice);
        pay.payToHandle("bobby", 5 * ONE, "b");
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 l1 = pay.createLink(key1, 40 * ONE, expiry, "l1");
        vm.prank(bob);
        uint256 l2 = pay.createLink(key2, 60 * ONE, expiry, "l2");
        vm.prank(carol);
        pay.createLink(key3, 30 * ONE, expiry, "l3");
        assertEq(pay.totalEscrowed(), 130 * ONE);
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        // A request fulfilment in the middle must not touch escrow.
        vm.prank(alice);
        uint256 reqId = pay.createRequest(carol, 7 * ONE, "req");
        vm.prank(carol);
        pay.fulfillRequest(reqId);
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        // Claim one link.
        vm.prank(dave);
        pay.claimLink(l1, dave, _sign(pk1, pay.linkClaimDigest(l1, dave)));
        assertEq(pay.totalEscrowed(), 90 * ONE);
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        // A split must not touch escrow either.
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        recipients[0] = bob;
        recipients[1] = carol;
        amounts[0] = 2 * ONE;
        amounts[1] = 3 * ONE;
        vm.prank(alice);
        pay.split(recipients, amounts, "s");
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed());

        // Reclaim another after expiry.
        vm.warp(uint256(expiry) + 1);
        vm.prank(bob);
        pay.reclaimLink(l2);
        assertEq(pay.totalEscrowed(), 30 * ONE);
        assertEq(musd.balanceOf(address(pay)), pay.totalEscrowed(), "only link 3 remains escrowed");
    }

    /// @dev Stray MUSD sent to the contract must NOT be counted as escrow and there is
    ///      deliberately no sweeper for it.
    function test_StrayTokensDoNotAffectEscrowAccounting() public {
        (address key,) = makeAddrAndKey("k");
        vm.prank(alice);
        pay.createLink(key, 10 * ONE, uint64(block.timestamp + 1 days), "l");

        musd.mint(address(pay), 3 * ONE);
        assertEq(pay.totalEscrowed(), 10 * ONE);
        assertEq(musd.balanceOf(address(pay)), 13 * ONE);
    }

    // ------------------------------------------------------------------ //
    //                              ERC-2771                              //
    // ------------------------------------------------------------------ //

    /// @dev SECURITY PROPERTY: only the trusted forwarder's appended sender may be believed.
    ///      Otherwise anyone could spend anyone else's MarenPay allowance.
    function test_ERC2771_ForwardedPayUsesAppendedSender() public {
        bytes memory inner = abi.encodeCall(MarenPay.pay, (bob, 5 * ONE, "meta"));

        // A direct caller appending alice's address cannot spend her allowance.
        vm.prank(attacker);
        (bool spoofed,) = address(pay).call(abi.encodePacked(inner, alice));
        assertFalse(spoofed, "the suffix must not be trusted from a random caller");
        assertEq(musd.balanceOf(alice), 1_000 * ONE);

        // The same calldata from the forwarder pays out of alice's balance.
        vm.prank(address(forwarder));
        (bool ok,) = address(pay).call(abi.encodePacked(inner, alice));
        assertTrue(ok);
        assertEq(musd.balanceOf(alice), 995 * ONE);
        assertEq(musd.balanceOf(bob), 1_005 * ONE);
    }
}
