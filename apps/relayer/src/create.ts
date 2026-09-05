import type { Context as HonoContext, Hono } from 'hono';
import { createViemAdapter, resolvePrivateKey, type ChainAdapter } from './chain.js';
import { loadConfig, type Env, type RelayerConfig } from './config.js';
import { buildApp } from './app.js';
import { createLogger, type Logger } from './logger.js';
import { NonceManager, TxWatcher } from './nonce.js';
import { RelayerService } from './service.js';
import { MemoryStore, RedisStore, type RelayStore } from './store.js';
import { preflightRpcs } from './rpc.js';
import { secretFileModeWarning } from './keystore.js';
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
  /** Non-fatal posture warnings. The relayer still relays with these set. */
  readonly warnings: readonly string[];
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
  const { config, problems: configProblems, warnings: configWarnings } = loadConfig(options.env);
  const problems = [...configProblems];
  const warnings = [...configWarnings];
  const logger = options.logger ?? createLogger(config.logLevel);

  // The key posture is announced at every boot, not only when it is wrong.
  // A relayer signing from a raw environment variable should never be something
  // an operator has to go looking for, and a keystore-backed one is worth
  // confirming out loud so a silent fallback would be visible.
  if (config.key !== null) {
    if (config.key.kind === 'env') {
      logger.warn(
        { event: 'key.dev_mode', keySource: 'env' },
        'SIGNING FROM RELAYER_PRIVATE_KEY: a development-only key mode. The raw hot key is readable by anything that can read this process environment. Use RELAYER_KEYSTORE_PATH + RELAYER_KEYSTORE_PASSWORD_FILE for any key holding real BTC; see apps/relayer/DEPLOY.md',
      );
    } else {
      logger.info(
        { event: 'key.keystore', keySource: config.key.kind, keystore: config.key.path },
        'signing from an encrypted keystore file',
      );
      // Secret files anyone on the box can read defeat the point of using them.
      for (const [path, label] of [
        [config.key.path, 'the keystore'],
        ...(config.key.kind === 'keystore-file'
          ? ([[config.key.passwordFile, 'the keystore passphrase file']] as const)
          : []),
      ] as ReadonlyArray<readonly [string, string]>) {
        const warning = await secretFileModeWarning(path, label);
        if (warning !== null) warnings.push(warning);
      }
    }
  }

  const isMultiInstance = options.env['VERCEL'] !== undefined;

  // The serverless target is NOT supported, and refuses rather than running
  // degraded. Two mechanisms this service depends on are wired only through the
  // stuck-transaction sweep, which needs a process that outlives a request:
  //
  //   - `reconcile()` never runs, so a reservation permanently holds the
  //     signer-chosen `request.gas * maxFeePerGas` instead of converging on what
  //     the transaction actually cost. Measured at ~25x real cost, so an
  //     operator's stated daily cap would deliver roughly 1/25 of the sponsored
  //     transactions they configured — silently.
  //   - `#pendingRefunds` is an in-process array, so an instance recycle erases
  //     it. The leak persists in the shared store while `/health` comes back
  //     reporting `accepting: true, problems: []` — a day-long outage with zero
  //     spend and no operator signal.
  //
  // Running degraded here would be exactly the "documented in the README but
  // broken in the code" shape R13 forbids. Lift this once reconciliation and
  // refund draining have a home that does not depend on the sweep.
  if (isMultiInstance) {
    problems.push(
      'the serverless (Vercel) target is not supported: settlement reconciliation and deferred refund draining run only in the standalone server, so reserved budget would never converge on real spend and queued refunds would be lost on instance recycle — run `pnpm --filter @maren/relayer start`',
    );
  }

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
    warnings,
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
    allowedOrigins: config.allowedOrigins,
    ...(options.socketIp === undefined ? {} : { socketIp: options.socketIp }),
  });

  for (const warning of warnings) {
    logger.warn({ event: 'relayer.warning' }, warning);
  }

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

  return { app, service, config, problems, warnings, logger, watcher, chain };
}
