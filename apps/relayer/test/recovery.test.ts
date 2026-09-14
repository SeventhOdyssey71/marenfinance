import type { DurableObjectStorage, DurableObjectTransaction } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, type Hash, type Hex } from 'viem';
import { DurableStore } from '../worker/durable-store.js';
import { RecoveryCoordinator, type RecoveryRecord } from '../src/recovery.js';
import { NonceManager } from '../src/nonce.js';
import { createRelayer } from '../src/create.js';
import { keys, utcDay } from '../src/store.js';
import { FakeChain, FORWARDER, makeEnv, signedRequest, SILENT_LOGGER, USER } from './helpers.js';

/** Simulates persistent storage across object/service reconstruction. A storage
 * transaction commits all writes or none, including failures at a write or a
 * lost commit response. This is a deterministic model, not a Workers runtime. */
class StorageHarness {
  data = new Map<string, unknown>();
  failure: 'before-commit' | 'after-commit' | 'write' | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly storage = {
    get: async <T>(key: string): Promise<T | undefined> =>
      structuredClone(this.data.get(key)) as T | undefined,
    list: async <T>({ prefix }: { prefix: string }) =>
      new Map([...this.data].filter(([key]) => key.startsWith(prefix))) as Map<string, T>,
    transaction: <T>(callback: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> => {
      const run = this.#queue.then(async () => {
        const draft = structuredClone(this.data);
        const failure = this.failure;
        this.failure = null;
        const result = await callback({
          get: async (key: string) => structuredClone(draft.get(key)),
          put: async (key: string, value: unknown) => {
            if (failure === 'write') throw new Error('storage write failure');
            draft.set(key, structuredClone(value));
          },
          delete: async (key: string) => draft.delete(key),
        } as unknown as DurableObjectTransaction);
        if (failure === 'before-commit') throw new Error('commit unavailable');
        this.data = draft;
        if (failure === 'after-commit') throw new Error('commit response lost');
        return result;
      });
      this.#queue = run.catch(() => undefined);
      return run;
    },
  } as unknown as DurableObjectStorage;
  store(): DurableStore {
    return new DurableStore(this.storage);
  }
}

class RecoverableChain extends FakeChain {
  readonly broadcasts: Hex[] = [];
  loseBroadcastResponse = false;
  gasLimit = 120_000n;
  override async simulate() {
    return this.gasLimit;
  }
  async prepareExecute(_request: unknown, ctx: { nonce: number }): Promise<Hex> {
    // Deterministic bytes stand in for the signed tx; integration tests cover
    // viem signing. Different nonces MUST produce different hashes.
    return `0x${ctx.nonce.toString(16).padStart(4, '0')}` as Hex;
  }
  async broadcastRaw(raw: Hex): Promise<Hash> {
    this.broadcasts.push(raw);
    if (this.loseBroadcastResponse) throw new Error('response lost after acceptance');
    return keccak256(raw);
  }
}

const day = utcDay();
function record(id = 'intent-1', overrides: Partial<RecoveryRecord> = {}): RecoveryRecord {
  const chain = new RecoverableChain();
  const scope = `${chain.chainId}:${chain.account.toLowerCase()}:${FORWARDER.toLowerCase()}`;
  return {
    id,
    requestId: id,
    scope,
    dedupeKey: `maren:recovery:nonce:${scope}:${id}`,
    payer: USER.address,
    ipHash: 'hashed-ip',
    day,
    reservedWei: 1_000n,
    createdAt: Date.now(),
    state: 'reserved',
    ...overrides,
  };
}
const transaction = { raw: '0x0007' as Hex, hash: keccak256('0x0007'), nonce: 7 };
const manager = (chain: RecoverableChain) =>
  new NonceManager({
    address: chain.account,
    getTransactionCount: () => chain.transactionCount(),
    logger: SILENT_LOGGER,
  });
