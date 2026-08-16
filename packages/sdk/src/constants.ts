/**
 * MUSD protocol risk parameters.
 *
 * Every value here was read LIVE from Mezo mainnet on 2026-08-15, not copied from
 * docs. Where the deployed code and the official docs disagree, the code wins and
 * the disagreement is called out — see DOC_DISCREPANCIES below.
 *
 * MUSD is a fork of Threshold USD, itself a fork of Liquity v1. It DIVERGES from
 * Liquity in ways that break ported frontends — see LIQUITY_DIVERGENCES.
 */

/** 1e18 fixed-point scalar used throughout the protocol. */
export const WAD = 10n ** 18n;

/** Minimum Collateral Ratio — liquidation threshold. 110%. Hardcoded `constant`, NOT governable. */
export const MCR = 1_100_000_000_000_000_000n; // 1.1e18

/** Critical Collateral Ratio — Recovery Mode threshold. 150%. Hardcoded `constant`, NOT governable. */
export const CCR = 1_500_000_000_000_000_000n; // 1.5e18

/** Maximum LTV implied by MCR (1/1.1). ~90.9%. */
export const MAX_LTV_BPS = 9090;

/**
 * Minimum NET debt a trove may carry: 1,800 MUSD.
 * Total debt at open is this + 200 MUSD gas compensation = 2,000 MUSD minimum.
 *
 * THIS IS THE SINGLE BIGGEST CONSUMER-ONBOARDING CONSTRAINT ON MEZO.
 * At a safe 200% CR and $63k BTC it requires ~0.063 BTC (~$4,000) of collateral to
 * open a position at all. Maren's pooled vault exists to abstract this away.
 */
export const MIN_NET_DEBT = 1_800n * WAD;

/** Escrowed at open, refunded on close, paid to the liquidator on liquidation. 200 MUSD. */
export const MUSD_GAS_COMPENSATION = 200n * WAD;

/** Minimum TOTAL debt at open = MIN_NET_DEBT + gas compensation. */
export const MIN_TOTAL_DEBT = MIN_NET_DEBT + MUSD_GAS_COMPENSATION;

/** Origination fee: 0.1%. Governable with a 7-day delay. */
export const BORROWING_RATE = 1_000_000_000_000_000n; // 1e15
export const BORROWING_RATE_BPS = 10;

/** Redemption fee: 0.75%, taken in BTC, paid to the PCV. Governable, 7-day delay. */
export const REDEMPTION_RATE = 7_500_000_000_000_000n; // 7.5e15
export const REDEMPTION_RATE_BPS = 75;

/**
 * Ongoing interest: 1.00% APR, SIMPLE (non-compounding), FIXED for the life of the loan.
 * A trove keeps the rate it opened at forever; global rate changes do not touch it.
 */
export const INTEREST_RATE_BPS = 100;

/** Liquidator's share of seized collateral: 0.5% (PERCENT_DIVISOR = 200). */
export const LIQUIDATOR_COLLATERAL_BPS = 50;

/** Governance timelock on all governable parameters. */
export const GOVERNANCE_MIN_DELAY_SECONDS = 604_800; // 7 days

/**
 * PriceFeed.fetchPrice() REVERTS if the oracle is older than this.
 * Every borrow/adjust/liquidate/redeem path reverts with it — the UI must have an
 * explicit "price feed unavailable" state rather than showing a stale number.
 */
export const ORACLE_MAX_PRICE_DELAY_SECONDS = 60;

/**
 * Maren's own, deliberately stricter, per-user safety rails. These are OUR product
 * policy, not protocol constants — we keep users far away from the 110% cliff.
 */
export const MAREN_POLICY = {
  /** Below this we refuse to let a user borrow more. */
  minHealthyCr: 1_800_000_000_000_000_000n, // 180%
  /** Default CR the UI targets when a user drags the "borrow" slider to "recommended". */
  targetCr: 2_500_000_000_000_000_000n, // 250%
  /** We warn hard below this. */
  warnCr: 1_600_000_000_000_000_000n, // 160%
  /** Internal liquidation trigger for the pooled vault — well above protocol MCR. */
  vaultLiquidationCr: 1_400_000_000_000_000_000n, // 140%
} as const;

