import { paymentRequired, rateLimited, type RelayError } from './errors.js';

/**
 * The sponsorship policy. ONE module, not constants scattered across handlers.
 *
 * Mezo's base fee is 1,300,000 wei, so a 100,000-gas transaction costs about
 * $0.0092 at $63k BTC. Sponsorship is cheap. Abuse control is the actual problem,
 * so every number below is a *cap*, and a cap that cannot be read from config is
 * treated as zero, not as infinity (R8 — gates fail closed).
 */

/** MUSD has 18 decimals, same as the BTC gas token. */
const WAD = 10n ** 18n;

export interface SponsorshipPolicy {
  /** Lifetime free sponsored actions per address before an in-band fee is required. */
  readonly freeActionsPerAddress: number;
  /**
   * MUSD fee required once the free tier is spent, in wei.
   * `null` means "not configured" — post-free-tier relaying is then DENIED
   * outright rather than defaulting to free. A missing fee must never turn into
   * an unbounded subsidy.
   */
  readonly feeMusdWei: bigint | null;
  /** Hard cap on BTC (wei) this relayer may spend on gas in one UTC day, across all users. */
  readonly maxDailySpendWei: bigint;
  /** Per-address action cap per UTC day, independent of the free/paid split. */
  readonly maxActionsPerAddressPerDay: number;
  /** Per-IP action cap per UTC day. */
  readonly maxActionsPerIpPerDay: number;
  /** Largest `ForwardRequest.gas` we will accept. Bounds the blast radius of one call. */
  readonly maxGasPerRequest: bigint;
  /**
   * Tighter ceiling for contract-account (ERC-1271 / EIP-7702) signers, whose
   * signature validation runs arbitrary code inside the transaction we pay for.
   * Always <= `maxGasPerRequest`.
   */
  readonly maxGasContractSigner: bigint;
  /** Reject a signed request whose deadline is further out than this many seconds. */
  readonly maxDeadlineSeconds: number;
}

/**
 * Defaults are deliberately restrictive. Note what is NOT here: there is no
 * default `feeMusdWei` and no default `maxDailySpendWei`. Those two are the
 * only knobs that decide how much money we can lose, so they must be stated
 * explicitly by an operator. config.ts refuses to boot into an accepting state
 * without them.
 */
export const POLICY_DEFAULTS = {
  freeActionsPerAddress: 25,
  maxActionsPerAddressPerDay: 50,
  maxActionsPerIpPerDay: 200,
  maxGasPerRequest: 1_500_000n,
  maxGasContractSigner: 500_000n,
  maxDeadlineSeconds: 3600,
} as const;

export interface UsageSnapshot {
  /** Lifetime sponsored actions already consumed by this address. */
  readonly lifetimeActions: number;
  /** Actions by this address in the current UTC day. */
  readonly addressActionsToday: number;
  /** Actions from this IP in the current UTC day. */
  readonly ipActionsToday: number;
  /** BTC (wei) already spent on gas by this relayer in the current UTC day. */
  readonly spentTodayWei: bigint;
}

export interface PolicyInput {
  readonly usage: UsageSnapshot;
  /**
   * The `relayFee` decoded out of the SIGNED calldata. Never from the request
   * body. `null` means this call shape carries no readable in-band fee, which
   * closes the paid tier for it rather than making it free.
   */
  readonly signedFeeMusdWei: bigint | null;
  /** Upper bound on what this request could cost us, in wei. */
  readonly projectedGasCostWei: bigint;
}

export type SponsorshipMode = 'free-tier' | 'fee-paid';

export interface PolicyDecision {
  readonly mode: SponsorshipMode;
  /** Free actions left for this address AFTER this one is counted. */
  readonly freeActionsRemaining: number;
  /** The fee this request had to carry, in MUSD wei. Zero on the free tier. */
  readonly requiredFeeMusdWei: bigint;
}

export type PolicyResult =
  | { readonly ok: true; readonly decision: PolicyDecision }
  | { readonly ok: false; readonly error: RelayError };

