import type { Context as HonoContext, Hono } from 'hono';
import { createViemAdapter, resolvePrivateKey, type ChainAdapter } from './chain.js';
import { loadConfig, type Env, type RelayerConfig } from './config.js';
import { buildApp } from './app.js';
import { createLogger, type Logger } from './logger.js';
import { NonceManager, TxWatcher } from './nonce.js';
import { RelayerService } from './service.js';
import { MemoryStore, RedisStore, type RelayStore } from './store.js';
import { preflightRpcs } from './rpc.js';
import { privateKeyToAddress } from 'viem/accounts';

/**
 * Composition root.
 *
 * `createRelayer` NEVER throws on bad configuration. A relayer that crash-loops
 * on a missing variable tells an operator nothing; one that boots into a
 * documented refusing state and explains itself on `/health` tells them exactly
 * what is wrong. Either way it does not relay — that is the part that matters
 * (R8).
 */

export interface Relayer {
  readonly app: Hono<{ Variables: { requestId: string } }>;
  readonly service: RelayerService;
  readonly config: RelayerConfig;
  readonly problems: readonly string[];
  readonly logger: Logger;
  readonly watcher: TxWatcher | null;
  readonly chain: ChainAdapter | null;
}

export interface CreateRelayerOptions {
  readonly env: Env;
  /** Injected in tests. */
  readonly store?: RelayStore;
  readonly chain?: ChainAdapter;
  readonly logger?: Logger;
  /** Standalone server starts the stuck-tx sweeper; serverless cannot. */
  readonly startWatcher?: boolean;
  readonly now?: () => number;
  /** Injected in tests to simulate an RPC that only serves eth_chainId. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Skip the RPC capability preflight. ONLY for tests that supply their own
   * chain adapter. There is no environment variable for this — an operator must
   * not be able to turn the check off from config.
   */
  readonly skipPreflight?: boolean;
  /** Overrides socket-address resolution. Tests only; production uses the runtime's. */
  readonly socketIp?: (c: HonoContext) => string | undefined;
}

export async function createRelayer(options: CreateRelayerOptions): Promise<Relayer> {
  const { config, problems: configProblems } = loadConfig(options.env);
  const problems = [...configProblems];
  const logger = options.logger ?? createLogger(config.logLevel);

  const isMultiInstance = options.env['VERCEL'] !== undefined;

  if (config.ipSaltIsEphemeral && isMultiInstance) {
    problems.push(
      'RELAYER_IP_SALT is unset on a multi-instance deployment, so per-IP limits would be counted per instance',
    );
  }

  // The in-memory store keeps counters per instance. On a multi-instance
  // deployment that does not weaken the global daily BTC cap slightly — it
  // removes it, because every instance believes it has the whole budget. The
  // budget is the backstop the entire abuse model rests on, so running without
  // shared storage there is a refusal, not a warning.
  if (config.store === 'memory' && isMultiInstance) {
    problems.push(
      'RELAYER_STORE=memory on a multi-instance deployment makes the global daily BTC budget unenforceable (each instance counts separately); set RELAYER_STORE=redis',
    );
  }

  // --- store ---------------------------------------------------------------
  let store: RelayStore;
  if (options.store !== undefined) {
    store = options.store;
  } else if (config.store === 'redis' && config.redis !== null) {
    store = new RedisStore(config.redis.url, config.redis.token);
  } else {
    store = new MemoryStore();
    if (config.store === 'redis') {
      // Config already recorded the missing credentials as a problem. We do NOT
      // silently run on the in-memory store in redis mode.
      logger.error({ event: 'store.misconfigured' }, 'redis store requested but not configured');
    }
  }

  // --- chain ---------------------------------------------------------------
  let chain: ChainAdapter | null = options.chain ?? null;
  if (chain === null && problems.length === 0) {
    try {
      const privateKey = await resolvePrivateKey(config);
      const account = privateKeyToAddress(privateKey);

      // Capability preflight BEFORE the first relay, not on the first failure.
      // An endpoint that answers eth_chainId but not eth_call would otherwise
      // look healthy and break every simulation. R8 applied to infrastructure.
      const preflight =
        options.skipPreflight === true
          ? { usable: config.rpcUrls, problems: [], warnings: [], reports: [] }
          : await preflightRpcs(config.rpcUrls, {
              expectedChainId: config.chainId,
              probeContract: config.musd,
              probeAccount: account,
              ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
            });

      for (const warning of preflight.warnings) {
        logger.warn({ event: 'rpc.degraded' }, warning);
      }
      problems.push(...preflight.problems);

      if (preflight.problems.length === 0) {
        logger.info(
          { event: 'rpc.preflight', usable: preflight.usable },
          `RPC preflight passed on ${preflight.usable.length} of ${config.rpcUrls.length} endpoints`,
        );
        chain = createViemAdapter({ config, privateKey, rpcUrls: preflight.usable });
      }
    } catch (error) {
      // The message may name a keystore path; it never contains the key itself.
      problems.push(
        `could not load the relayer signing key: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  const nonces =
    chain === null
      ? null
      : new NonceManager({
          address: chain.account,
          getTransactionCount: (address) => chain.transactionCount(address),
          logger,
        });

  const watcher =
    chain === null
      ? null
      : new TxWatcher({
          reader: chain,
          logger,
          stuckAfterMs: config.stuckTxMs,
          maxReplacements: 3,
        });

  const service = new RelayerService({
    config,
    problems,
    store,
    logger,
    chain,
    nonces,
    watcher,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  // Wire settlement reconciliation back into the service's budget accounting.
  watcher?.setOnSettled((tx, settlement) => service.reconcile(tx, settlement));
  // Deferred refunds must drain even when no transaction is in flight: a store
  // outage can leave budget owed back with nothing pending to trigger it.
  watcher?.setOnSweep(() => service.retryPendingRefunds().then(() => undefined));

  const app = buildApp({
    service,
    logger,
    ...(options.socketIp === undefined ? {} : { socketIp: options.socketIp }),
  });

  if (problems.length > 0) {
    logger.error(
      { event: 'relayer.refusing', problems },
      'relayer booted in a refusing state; POST /relay will return 503 until these are fixed',
    );
  } else {
    logger.info(
      {
        event: 'relayer.ready',
        network: config.network,
        chainId: config.chainId,
        relayer: chain?.account,
        targets: [...config.targets.values()].map((t) => t.name),
        freeActions: config.policy.freeActionsPerAddress,
        dailyBudgetWei: config.policy.maxDailySpendWei,
      },
      'relayer ready',
    );
  }

  if (options.startWatcher === true && watcher !== null) {
    watcher.start(config.sweepIntervalMs);
  }

  return { app, service, config, problems, logger, watcher, chain };
}
