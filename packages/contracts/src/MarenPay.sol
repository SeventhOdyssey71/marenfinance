// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMUSD} from "./interfaces/IMUSD.sol";
import {IPermit2} from "./interfaces/IPermit2.sol";
import {MarenRegistry} from "./MarenRegistry.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MarenPay
 * @author Maren Finance
 * @notice MUSD payments: direct, to a `@handle`, as a request, as a claimable link, or split
 *         N ways. ERC-2771 throughout, so any of it can be done by a user holding zero BTC.
 *
 * CUSTODY — the honest version:
 *   `pay`, `payToHandle`, `payWithPermit`, `payWithPermit2`, `fulfillRequest` and `split` are
 *   strictly non-custodial. MUSD moves wallet -> wallet in a single `transferFrom` under the
 *   payer's own allowance, permit, or Permit2 signature. MarenPay's MUSD balance does not
 *   change and it can never move funds a user has not authorised for that exact transfer.
 *
 *   `createLink` is the ONE exception and it is unavoidable: a link must be claimable by
 *   someone who does not exist yet, so the MUSD has to sit somewhere. It sits in this
 *   contract, earmarked to a link id, and is recoverable by the creator after the expiry they
 *   themselves chose. Escrowed funds are never pooled with anything else and are never lent,
 *   staked, or forwarded. If you are auditing one function in this file, audit that one.
 *
 * DESIGN NOTE (EIP-7702): every entrypoint is small, independent and idempotent-shaped so a
 * 7702-delegated account can batch `permit` + `pay`, or `deposit` + `borrow` + `pay` across
 * Maren contracts, in a single transaction. Nothing here assumes it is alone in its tx.
 */
