// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {IStabilityPool} from "./interfaces/IStabilityPool.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title MarenEarn
 * @author Maren Finance
 * @notice ERC-4626 vault over MUSD that deposits into the MUSD Stability Pool.
 *
 * WHAT THE YIELD ACTUALLY IS — do not let a UI round this off:
 *   The Stability Pool has NO token emissions. The only return is liquidation gains: when a
 *   trove is liquidated, depositors' MUSD is burned to absorb its debt and they receive its
 *   BTC collateral at a discount. That means the return is (a) lumpy, arriving in discrete
 *   liquidation events, (b) negative in MUSD terms and positive in BTC terms at the moment it
 *   happens, and (c) impossible to quote as a fixed APY. Maren shows trailing realised yield,
 *   labelled as backward-looking. Anyone who advertises a forward APY on this is guessing.
 *
 * THE BTC PROBLEM, STATED HONESTLY:
 *   Gains arrive as native BTC, but this vault's unit of account is MUSD. Converting requires
 *   a DEX, and as of 2026-08-15 Maren has not verified one exists on Mezo that can do it. So:
 *
 *     - `swapRouter` is `address(0)` at deployment and `harvest()` simply HOLDS the BTC.
 *     - Held BTC is counted in `totalAssets()` at the oracle price, so shareholders own it
 *       and it is not stranded — but the vault is then partially BTC-denominated and its
 *       share price moves with BTC. That is a real, deliberate exposure, not an accident.
 *     - When governance sets a router it has reviewed, `harvest()` starts converting to MUSD
 *       and compounding back into the Stability Pool, and the exposure goes away.
 *
 *   `totalAssets()` never reverts. If Mezo's oracle is stale it falls back to the last price
 *   observed during a harvest, and if no price has ever been observed it values held BTC at
 *   ZERO. Valuing at zero understates the vault, which costs a redeemer and protects everyone
 *   who stays — the safe direction. It is still a stale price being used for share pricing,
 *   which is why `harvest()` refreshes it and why the router should be wired sooner rather
 *   than later. This is the least-bad option available on this chain today; it is not good.
 */
