// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {IMUSD} from "./interfaces/IMUSD.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title MarenVault
 * @author Maren Finance
 * @notice A pooled MUSD trove. Maren runs ONE trove on Mezo's BorrowerOperations; users hold
 *         a segregated accounting claim inside it and can deposit from 0.001 BTC — roughly
 *         80x below the 1,800 MUSD minimum net debt that otherwise gates every Mezo borrower.
 *
 * ============================== READ THIS FIRST ==============================
 * THIS CONTRACT CARRIES REAL SYSTEMIC RISK AND IT IS NOT HIDDEN ANYWHERE ELSE.
 *
 * 1. POOLING IS NOT CUSTODY SEGREGATION. Every user's collateral is a number in this
 *    contract's storage; the BTC itself is one undifferentiated balance inside one trove
 *    owned by this contract. If that trove is liquidated by the MUSD protocol, ALL users
 *    lose collateral pro rata regardless of their individual health. Maren's defence is to
 *    keep the trove far away from the protocol's 110% cliff: users cannot borrow below 180%
 *    and are internally liquidated at 140%. That is a 30-point buffer, not a guarantee.
 *
 * 2. A FAST DRAWDOWN CAN OUTRUN THE KEEPER. Internal liquidation is a transaction someone
 *    has to land. Between 140% and 110% there is ~21% of BTC price. A gap move larger than
 *    that, or a period where Mezo's oracle is stale (see #3) and NOTHING can be liquidated,
 *    socialises the loss across the pool. The insurance buffer, funded by the 5% liquidation
 *    penalty and by protocol-owned seed collateral, absorbs the first slice. It is not
 *    sized to absorb a 2020-03-12.
 *
 * 3. THE ORACLE CAN SIMPLY STOP. `PriceFeed.fetchPrice()` reverts when Mezo's Skip Connect
 *    oracle is >60s stale, and there is no `lastGoodPrice()` fallback. While it is down: no
 *    borrowing, no liquidation, and no collateral withdrawal out of the trove. Deposits and
 *    repayments still work (they need no price). Every price-dependent path here fails with
 *    `PriceFeedUnavailable()` rather than an opaque revert so the UI can say so plainly.
 *
 * 4. USERS LARGE ENOUGH FOR A DIRECT TROVE SHOULD OPEN ONE. A direct trove carries none of
 *    the above. The UI is required to steer anyone above the protocol minimum to one and to
 *    say why. This vault exists for the users the protocol currently cannot serve at all.
 *
 * 5. BAD DEBT IS RECOGNISED, NOT PAPERED OVER. If a position goes underwater faster than it
 *    can be liquidated, `liquidateUser` seizes everything it can, repays what that covers,
 *    and leaves the shortfall on the defaulter's ledger while emitting `BadDebtRecognised`.
 *    It is never silently spread onto other users' balances.
 * =============================================================================
 *
 * ------------------------------- ACCOUNTING ---------------------------------
 * The hard problem is distributing the pooled trove's continuously accruing interest across
 * users without ever looping over them.
 *
 * Debt is held in SHARES against a monotonically non-decreasing `interestIndex`:
 *
 *     debtOf(user) = ceil(debtShares[user] * interestIndex / 1e18)
 *
 * `_accrue()` runs before every operation and sets
 *
 *     interestIndex = max(interestIndex, ceil(outstandingDebt * 1e18 / totalDebtShares))
 *
 * where `outstandingDebt` is MEASURED from the live trove, not modelled:
 *
 *     outstandingDebt = troveEntireDebt - 200e18 gas compensation - reserveMUSD
 *
 * Measuring rather than modelling matters. The borrowing fee is governable, interest is 1%
 * APR simple but fixed-at-open, and redistributions from other troves can add debt we never
 * asked for. Any of those would drift a hand-rolled model out of sync with reality within
 * days. Here, borrow and repay record the trove's outstanding debt before and after and mint
 * or burn shares against the OBSERVED delta, so the vault's books track the protocol's books
 * by construction, whatever the protocol does.
 *
 * Every rounding decision is made in the protocol's favour: shares round UP when minted,
 * DOWN when burned, and `debtOf` rounds UP. The index never decreases, so accumulated
 * rounding surplus is absorbed by future interest instead of being handed back. The result
 * is that `sum(debtOf(user)) >= outstandingDebt` always — the pool can never owe the protocol
 * more than it has charged its users. `test_fuzz_*` and the invariant suite assert exactly
 * this, including the direction of the drift.
 *
 * `reserveMUSD` is MUSD this contract holds that is already accounted for as repaid. It lets
 * a user borrow 50 MUSD without touching the trove at all, and lets a repayment settle even
 * when pushing it into the trove would drop net debt below the protocol's 1,800 minimum.
 * Because it is subtracted from `outstandingDebt`, moving MUSD between the reserve and the
 * trove changes nothing for users — which is precisely what makes `deleverage()` safe.
 * ----------------------------------------------------------------------------
 *
 * ------------------------------ REDEMPTIONS ---------------------------------
 * A redemption is the one event that reaches into the pooled trove without anyone here
 * asking for it. Any MUSD holder may swap MUSD for trove collateral at the oracle price,
 * and the protocol serves that swap from the lowest-ICR troves first. When it lands on this
 * vault the trove loses collateral and loses exactly the same VALUE of debt. The redeemer
 * pays the 0.75% redemption fee out of the collateral they receive, so the trove itself is
 * value neutral at the instant it happens.
 *
 * The trove is value neutral. The BOOKS are not, and that is the whole problem: nothing in
 * the per-user ledger moved. Left alone, the first users to withdraw would take collateral
 * that is no longer there and the last ones would find the trove empty, and the debt relief
 * the protocol just handed the pool could never reach the people who paid for it, because
 * `interestIndex` only ever goes up.
 *
 * `reconcileRedemption()` is the reconciliation, and it is deliberately boring:
 *
 *   1. MEASURE, do not model. `collateralRemoved` is what the books say should be inside the
 *      trove (`totalCollateral - idleCollateral`) minus what the trove actually holds.
 *      `debtRemoved` is what shareholders are accounted for minus what the trove actually
 *      owes. Both come from TroveManager, never from a redemption event or a parameter.
 *   2. SPLIT PRO RATA BY DEBT SHARES, not by collateral. A redemption cancels debt, so the
 *      people who owe that debt are the people it belongs to. A depositor with no debt is
 *      untouched: they were handed no relief, so they surrender no collateral.
 *   3. DEBT falls by scaling `interestIndex` down by exactly the measured relief. This is the
 *      ONE place the index moves down, and it moves by a measured quantity, never a modelled
 *      one. Everywhere else it is monotonic. Rounding is UP, so shareholders still owe at
 *      least what the trove owes.
 *   4. COLLATERAL falls through `redemptionCollateralPerShare`, a cumulative debit per debt
 *      share, applied to an account lazily against `redemptionSnapshot[account]`. Rounding is
 *      UP, so the pool keeps the dust rather than an individual withdrawer. There is no loop
 *      over users anywhere, at any pool size.
 *
 * Each debtor therefore loses collateral worth exactly the debt they stopped owing. Nobody's
 * net position value changes at the instant of redemption, and every position's collateral
 * ratio improves, which is the same thing that happens to a redeemed standalone trove.
 *
 * The reconciliation runs at the top of EVERY user-facing mutation, not only when a keeper
 * remembers to call it. No deposit, borrow, repay or withdraw can execute against books that
 * predate a redemption, so there is no window in which a user can withdraw a pre-redemption
 * entitlement. It needs no price, so it keeps working while Mezo's oracle is down.
 *
 * KNOWN LIMIT, stated rather than buried. A redemption large enough to cancel essentially all
 * pooled user debt re-pegs the index down towards its floor of 1. Everything stays correct,
 * but every share count minted afterwards is enormous, because shares are debt divided by that
 * index. `REDEMPTION_PRECISION` is 1e36 rather than 1e18 precisely so the per-share rounding
 * stays negligible in that state; see the constant. The invariant suite drives the vault into
 * it deliberately.
 *
 * A LIQUIDATION of the pooled trove looks identical on the collateral ledger and must never
 * be reconciled as a redemption: it removes collateral WITHOUT cancelling an equal value of
 * user debt, so splitting it this way would hand users debt relief the pool never received.
 * `getTroveStatus` tells them apart. A partial redemption leaves the trove active; a
 * liquidation, an owner close, or a redemption large enough to consume the trove entirely
 * does not. When the trove has left the active state every mutation halts with
 * `TroveNoLongerActive`, which is a hard stop and is meant to be: the honest response to
 * "the pool's trove is gone" is to stop paying claims first-come-first-served, not to keep
 * serving whoever transacts first.
 *
 * BE CLEAR ABOUT WHAT THAT COSTS. A halt is not a recovery. In that state the collateral the
 * protocol did not take sits in the MUSD CollSurplusPool, `BorrowerOperations.claimCollateral`
 * is the only way to reach it, and THIS CONTRACT DOES NOT CALL IT. Everyone is frozen until
 * a wind-down path exists, and building one means deciding how a shortfall is shared out,
 * which is a governance question and not a rounding question. It is deliberately not smuggled
 * into this change. Freezing is the conservative failure, and it is the one users can be told
 * about in advance.
 * ----------------------------------------------------------------------------
 *
 * ---------------------------- COMPOSED ENTRYPOINTS --------------------------
 * `deposit`, `borrow`, `repay` and `withdraw` are separate, independently callable
 * entrypoints, so a 7702-delegated account can batch permit + deposit + borrow + pay in a
 * single transaction. That covers the wallets that can batch. Most cannot, and asking a
 * first-time user for two or three signed transactions to end up with MUSD in hand is where
 * they leave. `depositAndBorrow` and `repayWithPermit` are the two composites that remove a
 * transaction each, and they are composites in the literal sense: both call the SAME
 * internals the single-step entrypoints call, so there is exactly one copy of the deposit
 * arithmetic and exactly one copy of the borrow arithmetic in this file.
 *
 * That is not a style preference. This project has already shipped two money bugs from one
 * piece of borrow arithmetic written out twice and then fixed in only one place
 * (docs/research/CODEBASE-AUDIT.md §1). A composite that re-derives what it composes is the
 * same mistake with a shorter fuse, because the second copy lives next to the first and looks
 * right. `depositAndBorrow` therefore contains no arithmetic at all.
 *
 * ONE DELIBERATE DIFFERENCE FROM CALLING THE TWO IN SEQUENCE, and it is the reason to use it:
 * the composite is ATOMIC. If the borrow leg fails, the deposit leg is rolled back with it, so
 * a user who asked for "deposit 0.01 and draw 300" never ends up holding a deposit they did
 * not want on its own. Two separate transactions would leave the deposit standing. The revert
 * REASON is identical either way; the surviving state is not.
 * ----------------------------------------------------------------------------
 */