/** Format MUSD wei for human-readable error detail. Display only. */
function musd(wei: bigint): string {
  const whole = wei / WAD;
  const frac = (wei % WAD).toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac} MUSD` : `${whole} MUSD`;
}

/**
 * Decide whether we are willing to pay for this request.
 *
 * Order matters: the cheapest, least user-specific checks first, so an attacker
 * cannot use expensive checks as an oracle. The global budget is checked before
 * anything user-specific because when it is exhausted the answer is the same for
 * everybody.
 *
 * Every rejection is a typed error naming the limit that stopped it (R16). None
 * of these paths falls through to "relay it anyway".
 */
export function evaluatePolicy(policy: SponsorshipPolicy, input: PolicyInput): PolicyResult {
  const { usage } = input;

  // --- global daily BTC budget ---------------------------------------------
  if (policy.maxDailySpendWei <= 0n) {
    return {
      ok: false,
      error: rateLimited(
        'GLOBAL_DAILY_BUDGET_EXHAUSTED',
        'No daily sponsorship budget is configured, so no request can be sponsored.',
        { limitWei: '0' },
      ),
    };
  }
  if (usage.spentTodayWei + input.projectedGasCostWei > policy.maxDailySpendWei) {
    return {
      ok: false,
      error: rateLimited(
        'GLOBAL_DAILY_BUDGET_EXHAUSTED',
        'The relayer has reached its global daily BTC gas budget. Relaying is halted until 00:00 UTC.',
        {
          limitWei: policy.maxDailySpendWei.toString(),
          spentWei: usage.spentTodayWei.toString(),
          projectedWei: input.projectedGasCostWei.toString(),
        },
      ),
    };
  }

  // --- per-IP daily cap ------------------------------------------------------
  if (usage.ipActionsToday >= policy.maxActionsPerIpPerDay) {
    return {
      ok: false,
      error: rateLimited('IP_RATE_LIMIT', 'This IP has reached its daily relay limit.', {
        limit: policy.maxActionsPerIpPerDay,
        used: usage.ipActionsToday,
      }),
    };
  }

  // --- per-address daily cap -------------------------------------------------
  if (usage.addressActionsToday >= policy.maxActionsPerAddressPerDay) {
    return {
      ok: false,
      error: rateLimited('ADDRESS_RATE_LIMIT', 'This address has reached its daily relay limit.', {
        limit: policy.maxActionsPerAddressPerDay,
        used: usage.addressActionsToday,
      }),
    };
  }

  // --- free tier -------------------------------------------------------------
  if (usage.lifetimeActions < policy.freeActionsPerAddress) {
    return {
      ok: true,
      decision: {
        mode: 'free-tier',
        freeActionsRemaining: policy.freeActionsPerAddress - usage.lifetimeActions - 1,
        requiredFeeMusdWei: 0n,
      },
    };
  }

  // --- paid tier -------------------------------------------------------------
  // Free actions are spent. From here the SIGNED calldata must carry the fee.
  if (policy.feeMusdWei === null) {
    return {
      ok: false,
      error: paymentRequired(
        'SPONSORSHIP_UNAVAILABLE',
        `This address has used all ${policy.freeActionsPerAddress} free sponsored actions, and no paid sponsorship fee is configured on this relayer.`,
        { freeActionsPerAddress: policy.freeActionsPerAddress },
      ),
    };
  }
  // TODO(MarenRelayHub): a call shape with no in-band fee cannot be charged for.
  // Until the hub exists, that closes the paid tier for it. Explicitly NOT a
  // silent free ride (R16).
  if (input.signedFeeMusdWei === null) {
    return {
      ok: false,
      error: paymentRequired(
        'SPONSORSHIP_UNAVAILABLE',
        `This address has used all ${policy.freeActionsPerAddress} free sponsored actions, and this call carries no in-band relay fee, so it cannot be sponsored further.`,
        { freeActionsPerAddress: policy.freeActionsPerAddress },
      ),
    };
  }
  if (input.signedFeeMusdWei <= 0n) {
    return {
      ok: false,
      error: paymentRequired(
        'SPONSORSHIP_FEE_REQUIRED',
        `This address has used all ${policy.freeActionsPerAddress} free sponsored actions. Re-sign the request with relayFee >= ${musd(policy.feeMusdWei)}.`,
        {
          freeActionsPerAddress: policy.freeActionsPerAddress,
          requiredFeeWei: policy.feeMusdWei.toString(),
        },
      ),
    };
  }
  if (input.signedFeeMusdWei < policy.feeMusdWei) {
    return {
      ok: false,
      error: paymentRequired(
        'FEE_BELOW_REQUIRED',
        `The signed relayFee is below the required sponsorship fee of ${musd(policy.feeMusdWei)}.`,
        {
          requiredFeeWei: policy.feeMusdWei.toString(),
          signedFeeWei: input.signedFeeMusdWei.toString(),
        },
      ),
    };
  }

  return {
    ok: true,
    decision: {
      mode: 'fee-paid',
      freeActionsRemaining: 0,
      requiredFeeMusdWei: policy.feeMusdWei,
    },
  };
}

/**
 * Free actions left for an address, for `GET /quota/:address`.
 *
 * Clamped at BOTH ends. The upper clamp is not defensive decoration: a counter
 * driven negative by an over-applied refund made this advertise 28 free actions
 * against a configured 25. A quota endpoint must never promise more than the
 * policy allows, whatever the counter says.
 */
export function freeActionsRemaining(policy: SponsorshipPolicy, lifetimeActions: number): number {
  const remaining = policy.freeActionsPerAddress - Math.max(0, lifetimeActions);
  return Math.min(policy.freeActionsPerAddress, Math.max(0, remaining));
}