contract MarenEarn is ERC4626, AccessControl, ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Claims gains and (once a router exists) converts them.
    bytes32 public constant KEEPER_ROLE = keccak256("MAREN_KEEPER_ROLE");

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @notice Hard ceiling on the performance fee. Governance cannot exceed it.
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000; // 20%

    IStabilityPool public immutable stabilityPool;
    IPriceFeed public immutable priceFeed;

    /// @notice Unset by design. See the contract header before setting it.
    ISwapRouter public swapRouter;

    /// @notice Last BTC/USD price observed during a successful harvest. Fallback only.
    uint256 public lastObservedBtcPrice;
    uint64 public lastObservedBtcPriceAt;

    uint256 public performanceFeeBps;
    address public feeRecipient;

    /// @notice Ceiling on `totalAssets()`. Starts small on mainnet, raised as it proves out.
    uint256 public depositCap;

    event Harvested(uint256 btcClaimed, uint256 btcHeld, uint256 musdCompounded, uint256 feePaid);
    event SwapRouterSet(address indexed previous, address indexed current);
    event PerformanceFeeSet(uint256 bps, address indexed recipient);
    event DepositCapSet(uint256 cap);
    event EmergencyWithdrawnFromStabilityPool(uint256 amount);
    event BtcPriceObserved(uint256 price, uint64 at);

    error FeeTooHigh(uint256 bps, uint256 max);
    error ZeroAddress();
    error ZeroAmount();
    error DepositCapExceeded(uint256 attempted, uint256 cap);
    error SwapReturnedTooLittle(uint256 received, uint256 minimum);
    error NoRouterConfigured();
    error PriceFeedUnavailable();

    constructor(
        address musd_,
        address stabilityPool_,
        address priceFeed_,
        address trustedForwarder_,
        address admin_,
        uint256 depositCap_
    ) ERC20("Maren Earn MUSD", "mMUSD") ERC4626(IERC20(musd_)) ERC2771Context(trustedForwarder_) {
        if (musd_ == address(0) || stabilityPool_ == address(0) || priceFeed_ == address(0)) {
            revert ZeroAddress();
        }
        stabilityPool = IStabilityPool(stabilityPool_);
        priceFeed = IPriceFeed(priceFeed_);
        depositCap = depositCap_;
        feeRecipient = admin_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        emit DepositCapSet(depositCap_);
    }

    /// @notice Receives native BTC liquidation gains from the Stability Pool.
    receive() external payable {}

    // ------------------------------------------------------------------ //
    //                            ERC-4626 core                           //
    // ------------------------------------------------------------------ //

    /**
     * @notice MUSD idle here + MUSD in the Stability Pool + BTC (held and unclaimed) valued
     *         at the oracle price.
     * @dev Unclaimed Stability Pool gains are included on purpose. If they were excluded, a
     *      depositor could arrive one block before a harvest and capture a share of gains
     *      earned entirely before they were exposed to any risk.
     *
     *      This function must never revert — every ERC-4626 preview and every redemption
     *      depends on it, and on Mezo the oracle can simply stop for a minute at a time.
     */
    function totalAssets() public view override returns (uint256) {
        uint256 musdIdle = IERC20(asset()).balanceOf(address(this));
        uint256 musdInPool = stabilityPool.getCompoundedMUSDDeposit(address(this));
        uint256 btc = address(this).balance + stabilityPool.getDepositorCollateralGain(address(this));
        return musdIdle + musdInPool + _valueBtc(btc);
    }

    /// @dev Values BTC at the live oracle price, falling back to the last price seen during a
    ///      harvest, and to zero if there has never been one. Zero understates the vault,
    ///      which is the direction that cannot be exploited by a redeemer.
    function _valueBtc(uint256 btcAmount) internal view returns (uint256) {
        if (btcAmount == 0) return 0;
        uint256 price = lastObservedBtcPrice;
        try priceFeed.fetchPrice() returns (uint256 live) {
            if (live != 0) price = live;
        } catch {
            // Oracle stale. Fall through to the cached price.
        }
        if (price == 0) return 0;
        return Math.mulDiv(btcAmount, price, WAD, Math.Rounding.Floor);
    }

    /**
     * @dev Inflation-attack mitigation. With no offset, the first depositor can donate assets
     *      directly to the vault and round every subsequent small deposit down to zero shares.
     *      An offset of 3 makes that attack cost 1000x what it steals.
     */
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    function maxDeposit(address) public view override returns (uint256) {
        uint256 assets = totalAssets();
        return assets >= depositCap ? 0 : depositCap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == type(uint256).max ? type(uint256).max : convertToShares(assets);
    }

    /// @notice The most MUSD `owner` can actually take out right now.
    /// @dev ERC-4626 requires this to return an amount that will not revert, and the
    ///      inherited implementation does not: it returns the full share value, which
    ///      includes BTC this contract holds and cannot pay out in MUSD. There is no
    ///      BTC->MUSD path while `swapRouter` is unset, so that portion is a claim
    ///      nothing can settle, and quoting it hands the first redeemers MUSD for BTC
    ///      the later ones will not find. Capped at what is genuinely payable: idle
    ///      MUSD plus this vault's compounded Stability Pool deposit.
    ///
    ///      This does NOT model Mezo's other refusal — the Stability Pool rejects every
    ///      non-zero withdrawal while any trove chain-wide sits below MCR, which is a
    ///      condition no depositor caused and none can clear. Reading it here would cost
    ///      an oracle call on a view every client polls, so the app checks it separately
    ///      and this stays the payable-balance cap.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxWithdraw(owner);
        uint256 payable_ =
            IERC20(asset()).balanceOf(address(this)) + stabilityPool.getCompoundedMUSDDeposit(address(this));
        return byShares < payable_ ? byShares : payable_;
    }

    /// @notice Shares that can actually be redeemed right now. Mirrors `maxWithdraw`.
    /// @dev Returns the FULL balance whenever liquidity does not bind, rather than routing
    ///      every holder through `convertToShares`. That round trip loses a wei to floor
    ///      rounding, and the loss is not cosmetic: it made `redeem(balanceOf(owner))`
    ///      revert with `ERC4626ExceededMaxRedeem(owner, 999, 998)`, i.e. it blocked a
    ///      full exit for someone the vault could pay in full. Only convert when the
    ///      payable balance is genuinely the smaller number.
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 held = balanceOf(owner);
        uint256 payable_ =
            IERC20(asset()).balanceOf(address(this)) + stabilityPool.getCompoundedMUSDDeposit(address(this));
        if (super.maxWithdraw(owner) <= payable_) return held;
        uint256 shares = convertToShares(payable_);
        return shares < held ? shares : held;
    }

    /// @dev Deposits land in the Stability Pool immediately. If `provideToSP` reverts the
    ///      whole deposit reverts — unlike the vault's collateral path there is no reason to
    ///      accept MUSD we cannot put to work.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
        if (assets > 0) {
            IERC20(asset()).forceApprove(address(stabilityPool), assets);
            stabilityPool.provideToSP(assets);
        }
    }

    /// @dev Pulls from idle MUSD first, then out of the Stability Pool. Withdrawing from the
    ///      pool also sweeps any pending BTC gain into this contract, which is harmless and
    ///      slightly helpful.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            uint256 need = assets - idle;
            uint256 inPool = stabilityPool.getCompoundedMUSDDeposit(address(this));
            stabilityPool.withdrawFromSP(need < inPool ? need : inPool);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ------------------------------------------------------------------ //
    //                              Harvest                               //
    // ------------------------------------------------------------------ //

    /**
     * @notice Claim BTC liquidation gains and, if a router is configured, convert them to MUSD
     *         and compound back into the Stability Pool.
     * @param minMusdOut Slippage bound for the swap. Ignored when no router is set.
     * @dev KEEPER_ROLE because `minMusdOut` is a trust-critical input: a permissionless
     *      harvest with a caller-chosen minimum is an invitation to sandwich the vault. Note
     *      that anyone can still cause gains to be CLAIMED (not swapped) simply by depositing
     *      or withdrawing, since Stability Pool interactions always pay out pending gains —
     *      so a hostile keeper cannot strand value, only decline to convert it.
     */
    function harvest(uint256 minMusdOut, uint256 deadline)
        external
        onlyRole(KEEPER_ROLE)
        nonReentrant
        returns (uint256 btcClaimed, uint256 musdCompounded)
    {
        uint256 btcBefore = address(this).balance;
        stabilityPool.withdrawFromSP(0);
        btcClaimed = address(this).balance - btcBefore;

        _observePrice();

        uint256 btcHeld = address(this).balance;
        uint256 feePaid;
        if (address(swapRouter) != address(0) && btcHeld > 0) {
            uint256 musdBefore = IERC20(asset()).balanceOf(address(this));
            swapRouter.swapExactBtcForMusd{value: btcHeld}(minMusdOut, address(this), deadline);
            // Measure our own balance rather than trusting the router's return value.
            uint256 received = IERC20(asset()).balanceOf(address(this)) - musdBefore;
            if (received < minMusdOut) revert SwapReturnedTooLittle(received, minMusdOut);

            feePaid = Math.mulDiv(received, performanceFeeBps, BPS, Math.Rounding.Floor);
            if (feePaid > 0) IERC20(asset()).safeTransfer(feeRecipient, feePaid);

            musdCompounded = received - feePaid;
            if (musdCompounded > 0) {
                IERC20(asset()).forceApprove(address(stabilityPool), musdCompounded);
                stabilityPool.provideToSP(musdCompounded);
            }
            btcHeld = address(this).balance;
        }

        emit Harvested(btcClaimed, btcHeld, musdCompounded, feePaid);
    }

    /// @notice Refresh the cached BTC price used to value held BTC. Permissionless because it
    ///         can only ever replace a stale price with a fresher one from the same oracle.
    function pokePrice() external {
        _observePrice();
    }

    function _observePrice() internal {
        try priceFeed.fetchPrice() returns (uint256 live) {
            if (live != 0) {
                lastObservedBtcPrice = live;
                lastObservedBtcPriceAt = uint64(block.timestamp);
                emit BtcPriceObserved(live, uint64(block.timestamp));
            }
        } catch {
            // Oracle stale. Keep the old cached value; harvesting itself still works.
        }
    }

    // ------------------------------------------------------------------ //
    //                            Governance                              //
    // ------------------------------------------------------------------ //

    /**
     * @notice Wire a BTC -> MUSD router.
     * @dev The router receives native BTC and is trusted to return MUSD. `harvest` bounds the
     *      damage with `minMusdOut` and by measuring its own balance, but a malicious router
     *      can still refuse to trade or waste gas. Set only after review; this is a
     *      DEFAULT_ADMIN_ROLE action and should sit behind the same timelock as everything
     *      else that can touch value.
     */
    function setSwapRouter(address router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit SwapRouterSet(address(swapRouter), router);
        swapRouter = ISwapRouter(router);
    }

    function setPerformanceFee(uint256 bps, address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_PERFORMANCE_FEE_BPS) revert FeeTooHigh(bps, MAX_PERFORMANCE_FEE_BPS);
        if (recipient == address(0)) revert ZeroAddress();
        performanceFeeBps = bps;
        feeRecipient = recipient;
        emit PerformanceFeeSet(bps, recipient);
    }

    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    /**
     * @notice Pull MUSD out of the Stability Pool into this contract without changing anyone's
     *         share balance.
     * @dev For the case where the Stability Pool itself must be exited quickly. It cannot move
     *      assets out of the vault — `totalAssets()` counts idle MUSD exactly the same — so it
     *      is a de-risking lever, not a withdrawal path. Withdrawals stay open throughout.
     */
    function emergencyWithdrawFromStabilityPool(uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        uint256 inPool = stabilityPool.getCompoundedMUSDDeposit(address(this));
        uint256 pull = amount < inPool ? amount : inPool;
        if (pull == 0) revert ZeroAmount();
        stabilityPool.withdrawFromSP(pull);
        emit EmergencyWithdrawnFromStabilityPool(pull);
    }

    // ------------------------------------------------------------------ //
    //                                Views                               //
    // ------------------------------------------------------------------ //

    /// @notice Split of `totalAssets()`, for a UI that must show how much of this vault is
    ///         currently BTC-denominated rather than MUSD-denominated.
    function assetBreakdown()
        external
        view
        returns (uint256 musdIdle, uint256 musdInPool, uint256 btcHeld, uint256 btcPending, uint256 btcValued)
    {
        musdIdle = IERC20(asset()).balanceOf(address(this));
        musdInPool = stabilityPool.getCompoundedMUSDDeposit(address(this));
        btcHeld = address(this).balance;
        btcPending = stabilityPool.getDepositorCollateralGain(address(this));
        btcValued = _valueBtc(btcHeld + btcPending);
    }

    /// @notice True when held BTC is being valued at a cached rather than live price.
    function isUsingStalePrice() external view returns (bool) {
        try priceFeed.fetchPrice() returns (uint256 live) {
            return live == 0;
        } catch {
            return true;
        }
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
