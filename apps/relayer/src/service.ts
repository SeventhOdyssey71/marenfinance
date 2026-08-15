import { getAddress, isAddress, type Address, type Hash } from 'viem';
import { admitCall } from './calldata.js';
import type { RelayerConfig } from './config.js';
import { bad, isRelayError, unavailable } from './errors.js';
import { parseForwardRequest, verifyForwardRequest } from './forwarder.js';
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
  readonly spentTodayWei: string | null;
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
    const { config, logger } = this.#deps;

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
    const usage = await this.#readUsage(payer, ctx.ipHash, day);
    const decision = evaluatePolicy(config.policy, {
      usage,
      signedFeeMusdWei: call.signedFeeMusdWei,
      projectedGasCostWei,
    });
    if (!decision.ok) {
      if (decision.error.code === 'GLOBAL_DAILY_BUDGET_EXHAUSTED') {
        // Halt the whole relayer for the rest of the UTC day rather than
        // rediscovering the same answer on every request.
        this.#budgetHaltedOn = day;
        logger.error(
          { event: 'relay.budget_halt', day, limitWei: config.policy.maxDailySpendWei },
          'daily BTC budget exhausted — relaying halted until 00:00 UTC',
        );
      }
      logger.warn(
        { event: 'relay.rejected', requestId: ctx.requestId, payer, code: decision.error.code },
        decision.error.message,
      );
      throw decision.error;
    }

    // Refuse to start work we cannot finish. An empty hot key mid-queue is worse
    // than a clean 503.
    const balance = await chain.balance();
    if (balance < MIN_BALANCE_WEI || balance < projectedGasCostWei) {
      throw unavailable('RELAYER_UNDERFUNDED', 'the relayer hot key is out of BTC', {
        balanceWei: balance.toString(),
      });
    }

    // 6. simulation ---------------------------------------------------------
    const gasLimit = await chain.simulate(request);

    // 7. reservation --------------------------------------------------------
    // Debited BEFORE broadcast. If the broadcast fails we give it back; if it
    // succeeds and later reverts we do NOT, because the gas was still spent and
    // refunding a reverted action would make deliberate reverts a free way to
    // drain the budget.
    await this.#reserve(payer, ctx.ipHash, day, projectedGasCostWei);

    // 8. submission ---------------------------------------------------------
    let pending: PendingTx;
    try {
      pending = await nonces.submit(
        fees,
        (submitCtx) => chain.sendExecute(request, submitCtx, gasLimit),
        { requestId: ctx.requestId, reservedWei: projectedGasCostWei, payer },
      );
    } catch (error) {
      await this.#release(payer, ctx.ipHash, day, projectedGasCostWei);
      logger.error(
        { event: 'relay.submit_failed', requestId: ctx.requestId, payer, err: error },
        'broadcast failed; quota reservation released',
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
    } catch {
      problems.push('quota store is unreachable');
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

  /** Reconcile the provisional gas reservation once a receipt exists. */
  async reconcile(tx: PendingTx, settlement: Settlement): Promise<void> {
    if (settlement.gasCostWei === null) return;
    const delta = settlement.gasCostWei - tx.reservedWei;
    if (delta === 0n) return;
    const day = this.#day();
    try {
      await this.#deps.store.incrBy(keys.spendDay(day), delta, DAY_SECONDS);
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

  async #reserve(payer: Address, ipHash: string, day: string, weigh: bigint): Promise<void> {
    const { store } = this.#deps;
    await Promise.all([
      store.incrBy(keys.lifetime(payer), 1n, NO_TTL),
      store.incrBy(keys.addressDay(payer, day), 1n, DAY_SECONDS),
      store.incrBy(keys.ipDay(ipHash, day), 1n, DAY_SECONDS),
      store.incrBy(keys.spendDay(day), weigh, DAY_SECONDS),
    ]);
  }

  async #release(payer: Address, ipHash: string, day: string, weigh: bigint): Promise<void> {
    const { store } = this.#deps;
    await Promise.all([
      store.decrBy(keys.lifetime(payer), 1n),
      store.decrBy(keys.addressDay(payer, day), 1n),
      store.decrBy(keys.ipDay(ipHash, day), 1n),
      store.decrBy(keys.spendDay(day), weigh),
    ]).catch(() => {
      // Losing a release over-counts the user's quota. That is the safe
      // direction and is not worth failing the request over.
      this.#deps.logger.warn({ event: 'relay.release_failed', payer }, 'quota release failed');
    });
  }
}

function formatBtc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 8);
  return `${whole}.${frac}`;
}
