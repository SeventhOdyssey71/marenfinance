import { getAddress, isAddress, type Address, type Hash } from 'viem';
import { admitCall } from './calldata.js';
import type { KeySourceKind, RelayerConfig } from './config.js';
import { bad, conflict, forbidden, isRelayError, unavailable, type RelayError } from './errors.js';
import {
  parseForwardRequest,
  verifyForwardRequest,
  type ForwardRequest,
  type VerifiedRequest,
} from './forwarder.js';
import type { AdmittedCall } from './calldata.js';
import type { ChainAdapter } from './chain.js';
import type { Logger } from './logger.js';
import { NonceManager, TxWatcher, type PendingTx } from './nonce.js';
import { evaluatePolicy, freeActionsRemaining, type UsageSnapshot } from './policy.js';
import { settle, type Settlement } from './receipt.js';
import { DAY_SECONDS, keys, NO_TTL, utcDay, type RelayStore } from './store.js';

/**
 * The relay pipeline.
 *
 * Order is the security property here. Each stage is cheaper than the one after
 * it and each one can only ever reject:
 *
 *   1. posture      — is this relayer accepting work at all?            (R8)
 *   2. shape        — schema, and no client-supplied funding source.    (R1)
 *   3. admission    — value == 0, gas cap, target + selector, decode.   (R3, R4)
 *   4. identity     — recover the signer; the payer IS the signer.      (R1, R2)
 *   5. policy       — free tier / in-band fee / rate limits / budget.   (R16)
 *   6. simulation   — eth_call + eth_estimateGas, reject reverts.
 *   7. reservation  — debit quota and budget BEFORE broadcasting.
 *   8. submission   — one serialised nonce allocation + broadcast.
 *
 * Nothing after stage 4 uses any value from the HTTP body that was not inside
 * the EIP-712 struct.
 */

export interface RelayContext {
  readonly requestId: string;
  /** Already hashed by the caller. The raw IP never reaches this module. */
  readonly ipHash: string;
  /** How the IP was established. Logged so a misconfigured proxy is visible. */
  readonly ipSource?: string;
}

export interface RelayResult {
  readonly hash: Hash;
  /** Always 'submitted' here. A hash is not a success — see receipt.ts (R15). */
  readonly state: 'submitted';
  readonly success: false;
  readonly payer: Address;
  readonly nonce: number;
  readonly sponsorship: 'free-tier' | 'fee-paid';
  readonly freeActionsRemaining: number;
  readonly function: string;
  readonly statusUrl: string;
}

export interface QuotaView {
  readonly address: Address;
  readonly freeActionsRemaining: number;
  readonly freeActionsPerAddress: number;
  readonly lifetimeActions: number;
  readonly actionsToday: number;
  readonly maxActionsPerDay: number;
  /** MUSD wei that must be signed into `relayFee` once the free tier is spent. */
  readonly feeAfterFreeTierMusdWei: string | null;
  readonly accepting: boolean;
}

export interface HealthView {
  readonly ok: boolean;
  readonly accepting: boolean;
  readonly relayer: Address | null;
  readonly balanceWei: string | null;
  readonly balanceBtc: string | null;
  readonly nonce: number | null;
  readonly chainId: number;
  readonly network: string;
  readonly forwarder: Address | null;
  readonly rpcs: readonly string[];
  readonly targets: string[];
  readonly store: string;
  readonly inFlight: number;
  readonly watching: number;
  /** Reserved: in-flight plus committed. What the cap is enforced against. */
  readonly spentTodayWei: string | null;
  /** Committed only: broadcast and never refunded. What may latch the halt. */
  readonly committedTodayWei: string | null;
  readonly pendingRefunds: number;
  readonly dailyBudgetWei: string;
  readonly problems: readonly string[];
}

/**
 * Runtime budget state, for `/healthz`.
 *
 * This exists because of a measured bug class, not for completeness. Adversarial
 * round 2 found the daily cap being overshot 52x by concurrent requests, and the
 * only reason anyone knew was that a test measured it: a running relayer would
 * have shown `accepting: true` and a budget it believed was intact. Committed
 * spend, reserved spend and the gap between them are now readable at any moment,
 * so the same class of defect has a tripwire rather than a postmortem.
 */
export interface BudgetView {
  /** The UTC day these counters belong to. Rolls at 00:00 UTC. */
  readonly day: string;
  readonly limitWei: string;
  /** Broadcast and never refunded. The only thing that may latch the halt. */
  readonly committedWei: string | null;
  /** Reserved: in-flight plus committed. What the cap is enforced against. */
  readonly reservedWei: string | null;
  /** Reserved minus committed: budget held by requests still in the pipeline. */
  readonly inFlightWei: string | null;
  /** Limit minus reserved, clamped at zero. What a new request can still claim. */
  readonly remainingWei: string | null;
  /** Committed spend as a percentage of the limit, one decimal place. */
  readonly committedPct: number | null;
  /** Reserved spend as a percentage of the limit. Exceeds 100 during a burst. */
  readonly reservedPct: number | null;
  readonly halted: boolean;
  /** Refunds the store refused. Each one inflates `reservedWei` until it drains. */
  readonly pendingRefunds: number;
}

/**
 * The deployment probe. Cheap, chain-free, and safe to poll every few seconds.
 *
 * `/health` reads the hot key balance and the chain nonce, so it costs two RPC
 * round trips and fails when the RPC is having a bad minute. That is the right
 * shape for an operator asking "what is wrong", and the wrong shape for a
 * container healthcheck: a flaky public endpoint would restart-loop a relayer
 * that is otherwise fine. `/healthz` reads only process state and two counters.
 */
