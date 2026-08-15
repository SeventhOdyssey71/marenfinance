// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
 * DESIGN NOTE (EIP-7702): `deposit`, `borrow`, `repay` and `withdraw` are separate,
 * independently callable entrypoints rather than one monolithic `depositAndBorrow`, so a
 * 7702-delegated account can batch permit + deposit + borrow + pay in a single transaction.
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

    /// @notice Monotonically non-decreasing. Starts at 1e18.
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
    event Borrowed(address indexed user, uint256 amount, uint256 debtAdded, uint256 newDebt, bool fromReserve);
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
        if (depositsPaused) revert DepositsArePaused();
        uint256 amount = msg.value;
        if (amount < MIN_DEPOSIT) revert DepositBelowMinimum(amount, MIN_DEPOSIT);

        uint256 newTotal = totalCollateral + amount;
        if (newTotal > depositCap) revert DepositCapExceeded(newTotal, depositCap);

        address user = _msgSender();
        _accrue();

        collateral[user] += amount;
        totalCollateral = newTotal;
        idleCollateral += amount;

        bool pushed = _tryPushCollateral(amount, upperHint, lowerHint);
        emit Deposited(user, amount, collateral[user], pushed);
    }

    /**
     * @notice Draw MUSD against your collateral. Refused below 180%.
     * @dev Served from `reserveMUSD` when possible — that is what makes a 50 MUSD loan
     *      possible against a protocol whose minimum is 1,800.
     */
    function borrow(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        if (borrowingPaused) revert BorrowingIsPaused();
        if (amount == 0) revert ZeroAmount();
        if (!troveOpen) revert TroveNotOpen();

        address user = _msgSender();
        _accrue();
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

    /**
     * @notice Repay MUSD. Never pausable — an exit must always be open.
     * @dev Needs no price. Repaying more than you owe repays exactly what you owe.
     */
    function repay(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        address user = _msgSender();
        _accrue();
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
        _accrue();
        _withdraw(user, amount, upperHint, lowerHint);
        emit Withdrawn(user, amount, collateral[user]);
    }

    /// @notice Repay everything owed and take back all remaining collateral, in one call.
    function closePosition(address upperHint, address lowerHint) external nonReentrant {
        address user = _msgSender();
        _accrue();

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
        _accrue();
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
        uint256 pushed = _pushRepayment(amount, upperHint, lowerHint);
        emit Deleveraged(pushed, reserveMUSD);
    }

    /// @notice Recompute the interest index from the live trove. Callable by anyone; it can
    ///         only ever move the index in the protocol's favour.
    function syncTrove() external nonReentrant {
        _accrue();
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
        _accrue();
        borrowerOperations.refinance(upperHint, lowerHint);
        // The refinancing fee lands on the trove as new debt; charge it to the protocol's
        // own position rather than to users.
        _mintDebtShares(address(this), _accountedDebt());
        emit Refinanced(troveManager.getTroveMaxBorrowingCapacity(address(this)));
    }

    /// @notice Add protocol-owned BTC to strengthen the trove. Counted as the protocol's own
    ///         collateral, so it can be withdrawn again by admin only, subject to the same
    ///         health checks as any user.
    function depositProtocolCollateral(address upperHint, address lowerHint)
        external
        payable
        onlyRole(KEEPER_ROLE)
        nonReentrant
    {
        if (msg.value == 0) revert ZeroAmount();
        _accrue();
        collateral[address(this)] += msg.value;
        totalCollateral += msg.value;
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
        _accrue();

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

    /// @notice Credit unattributed BTC sitting in this contract to the insurance buffer.
    function skim() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 surplus = address(this).balance - idleCollateral;
        if (surplus == 0) revert NothingToSkim();
        collateral[address(this)] += surplus;
        totalCollateral += surplus;
        idleCollateral += surplus;
        insuranceCollateralAccrued += surplus;
        emit Skimmed(surplus);
    }

    /// @notice Withdraw protocol-owned collateral (seed + insurance). Subject to the same
    ///         180% floor as any user, so the buffer can never be drained out from under one.
    function withdrawProtocolCollateral(uint256 amount, address upperHint, address lowerHint)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        _accrue();
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

    /// @notice Collateral ratio, 1e18 scaled. `type(uint256).max` when the user has no debt.
    /// @dev Reverts with `PriceFeedUnavailable()` when Mezo's oracle is stale.
    function collateralRatioOf(address user) external view returns (uint256) {
        return _collateralRatio(collateral[user], Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil), _price());
    }

    /// @notice True when the user is below Maren's internal 140% threshold.
    function isLiquidatable(address user) external view returns (bool) {
        uint256 debt = Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
        if (debt == 0) return false;
        return _collateralRatio(collateral[user], debt, _price()) < LIQUIDATION_CR;
    }

    /// @notice Additional MUSD `user` may borrow before hitting the 180% floor. Ignores the
    ///         trove-level checks and the protocol's `maxBorrowingCapacity`, either of which
    ///         may bind first.
    function maxBorrowable(address user) external view returns (uint256) {
        uint256 price = _price();
        uint256 maxDebt = Math.mulDiv(collateral[user], price, MIN_BORROW_CR, Math.Rounding.Floor);
        uint256 debt = Math.mulDiv(debtShares[user], _previewIndex(), WAD, Math.Rounding.Ceil);
        return maxDebt > debt ? maxDebt - debt : 0;
    }

    /**
     * @notice BTC needed to support `debt` MUSD at `targetCr`.
     * @dev Rounds UP, deliberately. Rounding this down would quote a user a collateral figure
     *      that leaves them one wei short of the ratio they asked for, and the borrow would
     *      then revert. Matches `collateralRequiredFor` in packages/sdk/src/position.ts —
     *      the SDK and this contract must never disagree, or the UI quotes numbers the
     *      contract rejects.
     *
     *      Sanity anchor, at the live oracle price of $63,071.83: reaching MUSD's 1,800 MUSD
     *      minimum net debt at 250% needs 0.079346 BTC (~$5,004.50). This vault's floor is
     *      0.001 BTC — 79.3x lower. That gap is the entire reason MarenVault exists.
     */
    function collateralRequiredFor(uint256 debt, uint256 targetCr) external view returns (uint256) {
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
        uint256 coll = collateral[user];
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
        (uint256 c, uint256 principal, uint256 interest, uint256 pendColl, uint256 pendPrincipal, uint256 pendInterest)
        = troveManager.getEntireDebtAndColl(address(this));
        coll = c + pendColl;
        uint256 gross = principal + interest + pendPrincipal + pendInterest;
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

    function _previewIndex() private view returns (uint256 index) {
        index = interestIndex;
        uint256 shares = totalDebtShares;
        if (shares == 0) return index;
        uint256 candidate = Math.mulDiv(_outstandingDebt(), WAD, shares, Math.Rounding.Ceil);
        if (candidate > index) index = candidate;
    }

    /**
     * @dev Distribute the trove's debt growth across all shares. The index is monotonic: it
     *      never falls, so a rounding surplus already charged to users is absorbed by the next
     *      interest accrual rather than refunded, and `sum(debtOf) >= outstandingDebt` holds
     *      for the life of the contract.
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
    function _burnDebtShares(address user, uint256 amount, uint256 fullDebt) private returns (uint256 shares) {
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
        } catch {
            emit CollateralHeldIdle(amount, idleCollateral);
            return false;
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
        } catch {
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