/**
 * MarenVault's own on-chain constants, mirrored from `packages/contracts/src/MarenVault.sol`.
 *
 * These are not policy — they are the literal `constant`s the deployed contract checks
 * before it reverts, transcribed so the interface can evaluate the same conditions BEFORE
 * a user signs rather than after they have paid for the answer. `MAREN_POLICY` above is
 * what Maren recommends; this is what the contract enforces. They currently agree at 180%,
 * and the duplication is deliberate: if governance ever moved one, silently reusing the
 * other would put a slider's hard stop on the wrong side of a revert.
 *
 * Verified against matsnet on 2026-08-16 by reading the public getters:
 *   MIN_DEPOSIT 1e15 · MIN_BORROW_CR 1.8e18 · MIN_TROVE_CR 1.8e18 · LIQUIDATION_CR 1.4e18
 */
export const MAREN_VAULT = {
  /** `MIN_DEPOSIT` — 0.001 BTC. Below it `deposit` reverts with DepositBelowMinimum. */
  minDeposit: 10n ** 15n,
  /** `MIN_BORROW_CR` — the floor YOUR position must clear. InsufficientCollateralRatio. */
  minBorrowCr: 1_800_000_000_000_000_000n,
  /**
   * `MIN_TROVE_CR` — the floor the SHARED trove must clear after any borrow.
   *
   * This is the constraint that closes borrowing for everyone at once, and it is checked
   * unconditionally: even a borrow served entirely from `reserveMUSD`, which adds no trove
   * debt at all, is refused while the pooled trove sits under it.
   */
  minTroveCr: 1_800_000_000_000_000_000n,
  /** `LIQUIDATION_CR` — where Maren's own keeper liquidates a pooled position. */
  liquidationCr: 1_400_000_000_000_000_000n,
} as const;

/**
 * Ways MUSD differs from Liquity v1. Ignoring any of these produces silent failures
 * or reverts that are very hard to debug. Kept in code because it is integration-critical.
 */
export const LIQUITY_DIVERGENCES = [
  'No `_maxFeePercentage` parameter on openTrove/adjustTrove/withdrawMUSD. Rates are flat + timelocked, so slippage protection is unnecessary — but a ported ABI will not match.',
  'PriceFeed.fetchPrice() is `view` and REVERTS on >60s staleness. There is NO `lastGoodPrice()` getter; the LastGoodPriceUpdated event is vestigial.',
  '`maxBorrowingCapacity` is a Mezo-only per-trove ceiling fixed at the price when the trove was opened. Adding collateral does NOT raise it — only refinance() does. Always show TroveManager.getTroveMaxBorrowingCapacity() as the real borrow limit, never an ICR-derived number.',
  'No `baseRate` accumulator and no redemption-fee decay. No getRedemptionRateWithDecay(), no REDEMPTION_FEE_FLOOR().',
  'Recovery Mode does NOT expand liquidations to higher CRs. The liquidation threshold stays 110% in both modes; Recovery Mode only forces new loans to open at >=150% and blocks refinance().',
  'Collateral is native BTC passed as msg.value, not an ERC-20. There is no approve step for collateral.',
  'Debt is split into principal + interest. getEntireDebtAndColl returns 6 values, not Liquity v1 4.',
] as const;

/**
 * Places where Mezo's published docs contradict the deployed bytecode.
 * We follow the CODE. Surfaced here so nobody "fixes" our implementation to match a doc.
 */
export const DOC_DISCREPANCIES = [
  'Docs claim borrowers with an outstanding loan pay a ZERO redemption fee. The deployed TroveManager applies getRedemptionRate() unconditionally — `isAccountFeeExempt` appears only in BorrowerOperations, never in TroveManager. DO NOT promise a borrower redemption-fee waiver in the UI.',
  'Docs list the refinance fee as 0.1%. The code computes refinancingFeePercentage (20%) of old net debt, then a 0.1% borrowing fee on THAT — an effective ~0.02% of old net debt.',
  'Total MUSD supply (~31.1M) materially exceeds trove-backed debt (~1.6M) plus the outstanding PCV bootstrap loan (~15.0M). The remainder sits in protocol-owned strategies and the Wormhole NTT bridge. The "100% Bitcoin-backed" claim is true of the CDP portion but NOT of most circulating MUSD today. Do not repeat a blanket backing claim to users.',
] as const;
