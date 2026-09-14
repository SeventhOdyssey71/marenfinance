import { DurableObject } from 'cloudflare:workers';
import { createRelayer, type Relayer } from '../src/create.js';
import { createLogger } from '../src/logger.js';
import type { Env as RelayerEnv } from '../src/config.js';
import { DurableStore } from './durable-store.js';

// The relayer's Worker bindings. Non-secret vars come from wrangler.jsonc `vars`;
// RELAYER_PRIVATE_KEY is a Worker secret (`wrangler secret put`).
export interface WorkerEnv {
  RELAYER: DurableObjectNamespace<RelayerDO>;
  LOG_LEVEL?: string;
  RELAYER_NETWORK?: string;
  RELAYER_RPC_URLS?: string;
  RELAYER_FORWARDER_ADDRESS?: string;
  RELAYER_ALLOWED_TARGETS?: string;
  RELAYER_MAX_DAILY_SPONSORED_BTC?: string;
  RELAYER_FREE_ACTIONS_PER_ADDRESS?: string;
  RELAYER_IP_SALT?: string;
  RELAYER_PRIVATE_KEY?: string;
  RELAYER_ALLOWED_ORIGINS?: string;
}

// Workers-safe pino sink. Pino's default destination is sonic-boom over a file
// descriptor, which does not exist on Workers; a plain stream that forwards each
// formatted line to console.log keeps pino's redaction (the security-relevant
// part — it strips signatures, keys and bodies) while writing through the
// Workers log pipeline.
const consoleSink = {
  write(line: string): void {
    console.log(line.endsWith('\n') ? line.slice(0, -1) : line);
  },
};

// The relayer as a single Durable Object.
//
// WHY A DO: the relayer is a stateful signer — it serialises nonces, reconciles
// gas reservations against real cost, and drains deferred refunds. All of that
// needs one authoritative instance that outlives a request. Routing every call
// to one named DO (see worker/index.ts) gives exactly that: a single nonce
// sequence and a single budget, which is why the VERCEL multi-instance refusal
// in create.ts stays off here.
export class RelayerDO extends DurableObject<WorkerEnv> {
  readonly #relayer: Promise<Relayer>;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.#relayer = this.#boot();
  }

  async #boot(): Promise<Relayer> {
    // config.ts reads by key; the extra DO-namespace binding on `env` is ignored.
    const env = this.env as unknown as RelayerEnv;
    const logger = createLogger(this.env.LOG_LEVEL ?? 'info', consoleSink);
    return createRelayer({
      env,
      logger,
      store: new DurableStore(this.ctx.storage),
      // The sweep is driven by this DO's alarm, not an in-process setInterval.
      startWatcher: false,
      // Cloudflare sets `cf-connecting-ip` at the edge and strips any client
      // value, so it is the unforgeable peer address. Feeding it as the socket IP
      // routes per-IP rate limiting through clientip.ts branch 3 correctly.
      socketIp: (c) => c.req.header('cf-connecting-ip') ?? undefined,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const relayer = await this.#relayer;
    await this.#armSweep(relayer);
    return relayer.app.fetch(request);
  }

  // Alarms reload and reconcile the durable signed-transaction journal. An
  // interrupted broadcast retains its reservation and is retried using exactly
  // the same bytes/hash; settlement/refunds and counters commit atomically.
  override async alarm(): Promise<void> {
    const relayer = await this.#relayer;
    try {
      await relayer.watcher?.sweep();
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + relayer.config.sweepIntervalMs);
    }
  }

  // Cron backstop (worker/index.ts `scheduled`): revives the sweep if the alarm
  // was never armed — a fresh instance that has taken no traffic — or failed to
  // reschedule after an error.
  async sweepNow(): Promise<void> {
    const relayer = await this.#relayer;
    await relayer.watcher?.sweep();
    await this.#armSweep(relayer);
  }

  async #armSweep(relayer: Relayer): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + relayer.config.sweepIntervalMs);
    }
  }
}