export interface HealthzView {
  readonly ok: boolean;
  readonly accepting: boolean;
  readonly relayer: Address | null;
  readonly chainId: number;
  readonly network: string;
  /** How the hot key reached this process. `env` is a development-only mode. */
  readonly keySource: KeySourceKind | null;
  /**
   * Always true, and stated rather than implied: the nonce queue and the
   * (payer, nonce) duplicate guard are in-process, so exactly one instance may
   * hold this key. See the header of `nonce.ts`.
   */
  readonly singleInstance: true;
  readonly nonce: {
    /** The next nonce this process will allocate, or null before its first sync. */
    readonly next: number | null;
    readonly inFlight: number;
    /** Submissions waiting behind the one being broadcast. */
    readonly queued: number;
    /** Times a failed broadcast forced the cached nonce to be discarded. */
    readonly resyncs: number;
  };
  readonly lastSubmitted: {
    readonly hash: Hash;
    readonly nonce: number;
    readonly at: string;
  } | null;
  /** Block of the most recent transaction of ours that produced a receipt. */
  readonly lastSubmittedBlock: string | null;
  readonly budget: BudgetView;
  readonly store: string;
  readonly watching: number;
  /** Allowed but not production-shaped. Does not stop the relayer. */
  readonly warnings: readonly string[];
  readonly problems: readonly string[];
}

export interface RelayerServiceDeps {
  readonly config: RelayerConfig;
  /** Configuration problems from `loadConfig`. Non-empty means: do not relay. */
  readonly problems: readonly string[];
  /** Non-fatal posture warnings from `loadConfig`. Surfaced on `/healthz`. */
  readonly warnings?: readonly string[];
  readonly store: RelayStore;
  readonly logger: Logger;
  /** Null when the config was too broken to build one. The service still boots. */
  readonly chain: ChainAdapter | null;
  readonly nonces: NonceManager | null;
  readonly watcher: TxWatcher | null;
  readonly now?: () => number;
}

/** Below this the relayer stops accepting work rather than start failing mid-queue. */
export const MIN_BALANCE_WEI = 10n ** 13n; // 0.00001 BTC — ~1,000 sponsored actions of headroom

export class RelayerService {
  readonly #deps: RelayerServiceDeps;
  #draining = false;
  /** Flipped by the daily budget check; reset when the UTC day rolls over. */
  #budgetHaltedOn: string | null = null;
  /** `payer:nonce` slots currently being processed. See H3 in `relay`. */
  readonly #inFlightRequests = new Set<string>();
  /** Refunds the store refused. Retried rather than dropped — see `#refund`. */
  readonly #pendingRefunds: Array<{ key: string; amount: bigint }> = [];
  /** Block number of the last transaction of ours that produced a receipt. */
  #lastSettledBlock: bigint | null = null;

  constructor(deps: RelayerServiceDeps) {
    this.#deps = deps;
  }

  get config(): RelayerConfig {
    return this.#deps.config;
  }

  get problems(): readonly string[] {
    return this.#deps.problems;
  }

