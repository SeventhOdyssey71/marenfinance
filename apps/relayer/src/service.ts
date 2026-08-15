import { getAddress, isAddress, type Address, type Hash } from 'viem';
import { admitCall } from './calldata.js';
import type { RelayerConfig } from './config.js';
import {
  bad,
  conflict,
  forbidden,
  isRelayError,
  unavailable,
  type RelayError,
} from './errors.js';
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

export interface RelayerServiceDeps {
  readonly config: RelayerConfig;
  /** Configuration problems from `loadConfig`. Non-empty means: do not relay. */
  readonly problems: readonly string[];
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

    // Everything from here holds a reservation, so every failure path must give
    // it back or we leak budget on each error.
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
      const committed = await this.#deps.store.incrBy(
        keys.committedDay(day),
        delta,
        DAY_SECONDS,
      );
      if (committed < 0n) {
        await this.#deps.store.incrBy(keys.committedDay(day), -committed, DAY_SECONDS);
      }
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
    const [lifetime, addressDay, ipDay, spendDay] = await Promise.all([
      store.incrBy(keys.lifetime(payer), 1n, NO_TTL),
      store.incrBy(keys.addressDay(payer, day), 1n, DAY_SECONDS),
      store.incrBy(keys.ipDay(ipHash, day), 1n, DAY_SECONDS),
      store.incrBy(keys.spendDay(day), weigh, DAY_SECONDS),
    ]);
    return { lifetime, addressDay, ipDay, spendDay };
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

  /** One counter's refund, with retries, then the queue. */
  async #refund(key: string, amount: bigint): Promise<void> {
    const { store, logger } = this.#deps;
    for (let attempt = 0; attempt < REFUND_ATTEMPTS; attempt += 1) {
      try {
        await store.decrBy(key, amount);
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
        await this.#deps.store.decrBy(entry.key, entry.amount);
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

function formatBtc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 8);
  return `${whole}.${frac}`;
}