contract MarenPay is ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ //
    //                               Types                                //
    // ------------------------------------------------------------------ //

    enum RequestStatus {
        None,
        Open,
        Fulfilled,
        Cancelled
    }

    struct PaymentRequest {
        address requester; // who gets paid
        address payer; // address(0) means "anyone may fulfil"
        uint256 amount;
        uint64 createdAt;
        RequestStatus status;
    }

    struct PaymentLink {
        address creator;
        /// @dev Address of a ONE-TIME keypair. The private key is the "secret" that travels
        ///      in the link URL and never touches the chain. See `claimLink`.
        address linkKey;
        uint256 amount;
        uint64 expiry;
        bool claimed;
        bool reclaimed;
    }

    // ------------------------------------------------------------------ //
    //                             Immutables                             //
    // ------------------------------------------------------------------ //

    IMUSD public immutable musd;
    MarenRegistry public immutable registry;

    /// @notice Canonical Permit2, 0x000000000022D473030F116dDEE9F6B43aC78BA3. May be
    ///         `address(0)` on a chain where it is not deployed, which disables
    ///         `payWithPermit2` and nothing else.
    IPermit2 public immutable permit2;

    /// @dev Bounds the gas of `split`. 64 transfers is ~1.6M gas, comfortably under a Mezo
    ///      block, and past that a caller should send two transactions.
    uint256 public constant MAX_SPLIT_RECIPIENTS = 64;

    // ------------------------------------------------------------------ //
    //                              Storage                               //
    // ------------------------------------------------------------------ //

    uint256 public nextRequestId = 1;
    uint256 public nextLinkId = 1;

    mapping(uint256 requestId => PaymentRequest) public requests;
    mapping(uint256 linkId => PaymentLink) public links;

    /// @notice Total MUSD this contract holds on behalf of unclaimed links. Any balance above
    ///         this is dust someone sent by mistake; there is deliberately no sweeper, so a
    ///         future upgrade cannot be used to justify touching escrow.
    uint256 public totalEscrowed;

    // ------------------------------------------------------------------ //
    //                               Events                               //
    // ------------------------------------------------------------------ //

    event Paid(address indexed from, address indexed to, uint256 amount, bytes32 indexed memoHash, string memo);
    event PaidToHandle(bytes32 indexed node, address indexed from, address indexed to, uint256 amount, string handle);
    event RequestCreated(
        uint256 indexed requestId, address indexed requester, address indexed payer, uint256 amount, string memo
    );
    event RequestFulfilled(uint256 indexed requestId, address indexed payer, address indexed requester, uint256 amount);
    event RequestCancelled(uint256 indexed requestId, address indexed requester);
    event LinkCreated(
        uint256 indexed linkId, address indexed creator, address indexed linkKey, uint256 amount, uint64 expiry
    );
    event LinkClaimed(uint256 indexed linkId, address indexed recipient, uint256 amount);
    event LinkReclaimed(uint256 indexed linkId, address indexed creator, uint256 amount);
    event SplitExecuted(address indexed from, uint256 total, uint256 recipientCount, bytes32 indexed memoHash);

    // ------------------------------------------------------------------ //
    //                               Errors                               //
    // ------------------------------------------------------------------ //

    error ZeroAddress();
    error ZeroAmount();
    error SelfPayment();
    error Permit2NotConfigured();
    error RequestNotOpen(uint256 requestId, RequestStatus status);
    error NotRequestPayer(address caller, address expected);
    error NotRequester(address caller, address expected);
    error LinkAlreadySettled(uint256 linkId);
    error LinkExpired(uint256 linkId, uint64 expiry);
    error LinkNotExpired(uint256 linkId, uint64 expiry);
    error NotLinkCreator(address caller, address expected);
    error InvalidLinkSignature();
    error InvalidExpiry(uint64 expiry);
    error ArrayLengthMismatch(uint256 recipients, uint256 amounts);
    error TooManyRecipients(uint256 count, uint256 max);
    error EmptySplit();

    constructor(address musd_, address registry_, address permit2_, address trustedForwarder_)
        ERC2771Context(trustedForwarder_)
    {
        if (musd_ == address(0) || registry_ == address(0)) revert ZeroAddress();
        musd = IMUSD(musd_);
        registry = MarenRegistry(registry_);
        // permit2_ == address(0) is legal and simply disables payWithPermit2.
        permit2 = IPermit2(permit2_);
    }

    // ------------------------------------------------------------------ //
    //                            Direct payment                          //
    // ------------------------------------------------------------------ //

    /// @notice Pay `to` with an on-chain memo. Requires a prior MUSD approval to this contract.
    function pay(address to, uint256 amount, string calldata memo) external nonReentrant {
        _pay(_msgSender(), to, amount, memo);
    }

    /// @notice Pay whoever owns `@handle`. Reverts if the handle is unregistered — a payment
    ///         to an unknown handle must fail loudly, never fall back to an address.
    function payToHandle(string calldata handle, uint256 amount, string calldata memo) external nonReentrant {
        address to = registry.resolve(handle);
        address from = _msgSender();
        _pay(from, to, amount, memo);
        emit PaidToHandle(registry.namehash(handle), from, to, amount, handle);
    }

    /**
     * @notice Approve and pay in one call, so a first-time user needs zero prior transactions.
     * @dev The `permit` is applied in a try/catch on purpose. A permit signature sits in the
     *      public mempool and anyone can submit it directly to MUSD first; that consumes the
     *      nonce and makes our inner `permit` revert, which would otherwise brick a perfectly
     *      valid payment. If the allowance is already sufficient we simply continue. This is
     *      the standard mitigation and it cannot be used to pay without authorisation — the
     *      `transferFrom` below still needs a real allowance.
     */
    function payWithPermit(
        address to,
        uint256 amount,
        string calldata memo,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        address from = _msgSender();
        _applyPermit(from, amount, deadline, v, r, s);
        _pay(from, to, amount, memo);
    }

    /**
     * @notice Pay using a Permit2 `SignatureTransfer` authorisation.
     * @dev This exists so Maren INTEROPERATES with Mezo's x402 rail (settlement proxy
     *      0x402085c248EeA27D92E8b30b2C58ed07f9E20001) instead of competing with it: a buyer
     *      who has already given Permit2 a one-time MUSD approval can pay through Maren with
     *      a single EIP-712 signature and no approval transaction, on any Maren surface.
     *
     *      Permit2 moves the funds payer -> recipient directly. MarenPay is only the spender
     *      named in the signature; it never holds the MUSD. `permit.permitted.token` is not
     *      checked here because Permit2 itself enforces that the signature covers that exact
     *      token — but a signature for a token other than MUSD would transfer that token, so
     *      we require it explicitly rather than rely on the caller.
     */
    function payWithPermit2(
        address to,
        uint256 amount,
        string calldata memo,
        IPermit2.PermitTransferFrom calldata permit,
        bytes calldata signature
    ) external nonReentrant {
        if (address(permit2) == address(0)) revert Permit2NotConfigured();
        if (permit.permitted.token != address(musd)) revert ZeroAddress();
        address from = _msgSender();
        _validatePayment(from, to, amount);

        permit2.permitTransferFrom(
            permit, IPermit2.SignatureTransferDetails({to: to, requestedAmount: amount}), from, signature
        );
        emit Paid(from, to, amount, keccak256(bytes(memo)), memo);
    }

    // ------------------------------------------------------------------ //
    //                         Payment requests                           //
    // ------------------------------------------------------------------ //

    /**
     * @notice Ask someone for money. Creates no obligation and moves no funds.
     * @param payer The address expected to pay, or `address(0)` to let anyone fulfil it
     *              (useful for an invoice published as a link).
     */
    function createRequest(address payer, uint256 amount, string calldata memo)
        external
        returns (uint256 requestId)
    {
        if (amount == 0) revert ZeroAmount();
        address requester = _msgSender();
        if (payer == requester) revert SelfPayment();

        requestId = nextRequestId++;
        requests[requestId] = PaymentRequest({
            requester: requester,
            payer: payer,
            amount: amount,
            createdAt: uint64(block.timestamp),
            status: RequestStatus.Open
        });
        emit RequestCreated(requestId, requester, payer, amount, memo);
    }

    /// @notice Pay an open request. Funds move payer -> requester; nothing is escrowed.
    function fulfillRequest(uint256 requestId) external nonReentrant {
        _fulfillRequest(requestId, _msgSender());
    }

    /// @notice Approve and fulfil in one call, for a payer with no prior MUSD allowance.
    function fulfillRequestWithPermit(uint256 requestId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        address payer = _msgSender();
        _applyPermit(payer, requests[requestId].amount, deadline, v, r, s);
        _fulfillRequest(requestId, payer);
    }

    /// @notice Withdraw a request you created. Only the requester can; the payer simply
    ///         ignores it. Cancelling is terminal — ids are never reused.
    function cancelRequest(uint256 requestId) external {
        PaymentRequest storage req = requests[requestId];
        if (req.status != RequestStatus.Open) revert RequestNotOpen(requestId, req.status);
        if (req.requester != _msgSender()) revert NotRequester(_msgSender(), req.requester);
        req.status = RequestStatus.Cancelled;
        emit RequestCancelled(requestId, req.requester);
    }

    // ------------------------------------------------------------------ //
    //                          Claimable links                           //
    // ------------------------------------------------------------------ //

    /**
     * @notice Escrow MUSD to be claimed by whoever holds the link.
     * @param linkKey Address of a one-time keypair generated by the sender's client. The
     *                PRIVATE key goes in the URL fragment (`#`), so it never reaches a server.
     * @param expiry  Unix timestamp after which the creator may reclaim. Must be in the future.
     *
     * @dev WHY A KEYPAIR AND NOT A HASHED SECRET. The obvious design is
     *      `claimLink(secret)` where `keccak256(secret)` was fixed at creation. It is
     *      unusable in a public mempool: the claim transaction reveals the secret, and any
     *      searcher can copy it, pay more gas, and take the money before the claim lands. The
     *      preimage is a bearer token with no binding to the claimer.
     *
     *      Here the secret is a private key and it is never broadcast. The claimer signs
     *      THEIR OWN recipient address with it (see `claimLink`), so a copied signature is
     *      only valid for the recipient it already names. Same UX, same one-string link,
     *      no front-running. This is the LinkDrop/Argent construction.
     */
    function createLink(address linkKey, uint256 amount, uint64 expiry, string calldata memo)
        external
        nonReentrant
        returns (uint256 linkId)
    {
        if (linkKey == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert InvalidExpiry(expiry);

        address creator = _msgSender();
        linkId = nextLinkId++;
        links[linkId] = PaymentLink({
            creator: creator,
            linkKey: linkKey,
            amount: amount,
            expiry: expiry,
            claimed: false,
            reclaimed: false
        });
        totalEscrowed += amount;

        IERC20(address(musd)).safeTransferFrom(creator, address(this), amount);
        emit LinkCreated(linkId, creator, linkKey, amount, expiry);
        emit Paid(creator, address(this), amount, keccak256(bytes(memo)), memo);
    }

    /**
     * @notice Claim a link. Anyone may submit this transaction — a relayer, usually — but the
     *         funds can only go to the `recipient` the signature names.
     * @param signature ECDSA signature by the link's private key over
     *                  `linkClaimDigest(linkId, recipient)`.
     */
    function claimLink(uint256 linkId, address recipient, bytes calldata signature) external nonReentrant {
        PaymentLink storage link = links[linkId];
        if (recipient == address(0)) revert ZeroAddress();
        if (link.creator == address(0)) revert LinkAlreadySettled(linkId);
        if (link.claimed || link.reclaimed) revert LinkAlreadySettled(linkId);
        if (block.timestamp > link.expiry) revert LinkExpired(linkId, link.expiry);

        address signer = ECDSA.recover(linkClaimDigest(linkId, recipient), signature);
        if (signer != link.linkKey) revert InvalidLinkSignature();

        uint256 amount = link.amount;
        link.claimed = true;
        totalEscrowed -= amount;

        IERC20(address(musd)).safeTransfer(recipient, amount);
        emit LinkClaimed(linkId, recipient, amount);
        emit Paid(link.creator, recipient, amount, bytes32(0), "");
    }

    /**
     * @notice Take an unclaimed link back after it expires.
     * @dev Only after expiry, never before. If the creator could cancel at will they could
     *      watch the mempool and front-run a legitimate claim, which is the exact attack the
     *      keypair scheme exists to prevent. The creator controls the expiry at creation
     *      time, so "cancel sooner" means "set a shorter expiry".
     */
    function reclaimLink(uint256 linkId) external nonReentrant {
        PaymentLink storage link = links[linkId];
        if (link.creator == address(0)) revert LinkAlreadySettled(linkId);
        if (link.claimed || link.reclaimed) revert LinkAlreadySettled(linkId);
        if (link.creator != _msgSender()) revert NotLinkCreator(_msgSender(), link.creator);
        if (block.timestamp <= link.expiry) revert LinkNotExpired(linkId, link.expiry);

        uint256 amount = link.amount;
        link.reclaimed = true;
        totalEscrowed -= amount;

        IERC20(address(musd)).safeTransfer(link.creator, amount);
        emit LinkReclaimed(linkId, link.creator, amount);
    }

    /// @notice The digest a link's private key must sign. Domain-separated by chain id and
    ///         contract address so a signature cannot be replayed onto another deployment.
    function linkClaimDigest(uint256 linkId, address recipient) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode("MarenPay.claimLink", block.chainid, address(this), linkId, recipient))
        );
    }

    // ------------------------------------------------------------------ //
    //                                Split                               //
    // ------------------------------------------------------------------ //

    /// @notice One signature, N recipients. Each leg is an independent payer -> recipient
    ///         transfer; nothing is pooled.
    function split(address[] calldata recipients, uint256[] calldata amounts, string calldata memo)
        external
        nonReentrant
        returns (uint256 total)
    {
        uint256 n = recipients.length;
        if (n != amounts.length) revert ArrayLengthMismatch(n, amounts.length);
        if (n == 0) revert EmptySplit();
        if (n > MAX_SPLIT_RECIPIENTS) revert TooManyRecipients(n, MAX_SPLIT_RECIPIENTS);

        address from = _msgSender();
        bytes32 memoHash = keccak256(bytes(memo));
        for (uint256 i; i < n; ++i) {
            _validatePayment(from, recipients[i], amounts[i]);
            total += amounts[i];
            IERC20(address(musd)).safeTransferFrom(from, recipients[i], amounts[i]);
            emit Paid(from, recipients[i], amounts[i], memoHash, memo);
        }
        emit SplitExecuted(from, total, n, memoHash);
    }

    // ------------------------------------------------------------------ //
    //                              Internals                             //
    // ------------------------------------------------------------------ //

    function _pay(address from, address to, uint256 amount, string calldata memo) private {
        _validatePayment(from, to, amount);
        IERC20(address(musd)).safeTransferFrom(from, to, amount);
        emit Paid(from, to, amount, keccak256(bytes(memo)), memo);
    }

    function _fulfillRequest(uint256 requestId, address payer) private {
        PaymentRequest storage req = requests[requestId];
        if (req.status != RequestStatus.Open) revert RequestNotOpen(requestId, req.status);
        if (req.payer != address(0) && req.payer != payer) revert NotRequestPayer(payer, req.payer);
        if (payer == req.requester) revert SelfPayment();

        req.status = RequestStatus.Fulfilled;
        IERC20(address(musd)).safeTransferFrom(payer, req.requester, req.amount);
        emit RequestFulfilled(requestId, payer, req.requester, req.amount);
        emit Paid(payer, req.requester, req.amount, bytes32(0), "");
    }

    /// @dev See `payWithPermit` for why failure here is tolerated.
    function _applyPermit(address owner, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try musd.permit(owner, address(this), amount, deadline, v, r, s) {}
        catch {
            // Permit already consumed (front-run) or otherwise unusable. If the allowance is
            // genuinely missing, the transferFrom that follows reverts, which is correct.
        }
    }

    function _validatePayment(address from, address to, uint256 amount) private pure {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (to == from) revert SelfPayment();
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