  /**
   * The single posture gate. If anything about the configuration is unresolved,
   * this is false and `/relay` refuses. There is no partial mode where some
   * requests get through on a half-configured relayer.
   */
  get accepting(): boolean {
    return (
      !this.#draining &&
      this.#deps.problems.length === 0 &&
      this.#deps.chain !== null &&
      this.#deps.nonces !== null &&
      this.#budgetHaltedOn !== utcDay(new Date(this.#now()))
    );
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  #day(): string {
    return utcDay(new Date(this.#now()));
  }

  // -------------------------------------------------------------------------
  // POST /relay
  // -------------------------------------------------------------------------

  async relay(body: unknown, ctx: RelayContext): Promise<RelayResult> {
    const { config } = this.#deps;

    // 1. posture ------------------------------------------------------------
    if (this.#draining) {
      throw unavailable('RELAYER_SHUTTING_DOWN', 'the relayer is draining and not accepting work');
    }
    if (!this.accepting) {
      throw unavailable(
        'RELAYER_NOT_ACCEPTING',
        'the relayer is not accepting work; see /health for the reasons',
        { problems: this.#deps.problems.length },
      );
    }
    const chain = this.#deps.chain;
    const nonces = this.#deps.nonces;
    if (chain === null || nonces === null) {
      // Unreachable given `accepting`, but the type system does not know that
      // and a null-deref here would be an outage.
      throw unavailable('RELAYER_NOT_ACCEPTING', 'the relayer has no chain connection');
    }
    if (config.forwarder === null) {
      throw unavailable('RELAYER_NOT_ACCEPTING', 'no forwarder configured');
    }

    // Opportunistic: give back any refund the store previously refused, before
    // it can accumulate into a budget that halts us having spent nothing.
    if (this.#pendingRefunds.length > 0) {
      await this.retryPendingRefunds();
    }

    // 2. shape --------------------------------------------------------------
    const request = parseForwardRequest(body);

    // 3. admission ----------------------------------------------------------
    const call = admitCall(config, request);

    // 4. identity -----------------------------------------------------------
    const verified = await verifyForwardRequest(chain, request, {
      chainId: config.chainId,
      forwarder: config.forwarder,
      maxDeadlineSeconds: config.policy.maxDeadlineSeconds,
      now: Math.floor(this.#now() / 1000),
    });
    const payer = verified.payer;

    // H4 — contract (ERC-1271 / EIP-7702) signers run arbitrary code during
    // signature validation, inside the transaction WE pay for. A signer can make
    // that validation burn the full gas limit and then revert, and unlike an EOA
    // there is no bound on how expensive it is. Simulation catches the revert,
    // but a hostile account can make validation succeed in `eth_call` and fail
    // on-chain. So contract signers get a tighter ceiling than EOAs.
    if (verified.signerKind === 'contract' && request.gas > config.policy.maxGasContractSigner) {
      throw forbidden(
        'GAS_LIMIT_TOO_HIGH',
        'requested gas exceeds the per-request cap for contract-account signers',
        {
          requested: request.gas.toString(),
          cap: config.policy.maxGasContractSigner.toString(),
          signerKind: 'contract',
        },
      );
    }

    // H3 — two identical requests arriving together both pass the nonce check
    // before either is submitted. Only one can land; the other burns our gas
    // reverting on a consumed nonce. The forwarder nonce is the natural dedupe
    // key, and it is inside the signed struct.
    const inFlightKey = `${payer.toLowerCase()}:${request.nonce.toString()}`;
    if (this.#inFlightRequests.has(inFlightKey)) {
      throw conflict(
        'DUPLICATE_REQUEST_IN_FLIGHT',
        'a request from this signer at this nonce is already being processed',
        { nonce: request.nonce.toString() },
      );
    }
    this.#inFlightRequests.add(inFlightKey);
    try {
      return await this.#relayVerified(request, call, verified, ctx);
    } finally {
      this.#inFlightRequests.delete(inFlightKey);
    }
  }

  /**
   * The money-spending half of `relay`, after identity is settled and the
   * (payer, nonce) slot is held. Split out so the dedupe guard above has a
   * single, obvious release point in `finally`.
   */
  async #relayVerified(
    request: ForwardRequest,
    call: AdmittedCall,
    verified: VerifiedRequest,
    ctx: RelayContext,
  ): Promise<RelayResult> {
    const { config, logger } = this.#deps;
    const chain = this.#deps.chain;
    const nonces = this.#deps.nonces;
    if (chain === null || nonces === null) {
      throw unavailable('RELAYER_NOT_ACCEPTING', 'the relayer has no chain connection');
    }
    const payer = verified.payer;

    logger.info(
      {
        event: 'relay.admitted',
        requestId: ctx.requestId,
        payer,
        signerKind: verified.signerKind,
        target: call.target.name,
        fn: call.fn.id,
        selector: call.selector,
        gas: request.gas,
        calldataBytes: (request.data.length - 2) / 2,
      },
      'request verified and admitted',
    );

    // 5. policy -------------------------------------------------------------
    const fees = await chain.estimateFees();
    // Upper bound on what this can cost us: the gas the user signed for, at the
    // maximum fee we are willing to pay. Reserving the bound rather than the
    // estimate means concurrent requests cannot collectively overshoot the cap.
    const projectedGasCostWei = request.gas * fees.maxFeePerGas;

    const day = this.#day();

    // 5a. cheap pre-check ----------------------------------------------------
    // Rejects the common case without touching the counters. This is an
    // OPTIMISATION ONLY and is not authoritative — see 5b.
    const usage = await this.#readUsage(payer, ctx.ipHash, day);
    const preCheck = evaluatePolicy(config.policy, {
      usage,
      signedFeeMusdWei: call.signedFeeMusdWei,
      projectedGasCostWei,
    });
    if (!preCheck.ok) {
      this.#rejectPolicy(preCheck.error, ctx, payer);
    }

    // 5b. AUTHORITATIVE reservation -----------------------------------------
    //
    // The previous shape here was a check-then-act race, and it was measured:
    // 25 concurrent requests against a one-request budget went 13x over, 250
    // went 130x, every one broadcast. `get` -> decide -> (balance + simulate:
    // two RPC round trips) -> `incrBy` left a window hundreds of milliseconds
    // wide in which every concurrent request saw the same pre-spend counters.
    // It was not a MemoryStore artifact — it reproduced against atomic Redis
    // INCRBY, because the atomicity was never the problem. Discarding INCRBY's
    // return value was.
    //
    // So: increment FIRST, and decide on the values the increment itself
    // returned. Those are per-request unique under any correct store, which
    // makes the decision serialisable no matter how many requests race. If we
    // lose, we refund and reject.
    const reserved = await this.#reserve(payer, ctx.ipHash, day, projectedGasCostWei);

    // Reconstruct the usage this request actually saw, by subtracting its own
    // contribution from the post-increment values. Feeding that back through
    // the SAME policy function keeps one definition of every cap.
    const confirmed = evaluatePolicy(config.policy, {
      usage: {
        lifetimeActions: Number(reserved.lifetime - 1n),
        addressActionsToday: Number(reserved.addressDay - 1n),
        ipActionsToday: Number(reserved.ipDay - 1n),
        spentTodayWei: reserved.spendDay - projectedGasCostWei,
      },
      signedFeeMusdWei: call.signedFeeMusdWei,
      projectedGasCostWei,
    });
    if (!confirmed.ok) {
      await this.#release(payer, ctx.ipHash, day, projectedGasCostWei);
      this.#rejectPolicy(confirmed.error, ctx, payer);
    }
    const decision = confirmed.ok ? confirmed : preCheck;

    // The near-limit warnings fire AFTER the broadcast, not here. Warning on a
    // reservation means warning on traffic that is about to be refunded: a
    // request that fails simulation still crosses the threshold on the way up
    // and un-crosses it on the way back down, so the next one crosses again.
    // Measured: six requests whose calls revert produced six `budget.near_limit`
    // warnings for zero wei of spend, which is an unauthenticated way to fill an
    // operator's log with the one signal they are meant to page on. Same mistake
    // in a smaller form as latching the halt on reserved rather than committed
    // spend (see `#commitSpend`).

    // Everything from here holds a reservation, so every failure path must give
    // it back or we leak budget on each error.
    //
    // The reservation is held across BOTH the balance read and the simulation
    // and the broadcast, with no reclaim timer. Every exit path below refunds,
    // so this does not leak — but it does mean a slow RPC pins budget for the
    // duration. The bound is viem's transport timeout (15s, x2 retries) inside
    // whatever the host allows, so the residual is availability, not solvency:
    // worst case some budget is briefly unavailable to other callers. A reclaim
    // sweep would tighten it if hold times ever became material.
    let pending: PendingTx;
    try {
      // Refuse to start work we cannot finish. An empty hot key mid-queue is
      // worse than a clean 503.
      const balance = await chain.balance();
      if (balance < MIN_BALANCE_WEI || balance < projectedGasCostWei) {
        throw unavailable('RELAYER_UNDERFUNDED', 'the relayer hot key is out of BTC', {
          balanceWei: balance.toString(),
        });
      }

      // 6. simulation --------------------------------------------------------
      const gasLimit = await chain.simulate(request);

      // 7. submission --------------------------------------------------------
      // The reservation stands once broadcast succeeds. If the transaction
      // later reverts we do NOT refund, because the gas was still spent and
      // refunding reverts would make deliberate reverts a free way to drain the
      // budget.
      pending = await nonces.submit(
        fees,
        (submitCtx) => chain.sendExecute(request, submitCtx, gasLimit),
        { requestId: ctx.requestId, reservedWei: projectedGasCostWei, reservedDay: day, payer },
      );
      // The reservation is now COMMITTED: it was broadcast and will not be
      // refunded. Only committed spend may latch the day-long halt.
      await this.#commitSpend(day, projectedGasCostWei);
    } catch (error) {
      await this.#release(payer, ctx.ipHash, day, projectedGasCostWei);
      logger.error(
        { event: 'relay.reservation_released', requestId: ctx.requestId, payer, err: error },
        'request failed after reservation; quota and budget released',
      );
      throw isRelayError(error)
        ? error
        : unavailable('SUBMISSION_FAILED', 'the transaction could not be broadcast');
    }

    this.#deps.watcher?.track(pending);

    // Broadcast, therefore real, therefore worth a warning. See the note above
    // the reservation for why this is not done where the counters are debited.
    this.#warnNearLimit(
      { kind: 'address', subject: payer, requestId: ctx.requestId },
      Number(reserved.addressDay),
      config.policy.maxActionsPerAddressPerDay,
    );
    this.#warnNearLimit(
      { kind: 'ip', subject: ctx.ipHash, requestId: ctx.requestId },
      Number(reserved.ipDay),
      config.policy.maxActionsPerIpPerDay,
    );

    logger.info(
      {
        event: 'relay.submitted',
        requestId: ctx.requestId,
        payer,
        hash: pending.hash,
        nonce: pending.nonce,
        fn: call.fn.id,
        sponsorship: decision.decision.mode,
        reservedWei: projectedGasCostWei,
      },
      'transaction broadcast',
    );

    return {
      hash: pending.hash,
      state: 'submitted',
      success: false,
      payer,
      nonce: pending.nonce,
      sponsorship: decision.decision.mode,
      freeActionsRemaining: decision.decision.freeActionsRemaining,
      function: call.fn.id,
      statusUrl: `/status/${pending.hash}`,
    };
  }

  // -------------------------------------------------------------------------
  // GET /status/:hash
  // -------------------------------------------------------------------------

  async status(hash: string): Promise<Settlement> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw bad('MALFORMED_REQUEST', 'not a 32-byte transaction hash');
    }
    const chain = this.#deps.chain;
    if (chain === null) {
      throw unavailable('RELAYER_NOT_ACCEPTING', 'the relayer has no chain connection');
    }
    // Every success verdict in this service comes from this one call (R15).
    return settle(chain, hash as Hash);
  }

  // -------------------------------------------------------------------------
  // GET /quota/:address
  // -------------------------------------------------------------------------

  async quota(rawAddress: string): Promise<QuotaView> {
    if (!isAddress(rawAddress)) {
      throw bad('MALFORMED_REQUEST', 'not a valid address');
    }
    const address = getAddress(rawAddress);
    const { config, store } = this.#deps;
    const day = this.#day();
    const [lifetime, today] = await Promise.all([
      store.get(keys.lifetime(address)),
      store.get(keys.addressDay(address, day)),
    ]);
    const lifetimeActions = Number(lifetime);
    return {
      address,
      freeActionsRemaining: freeActionsRemaining(config.policy, lifetimeActions),
      freeActionsPerAddress: config.policy.freeActionsPerAddress,
      lifetimeActions,
      actionsToday: Number(today),
      maxActionsPerDay: config.policy.maxActionsPerAddressPerDay,
      feeAfterFreeTierMusdWei:
        config.policy.feeMusdWei === null ? null : config.policy.feeMusdWei.toString(),
      accepting: this.accepting,
    };
  }

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------

  async health(): Promise<HealthView> {
    const { config, chain, nonces, watcher, store } = this.#deps;
    let balanceWei: bigint | null = null;
    let nonce: number | null = null;
    let spentToday: bigint | null = null;
    let committedToday: bigint | null = null;
    const problems = [...this.#deps.problems];

    if (chain !== null) {
      try {
        balanceWei = await chain.balance();
        nonce = await chain.transactionCount(chain.account);
      } catch {
        problems.push('cannot reach the configured Mezo RPC');
      }
    }
    try {
      spentToday = await store.get(keys.spendDay(this.#day()));
      committedToday = await store.get(keys.committedDay(this.#day()));
    } catch {
      problems.push('quota store is unreachable');
    }
    if (this.#pendingRefunds.length > 0) {
      // Not fatal, but it inflates the reserved counter until it clears, so an
      // operator should see it before it looks like real spend.
      problems.push(
        `${this.#pendingRefunds.length} reservation refund(s) could not be written to the quota store`,
      );
    }
    if (balanceWei !== null && balanceWei < MIN_BALANCE_WEI) {
      problems.push('relayer hot key balance is below the minimum operating balance');
    }
    if (this.#budgetHaltedOn === this.#day()) {
      problems.push('daily BTC sponsorship budget is exhausted');
    }

    return {
      ok: problems.length === 0,
      accepting: this.accepting && problems.length === 0,
      relayer: chain?.account ?? null,
      balanceWei: balanceWei?.toString() ?? null,
      balanceBtc: balanceWei === null ? null : formatBtc(balanceWei),
      nonce,
      chainId: config.chainId,
      network: config.network,
      forwarder: config.forwarder,
      rpcs: config.rpcUrls,
      targets: [...config.targets.values()].map((t) => `${t.name}:${t.address}`),
      store: store.kind,
      inFlight: nonces?.inFlight ?? 0,
      watching: watcher?.size ?? 0,
      spentTodayWei: spentToday?.toString() ?? null,
      committedTodayWei: committedToday?.toString() ?? null,
      pendingRefunds: this.#pendingRefunds.length,
      dailyBudgetWei: config.policy.maxDailySpendWei.toString(),
      problems,
    };
  }

  // -------------------------------------------------------------------------
  // GET /healthz
  // -------------------------------------------------------------------------

  /**
   * The deployment probe: process state plus the two budget counters, and NOT a
   * single RPC call. Cheap enough to poll on a five-second container
   * healthcheck, and it does not go unhealthy because a public Mezo endpoint had
   * a bad minute.
   *
   * A store that cannot be read leaves the budget numbers null and adds a
   * problem, which is the honest answer: "we cannot see the budget" is not the
   * same as "the budget is fine", and reporting zero here is how a relayer ends
   * up looking solvent while spending blind.
   */
  async healthz(): Promise<HealthzView> {
    const { config, chain, nonces, watcher, store } = this.#deps;
    const day = this.#day();
    const problems = [...this.#deps.problems];

    let reserved: bigint | null = null;
    let committed: bigint | null = null;
    try {
      reserved = await store.get(keys.spendDay(day));
      committed = await store.get(keys.committedDay(day));
    } catch {
      problems.push('quota store is unreachable');
    }
    if (this.#pendingRefunds.length > 0) {
      problems.push(
        `${this.#pendingRefunds.length} reservation refund(s) could not be written to the quota store`,
      );
    }
    const halted = this.#budgetHaltedOn === day;
    if (halted) {
      problems.push('daily BTC sponsorship budget is exhausted');
    }

    const limit = config.policy.maxDailySpendWei;
    const budget: BudgetView = {
      day,
      limitWei: limit.toString(),
      committedWei: committed?.toString() ?? null,
      reservedWei: reserved?.toString() ?? null,
      inFlightWei:
        reserved === null || committed === null
          ? null
          : (reserved - committed > 0n ? reserved - committed : 0n).toString(),
      remainingWei:
        reserved === null ? null : (limit - reserved > 0n ? limit - reserved : 0n).toString(),
      committedPct: committed === null ? null : pctOf(committed, limit),
      reservedPct: reserved === null ? null : pctOf(reserved, limit),
      halted,
      pendingRefunds: this.#pendingRefunds.length,
    };

    const last = nonces?.lastSubmission ?? null;
    return {
      ok: problems.length === 0,
      accepting: this.accepting && problems.length === 0,
      relayer: chain?.account ?? null,
      chainId: config.chainId,
      network: config.network,
      keySource: config.key?.kind ?? null,
      singleInstance: true,
      nonce: {
        next: nonces?.nextNonce ?? null,
        inFlight: nonces?.inFlight ?? 0,
        queued: nonces?.queued ?? 0,
        resyncs: nonces?.resyncs ?? 0,
      },
      lastSubmitted:
        last === null
          ? null
          : { hash: last.hash, nonce: last.nonce, at: new Date(last.at).toISOString() },
      lastSubmittedBlock: this.#lastSettledBlock?.toString() ?? null,
      budget,
      store: store.kind,
      watching: watcher?.size ?? 0,
      warnings: this.#deps.warnings ?? [],
      problems,
    };
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  /**
   * Stop accepting new work, then wait for in-flight broadcasts to finish.
   * We wait on *broadcasts*, not on receipts: once a transaction is in the
   * mempool it survives our process dying, but a half-signed one does not.
   */
  async drain(timeoutMs: number): Promise<void> {
    this.#draining = true;
    const deadline = this.#now() + timeoutMs;
    while ((this.#deps.nonces?.inFlight ?? 0) > 0 && this.#now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.#deps.watcher?.stop();
    this.#deps.logger.info(
      { event: 'relayer.drained', inFlight: this.#deps.nonces?.inFlight ?? 0 },
      'drain complete',
    );
  }

  /**
   * Reconcile the provisional gas reservation once a receipt exists.
   *
   * Two things this must get right, both of which were wrong before they were
   * tested:
   *   - The adjustment applies to the day the reservation was DEBITED, not
   *     today. A transaction submitted at 23:59 that confirms at 00:01 would
   *     otherwise credit a day it never debited, leaving yesterday permanently
   *     over-counted and today spuriously under-counted.
   *   - The counter is clamped at zero. Repeated over-refunds could otherwise
   *     drive the daily spend negative and hand an attacker free budget.
   */
  async reconcile(tx: PendingTx, settlement: Settlement): Promise<void> {
    // Recorded before every early return below. A relayer whose transactions
    // settle but cost exactly what was reserved would otherwise report no block
    // at all, which reads identically to "nothing has ever landed".
    if (settlement.blockNumber !== null) {
      this.#lastSettledBlock = settlement.blockNumber;
    }
    if (settlement.gasCostWei === null) return;
    const delta = settlement.gasCostWei - tx.reservedWei;
    if (delta === 0n) return;
    const day = tx.reservedDay;
    try {
      const updated = await this.#deps.store.incrBy(keys.spendDay(day), delta, DAY_SECONDS);
      if (updated < 0n) {
        await this.#deps.store.incrBy(keys.spendDay(day), -updated, DAY_SECONDS);
      }
      // Committed spend tracks the same correction, or the halt would be latched
      // off a number that never converges on what we actually paid.
      const committed = await this.#deps.store.incrBy(keys.committedDay(day), delta, DAY_SECONDS);
      if (committed < 0n) {
        await this.#deps.store.incrBy(keys.committedDay(day), -committed, DAY_SECONDS);
      }
      this.#reconsiderBudgetHalt(day, committed < 0n ? 0n : committed);
    } catch {
      // A reconciliation we cannot record leaves the budget OVER-counted, which
      // is the safe direction. Log, do not retry into a loop.
      this.#deps.logger.warn(
        { event: 'relay.reconcile_failed', hash: tx.hash },
        'could not reconcile gas spend; the daily budget stays conservatively debited',
      );
      return;
    }
    this.#deps.logger.info(
      {
        event: 'relay.settled',
        requestId: tx.requestId,
        hash: tx.hash,
        state: settlement.state,
        success: settlement.success,
        gasCostWei: settlement.gasCostWei,
        reservedWei: tx.reservedWei,
      },
      'transaction settled',
    );
  }

  // -------------------------------------------------------------------------
  // counters
  // -------------------------------------------------------------------------

  async #readUsage(payer: Address, ipHash: string, day: string): Promise<UsageSnapshot> {
    const { store } = this.#deps;
    const [lifetime, addressToday, ipToday, spentToday] = await Promise.all([
      store.get(keys.lifetime(payer)),
      store.get(keys.addressDay(payer, day)),
      store.get(keys.ipDay(ipHash, day)),
      store.get(keys.spendDay(day)),
    ]);
    return {
      lifetimeActions: Number(lifetime),
      addressActionsToday: Number(addressToday),
      ipActionsToday: Number(ipToday),
      spentTodayWei: spentToday,
    };
  }

  /**
   * Debit every counter and RETURN what each one became.
   *
   * The return value is the whole point: `incrBy` is the only operation that
   * yields a value no concurrent caller can also see, so it is the only sound
   * basis for a limit decision. A `get` before an `incrBy` is a race by
   * construction, however atomic the store.
   */
  async #reserve(
    payer: Address,
    ipHash: string,
    day: string,
    weigh: bigint,
  ): Promise<{ lifetime: bigint; addressDay: bigint; ipDay: bigint; spendDay: bigint }> {
    const { store } = this.#deps;
    // `allSettled`, not `all`. Four independent writes: `all` rejects on the
    // first failure while the other three still land, and nothing above this
    // frame knows a reservation was taken, so nothing gives it back. Measured
    // with one counter forced to throw: the request answered 500 and left the
    // signer's lifetime and daily action counters permanently debited for a
    // relay that never happened. Two of those counters are a user's own free
    // tier and one is the shared daily budget, so a store that flaps for a
    // minute burns both. Upstash REST over the public internet is exactly that
    // store.
    const written: Array<{ key: string; amount: bigint }> = [];
    const settled = await Promise.allSettled([
      store.incrBy(keys.lifetime(payer), 1n, NO_TTL),
      store.incrBy(keys.addressDay(payer, day), 1n, DAY_SECONDS),
      store.incrBy(keys.ipDay(ipHash, day), 1n, DAY_SECONDS),
      store.incrBy(keys.spendDay(day), weigh, DAY_SECONDS),
    ]);
    const debits: Array<{ key: string; amount: bigint }> = [
      { key: keys.lifetime(payer), amount: 1n },
      { key: keys.addressDay(payer, day), amount: 1n },
      { key: keys.ipDay(ipHash, day), amount: 1n },
      { key: keys.spendDay(day), amount: weigh },
    ];
    let failure: unknown = null;
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === 'fulfilled') written.push(debits[index]!);
      else failure ??= outcome.reason;
    }
    if (failure !== null) {
      await Promise.all(written.map((entry) => this.#refund(entry.key, entry.amount)));
      this.#deps.logger.error(
        { event: 'relay.reservation_partial', payer, wrote: written.length, err: failure },
        'the quota store failed mid-reservation; the counters that did land were given back',
      );
      // A typed 503, not the bare 500 an unhandled store error produced before.
      // "We cannot count, so we will not spend" is the honest answer and it is
      // the one clients already know how to read.
      throw isRelayError(failure)
        ? failure
        : unavailable('STORE_UNAVAILABLE', 'the quota store could not record this request');
    }
    const [lifetime, addressDay, ipDay, spendDay] = settled.map((outcome) =>
      outcome.status === 'fulfilled' ? outcome.value : 0n,
    ) as [bigint, bigint, bigint, bigint];
    return { lifetime, addressDay, ipDay, spendDay };
  }

  /**
   * WARN once, on the request that crosses 80% of a per-day action cap.
   *
   * "Once" is the whole design. Logging on every request above the threshold
   * turns the last 20% of a cap into a log flood, which is how a real signal
   * gets filtered out by whoever is on call. The crossing is detected from the
   * counter's own post-increment value: `used` is what this request made it, so
   * `used - 1` is what it was before, and exactly one request can straddle the
   * threshold. Same reason the limits themselves are decided on the increment's
   * return value rather than a prior read.
   *
   * The IP subject is already a salted hash by the time it reaches this service;
   * no raw client address is logged anywhere.
   */
  #warnNearLimit(
    who: { kind: 'address' | 'ip'; subject: string; requestId: string },
    used: number,
    limit: number,
  ): void {
    if (limit <= 0) return;
    const threshold = Math.ceil(limit * NEAR_LIMIT_FRACTION);
    if (used < threshold || used - 1 >= threshold) return;
    this.#deps.logger.warn(
      {
        event: 'quota.near_limit',
        requestId: who.requestId,
        kind: who.kind,
        ...(who.kind === 'address' ? { payer: who.subject } : { ipHash: who.subject }),
        used,
        limit,
        pct: Math.round((used / limit) * 1000) / 10,
      },
      `${who.kind} has used ${used} of its ${limit} daily relays`,
    );
  }

  /**
   * The same crossing signal for the global daily BTC budget, off COMMITTED
   * spend.
   *
   * It used to read the reserved counter at reservation time, which made it an
   * anonymous log-flood primitive: a request that fails simulation reserves,
   * crosses 80%, warns, and is then refunded back under the threshold, so the
   * next one crosses again. Six reverting requests produced six warnings against
   * zero wei of real spend. Committed spend only moves when a transaction was
   * broadcast, so a crossing here is a crossing an operator should act on.
   */
  #warnBudgetNearLimit(committedAfter: bigint, thisRequestWei: bigint): void {
    const limit = this.#deps.config.policy.maxDailySpendWei;
    if (limit <= 0n) return;
    const threshold = (limit * BigInt(Math.round(NEAR_LIMIT_FRACTION * 100))) / 100n;
    const before = committedAfter - thisRequestWei;
    if (committedAfter < threshold || before >= threshold) return;
    this.#deps.logger.warn(
      {
        event: 'budget.near_limit',
        committedWei: committedAfter,
        limitWei: limit,
        pct: pctOf(committedAfter, limit),
      },
      'the daily BTC sponsorship budget is mostly committed',
    );
  }

  /**
   * Log a policy rejection and throw it.
   *
   * NOTE WHAT THIS DOES NOT DO: it does not latch the day-long budget halt.
   *
   * It used to, and that was a free remote denial of service. Because the
   * reservation now increments BEFORE a request can be rejected for any other
   * reason, a burst that is entirely refunded still transiently drives the
   * reserved counter past the cap — and the first request to observe that
   * transient overage would latch the halt permanently, since the latch was
   * never re-evaluated once the refunds landed. Demonstrated: 60 concurrent
   * requests whose calls revert in simulation, against a budget for 20, spent
   * 0 wei, broadcast nothing, refunded everything, and still took the relayer
   * offline until 00:00 UTC. It also fired by accident, latching the global
   * halt when one benign client hit its per-address cap at 10% of budget.
   *
   * The halt is now derived from COMMITTED spend only — see `#commitSpend`.
   */
  #rejectPolicy(error: RelayError, ctx: RelayContext, payer: Address): never {
    this.#deps.logger.warn(
      { event: 'relay.rejected', requestId: ctx.requestId, payer, code: error.code },
      error.message,
    );
    throw error;
  }

  /**
   * Record spend that actually happened, and latch the halt if the day's budget
   * is genuinely gone.
   *
   * `committedDay` only ever counts reservations that were broadcast and never
   * refunded, so it cannot be inflated by requests that fail simulation, lose a
   * race, or trip any other limit. That is the whole difference between a halt
   * that means "we are out of money" and one that means "somebody sent us a lot
   * of doomed requests at once".
   */
  async #commitSpend(day: string, weiSpent: bigint): Promise<void> {
    const { config, logger, store } = this.#deps;
    let committed: bigint;
    try {
      committed = await store.incrBy(keys.committedDay(day), weiSpent, DAY_SECONDS);
    } catch {
      // Losing this write under-counts committed spend, which delays the halt
      // rather than triggering it early. The reserved counter still enforces the
      // cap per request, so this is the safe direction.
      logger.warn({ event: 'relay.commit_failed', day }, 'could not record committed spend');
      return;
    }
    if (committed >= config.policy.maxDailySpendWei) {
      this.#budgetHaltedOn = day;
      logger.error(
        {
          event: 'relay.budget_halt',
          day,
          committedWei: committed,
          limitWei: config.policy.maxDailySpendWei,
        },
        'daily BTC budget spent — relaying halted until 00:00 UTC',
      );
    }
    // The number the halt was latched on is a CEILING, not a cost — see
    // `#reconsiderBudgetHalt`. Warning here rather than at reservation time is
    // the same distinction: only spend that was actually broadcast counts.
    this.#warnBudgetNearLimit(committed, weiSpent);
  }

  /**
   * LIFT a halt that reconciliation has just disproved.
   *
   * `#commitSpend` latches off `request.gas * maxFeePerGas`, which is a ceiling
   * the SIGNER chose, not what the transaction cost. The web client alone signs
   * 1.5x its own estimate plus 60k (`relayGasLimit`), and the per-request cap
   * lets anyone sign 1,500,000 gas onto a 60,000-gas `commit()`. So the day's
   * committed counter can reach the cap on a fraction of the real spend, and
   * before this existed the latch was never re-read: `reconcile()` corrected
   * `committed:<day>` downward and `#budgetHaltedOn` stayed set until 00:00 UTC.
   *
   * Measured: one request signing 1,000,000 gas against a budget sized for
   * exactly that reservation halted the relayer, then settled at 120,000 gas —
   * 6% of the budget genuinely spent, and every later request answered 503
   * RELAYER_NOT_ACCEPTING for the rest of the day. Cheap to do on purpose and
   * indistinguishable from ordinary traffic, because it IS ordinary traffic.
   *
   * Lifting is sound in the same way latching is: the halt means "the day's
   * money is gone", and the only number that can say so is the reconciled one.
   * A halt for a day that is no longer today is left alone — `accepting`
   * already ignores it — so this only ever un-halts on evidence.
   */
  #reconsiderBudgetHalt(day: string, committed: bigint): void {
    if (this.#budgetHaltedOn !== day) return;
    const limit = this.#deps.config.policy.maxDailySpendWei;
    if (committed >= limit) return;
    this.#budgetHaltedOn = null;
    this.#deps.logger.warn(
      { event: 'relay.budget_halt_lifted', day, committedWei: committed, limitWei: limit },
      'reconciled spend is below the daily budget; relaying resumed',
    );
  }

  /**
   * Give back a reservation that will never become spend.
   *
   * A failed INCREMENT fails the request, which is safe. A failed DECREMENT is
   * not: it leaks the reservation forever, and because the budget is the thing
   * that halts the relayer, enough leaked refunds take the service offline
   * having spent nothing. Measured with refunds forced to fail and a budget for
   * 10: after 10 rejected requests — nothing broadcast, no BTC spent — the
   * counter read 100% of budget and everything after got RELAYER_NOT_ACCEPTING.
   * Upstash REST over the public internet is exactly the store that flaps, so
   * swallowing this was not a theoretical hole.
   *
   * So refunds retry, and anything still failing is queued for the reconciler
   * rather than dropped.
   */
  async #release(payer: Address, ipHash: string, day: string, weigh: bigint): Promise<void> {
    await Promise.all([
      this.#refund(keys.lifetime(payer), 1n),
      this.#refund(keys.addressDay(payer, day), 1n),
      this.#refund(keys.ipDay(ipHash, day), 1n),
      this.#refund(keys.spendDay(day), weigh),
    ]);
  }

  /**
   * Apply one refund and CLAMP THE COUNTER AT ZERO.
   *
   * `decrBy` is a bare DECRBY with no idempotency key, so a command that lands
   * but whose response is lost gets applied again by the retry below. Without a
   * clamp that drives counters negative, and negative counters are free money:
   * one refunded request was measured taking `spend:<day>` to -1.56e12 and
   * `lifetime` to -3, after which `/quota` advertised 28 free actions against a
   * configured 25 and the reserved budget had headroom ABOVE the operator's
   * daily cap. Wrong direction for money, and one lost TCP response away.
   *
   * A counter that only ever accumulates today's activity has a true floor of
   * zero, so clamping is sound as a bound. It is a BOUND, not exactness: with
   * other reservations in flight an over-applied refund can still credit part of
   * their reservation before the floor is reached. The exact fix is a per
   * (reservation, counter) idempotency key, which needs a `SET NX` primitive on
   * the store interface; recorded in the README rather than half-built here.
   */
  async #applyRefundOnce(key: string, amount: bigint): Promise<void> {
    const { store } = this.#deps;
    const updated = await store.decrBy(key, amount);
    if (updated < 0n) {
      // Put back exactly the overshoot. Same shape as reconcile()'s clamp.
      await store.incrBy(key, -updated, NO_TTL);
    }
  }

  /** One counter's refund, with retries, then the queue. */
  async #refund(key: string, amount: bigint): Promise<void> {
    const { logger } = this.#deps;
    for (let attempt = 0; attempt < REFUND_ATTEMPTS; attempt += 1) {
      try {
        await this.#applyRefundOnce(key, amount);
        return;
      } catch {
        if (attempt < REFUND_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, REFUND_BACKOFF_MS * (attempt + 1)));
        }
      }
    }
    this.#pendingRefunds.push({ key, amount });
    logger.error(
      { event: 'relay.refund_deferred', key, pending: this.#pendingRefunds.length },
      'could not refund a reservation after retries; queued for reconciliation',
    );
  }

  /**
   * Drain refunds that could not be applied at the time.
   *
   * Called from the stuck-transaction sweep and opportunistically at the head of
   * each relay, so a store that flaps for a few seconds does not permanently
   * consume budget. Entries that still fail stay queued.
   */
  async retryPendingRefunds(): Promise<number> {
    if (this.#pendingRefunds.length === 0) return 0;
    const queued = this.#pendingRefunds.splice(0, this.#pendingRefunds.length);
    let recovered = 0;
    for (const entry of queued) {
      try {
        // Clamped, for the same reason as #refund: this path retries too.
        await this.#applyRefundOnce(entry.key, entry.amount);
        recovered += 1;
      } catch {
        this.#pendingRefunds.push(entry);
      }
    }
    if (recovered > 0) {
      this.#deps.logger.info(
        { event: 'relay.refunds_recovered', recovered, stillPending: this.#pendingRefunds.length },
        'recovered deferred refunds',
      );
    }
    return recovered;
  }

  /** Number of refunds still owed to the counters. Surfaced on `/health`. */
  get pendingRefundCount(): number {
    return this.#pendingRefunds.length;
  }
}

/** Refund retry budget. Short, because the caller is holding an HTTP request. */
const REFUND_ATTEMPTS = 3;
const REFUND_BACKOFF_MS = 25;

/** Fraction of a limit at which crossing it is worth a WARN. */
export const NEAR_LIMIT_FRACTION = 0.8;

function formatBtc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 8);
  return `${whole}.${frac}`;
}

/** Percentage to one decimal place, computed in bigint to keep wei exact. */
function pctOf(value: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((value * 1000n) / total) / 10;
}