contract MarenVault is AccessControl, ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ //
    //                               Roles                                //
    // ------------------------------------------------------------------ //

    /// @notice Runs the pooled trove: opens it, tops it up, deleverages, liquidates.
    ///         Cannot move user funds anywhere except where this contract's rules allow.
    bytes32 public constant KEEPER_ROLE = keccak256("MAREN_KEEPER_ROLE");

    /// @notice May halt ENTRIES only. Structurally cannot halt exits — see `_requireCanEnter`.
    bytes32 public constant GUARDIAN_ROLE = keccak256("MAREN_GUARDIAN_ROLE");

    // ------------------------------------------------------------------ //
    //                             Constants                              //
    // ------------------------------------------------------------------ //

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    /**
     * @notice Fixed-point scale of `redemptionCollateralPerShare`, deliberately 1e36 and not
     *         1e18.
     * @dev The per-share debit rounds UP, so one unit of it is worth `totalDebtShares / SCALE`
     *      wei of BTC across the pool. That is nothing at 1e18 scale in ordinary conditions,
     *      and it is NOT nothing after a redemption that cancels almost all pooled user debt:
     *      the interest index is re-pegged towards its floor, every subsequent borrow mints
     *      shares against a tiny index, and `totalDebtShares` can reach 1e40. At 1e18 scale
     *      the rounding would then cost thousands of BTC. At 1e36 it costs ten-thousandths of
     *      a satoshi. The invariant suite found this by driving the index into the floor and
     *      borrowing afterwards, which is exactly the sequence a large redemption produces.
     */
    uint256 internal constant REDEMPTION_PRECISION = 1e36;

    /// @notice The whole point of this contract: ~80x below the protocol's effective minimum.
    uint256 public constant MIN_DEPOSIT = 0.001 ether;

    /// @notice A user may not borrow if it would put them below 180%. (MAREN_POLICY.minHealthyCr)
    uint256 public constant MIN_BORROW_CR = 1.8e18;

    /// @notice Internal liquidation trigger. 30 points above the protocol's 110% MCR.
    ///         (MAREN_POLICY.vaultLiquidationCr)
    uint256 public constant LIQUIDATION_CR = 1.4e18;

    /// @notice The pooled trove itself must stay at or above this after any borrow.
    uint256 public constant MIN_TROVE_CR = 1.8e18;

    /// @notice Seized at liquidation on top of the debt repaid; routed to the insurance buffer.
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500; // 5%

    /// @notice MUSD escrowed in the GasPool at open and returned at close. Part of the trove's
    ///         recorded debt but never part of what users owe, so it is subtracted out.
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;

    /// @notice Protocol floor on net debt. The pooled trove can never be repaid below it
    ///         without closing, which is why `reserveMUSD` exists.
    uint256 public constant MIN_NET_DEBT = 1800e18;

    /// @notice `TroveManager.Status.active`. Anything else means the pooled trove has left
    ///         the system, by liquidation, by an owner close, or by a full redemption.
    uint256 public constant TROVE_STATUS_ACTIVE = 1;

    // ------------------------------------------------------------------ //
    //                               Types                                //
    // ------------------------------------------------------------------ //

    /// @dev Working values for one liquidation. A struct rather than locals purely to stay
    ///      inside the EVM's 16-slot stack window without `via_ir`.
    struct Liquidation {
        uint256 debt;
        uint256 coll;
        uint256 repayAmount;
        uint256 collForDebt;
        uint256 penalty;
        uint256 seized;
    }

    // ------------------------------------------------------------------ //
    //                             Immutables                             //
    // ------------------------------------------------------------------ //

    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IMUSD public immutable musd;

    // ------------------------------------------------------------------ //
    //                              Storage                               //
    // ------------------------------------------------------------------ //

    /// @notice BTC credited to each account. `collateral[address(this)]` is protocol-owned:
    ///         the keeper's seed collateral plus every liquidation penalty ever collected.
    mapping(address account => uint256 btc) public collateral;

    /// @notice Debt shares. Multiply by `interestIndex` to get MUSD owed.
    mapping(address account => uint256 shares) public debtShares;

    uint256 public totalCollateral;
    uint256 public totalDebtShares;

    /// @notice Starts at 1e18. Non-decreasing everywhere EXCEPT `_reconcileRedemption`, which
    ///         is the single place it falls and does so only by a quantity measured off the
    ///         live trove. Do not write code that assumes it only goes up.
    uint256 public interestIndex = WAD;

    /// @notice BTC held here but not yet inside the trove (oracle was down when it arrived,
    ///         or the trove is not open yet). Still fully credited to its depositor.
    uint256 public idleCollateral;

    /// @notice MUSD held here that already counts as repaid. See the accounting notes above.
    uint256 public reserveMUSD;

    /// @notice Lifetime liquidation penalties collected, for reporting. The BTC itself lives
    ///         in `collateral[address(this)]`.
    uint256 public insuranceCollateralAccrued;

    /// @notice Debt written off as uncollectable, for reporting. Never nets off user balances.
    uint256 public badDebtRecognised;

    /**
     * @notice Cumulative BTC debited per debt share by redemptions, `REDEMPTION_PRECISION`
     *         scaled.
     * @dev The whole redemption splitter in one number. An account owes
     *      `debtShares * (redemptionCollateralPerShare - redemptionSnapshot) / 1e36` of
     *      collateral, settled the next time it is touched. Monotonically non-decreasing.
     */
    uint256 public redemptionCollateralPerShare;

    /// @notice Where each account has already settled up to. An account that has never held
    ///         debt shares is simply moved forward with nothing to pay.
    mapping(address account => uint256 perShare) public redemptionSnapshot;

    /// @notice Lifetime BTC taken out of the pooled trove by redemptions, for reporting.
    uint256 public totalCollateralRedeemed;

    /// @notice Lifetime MUSD of user debt cancelled by those redemptions, for reporting.
    uint256 public totalDebtRedeemed;

    /**
     * @notice Redemption collateral that could NOT be charged to the account that owed it.
     * @dev Only reachable for a position already below 100% collateralisation, where the
     *      debit exceeds every wei the account holds. It is capped at the account's balance,
     *      added back to `totalCollateral` and recorded here rather than being spread silently
     *      onto other users, in exactly the same spirit as `badDebtRecognised`.
     *
     *      IT IS A PERMANENT GAP, and every place that compares the books against the live
     *      trove has to subtract it. `totalCollateral` is credited back so the per-account
     *      ledger still sums to it, which means the books deliberately record more collateral
     *      than the protocol holds, by exactly this much, for the life of the contract. The
     *      redemption detector reads that gap, so without subtracting it the detector would
     *      re-read the SAME shortfall as a fresh redemption on the very next sync and charge
     *      it pro rata to everyone still holding debt shares, which is the socialisation this
     *      whole mechanism exists to prevent. See `_booksInTrove`.
     *
     *      THE MAKE-WHOLE PATH is `depositProtocolCollateral` (H-2 / M-2 fix): real BTC deposited
     *      there retires this gap, lowering it in lockstep with the deposit (capped at the gap)
     *      WITHOUT re-crediting `totalCollateral` or any account, because the missing collateral
     *      was a loss the protocol already took. It covers a shortfall of any origin; the H-2
     *      residual (the protocol's own position exhausted by a redemption excess) is the case it
     *      was added for. See docs/audit/CONTRACTS-AUDIT.md H-2 and M-2.
     */
    uint256 public redemptionShortfall;

    bool public troveOpen;

    /// @notice Blocks `deposit`. NEVER blocks withdraw, repay, closePosition or liquidation.
    bool public depositsPaused;

    /// @notice Blocks `borrow`. NEVER blocks withdraw, repay, closePosition or liquidation.
    bool public borrowingPaused;

    /// @notice Ceiling on `totalCollateral`. Starts small on mainnet and is raised as the
    ///         position proves out (ARCHITECTURE.md §7).
    uint256 public depositCap;

    // ------------------------------------------------------------------ //
    //                               Events                               //
    // ------------------------------------------------------------------ //

    event Deposited(address indexed user, uint256 amount, uint256 newCollateral, bool pushedToTrove);
    event Withdrawn(address indexed user, uint256 amount, uint256 newCollateral);
    event Borrowed(
        address indexed user, uint256 amount, uint256 debtAdded, uint256 newDebt, bool fromReserve
    );
    event Repaid(address indexed user, uint256 amount, uint256 newDebt);
    event PositionClosed(address indexed user, uint256 debtRepaid, uint256 collateralReturned);
    event Liquidated(
        address indexed user,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralToLiquidator,
        uint256 penaltyToInsurance
    );
    event BadDebtRecognised(address indexed user, uint256 amount);
    event InterestAccrued(uint256 oldIndex, uint256 newIndex, uint256 outstandingDebt);
    event PooledTroveOpened(uint256 seedCollateral, uint256 seedDebt);
    event PooledTroveClosed(uint256 collateralReturned);
    event CollateralPushedToTrove(uint256 amount);
    event CollateralHeldIdle(uint256 amount, uint256 totalIdle);
    /// @dev Carries the revert selector so a keeper can tell "the trove had no room" or "the
    ///      oracle is stale" from "the call reverted for a reason nobody predicted". Zero
    ///      means the callee reverted with no returndata at all.
    event CollateralPushFailed(uint256 amount, bytes4 reason);
    event RepaymentPushFailed(uint256 amount, bytes4 reason);
    event RedemptionReconciled(
        uint256 collateralRemoved,
        uint256 debtRemoved,
        uint256 oldInterestIndex,
        uint256 newInterestIndex,
        uint256 collateralPerShare
    );
    event RedemptionSettled(address indexed account, uint256 collateralDebited, uint256 newCollateral);
    event RedemptionShortfallRecognised(address indexed account, uint256 amount);
    event Deleveraged(uint256 musdRepaidIntoTrove, uint256 reserveRemaining);
    event Refinanced(uint256 newMaxBorrowingCapacity);
    event ProtocolCollateralAdded(uint256 amount);
    event Skimmed(uint256 amount);
    event DepositsPausedSet(bool paused);
    event BorrowingPausedSet(bool paused);
    event DepositCapSet(uint256 cap);

    // ------------------------------------------------------------------ //
    //                               Errors                               //
    // ------------------------------------------------------------------ //

    /// @notice Mezo's oracle is >60s stale, so no price-dependent action can be taken safely.
    ///         This is a chain condition, not a user error.
    error PriceFeedUnavailable();
    error DepositsArePaused();
    error BorrowingIsPaused();
    error DepositBelowMinimum(uint256 amount, uint256 minimum);
    error DepositCapExceeded(uint256 attempted, uint256 cap);
    error ZeroAmount();
    error InsufficientCollateral(uint256 requested, uint256 available);
    error InsufficientCollateralRatio(uint256 resultingCr, uint256 requiredCr);
    error TroveCollateralRatioTooLow(uint256 resultingCr, uint256 requiredCr);
    error TroveNotOpen();
    error TroveAlreadyOpen();
    error SeedDebtBelowProtocolMinimum(uint256 requested, uint256 minimum);
    error PositionHealthy(uint256 cr, uint256 threshold);
    error NothingToLiquidate(address user);
    error NoDebt();
    error ReserveTooSmall(uint256 requested, uint256 available);
    error OutstandingUserDebt(uint256 shares);
    error CollateralTransferFailed(address to, uint256 amount);
    error NothingToSkim();

    /// @notice The pooled trove has left the active state: liquidated, closed, or fully
    ///         redeemed. Every mutation halts rather than guess which, because a liquidation
    ///         and a redemption look the same on the collateral ledger and are not the same
    ///         thing. Carries the raw `TroveManager.Status` so the UI can say which.
    error TroveNoLongerActive(uint256 status);

    /// @notice `deleverage()` moved nothing. Previously this emitted `Deleveraged(0, ...)` and
    ///         looked like a success to a keeper watching events.
    error NothingRepaid();

    // ------------------------------------------------------------------ //
    //                            Construction                            //
    // ------------------------------------------------------------------ //

    constructor(
        address borrowerOperations_,
        address troveManager_,
        address priceFeed_,
        address musd_,
        address trustedForwarder_,
        address admin_,
        uint256 depositCap_
    ) ERC2771Context(trustedForwarder_) {
        borrowerOperations = IBorrowerOperations(borrowerOperations_);
        troveManager = ITroveManager(troveManager_);
        priceFeed = IPriceFeed(priceFeed_);
        musd = IMUSD(musd_);
        depositCap = depositCap_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        emit DepositCapSet(depositCap_);
    }

    /**
     * @notice Accepts native BTC from the MUSD ActivePool / CollSurplusPool during
     *         `withdrawColl` and `closeTrove`.
     * @dev Deliberately does not credit the sender. BTC that arrives here outside a vault
     *      operation is unattributable, so it is left as an unaccounted surplus that
     *      `skim()` moves into the insurance buffer. Crediting `msg.sender` would let anyone
     *      mint themselves collateral by self-destructing a contract into this one.
     */
    receive() external payable {}

    // ------------------------------------------------------------------ //
    //                            User actions                            //
    // ------------------------------------------------------------------ //

    /**
     * @notice Deposit native BTC as collateral.
     * @dev Needs no price, so it works while the oracle is down. The BTC is pushed straight
     *      into the pooled trove when possible; if `addColl` reverts (almost always oracle
     *      staleness) it is held here, still fully credited, until a keeper calls
     *      `topUpCollateral`. Idle collateral does NOT back the trove, which is why `borrow`
     *      additionally checks the trove's own ICR.
     */
    function deposit(address upperHint, address lowerHint) external payable nonReentrant {
        _requireDepositAllowed(msg.value);

        address user = _msgSender();
        // Before anything else, and before the cap is measured: a redemption may have shrunk
        // both the pool and this user's claim since the last time anyone touched the vault.
        _syncState();
        _settleRedemption(user);

        _creditDeposit(user, msg.value, upperHint, lowerHint);
    }

    /**
     * @notice Draw MUSD against your collateral. Refused below 180%.
     * @dev Served from `reserveMUSD` when possible — that is what makes a 50 MUSD loan
     *      possible against a protocol whose minimum is 1,800.
     */
    function borrow(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        _requireBorrowAllowed(amount);

        address user = _msgSender();
        _syncState();
        _settleRedemption(user);

        _borrow(user, amount, upperHint, lowerHint);
    }

    /**
     * @notice Deposit BTC and draw MUSD against it in one transaction.
     * @dev This is `deposit` followed by `borrow` and nothing else. It calls the same two
     *      internals those entrypoints call, in the same order, with the same checks:
     *
     *        `DepositsArePaused` / `DepositBelowMinimum`:  the deposit leg's own guards
     *        `BorrowingIsPaused` / `ZeroAmount` / `TroveNotOpen`: the borrow leg's
     *        `TroveNoLongerActive`:                        the shared state sync
     *        `DepositCapExceeded`:                         measured after the sync
     *        `PriceFeedUnavailable`:                       the borrow leg needs a price
     *        `InsufficientCollateralRatio`:                the 180% per-user floor
     *        `TroveCollateralRatioTooLow`:                 the 180% pooled-trove floor
     *
     *      THE REVERT REASON IS NOT ALWAYS THE ONE THE TWO SEPARATE CALLS WOULD HAVE GIVEN,
     *      and the earlier version of this comment claimed it was. Both guard sets run before
     *      either leg, so a borrow-leg guard beats a deposit-leg failure that only surfaces at
     *      or after the sync. Exactly two orderings differ, both verified: over the cap with a
     *      zero borrow reports `ZeroAmount` where `deposit` alone reports `DepositCapExceeded`,
     *      and a frozen trove with borrowing paused reports `BorrowingIsPaused` where `deposit`
     *      alone reports `TroveNoLongerActive`. Nothing executes in either case, so this costs
     *      a caller diagnosis and never state. See docs/audit/CONTRACTS-AUDIT.md I-1.
     *
     *      The 180% floor is computed on the POST-deposit position, because `_creditDeposit`
     *      has already run when `_borrow` reads `collateral[user]`. A user depositing 0.01 BTC
     *      and drawing against it is measured on the 0.01 BTC, which is the only reading that
     *      makes the call useful.
     *
     *      No new event. This emits `Deposited` then `Borrowed`, the same two an indexer
     *      already parses, in the same transaction and in that order.
     *
     *      Both legs are atomic together. See the COMPOSED ENTRYPOINTS note at the top of this
     *      file for why that is the point and what it costs.
     */
    function depositAndBorrow(uint256 amount, address upperHint, address lowerHint)
        external
        payable
        nonReentrant
    {
        // Both guard sets run before either leg executes, and in the order the single calls run
        // them. Checking the borrow's guards up front is what stops a doomed borrow from
        // burning the caller's gas on an `addColl` the revert is about to undo.
        _requireDepositAllowed(msg.value);
        _requireBorrowAllowed(amount);

        address user = _msgSender();
        // One sync and one settlement for both legs. Running them twice would be harmless and
        // wasteful: the second pass finds nothing, because the first cleared it.
        _syncState();
        _settleRedemption(user);

        _creditDeposit(user, msg.value, upperHint, lowerHint);
        _borrow(user, amount, upperHint, lowerHint);
    }

    /**
     * @notice Repay MUSD. Never pausable — an exit must always be open.
     * @dev Needs no price. Repaying more than you owe repays exactly what you owe.
     */
    function repay(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        address user = _msgSender();
        _syncState();
        _settleRedemption(user);
        uint256 repaid = _repay(user, amount, upperHint, lowerHint);
        emit Repaid(user, repaid, debtOf(user));
    }

    /**
     * @notice Approve and repay in one call, so the separate approval transaction disappears.
     * @dev MUSD is EIP-2612. Verified against the deployed matsnet token rather than against
     *      Mezo's documentation, which this project does not trust on its own: the runtime
     *      bytecode at 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 contains the selector
     *      0xd505accf for the canonical
     *      `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)`, and a static call
     *      to it with an expired deadline reverts with OpenZeppelin's
     *      `ERC2612ExpiredSignature(uint256)` rather than falling through a fallback. See
     *      IMUSD.sol for the full record. `test_fork_composedEntrypointsAgainstTheRealContracts`
     *      signs against that token's own DOMAIN_SEPARATOR and repays through it.
     *
     *      THE PERMIT IS TRY/CATCHED ON PURPOSE, and this is the one part worth reading twice.
     *      A permit signature sits in the public mempool, and anyone at all can lift it and
     *      submit it straight to MUSD ahead of this transaction. That is not an attack on the
     *      user's funds, because the permit only ever grants an allowance to THIS contract,
     *      and submitting it does exactly what the user signed for. What it does is consume
     *      the nonce, so the inner `permit` here reverts on a signature that has already done
     *      its job, and a perfectly valid repayment would fail for a reason the user cannot
     *      act on. Swallowing that failure and continuing is the standard mitigation.
     *
     *      It is not a way to repay on someone else's behalf without authorisation. The
     *      allowance is the authorisation, and the `safeTransferFrom` inside `_repay` still
     *      demands a real one; if the permit genuinely failed and no allowance exists, that
     *      transfer reverts with MUSD's own `ERC20InsufficientAllowance`. Same shape and same
     *      reasoning as `MarenPay.payWithPermit`; if you change one, change both.
     *
     *      The permit runs before the state sync only because that mirrors MarenPay. The order
     *      cannot matter: `permit` touches nothing in this contract, and anything that reverts
     *      afterwards unwinds it along with everything else.
     *
     *      ONE CAVEAT, stated rather than buried. The permit is signed for `amount`, so closing
     *      out with `type(uint256).max` means signing a permit for `type(uint256).max`, and
     *      MUSD, like every OpenZeppelin ERC-20, treats a maximum allowance as infinite and
     *      never decrements it, leaving this contract permanently approved. `_repay` still
     *      transfers only the debt, so nothing extra moves in this call, but the standing
     *      approval outlives it. To close out without that, sign for the exact figure
     *      `previewDebtOf` reports plus a small margin for the interest that accrues between
     *      signing and landing, and pass that same figure as `amount`; repaying more than you
     *      owe repays exactly what you owe.
     */
    function repayWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address upperHint,
        address lowerHint
    ) external nonReentrant {
        address user = _msgSender();
        _applyPermit(user, amount, deadline, v, r, s);
        _syncState();
        _settleRedemption(user);
        uint256 repaid = _repay(user, amount, upperHint, lowerHint);
        emit Repaid(user, repaid, debtOf(user));
    }

    /**
     * @notice Withdraw collateral. Never pausable.
     * @dev Requires a price only if you still owe MUSD, or if the BTC has to come out of the
     *      trove. A debt-free user whose BTC is sitting idle can always leave, oracle or no
     *      oracle.
     */
    function withdraw(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        address user = _msgSender();
        // The reconciliation happens BEFORE the balance is read, so a withdrawal racing a
        // redemption is measured against the post-redemption entitlement, never the stale one.
        _syncState();
        _settleRedemption(user);
        _withdraw(user, amount, upperHint, lowerHint);
        emit Withdrawn(user, amount, collateral[user]);
    }

    /// @notice Repay everything owed and take back all remaining collateral, in one call.
    function closePosition(address upperHint, address lowerHint) external nonReentrant {
        address user = _msgSender();
        _syncState();
        _settleRedemption(user);

        uint256 repaid = _repay(user, type(uint256).max, upperHint, lowerHint);
        uint256 coll = collateral[user];
        if (coll > 0) _withdraw(user, coll, upperHint, lowerHint);

        emit PositionClosed(user, repaid, coll);
    }

    // ------------------------------------------------------------------ //
    //                             Liquidation                            //
    // ------------------------------------------------------------------ //

    /**
     * @notice Internally liquidate a user below 140%. The caller supplies the MUSD and
     *         receives collateral worth exactly what they repaid; the 5% penalty goes to the
     *         insurance buffer, not to the liquidator.
     * @dev KEEPER_ROLE only, and deliberately so. An open liquidation market would be more
     *      decentralised, but a public liquidator that profits from the penalty has an
     *      incentive to push users over the line, and at 140% there is nothing to arbitrage
     *      against — the protocol itself is happy at 110%. Maren runs this at cost.
     *
     *      If the position is underwater beyond what its collateral can cover, this repays
     *      as much as the collateral supports and records the remainder as bad debt rather
     *      than pretending it was collected.
     */
    function liquidateUser(address user, address upperHint, address lowerHint)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        _syncState();
        // Both ledgers this touches have to be current before anything is computed from them:
        // the defaulter's, and the protocol's own position that receives the penalty.
        _settleRedemption(user);
        _settleRedemption(address(this));
        Liquidation memory m = _computeLiquidation(user);
        address liquidator = _msgSender();

        // Effects. The penalty stays inside the vault as protocol-owned collateral; only the
        // portion matching the repaid debt actually leaves.
        collateral[user] = m.coll - m.seized;
        collateral[address(this)] += m.penalty;
        insuranceCollateralAccrued += m.penalty;
        totalCollateral -= m.collForDebt;

        _burnDebtShares(user, m.repayAmount, m.debt);
        uint256 residual = m.debt - m.repayAmount;
        if (residual > 0) {
            badDebtRecognised += residual;
            emit BadDebtRecognised(user, residual);
        }

        // Interactions.
        IERC20(address(musd)).safeTransferFrom(liquidator, address(this), m.repayAmount);
        reserveMUSD += m.repayAmount;
        _pushRepayment(type(uint256).max, upperHint, lowerHint);
        _sendCollateral(liquidator, m.collForDebt, upperHint, lowerHint);

        emit Liquidated(user, liquidator, m.repayAmount, m.collForDebt, m.penalty);
    }

    /// @dev Split out of `liquidateUser` to keep it under the stack limit, and because the
    ///      arithmetic is the part worth reading on its own.
    function _computeLiquidation(address user) private view returns (Liquidation memory m) {
        uint256 price = _price();

        m.debt = debtOf(user);
        if (m.debt == 0) revert NothingToLiquidate(user);

        m.coll = collateral[user];
        uint256 cr = _collateralRatio(m.coll, m.debt, price);
        if (cr >= LIQUIDATION_CR) revert PositionHealthy(cr, LIQUIDATION_CR);

        // The most we can repay while still covering the penalty out of this user's own
        // collateral: repay * (1 + 5%) <= collateralValue. Anything above this is a shortfall
        // the liquidator would eat, so it is recorded as bad debt instead.
        uint256 collValue = Math.mulDiv(m.coll, price, WAD, Math.Rounding.Floor);
        uint256 maxRepay = Math.mulDiv(collValue, BPS, BPS + LIQUIDATION_PENALTY_BPS, Math.Rounding.Floor);
        m.repayAmount = m.debt < maxRepay ? m.debt : maxRepay;
        if (m.repayAmount == 0) revert NothingToLiquidate(user);

        m.collForDebt = Math.mulDiv(m.repayAmount, WAD, price, Math.Rounding.Floor);
        m.penalty = Math.mulDiv(m.collForDebt, LIQUIDATION_PENALTY_BPS, BPS, Math.Rounding.Floor);
        m.seized = m.collForDebt + m.penalty;
        if (m.seized > m.coll) {
            m.seized = m.coll;
            m.penalty = m.seized - m.collForDebt;
        }
    }

    // ------------------------------------------------------------------ //
    //                          Keeper operations                         //
    // ------------------------------------------------------------------ //

    /**
     * @notice Open the pooled trove with protocol-owned seed collateral.
     * @dev The seed debt is credited to `address(this)`, so the protocol carries its own
     *      origination fee and its share of interest exactly like any user. Because the
     *      drawn MUSD stays here as `reserveMUSD`, the vault's outstanding debt immediately
     *      after this call is only the borrowing fee.
     */
    function openPooledTrove(uint256 seedDebt, address upperHint, address lowerHint)
        external
        payable
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (troveOpen) revert TroveAlreadyOpen();
        if (seedDebt < MIN_NET_DEBT) revert SeedDebtBelowProtocolMinimum(seedDebt, MIN_NET_DEBT);
        if (msg.value == 0) revert ZeroAmount();
        _price(); // fail with PriceFeedUnavailable() rather than BorrowerOperations' revert
        _settleRedemption(address(this));

        uint256 newTotal = totalCollateral + msg.value;
        if (newTotal > depositCap) revert DepositCapExceeded(newTotal, depositCap);

        collateral[address(this)] += msg.value;
        totalCollateral = newTotal;
        troveOpen = true;

        borrowerOperations.openTrove{value: msg.value}(seedDebt, upperHint, lowerHint);
        reserveMUSD += seedDebt;

        // Whatever the protocol actually charged (fee, rounding, anything) becomes the
        // protocol's own debt. Measured, not assumed.
        _mintDebtShares(address(this), 0);

        emit PooledTroveOpened(msg.value, seedDebt);
    }

    /// @notice Push idle BTC into the trove. The usual reason it is idle is that the oracle
    ///         was stale when it was deposited.
    function topUpCollateral(uint256 amount, address upperHint, address lowerHint)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (!troveOpen) revert TroveNotOpen();
        _syncState();
        if (amount == 0 || amount > idleCollateral) revert InsufficientCollateral(amount, idleCollateral);
        _price();
        idleCollateral -= amount;
        borrowerOperations.addColl{value: amount}(upperHint, lowerHint);
        emit CollateralPushedToTrove(amount);
    }

    /**
     * @notice Move reserve MUSD into the trove, reducing the trove's actual debt.
     * @dev Changes NOTHING for users: `outstandingDebt` subtracts the reserve, so shifting
     *      MUSD from reserve to trove leaves it identical. What it does change is the trove's
     *      real ICR, which is the number the MUSD protocol liquidates on. This is the
     *      keeper's main lever in a drawdown.
     */
    function deleverage(uint256 amount, address upperHint, address lowerHint)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (!troveOpen) revert TroveNotOpen();
        if (amount == 0) revert ZeroAmount();
        if (amount > reserveMUSD) revert ReserveTooSmall(amount, reserveMUSD);
        _syncState();
        uint256 pushed = _pushRepayment(amount, upperHint, lowerHint);
        // A best-effort push that moved nothing is a failed deleverage, and a keeper reacting
        // to a drawdown has to learn that from the transaction rather than from a `Deleveraged`
        // event carrying a zero it will not read. The two ways to get here are the trove
        // already sitting at the 1,800 MUSD floor and `repayMUSD` reverting, most often on a
        // stale oracle; `RepaymentPushFailed` distinguishes them.
        if (pushed == 0) revert NothingRepaid();
        emit Deleveraged(pushed, reserveMUSD);
    }

    /**
     * @notice Bring the vault's books in line with the live trove: apply any redemption that
     *         has landed on the pooled trove, then recompute the interest index.
     * @dev Callable by anyone, permissionlessly, and it needs no price, so it still works
     *      while Mezo's oracle is down. Nobody has to call it for the vault to be correct:
     *      every user-facing mutation runs the same code first. It exists so a keeper, an
     *      indexer or a passing stranger can make the public view functions exact without
     *      having to transact against a position.
     */
    function reconcileRedemption() external nonReentrant {
        _syncState();
    }

    /**
     * @notice Write one account's share of past redemptions into its ledger balance.
     * @dev Also permissionless, and for the same reason it is safe to be: settling can only
     *      move an account from its stale balance to the entitlement every view already
     *      reports, and it is what that account's own next transaction would do anyway.
     *      Nobody needs to call this. It exists so a keeper can flush an account that has gone
     *      quiet, which is what turns an unrecognised shortfall on an underwater position into
     *      a recorded one.
     */
    function settleRedemption(address account) external nonReentrant {
        _syncState();
        _settleRedemption(account);
    }

    /// @notice Recompute the interest index from the live trove, reconciling any redemption
    ///         first. Callable by anyone. Kept under its original name because the deployed
    ///         SDK and keeper call it; it is `reconcileRedemption()` by another name.
    function syncTrove() external nonReentrant {
        _syncState();
    }

    /**
     * @notice Reset the trove's interest rate to the current global rate and raise its
     *         `maxBorrowingCapacity`.
     * @dev On Mezo `maxBorrowingCapacity` is frozen at the BTC price when the trove opened;
     *      adding collateral does not raise it and `refinance()` is the ONLY thing that does.
     *      A pooled trove that has been open across a large BTC rally will hit that ceiling
     *      long before it hits any collateral limit. Blocked by the protocol in Recovery Mode.
     */
    function refinancePooledTrove(address upperHint, address lowerHint)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (!troveOpen) revert TroveNotOpen();
        _price();
        _syncState();
        _settleRedemption(address(this));
        borrowerOperations.refinance(upperHint, lowerHint);
        // The refinancing fee lands on the trove as new debt; charge it to the protocol's
        // own position rather than to users.
        _mintDebtShares(address(this), _accountedDebt());
        emit Refinanced(troveManager.getTroveMaxBorrowingCapacity(address(this)));
    }

    /// @notice Add protocol-owned BTC to strengthen the trove. Counted as the protocol's own
    ///         collateral, so it can be withdrawn again by admin only, subject to the same
    ///         health checks as any user.
    /// @dev H-2 residual make-whole. If a redemption drained the protocol's own position past
    ///      zero, `_recogniseShortfall` recorded the uncovered part against `address(this)` and
    ///      credited it to `totalCollateral` as phantom BTC so the ledger still summed. Real BTC
    ///      deposited here retires that phantom FIRST: it lowers `redemptionShortfall` in lockstep
    ///      (or `_booksInTrove` would under-report and miss a later redemption) WITHOUT
    ///      re-crediting `totalCollateral` or any account, because that collateral was a loss the
    ///      protocol already took. Only the remainder becomes fresh, claimable protocol collateral.
    function depositProtocolCollateral(address upperHint, address lowerHint)
        external
        payable
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (msg.value == 0) revert ZeroAmount();
        _syncState();
        _settleRedemption(address(this));

        uint256 shortfall = redemptionShortfall;
        uint256 cover = msg.value < shortfall ? msg.value : shortfall;
        uint256 credited = msg.value - cover;
        if (cover > 0) redemptionShortfall = shortfall - cover;
        if (credited > 0) {
            collateral[address(this)] += credited;
            totalCollateral += credited;
        }
        idleCollateral += msg.value;
        _tryPushCollateral(msg.value, upperHint, lowerHint);
        emit ProtocolCollateralAdded(msg.value);
    }

    // ------------------------------------------------------------------ //
    //                          Admin operations                          //
    // ------------------------------------------------------------------ //

    /**
     * @notice Emergency: close the pooled trove and hold all collateral here as idle BTC.
     * @dev Only once every user has repaid — the protocol's `closeTrove` demands the full net
     *      debt in MUSD. After this, users withdraw from idle collateral with no oracle
     *      dependency at all, which is the safest possible wind-down state.
     *
     *      The vault is always slightly SHORT of that number by construction: the seed trove's
     *      0.1% origination fee and its share of accrued interest are real debt for which no
     *      MUSD was ever minted to this contract. The caller covers that shortfall out of
     *      their own balance, which is correct — it is the protocol's own cost of having kept
     *      the pool open, and it must not be taken out of user collateral.
     */
    function closePooledTrove() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (!troveOpen) revert TroveNotOpen();
        _syncState();
        // The protocol's own shares are about to be deleted, so its share of any outstanding
        // redemption has to be charged to it before they are.
        _settleRedemption(address(this));

        uint256 userShares = totalDebtShares - debtShares[address(this)];
        if (userShares > 0) revert OutstandingUserDebt(userShares);

        (, uint256 netDebt) = _troveCollAndNetDebt();
        uint256 held = IERC20(address(musd)).balanceOf(address(this));
        if (netDebt > held) {
            IERC20(address(musd)).safeTransferFrom(_msgSender(), address(this), netDebt - held);
        }

        uint256 balanceBefore = address(this).balance;
        borrowerOperations.closeTrove();
        uint256 returned = address(this).balance - balanceBefore;

        troveOpen = false;
        idleCollateral += returned;
        // The trove is gone, so the protocol's remaining debt shares are gone with it.
        totalDebtShares -= debtShares[address(this)];
        debtShares[address(this)] = 0;
        reserveMUSD = IERC20(address(musd)).balanceOf(address(this));

        emit PooledTroveClosed(returned);
    }

    /**
     * @notice Credit unattributed BTC sitting in this contract to the insurance buffer.
     * @dev This is the only function here that derives state from `address(this).balance`, so
     *      it is the only one a re-entrant call could feed a balance the ledger has not caught
     *      up with. It cannot: the EVM debits the value at CALL time, so by the moment a
     *      withdrawal recipient's `receive` hook runs, `_sendCollateral` has already lowered
     *      `idleCollateral` AND the BTC has already left, and `skim()` reverts with
     *      `NothingToSkim`. `test_skim_cannotBeReenteredFromAWithdrawal` pins that.
     *
     *      `nonReentrant` is here as belt-and-braces anyway, because it makes the statement
     *      "every mutation on this contract is guarded" true without a footnote, and because
     *      the argument above depends on an EVM detail rather than on anything local.
     *
     *      It is also the only mutation that does not `_syncState()` first, deliberately: it
     *      is a recovery tool and has to keep working when the pooled trove has left the active
     *      state. The consequence is that its `_settleRedemption` call can be a no-op against a
     *      per-share figure an unreconciled redemption has not bumped yet. That is harmless:
     *      the debit is priced off debt shares, which this function does not touch, so it lands
     *      identically on the next sync.
     */
    function skim() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 surplus = address(this).balance - idleCollateral;
        if (surplus == 0) revert NothingToSkim();
        _settleRedemption(address(this));
        collateral[address(this)] += surplus;
        totalCollateral += surplus;
        idleCollateral += surplus;
        insuranceCollateralAccrued += surplus;
        emit Skimmed(surplus);
    }

    /**
     * @notice Move protocol-owned collateral (seed + insurance) out of the pooled trove.
     *         Subject to the same 180% floor as any user, so the buffer can never be drained
     *         out from under one.
     * @dev READ THIS BEFORE CALLING IT. This does NOT pay the admin. `_withdraw` sends to the
     *      account it debits, and the account here is `address(this)`, so the BTC is pulled out
     *      of the trove and then sent to this contract from this contract: a no-op transfer.
     *      What actually happens is that `collateral[address(this)]`, `totalCollateral` and
     *      `idleCollateral` all fall by `amount` while the contract's real BTC balance does
     *      not, turning `amount` of protocol-owned collateral into unattributed surplus.
     *      `skim()` credits that surplus straight back, so nothing is lost, but nothing is
     *      withdrawn either. Paying an external recipient needs a recipient argument and an
     *      explicit decision to open an admin exit; see docs/audit/CONTRACTS-AUDIT.md M-1.
     */
    function withdrawProtocolCollateral(uint256 amount, address upperHint, address lowerHint)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        _syncState();
        _settleRedemption(address(this));
        _withdraw(address(this), amount, upperHint, lowerHint);
    }

    /**
     * @notice Halt new deposits.
     * @dev Note what this function CANNOT do. There is no global pause on this contract and
     *      no modifier on `withdraw`, `repay`, `closePosition` or `liquidateUser`. Entries
     *      and exits are separate switches by construction, not by convention, so no
     *      guardian key — compromised or not — can trap a user's collateral.
     */
    function setDepositsPaused(bool paused) external onlyRole(GUARDIAN_ROLE) {
        depositsPaused = paused;
        emit DepositsPausedSet(paused);
    }

    /// @notice Halt new borrowing. Same guarantee as `setDepositsPaused`: exits stay open.
    function setBorrowingPaused(bool paused) external onlyRole(GUARDIAN_ROLE) {
        borrowingPaused = paused;
        emit BorrowingPausedSet(paused);
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    // ------------------------------------------------------------------ //
    //                                Views                               //
    // ------------------------------------------------------------------ //

    /// @notice MUSD owed by `user` at the last accrual. Rounds up, in the protocol's favour.
    function debtOf(address user) public view returns (uint256) {
        return Math.mulDiv(debtShares[user], interestIndex, WAD, Math.Rounding.Ceil);
    }

    /// @notice `debtOf` including interest that has accrued since the last accrual. This is
    ///         the number a UI should show; `debtOf` is the number storage currently holds.
    function previewDebtOf(address user) external view returns (uint256) {
        return Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
    }

    /**
     * @notice BTC `user` can actually claim, after any redemption that has landed on the
     *         pooled trove, whether or not anyone has reconciled it yet.
     * @dev This, not the raw `collateral` mapping, is what a UI should show and what every
     *      other view here is computed from. The two are equal except in the window between a
     *      redemption landing and that account's next transaction, and in that window the
     *      mapping is the stale one.
     */
    function collateralOf(address user) external view returns (uint256) {
        return _effectiveCollateral(user);
    }

    /// @notice Collateral `user` still owes to redemptions it has not settled. The difference
    ///         between `collateral(user)` and `collateralOf(user)`.
    function pendingRedemptionDebitOf(address user) external view returns (uint256) {
        return _pendingRedemptionDebit(user);
    }

    /// @notice BTC that has left the pooled trove to a redemption and is not on the books yet.
    ///         Anyone can clear it with `reconcileRedemption()`, and any user action does.
    function pendingRedemptionCollateral() external view returns (uint256) {
        return _pendingRedemptionCollateral();
    }

    /// @notice Collateral ratio, 1e18 scaled. `type(uint256).max` when the user has no debt.
    /// @dev Reverts with `PriceFeedUnavailable()` when Mezo's oracle is stale.
    function collateralRatioOf(address user) external view returns (uint256) {
        return _collateralRatio(
            _effectiveCollateral(user),
            Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil),
            _price()
        );
    }

    /// @notice True when the user is below Maren's internal 140% threshold.
    function isLiquidatable(address user) external view returns (bool) {
        uint256 debt = Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
        if (debt == 0) return false;
        return _collateralRatio(_effectiveCollateral(user), debt, _price()) < LIQUIDATION_CR;
    }

    /**
     * @notice Additional MUSD `user` may borrow before hitting the 180% floor.
     * @dev Ignores the trove-level ICR check and the protocol's `maxBorrowingCapacity`, either
     *      of which may bind first. Rounds DOWN, matching the SDK's discipline.
     *
     *      The pooled analogue of `maxNetDebtAt` in packages/sdk/src/position.ts, and it
     *      differs from it for the same reason `collateralRequiredForDebt` does: no per-user
     *      gas compensation, and no origination fee on the portion served from `reserveMUSD`.
     *      A borrow large enough to draw from the trove DOES pay the 0.1% fee, which is added
     *      to the borrower's debt and puts them fractionally under 180% if they borrow exactly
     *      this number. That fee is governable, so modelling it here would be modelling a
     *      value that can change underneath us; the UI targets 250%, not 180%, and carries its
     *      own buffer. The counterpart comment lives on `maxNetDebtAt` in
     *      packages/sdk/src/position.ts; if you change either, change both.
     */
    function maxBorrowable(address user) external view returns (uint256) {
        uint256 price = _price();
        uint256 maxDebt = Math.mulDiv(_effectiveCollateral(user), price, MIN_BORROW_CR, Math.Rounding.Floor);
        uint256 debt = Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
        return maxDebt > debt ? maxDebt - debt : 0;
    }

    /**
     * @notice BTC needed to support `debt` MUSD of POOLED debt at `targetCr`.
     * @dev Rounds UP, deliberately: rounding down would quote a user a collateral figure that
     *      leaves them a wei short of the ratio they asked for, and the borrow would revert.
     *      Same discipline as `collateralRequiredFor` in packages/sdk/src/position.ts, and the
     *      same core expression — `ceil(debt * targetCr / price)`.
     *
     *      THE ONE DELIBERATE DIFFERENCE FROM THE SDK, so nobody "fixes" it: the SDK's
     *      function takes a trove's NET debt and grosses it up by the 0.1% origination fee and
     *      the 200 MUSD gas compensation, because that is what a DIRECT trove carries. A
     *      POOLED position carries neither — there is one gas compensation for the whole
     *      pooled trove, already paid by the protocol's own seed position, and a borrow served
     *      from `reserveMUSD` pays no origination fee at all. `debtOf(user)` is therefore the
     *      complete debt, and grossing it up here would over-quote every pooled user by 200
     *      MUSD of collateral they do not owe.
     *
     *      So: pass a POOLED debt figure (e.g. `debtOf(user)`) to this function, and use the
     *      SDK's `collateralRequiredFor` for the direct-trove route. `assessBorrowRoute` is
     *      what decides which of the two a given user is being quoted. The counterpart comment
     *      lives on `collateralRequiredFor` in packages/sdk/src/position.ts; if you change
     *      either, change both.
     *
     *      Sanity anchor, at the live oracle price of $63,071.83: a DIRECT trove's total debt
     *      at open (1,800 net + 1.8 fee + 200 gas comp = 2,001.8) at 250% needs 0.079346 BTC
     *      (~$5,004.50). This vault's floor is 0.001 BTC — 79.3x lower. That gap is the entire
     *      reason MarenVault exists.
     */
    function collateralRequiredForDebt(uint256 debt, uint256 targetCr) external view returns (uint256) {
        if (debt == 0) return 0;
        return Math.mulDiv(debt, targetCr, _price(), Math.Rounding.Ceil);
    }

    /**
     * @notice BTC/USD price at which `user` becomes internally liquidatable at 140%.
     * @dev Rounds UP: it is safer to tell a user liquidation is nearer than it is. Returns 0
     *      for a user with no debt (they can never be liquidated) and `type(uint256).max` for
     *      a user with debt and no collateral (they already are).
     */
    function liquidationPriceOf(address user) external view returns (uint256) {
        uint256 debt = Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
        if (debt == 0) return 0;
        uint256 coll = _effectiveCollateral(user);
        if (coll == 0) return type(uint256).max;
        return Math.mulDiv(debt, LIQUIDATION_CR, coll, Math.Rounding.Ceil);
    }

    /// @notice What the vault owes the MUSD protocol right now, net of gas compensation and
    ///         the MUSD reserve. This is the number the interest index tracks.
    function outstandingDebt() external view returns (uint256) {
        return _outstandingDebt();
    }

    /// @notice Debt attributed to shareholders at the current index. Compare with
    ///         `outstandingDebt()` — the difference is accumulated rounding, and it must
    ///         always be non-negative.
    function accountedDebt() external view returns (uint256) {
        return _accountedDebt();
    }

    /// @notice The pooled trove's own collateral, debt and ICR, straight from TroveManager.
    function troveStatus() external view returns (uint256 coll, uint256 netDebt, uint256 icr) {
        if (!troveOpen) return (0, 0, type(uint256).max);
        (coll, netDebt) = _troveCollAndNetDebt();
        icr = troveManager.getCurrentICR(address(this), _price());
    }

    /// @notice Mezo's per-trove borrow ceiling, fixed at the price when the trove was opened.
    ///         Only `refinancePooledTrove` raises it.
    function troveMaxBorrowingCapacity() external view returns (uint256) {
        return troveOpen ? troveManager.getTroveMaxBorrowingCapacity(address(this)) : 0;
    }

    // ------------------------------------------------------------------ //
    //                       Internals — accounting                       //
    // ------------------------------------------------------------------ //

    /// @dev Trove collateral and net debt, INCLUDING pending redistributions and EXCLUDING
    ///      the 200 MUSD gas compensation. Uses the 6-return Mezo variant, not Liquity's 4.
    function _troveCollAndNetDebt() private view returns (uint256 coll, uint256 netDebt) {
        // Mezo includes each pending redistribution in the first three totals.
        // The final three values describe a subset, not additional balances.
        (uint256 c, uint256 principal, uint256 interest,,,) = troveManager.getEntireDebtAndColl(address(this));
        coll = c;
        uint256 gross = principal + interest;
        netDebt = gross > MUSD_GAS_COMPENSATION ? gross - MUSD_GAS_COMPENSATION : 0;
    }

    function _outstandingDebt() private view returns (uint256) {
        if (!troveOpen) return 0;
        (, uint256 netDebt) = _troveCollAndNetDebt();
        uint256 reserve = reserveMUSD;
        return netDebt > reserve ? netDebt - reserve : 0;
    }

    function _accountedDebt() private view returns (uint256) {
        return Math.mulDiv(totalDebtShares, interestIndex, WAD, Math.Rounding.Floor);
    }

    /**
     * @dev The index a view should quote: what `_syncState()` would set if it ran right now.
     *      That is the redemption re-peg first, then the interest accrual, in the same order
     *      and with the same rounding as the real thing. Without the first step every view on
     *      this contract would over-report debt between a redemption and the next transaction.
     */
    function _previewIndex() private view returns (uint256 index) {
        index = interestIndex;
        uint256 shares = totalDebtShares;
        if (shares == 0) return index;

        uint256 outstanding = _outstandingDebt();
        if (_pendingRedemptionCollateral() > 0) {
            uint256 accounted = _accountedDebt();
            if (accounted > outstanding) {
                index = Math.mulDiv(index, outstanding, accounted, Math.Rounding.Ceil);
                if (index == 0) index = 1;
            }
        }

        uint256 candidate = Math.mulDiv(outstanding, WAD, shares, Math.Rounding.Ceil);
        if (candidate > index) index = candidate;
    }

    /**
     * @dev How much collateral the books say is sitting inside the pooled trove right now.
     *
     *      `redemptionShortfall` comes out because it is credited collateral that is KNOWN not
     *      to exist: `_recogniseShortfall` adds an uncollectable debit back to
     *      `totalCollateral` so the per-account ledger still sums to it, which leaves the books
     *      permanently that much above the protocol's real holdings. Leaving it in would make
     *      the redemption detector read that same gap as a brand new redemption on the very
     *      next sync, charge it pro rata to every remaining debt-share holder, and repeat on
     *      every sync after that until the shortfall had been socialised onto exactly the users
     *      it was recorded to protect.
     *
     *      Both callers use this, so the detector and the view that previews it can never
     *      disagree about what counts.
     */
    function _booksInTrove() private view returns (uint256) {
        uint256 elsewhere = idleCollateral + redemptionShortfall;
        return totalCollateral > elsewhere ? totalCollateral - elsewhere : 0;
    }

    /// @dev BTC that has left the pooled trove without the vault asking, and has not been
    ///      reconciled yet. Zero in the ordinary case, and zero once anyone transacts.
    function _pendingRedemptionCollateral() private view returns (uint256) {
        if (!troveOpen) return 0;
        if (troveManager.getTroveStatus(address(this)) != TROVE_STATUS_ACTIVE) return 0;
        (uint256 troveColl,) = _troveCollAndNetDebt();
        uint256 booksInTrove = _booksInTrove();
        return troveColl >= booksInTrove ? 0 : booksInTrove - troveColl;
    }

    /// @dev The per-share debit a view should quote, including a redemption nobody has
    ///      reconciled yet, so `collateralOf` is right the instant the redemption lands.
    function _previewCollateralPerShare() private view returns (uint256 perShare) {
        perShare = redemptionCollateralPerShare;
        uint256 shares = totalDebtShares;
        if (shares == 0) return perShare;
        uint256 pending = _pendingRedemptionCollateral();
        if (pending == 0) return perShare;
        // Preview only the share-holders' portion, exactly as `_reconcileRedemption` will split
        // it (audit H-2): the excess the protocol's own position absorbs is not spread per share,
        // so a per-user view would over-charge in the window before anyone reconciles without it.
        (, uint256 netDebt) = _troveCollAndNetDebt();
        uint256 accounted = _accountedDebt();
        uint256 outstanding = _outstandingDebt();
        uint256 debtRemoved = accounted > outstanding ? accounted - outstanding : 0;
        uint256 excess = _redemptionExcessCollateral(pending, debtRemoved, netDebt);
        perShare += Math.mulDiv(pending - excess, REDEMPTION_PRECISION, shares, Math.Rounding.Ceil);
    }

    /// @dev What `account` can actually claim: its ledger balance less every redemption debit
    ///      it has not settled yet, floored at zero.
    function _effectiveCollateral(address account) private view returns (uint256) {
        uint256 coll = collateral[account];
        uint256 debit = _pendingRedemptionDebit(account);
        return debit >= coll ? 0 : coll - debit;
    }

    function _pendingRedemptionDebit(address account) private view returns (uint256) {
        uint256 perShare = _previewCollateralPerShare();
        uint256 snapshot = redemptionSnapshot[account];
        if (perShare <= snapshot) return 0;
        uint256 shares = debtShares[account];
        if (shares == 0) return 0;
        return Math.mulDiv(shares, perShare - snapshot, REDEMPTION_PRECISION, Math.Rounding.Ceil);
    }

    // ------------------------------------------------------------------ //
    //                Internals: the redemption splitter                  //
    // ------------------------------------------------------------------ //

    /// @dev The single entry point every mutation runs first: reconcile a redemption, then
    ///      accrue interest, in that order. Reconciling first matters, because the accrual
    ///      compares accounted debt against a trove figure that the redemption has changed.
    function _syncState() private {
        _reconcileRedemption();
        _accrue();
    }

    /// @dev Halts everything if the pooled trove has left the active state. See the REDEMPTIONS
    ///      note at the top of this file for why this is a hard stop and not a fallback.
    function _requireTroveActive() private view {
        uint256 status = troveManager.getTroveStatus(address(this));
        if (status != TROVE_STATUS_ACTIVE) revert TroveNoLongerActive(status);
    }

    /**
     * @dev Detects a redemption by comparing the books against the live trove, and rolls it
     *      through every position at once.
     *
     *      Only a SHORTFALL is a redemption. A trove holding MORE collateral than the books
     *      expect is a redistribution gain from someone else's liquidation, which is a
     *      windfall, not a loss, and is left alone for `skim()` rather than distributed here.
     *
     *      The debt side is only touched when the collateral side moved. Accounted debt sits a
     *      few wei above outstanding debt in normal operation, as the rounding surplus the
     *      accrual deliberately keeps; re-pegging the index on that alone would hand the
     *      surplus back to users on every single call.
     *
     *      H-2 (FIXED). The debt relief handed to users is capped at what they owe
     *      (`accounted`), because that is all the index can cancel. When a redemption cancels
     *      MORE trove debt than the pool's users owe, which needs `reserveMUSD` to be non-zero
     *      because `outstanding = troveNetDebt - reserveMUSD`, the surplus relief accrues to the
     *      reserve, which no share-holder can claim. The collateral that paid for that surplus is
     *      NO LONGER split across users: the portion matching relief that landed in the reserve
     *      is charged to the protocol's own position, mirroring the `shares == 0` branch, so each
     *      debtor loses collateral worth exactly the debt it stopped owing (value neutral per
     *      position). The removed KNOWN LIMIT was that this excess was socialised onto users.
     *      RESIDUAL: if the protocol's own position cannot cover the excess, the remainder falls
     *      to `_recogniseShortfall(address(this))`, and `depositProtocolCollateral` retires that
     *      shortfall. Written up as H-2 in docs/audit/CONTRACTS-AUDIT.md.
     */
    function _reconcileRedemption() private {
        if (!troveOpen) return;
        _requireTroveActive();

        (uint256 troveColl, uint256 troveNetDebt) = _troveCollAndNetDebt();
        uint256 booksInTrove = _booksInTrove();
        if (troveColl >= booksInTrove) return;

        uint256 collateralRemoved = booksInTrove - troveColl;
        uint256 shares = totalDebtShares;
        uint256 oldIndex = interestIndex;
        uint256 debtRemoved;

        if (shares == 0) {
            // A redemption with no debt shares outstanding. There is nobody it can be charged
            // to pro rata, so the protocol's own collateral absorbs it and any remainder is
            // recognised. In practice unreachable: a redemption needs trove debt to cancel,
            // and trove debt with no shares means the reserve alone backs it.
            uint256 own = collateral[address(this)];
            uint256 charged = own < collateralRemoved ? own : collateralRemoved;
            collateral[address(this)] = own - charged;
            _recogniseShortfall(address(this), collateralRemoved - charged);
        } else {
            uint256 accounted = _accountedDebt();
            uint256 outstanding = _outstandingDebt();
            if (accounted > outstanding) {
                // `debtRemoved` is the redemption plus whatever rounding surplus the accrual
                // had banked, which is bounded by `totalDebtShares / 1e18` wei and is handed
                // back here. It cannot break `sum(debtOf) >= outstandingDebt`, which is
                // re-established below by construction, and it is worth roughly 1e-15 MUSD
                // per 1,000 MUSD of pooled debt. Measuring the relief from the trove is worth
                // more than defending dust of that size.
                debtRemoved = accounted - outstanding;
                // The one downward move the index ever makes, by exactly the measured relief
                // and no more. Rounding UP keeps `sum(debtOf) >= outstandingDebt` intact, and
                // the floor at 1 keeps `_mintDebtShares` from dividing by zero after a
                // redemption that cancelled every last unit of user debt.
                uint256 newIndex = Math.mulDiv(oldIndex, outstanding, accounted, Math.Rounding.Ceil);
                interestIndex = newIndex == 0 ? 1 : newIndex;
            }
            // H-2. The reserve may have absorbed relief no share-holder can claim; the collateral
            // that paid for it must not be split across users. `_redemptionExcessCollateral` is
            // that portion, and the protocol's own position absorbs it exactly as the `shares == 0`
            // branch does, falling to the shortfall path if the position cannot cover it.
            uint256 excess = _redemptionExcessCollateral(collateralRemoved, debtRemoved, troveNetDebt);
            if (excess > 0) {
                uint256 own = collateral[address(this)];
                uint256 charged = own < excess ? own : excess;
                collateral[address(this)] = own - charged;
                _recogniseShortfall(address(this), excess - charged);
            }
            // Rounding UP the per-share debit means the debits collectively exceed what left
            // the trove, so the dust stays in the pool rather than in a withdrawer's pocket.
            // The overshoot is bounded by `totalDebtShares / REDEMPTION_PRECISION` wei of BTC,
            // which is what one unit of per-share error is worth across every holder.
            redemptionCollateralPerShare += Math.mulDiv(
                collateralRemoved - excess, REDEMPTION_PRECISION, shares, Math.Rounding.Ceil
            );
        }

        totalCollateral -= collateralRemoved;
        totalCollateralRedeemed += collateralRemoved;
        totalDebtRedeemed += debtRemoved;

        emit RedemptionReconciled(
            collateralRemoved, debtRemoved, oldIndex, interestIndex, redemptionCollateralPerShare
        );
    }

    /// @dev The part of a redemption's `collateralRemoved` that corresponds to relief the reserve
    ///      absorbed rather than any share-holder (audit H-2). Non-zero only when the redemption
    ///      drove `outstandingDebt` to its reserve-clamped floor: then `reserveMUSD` over-covers
    ///      the trove by `reserveMUSD - netDebt`, MUSD credited to nobody. The collateral matching
    ///      it is that same fraction of `collateralRemoved`, since `collateralRemoved` is worth
    ///      `debtRemoved + excessRelief` of cancelled trove debt. Rounds the protocol's share UP so
    ///      no share-holder's collateral loss can exceed the value of the debt it stopped owing.
    function _redemptionExcessCollateral(uint256 collateralRemoved, uint256 debtRemoved, uint256 netDebt)
        private
        view
        returns (uint256)
    {
        uint256 reserve = reserveMUSD;
        uint256 excessRelief = reserve > netDebt ? reserve - netDebt : 0;
        if (excessRelief == 0) return 0;
        uint256 reliefTotal = debtRemoved + excessRelief;
        if (reliefTotal == 0) return 0;
        uint256 excess = Math.mulDiv(collateralRemoved, excessRelief, reliefTotal, Math.Rounding.Ceil);
        return excess < collateralRemoved ? excess : collateralRemoved;
    }

    /**
     * @dev Charges `account` its share of every redemption since it was last touched. O(1),
     *      and it must run BEFORE anything reads that account's collateral or changes its debt
     *      shares, because the debit is priced against the shares held when the redemption
     *      happened.
     */
    function _settleRedemption(address account) private {
        uint256 perShare = redemptionCollateralPerShare;
        uint256 snapshot = redemptionSnapshot[account];
        if (snapshot == perShare) return;

        redemptionSnapshot[account] = perShare;
        uint256 shares = debtShares[account];
        if (shares == 0) return;

        uint256 owed = Math.mulDiv(shares, perShare - snapshot, REDEMPTION_PRECISION, Math.Rounding.Ceil);
        if (owed == 0) return;

        uint256 coll = collateral[account];
        if (owed > coll) {
            // Only reachable below 100% collateralisation: the debit is the value of the debt
            // this account stopped owing, so it can only exceed the collateral held if that
            // collateral was already worth less than the debt.
            _recogniseShortfall(account, owed - coll);
            owed = coll;
        }

        collateral[account] = coll - owed;
        emit RedemptionSettled(account, owed, coll - owed);
    }

    /// @dev Puts an uncharged redemption debit back on the books instead of quietly spreading
    ///      it across the other users. `totalCollateral` is credited back so the per-account
    ///      ledger never sums to more than it, which would brick withdrawals on an underflow.
    ///      That credit is the reason `_booksInTrove` subtracts `redemptionShortfall`: read
    ///      that comment before touching either.
    function _recogniseShortfall(address account, uint256 amount) private {
        if (amount == 0) return;
        redemptionShortfall += amount;
        totalCollateral += amount;
        emit RedemptionShortfallRecognised(account, amount);
    }

    /**
     * @dev Distribute the trove's debt growth across all shares. The index is monotonic here:
     *      it never falls, so a rounding surplus already charged to users is absorbed by the
     *      next interest accrual rather than refunded, and `sum(debtOf) >= outstandingDebt`
     *      holds for the life of the contract. `_reconcileRedemption` is the one and only
     *      thing that moves it the other way, and only by a measured amount.
     */
    function _accrue() private {
        uint256 shares = totalDebtShares;
        if (shares == 0) return;
        uint256 outstanding = _outstandingDebt();
        uint256 candidate = Math.mulDiv(outstanding, WAD, shares, Math.Rounding.Ceil);
        uint256 current = interestIndex;
        if (candidate > current) {
            interestIndex = candidate;
            emit InterestAccrued(current, candidate, outstanding);
        }
    }

    /// @dev Mints shares for however much the trove's outstanding debt actually grew. Rounds
    ///      up, so the borrower absorbs the rounding.
    function _mintDebtShares(address user, uint256 outstandingBefore) private returns (uint256 delta) {
        uint256 outstandingAfter = _outstandingDebt();
        if (outstandingAfter <= outstandingBefore) return 0;
        delta = outstandingAfter - outstandingBefore;
        uint256 shares = Math.mulDiv(delta, WAD, interestIndex, Math.Rounding.Ceil);
        debtShares[user] += shares;
        totalDebtShares += shares;
    }

    /// @dev Burns shares for `amount` repaid. Rounds down, so the repayer keeps the rounding
    ///      dust as debt rather than being credited with more than they paid.
    function _burnDebtShares(address user, uint256 amount, uint256 fullDebt)
        private
        returns (uint256 shares)
    {
        uint256 held = debtShares[user];
        if (amount >= fullDebt) {
            shares = held;
        } else {
            shares = Math.mulDiv(amount, WAD, interestIndex, Math.Rounding.Floor);
            if (shares > held) shares = held;
        }
        debtShares[user] = held - shares;
        totalDebtShares -= shares;
    }

    // ------------------------------------------------------------------ //
    //                       Internals — operations                       //
    // ------------------------------------------------------------------ //

    /**
     * @dev Everything `deposit` checks BEFORE the state sync, and it stays before it. On a pool
     *      whose trove has left the active state `_syncState` reverts with
     *      `TroveNoLongerActive`, so moving these two behind it would change a paused or
     *      undersized deposit's revert reason in exactly the case a user most needs the honest
     *      one. `depositAndBorrow` gets the same ordering by calling the same function.
     */
    function _requireDepositAllowed(uint256 amount) private view {
        if (depositsPaused) revert DepositsArePaused();
        if (amount < MIN_DEPOSIT) revert DepositBelowMinimum(amount, MIN_DEPOSIT);
    }

    /**
     * @dev The deposit itself, after the sync. The cap is measured HERE and not alongside the
     *      other two checks, because a redemption shrinks `totalCollateral`, and a deposit that
     *      only fits once the reconciliation has landed has to be allowed to fit.
     */
    function _creditDeposit(address user, uint256 amount, address upperHint, address lowerHint) private {
        uint256 newTotal = totalCollateral + amount;
        if (newTotal > depositCap) revert DepositCapExceeded(newTotal, depositCap);

        collateral[user] += amount;
        totalCollateral = newTotal;
        idleCollateral += amount;

        bool pushed = _tryPushCollateral(amount, upperHint, lowerHint);
        emit Deposited(user, amount, collateral[user], pushed);
    }

    /// @dev Everything `borrow` checks before the state sync, for the same reason as
    ///      `_requireDepositAllowed`.
    function _requireBorrowAllowed(uint256 amount) private view {
        if (borrowingPaused) revert BorrowingIsPaused();
        if (amount == 0) revert ZeroAmount();
        if (!troveOpen) revert TroveNotOpen();
    }

    /**
     * @dev The borrow itself, after the sync. THE ONLY COPY of this arithmetic in the contract:
     *      `borrow` and `depositAndBorrow` both land here, so there is no second version to
     *      drift out of step with the first.
     *
     *      It reads `collateral[user]` for the 180% check, which means whatever the caller
     *      credited before calling it is counted. `borrow` credits nothing, so the check is on
     *      the standing position; `depositAndBorrow` credits the deposit first, so the check is
     *      on the post-deposit position. Both are correct and both are the same code.
     */
    function _borrow(address user, uint256 amount, address upperHint, address lowerHint) private {
        uint256 price = _price();

        uint256 outstandingBefore = _outstandingDebt();
        uint256 reserve = reserveMUSD;
        bool fromReserve = reserve >= amount;
        if (fromReserve) {
            reserveMUSD = reserve - amount;
        } else {
            reserveMUSD = 0;
            // Drawing more debt mints MUSD to this contract and adds amount + fee to the trove.
            borrowerOperations.withdrawMUSD(amount - reserve, upperHint, lowerHint);
        }

        uint256 debtAdded = _mintDebtShares(user, outstandingBefore);

        uint256 userDebt = debtOf(user);
        uint256 cr = _collateralRatio(collateral[user], userDebt, price);
        if (cr < MIN_BORROW_CR) revert InsufficientCollateralRatio(cr, MIN_BORROW_CR);

        uint256 troveCr = troveManager.getCurrentICR(address(this), price);
        if (troveCr < MIN_TROVE_CR) revert TroveCollateralRatioTooLow(troveCr, MIN_TROVE_CR);

        IERC20(address(musd)).safeTransfer(user, amount);
        emit Borrowed(user, amount, debtAdded, userDebt, fromReserve);
    }

    /// @dev See `repayWithPermit` for why a failure here is swallowed rather than bubbled.
    function _applyPermit(address owner, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        private
    {
        try musd.permit(owner, address(this), amount, deadline, v, r, s) {}
            catch {
            // Permit already consumed (front-run) or otherwise unusable. If the allowance is
            // genuinely missing, the transferFrom inside `_repay` reverts, which is correct.
        }
    }

    function _repay(address user, uint256 amount, address upperHint, address lowerHint)
        private
        returns (uint256 repaid)
    {
        uint256 debt = debtOf(user);
        if (debt == 0) revert NoDebt();
        repaid = amount > debt ? debt : amount;
        if (repaid == 0) revert ZeroAmount();

        _burnDebtShares(user, repaid, debt);

        IERC20(address(musd)).safeTransferFrom(user, address(this), repaid);
        reserveMUSD += repaid;
        _pushRepayment(type(uint256).max, upperHint, lowerHint);
    }

    function _withdraw(address user, uint256 amount, address upperHint, address lowerHint) private {
        if (amount == 0) revert ZeroAmount();
        uint256 coll = collateral[user];
        if (amount > coll) revert InsufficientCollateral(amount, coll);

        uint256 debt = debtOf(user);
        if (debt > 0) {
            uint256 cr = _collateralRatio(coll - amount, debt, _price());
            if (cr < MIN_BORROW_CR) revert InsufficientCollateralRatio(cr, MIN_BORROW_CR);
        }

        collateral[user] = coll - amount;
        totalCollateral -= amount;
        _sendCollateral(user, amount, upperHint, lowerHint);
    }

    /// @dev Idle BTC first, then out of the trove. Pulling from the trove needs a price, so
    ///      the named error is raised before BorrowerOperations can produce an opaque one.
    function _sendCollateral(address to, uint256 amount, address upperHint, address lowerHint) private {
        if (amount == 0) return;
        uint256 idle = idleCollateral;
        if (idle < amount) {
            uint256 need = amount - idle;
            if (!troveOpen) revert InsufficientCollateral(amount, idle);
            _price();
            uint256 balanceBefore = address(this).balance;
            borrowerOperations.withdrawColl(need, upperHint, lowerHint);
            uint256 received = address(this).balance - balanceBefore;
            idle += received;
        }
        idleCollateral = idle - amount;
        Address.sendValue(payable(to), amount);
    }

    function _tryPushCollateral(uint256 amount, address upperHint, address lowerHint) private returns (bool) {
        if (!troveOpen || amount == 0) {
            emit CollateralHeldIdle(amount, idleCollateral);
            return false;
        }
        // The realistic failure here is a stale oracle inside BorrowerOperations. Falling back
        // to idle keeps the deposit working; the BTC never leaves this contract either way.
        try borrowerOperations.addColl{value: amount}(upperHint, lowerHint) {
            idleCollateral -= amount;
            emit CollateralPushedToTrove(amount);
            return true;
        } catch (bytes memory reason) {
            // "Held idle" alone cannot be acted on: a keeper cannot tell a stale oracle, which
            // fixes itself, from a revert nobody anticipated, which does not. The selector
            // goes out with the event so the two are distinguishable off-chain.
            emit CollateralPushFailed(amount, _revertSelector(reason));
            emit CollateralHeldIdle(amount, idleCollateral);
            return false;
        }
    }

    /// @dev First four bytes of revert data: an error selector, a `Error(string)` selector for
    ///      a require, or zero when the callee reverted with nothing at all.
    function _revertSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            selector := and(
                mload(add(reason, 0x20)),
                0xffffffff00000000000000000000000000000000000000000000000000000000
            )
        }
    }

    /**
     * @dev Move up to `maxAmount` of the MUSD reserve into the trove. Best effort by design:
     *      it stops at the protocol's 1,800 minimum net debt and tolerates a stale oracle,
     *      because a repayment must settle for the user whether or not the trove can absorb
     *      it right now. `outstandingDebt` is unchanged either way.
     */
    function _pushRepayment(uint256 maxAmount, address upperHint, address lowerHint)
        private
        returns (uint256 pushed)
    {
        uint256 reserve = reserveMUSD;
        if (!troveOpen || reserve == 0 || maxAmount == 0) return 0;

        (, uint256 netDebt) = _troveCollAndNetDebt();
        if (netDebt <= MIN_NET_DEBT) return 0;
        uint256 room = netDebt - MIN_NET_DEBT;

        pushed = reserve < room ? reserve : room;
        if (pushed > maxAmount) pushed = maxAmount;
        if (pushed == 0) return 0;

        try borrowerOperations.repayMUSD(pushed, upperHint, lowerHint) {
            reserveMUSD = reserve - pushed;
        } catch (bytes memory reason) {
            emit RepaymentPushFailed(pushed, _revertSelector(reason));
            pushed = 0;
        }
    }

    // ------------------------------------------------------------------ //
    //                        Internals — pricing                         //
    // ------------------------------------------------------------------ //

    /**
     * @dev Every price read in this contract goes through here so that a stale Mezo oracle
     *      surfaces as `PriceFeedUnavailable()` and never as an unattributable revert from
     *      three contracts deep. A zero price is treated as unavailable rather than trusted.
     */
    function _price() private view returns (uint256) {
        try priceFeed.fetchPrice() returns (uint256 price) {
            if (price == 0) revert PriceFeedUnavailable();
            return price;
        } catch {
            revert PriceFeedUnavailable();
        }
    }

    function _collateralRatio(uint256 coll, uint256 debt, uint256 price) private pure returns (uint256) {
        if (debt == 0) return type(uint256).max;
        return Math.mulDiv(coll, price, debt, Math.Rounding.Floor);
    }

    // ------------------------------------------------------------------ //
    //                          ERC-2771 plumbing                         //
    // ------------------------------------------------------------------ //

    function _msgSender() internal view override(ERC2771Context, Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(ERC2771Context, Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(ERC2771Context, Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
