/** LOCAL TEST FIXTURE ONLY. Never deploy. No authentication: its deliberately
 * destructive test endpoints operate only on a disposable DO and local Anvil. */
import { DurableObject } from 'cloudflare:workers';
import { defineChain, keccak256, type Address } from 'viem';
import { createViemAdapter } from '../../src/chain.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { NonceManager } from '../../src/nonce.js';
import { RecoveryCoordinator, type RecoveryRecord } from '../../src/recovery.js';
import { keys, utcDay } from '../../src/store.js';
import { DurableStore } from '../../worker/durable-store.js';

// Published Anvil development key. No user key or public chain is used.
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
interface Env {
  RECOVERY: DurableObjectNamespace<RecoveryCheckDO>;
  RPC_URL: string;
  FORWARDER: Address;
}

export class RecoveryCheckDO extends DurableObject<Env> {
  readonly #ready;
  readonly #store;
  readonly #chain;
  readonly #recovery;
  readonly #day = utcDay();
  readonly #instance = crypto.randomUUID();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.RPC_URL))
      throw new Error('fixture requires local Anvil');
    const { config, problems } = loadConfig({
      RELAYER_NETWORK: 'testnet',
      RELAYER_RPC_URLS: env.RPC_URL,
      RELAYER_PRIVATE_KEY: TEST_KEY,
      RELAYER_FORWARDER_ADDRESS: env.FORWARDER,
      RELAYER_ALLOWED_TARGETS: `marenPay:${env.FORWARDER}`,
      RELAYER_MAX_DAILY_SPONSORED_BTC: '0.01',
      LOG_LEVEL: 'silent',
    });
    if (problems.length) throw new Error(problems.join('; '));
    const chain = defineChain({
      id: 31611,
      name: 'Disposable local Anvil',
      nativeCurrency: { name: 'Test BTC', symbol: 'BTC', decimals: 18 },
      rpcUrls: { default: { http: [env.RPC_URL] } },
    });
    this.#chain = createViemAdapter({
      config,
      privateKey: TEST_KEY,
      chain,
      rpcUrls: [env.RPC_URL],
    });
    const logger = createLogger('silent', { write() {} });
    this.#store = new DurableStore(ctx.storage);
    this.#recovery = new RecoveryCoordinator(this.#store, this.#chain, env.FORWARDER, logger);
    const nonces = new NonceManager({
      address: this.#chain.account,
      getTransactionCount: () => this.#chain.transactionCount(this.#chain.account),
      logger,
    });
    this.#ready = this.#recovery.initialize(nonces);
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    /**
     * DRAIN THE BODY BEFORE THE SLOW AWAIT, not after it.
     *
     * This used to read the body at the bottom of the handler, after `await this.#ready`.
     * `#ready` is `initialize()`, which does chain I/O, and the request here has been
     * forwarded from the outer worker — so on a cold start, by the time the read came
     * round, workerd had already torn the stream down: "Can't read from request stream
     * after response has been sent". It never reproduced locally, where initialize()
     * against a warm local Anvil returns in milliseconds, and it failed on CI runners
     * every time. Raising the test timeout only moved the failure to the next check,
     * which is what ruled slowness out.
     *
     * The product handler never had this shape — `POST /relay` reads `c.req.json()` as
     * its first statement — so this was the fixture's bug, not the relayer's.
     */
    const payload =
      request.method === 'POST' && (path === '/reserve' || path === '/prepare')
        ? ((await request.json()) as { id: string })
        : null;
    await this.#ready;
    if (path === '/state')
      return Response.json({
        instance: this.#instance,
        active: (await this.#store.listRecovery()).length,
        spent: (await this.#store.get(keys.spendDay(this.#day))).toString(),
        committed: (await this.#store.get(keys.committedDay(this.#day))).toString(),
        lifetime: (await this.#store.get(keys.lifetime(this.#chain.account))).toString(),
        alarmRuns: (await this.ctx.storage.get<number>('runtime:alarmRuns')) ?? 0,
      });
    if (request.method !== 'POST') return new Response('POST required', { status: 405 });
    if (path === '/arm') {
      await this.ctx.storage.setAlarm(Date.now() + 150);
      return Response.json({ armed: true });
    }
    if (path === '/broadcast-drop') {
      const entry = (await this.#store.listRecovery())[0];
      if (!entry?.transaction) throw new Error('prepared intent required');
      await this.#chain.broadcastRaw!(entry.transaction.raw);
      // Deliberately lose the successful ACK at the test fixture boundary.
      return new Response('simulated lost response', { status: 503 });
    }
    if (path !== '/reserve' && path !== '/prepare') return new Response('unknown', { status: 404 });
    if (!payload) return new Response('body required', { status: 400 });
    const { id } = payload;
    const fees = await this.#chain.estimateFees();
    const gasLimit = 100_000n;
    const record: RecoveryRecord = {
      id,
      requestId: id,
      scope: this.#recovery.scope,
      dedupeKey: `runtime:dedupe:${id}`,
      payer: this.#chain.account,
      ipHash: 'local-fixture',
      day: this.#day,
      reservedWei: gasLimit * fees.maxFeePerGas,
      createdAt: Date.now(),
      state: 'reserved',
    };
    await this.#store.reserveRecovery(record);
    if (path === '/reserve') return Response.json({ reserved: true });
    const nonce = await this.#chain.transactionCount(this.#chain.account);
    const raw = await this.#chain.prepareExecute!(
      {
        from: this.#chain.account,
        to: this.env.FORWARDER,
        value: 0n,
        gas: 50_000n,
        nonce: 0n,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        data: '0x',
        signature: '0x',
      },
      { nonce, ...fees },
      gasLimit,
    );
    const hash = keccak256(raw);
    await this.#store.prepareRecovery(id, { raw, hash, nonce });
    return Response.json({ hash, nonce });
  }

  override async alarm(): Promise<void> {
    await this.#ready;
    await this.#recovery.sweep();
    await this.ctx.storage.put(
      'runtime:alarmRuns',
      ((await this.ctx.storage.get<number>('runtime:alarmRuns')) ?? 0) + 1,
    );
    if ((await this.#store.listRecovery()).length)
      await this.ctx.storage.setAlarm(Date.now() + 150);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.RECOVERY.get(env.RECOVERY.idFromName('single-test-signer')).fetch(request);
  },
};