async function boot(harness: StorageHarness, chain = new RecoverableChain()) {
  return createRelayer({
    env: makeEnv(),
    chain,
    store: harness.store(),
    skipPreflight: true,
    logger: SILENT_LOGGER,
    startWatcher: false,
    socketIp: () => '127.0.0.1',
  });
}
async function post(relayer: Awaited<ReturnType<typeof boot>>, body: unknown) {
  return relayer.app.fetch(
    new Request('https://relay.test/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
function receipt(chain: RecoverableChain, hash: Hash, reverted = false) {
  chain.receipts.set(hash, {
    status: reverted ? 'reverted' : 'success',
    blockNumber: 100n,
    gasUsed: 100n,
    effectiveGasPrice: 2n,
    from: chain.account,
  });
}

describe('durable recovery accounting', () => {
  it('atomically rolls back all reservation writes on storage failure', async () => {
    const h = new StorageHarness();
    h.failure = 'write';
    await expect(h.store().reserveRecovery(record())).rejects.toThrow();
    expect(h.data.size).toBe(0);
  });

  it('recovers a reservation whose storage ACK was lost without broadcasting', async () => {
    const h = new StorageHarness();
    h.failure = 'after-commit';
    await expect(h.store().reserveRecovery(record())).rejects.toThrow();
    expect(await h.store().get(keys.lifetime(USER.address))).toBe(1n);
    const relayer = await boot(h);
    expect(relayer.problems).toEqual([]);
    expect(await h.store().listRecovery()).toEqual([]);
    expect(await h.store().get(keys.lifetime(USER.address))).toBe(0n);
    expect(await h.store().get(keys.spendDay(day))).toBe(0n);
  });

  it('retries deferred refunds after restart without double crediting a lost ACK', async () => {
    const h = new StorageHarness();
    const s = h.store();
    await s.reserveRecovery(record());
    await s.reserveRecovery(record('other'));
    h.failure = 'before-commit';
    await expect(s.releaseRecovery('intent-1')).rejects.toThrow();
    expect(await s.get(keys.spendDay(day))).toBe(2_000n);
    h.failure = 'after-commit';
    await expect(h.store().releaseRecovery('intent-1')).rejects.toThrow();
    await h.store().releaseRecovery('intent-1');
    expect(await s.get(keys.spendDay(day))).toBe(1_000n);
    expect(await s.get(keys.lifetime(USER.address))).toBe(1n);
  });

  it('retains an unsigned pre-broadcast crash only until boot can safely refund it', async () => {
    const h = new StorageHarness();
    await h.store().reserveRecovery(record());
    await boot(h);
    expect(await h.store().get(keys.spendDay(day))).toBe(0n);
  });

  it('restores prepared-before-broadcast intent and nonce floor despite an empty RPC mempool', async () => {
    const h = new StorageHarness();
    const s = h.store();
    const chain = new RecoverableChain();
    await s.reserveRecovery(record());
    await s.prepareRecovery('intent-1', transaction);
    const recovery = new RecoveryCoordinator(h.store(), chain, FORWARDER, SILENT_LOGGER);
    const nonces = manager(chain);
    await recovery.initialize(nonces);
    await recovery.sweep();
    expect(chain.broadcasts).toEqual([transaction.raw]);
    const pending = await nonces.submit(
      chain.fees,
      async (ctx) => {
        expect(ctx.nonce).toBe(8);
        return keccak256('0x08');
      },
      { requestId: 'next', payer: USER.address, reservedDay: day, reservedWei: 1n },
    );
    expect(pending.nonce).toBe(8);
    expect(await s.get(keys.spendDay(day))).toBe(1_000n);
  });

  it('never refunds a prepared transaction even after release is retried', async () => {
    const h = new StorageHarness();
    const s = h.store();
    await s.reserveRecovery(record());
    await s.prepareRecovery('intent-1', transaction);
    await s.releaseRecovery('intent-1');
    await h.store().releaseRecovery('intent-1');
    expect(await s.get(keys.spendDay(day))).toBe(1_000n);
    expect(await s.get(keys.committedDay(day))).toBe(1_000n);
  });

  it('preparation is idempotent and disallows replacing its signed hash', async () => {
    const h = new StorageHarness();
    const s = h.store();
    await s.reserveRecovery(record());
    await s.prepareRecovery('intent-1', transaction);
    await s.prepareRecovery('intent-1', transaction);
    expect(await s.get(keys.committedDay(day))).toBe(1_000n);
    await expect(
      s.prepareRecovery('intent-1', { ...transaction, hash: keccak256('0x08') }),
    ).rejects.toThrow();
  });

  it('settlement plus deletion are atomic and retry safely after a lost commit response', async () => {
    const h = new StorageHarness();
    const s = h.store();
    await s.reserveRecovery(record());
    await s.prepareRecovery('intent-1', transaction);
    await s.reserveRecovery(record('other'));
    h.failure = 'before-commit';
    await expect(s.settleRecovery('intent-1', 200n)).rejects.toThrow();
    expect(await s.get(keys.spendDay(day))).toBe(2_000n);
    h.failure = 'after-commit';
    await expect(s.settleRecovery('intent-1', 200n)).rejects.toThrow();
    await h.store().settleRecovery('intent-1', 200n);
    expect(await s.get(keys.spendDay(day))).toBe(1_200n);
    expect(await s.get(keys.committedDay(day))).toBe(200n);
    expect(await s.get(keys.lifetime(USER.address))).toBe(2n);
  });

  it('settles against the original UTC day after counters would normally expire', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-13T23:59:59Z'));
      const h = new StorageHarness();
      const s = h.store();
      const oldDay = '2026-09-13';
      await s.reserveRecovery(record('old', { day: oldDay }));
      await s.prepareRecovery('old', transaction);
      vi.setSystemTime(new Date('2026-09-15T00:01:00Z'));
      await s.reserveRecovery(record('today', { day: '2026-09-15' }));
      await s.settleRecovery('old', 200n);
      expect(await s.get(keys.spendDay(oldDay))).toBe(200n);
      expect(await s.get(keys.committedDay(oldDay))).toBe(200n);
      expect(await s.get(keys.spendDay('2026-09-15'))).toBe(1_000n);
      expect(await s.get(keys.addressDay(USER.address, oldDay))).toBe(0n);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects another signer configuration instead of replaying old raw transactions', async () => {
    const h = new StorageHarness();
    await h.store().reserveRecovery(record('wrong', { scope: 'other-signer' }));
    const relayer = await boot(h);
    expect(relayer.service.accepting).toBe(false);
    expect(relayer.problems.join(' ')).toContain('another signer');
    expect(await h.store().listRecovery()).toHaveLength(1);
  });
});

describe('durable relay pipeline', () => {
  it('returns the locally known hash after lost broadcast response and survives restart/duplicate alarms', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    chain.loseBroadcastResponse = true;
    const first = await boot(h, chain);
    const body = await signedRequest();
    const response = await post(first, body);
    expect(response.status).toBe(202);
    const submitted = (await response.json()) as { hash: Hash };
    expect(submitted.hash).toBe(keccak256(chain.broadcasts[0]!));
    expect(await h.store().get(keys.spendDay(day))).toBe(200_000n * chain.fees.maxFeePerGas);
    const restarted = await boot(h, chain);
    expect((await restarted.service.healthz()).watching).toBe(1);
    expect((await post(restarted, body)).status).toBe(409);
    receipt(chain, submitted.hash);
    await Promise.all([restarted.watcher!.sweep(), restarted.watcher!.sweep()]);
    await (await boot(h, chain)).watcher!.sweep();
    expect(await h.store().get(keys.spendDay(day))).toBe(200n);
    expect(await h.store().get(keys.committedDay(day))).toBe(200n);
    expect(await h.store().get(keys.lifetime(USER.address))).toBe(1n);
    expect(await h.store().listRecovery()).toHaveLength(0);
  });

  it('charges reverted transactions and allows a corrected retry at the unchanged user nonce', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    const relayer = await boot(h, chain);
    const body = await signedRequest();
    const response = await post(relayer, body);
    const { hash } = (await response.json()) as { hash: Hash };
    receipt(chain, hash, true);
    await relayer.watcher!.sweep();
    expect(await h.store().get(keys.spendDay(day))).toBe(200n);
    expect((await post(await boot(h, chain), await signedRequest())).status).toBe(202);
  });

  it('reserves the outer gas ceiling, including overhead above the signed inner gas', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    chain.gasLimit = 300_000n;
    const relayer = await boot(h, chain);
    expect((await post(relayer, await signedRequest())).status).toBe(202);
    expect(await h.store().get(keys.spendDay(day))).toBe(300_000n * chain.fees.maxFeePerGas);
  });

  it('enforces the durable daily cap concurrently and reports exhaustion across restart/settlement', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    const options = {
      env: makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.00000052' }),
      chain,
      store: h.store(),
      skipPreflight: true,
      logger: SILENT_LOGGER,
      startWatcher: false,
      socketIp: () => '127.0.0.1',
    };
    const relayer = await createRelayer(options);
    const responses = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const account = privateKeyToAccount(
          `0x${(index + 1).toString(16).padStart(64, '0')}` as Hex,
        );
        return post(relayer, await signedRequest({ account }));
      }),
    );
    expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
    expect(chain.broadcasts).toHaveLength(1);
    expect(await h.store().get(keys.spendDay(day))).toBe(520_000_000_000n);
    const restarted = await createRelayer({ ...options, store: h.store() });
    const health = await restarted.service.healthz();
    expect(health.budget.halted).toBe(true);
    expect(health.accepting).toBe(false);
    receipt(chain, keccak256(chain.broadcasts[0]!));
    await restarted.watcher!.sweep();
    expect((await restarted.service.healthz()).accepting).toBe(true);
  });

  it('retains unknown receipts and never rebroadcasts while receipt RPC is unavailable', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    const relayer = await boot(h, chain);
    await post(relayer, await signedRequest());
    chain.getReceipt = async () => {
      throw new Error('offline');
    };
    await relayer.watcher!.sweep();
    expect(chain.broadcasts).toHaveLength(1);
    expect(await h.store().listRecovery()).toHaveLength(1);
  });

  it('blocks new allocations when a journal prepare ACK is lost, then restores safely', async () => {
    const h = new StorageHarness();
    const chain = new RecoverableChain();
    chain.prepareExecute = async (_request, ctx) => {
      h.failure = 'after-commit';
      return `0x${ctx.nonce.toString(16).padStart(4, '0')}` as Hex;
    };
    const relayer = await boot(h, chain);
    const response = await post(relayer, await signedRequest());
    expect(response.status).toBe(503);
    const failure = (await response.json()) as {
      error: string;
      meta: { hash: Hash; statusUrl: string };
    };
    expect(failure.error).toBe('SUBMISSION_UNCERTAIN');
    expect(failure.meta.hash).toBe(keccak256('0x0007'));
    expect(failure.meta.statusUrl).toBe(`/status/${failure.meta.hash}`);
    expect(relayer.service.accepting).toBe(false);
    expect(chain.broadcasts).toHaveLength(0);
    expect(await h.store().get(keys.spendDay(day))).toBeGreaterThan(0n);
    const restarted = await boot(h, chain);
    await restarted.watcher!.sweep();
    expect(chain.broadcasts).toHaveLength(1);
    expect((await restarted.service.healthz()).recovery?.blocked).toBe(false);
  });
});
