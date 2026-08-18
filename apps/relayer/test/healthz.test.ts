import { describe, expect, it } from 'vitest';
import { buildTestRelayer, FakeChain, makeEnv, signedRequest } from './helpers.js';
import { MemoryStore, keys, utcDay, type RelayStore } from '../src/store.js';
import type { HealthzView } from '../src/service.js';

/**
 * `GET /healthz` is the deployment probe, and it exists because of a specific
 * failure mode rather than for tidiness.
 *
 * Two properties are load-bearing and both are asserted here:
 *
 *   - It makes NO RPC calls. `/health` reads the hot key balance and the chain
 *     nonce, so a flaky public Mezo endpoint takes it to 503; wiring a container
 *     healthcheck to that would restart-loop a relayer that is otherwise fine.
 *   - It reports the budget in enough detail to see the 52x-overshoot bug class
 *     from adversarial round 2 while it is happening, rather than in a
 *     postmortem. Committed spend, reserved spend, and the gap between them are
 *     three different numbers and collapsing them is how the overshoot hid.
 */

async function healthz(relayer: Awaited<ReturnType<typeof buildTestRelayer>>) {
  const response = await relayer.get('/healthz');
  return { status: response.status, body: (await response.json()) as HealthzView };
}

describe('GET /healthz', () => {
  it('answers 200 with the operator-facing state when the relayer is accepting', async () => {
    const relayer = await buildTestRelayer();
    const { status, body } = await healthz(relayer);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.accepting).toBe(true);
    expect(body.relayer).toBe(relayer.chainFake.account);
    expect(body.chainId).toBe(relayer.config.chainId);
    expect(body.network).toBe('testnet');
    expect(body.problems).toEqual([]);
  });

  it('makes no RPC calls, so a degraded endpoint cannot restart-loop a healthy relayer', async () => {
    const chain = new FakeChain();
    let rpcCalls = 0;
    // Anything that would reach the node throws AND counts. `/healthz` must do
    // neither: not call it, and not fail if it would have.
    chain.balance = async () => {
      rpcCalls += 1;
      throw new Error('RPC is down');
    };
    chain.transactionCount = async () => {
      rpcCalls += 1;
      throw new Error('RPC is down');
    };
    const relayer = await buildTestRelayer(makeEnv(), chain);

    const { status, body } = await healthz(relayer);
    expect(rpcCalls).toBe(0);
    expect(status).toBe(200);
    expect(body.accepting).toBe(true);

    // `/health` is the endpoint that IS allowed to notice, and does.
    const health = (await (await relayer.get('/health')).json()) as { problems: string[] };
    expect(health.problems).toContain('cannot reach the configured Mezo RPC');
    expect(rpcCalls).toBeGreaterThan(0);
  });

  it('answers 503 and names every reason when the relayer is refusing', async () => {
    // No key, no budget: the state a freshly provisioned host boots into.
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_PRIVATE_KEY: undefined, RELAYER_MAX_DAILY_SPONSORED_BTC: undefined }),
    );
    const { status, body } = await healthz(relayer);

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.accepting).toBe(false);
    expect(body.keySource).toBeNull();
    expect(body.problems.join('\n')).toMatch(/no signing key configured/);
    expect(body.problems.join('\n')).toMatch(/RELAYER_MAX_DAILY_SPONSORED_BTC/);
  });

  it('states the single-instance assumption rather than leaving it in a comment', async () => {
    const relayer = await buildTestRelayer();
    const { body } = await healthz(relayer);
    // The nonce queue and the (payer, nonce) guard are in-process. An operator
    // reading this endpoint should be able to learn that without reading
    // nonce.ts, because the failure it causes (two machines, one key, dropped
    // transactions) is silent.
    expect(body.singleInstance).toBe(true);
  });

  it('reports how the hot key reached the process, and warns when that is an env var', async () => {
    const relayer = await buildTestRelayer();
    const { body } = await healthz(relayer);

    expect(body.keySource).toBe('env');
    expect(body.warnings.join('\n')).toMatch(/DEVELOPMENT-ONLY/);
    // A warning does NOT stop the relayer. That distinction is the whole point
    // of having warnings separate from problems.
    expect(body.accepting).toBe(true);
  });

  it('reports keystore-file as the key source without warning about it', async () => {
    // Config resolves the paths; nothing reads them because the chain adapter
    // is injected by the test harness.
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_PRIVATE_KEY: undefined,
        RELAYER_KEYSTORE_PATH: '/run/secrets/maren/keystore.json',
        RELAYER_KEYSTORE_PASSWORD_FILE: '/run/secrets/maren/passphrase',
      }),
    );
    const { body } = await healthz(relayer);

    expect(body.keySource).toBe('keystore-file');
    expect(body.warnings).toEqual([]);
    expect(body.problems).toEqual([]);
  });
});

describe('/healthz budget observability', () => {
  // FakeChain: gas 200,000 x maxFeePerGas 2,600,000 = 5.2e11 wei per request.
  const PER_REQUEST_WEI = 200_000n * 2_600_000n;

  function budgetEnv(requests: bigint) {
    return makeEnv({
      RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(PER_REQUEST_WEI * requests) / 1e18).toFixed(18),
    });
  }

  it('starts at zero spend and the configured limit', async () => {
    const relayer = await buildTestRelayer(budgetEnv(10n));
    const { body } = await healthz(relayer);

    expect(body.budget.limitWei).toBe((PER_REQUEST_WEI * 10n).toString());
    expect(body.budget.committedWei).toBe('0');
    expect(body.budget.reservedWei).toBe('0');
    expect(body.budget.inFlightWei).toBe('0');
    expect(body.budget.remainingWei).toBe((PER_REQUEST_WEI * 10n).toString());
    expect(body.budget.committedPct).toBe(0);
    expect(body.budget.halted).toBe(false);
    expect(body.budget.day).toBe(utcDay(new Date()));
  });

  it('moves committed, reserved and remaining together as requests settle', async () => {
    const relayer = await buildTestRelayer(budgetEnv(4n));
    await relayer.post('/relay', await signedRequest(), { 'x-test-socket-ip': '203.0.113.7' });

    const { body } = await healthz(relayer);
    expect(body.budget.committedWei).toBe(PER_REQUEST_WEI.toString());
    expect(body.budget.reservedWei).toBe(PER_REQUEST_WEI.toString());
    // Nothing in flight once the request has returned: reserved == committed.
    expect(body.budget.inFlightWei).toBe('0');
    expect(body.budget.remainingWei).toBe((PER_REQUEST_WEI * 3n).toString());
    expect(body.budget.committedPct).toBe(25);
    expect(body.budget.reservedPct).toBe(25);
  });

  it('shows a reservation that was never committed as in-flight budget, which is the leak signal', async () => {
    // A reservation that is debited and never refunded is exactly the shape of
    // the overshoot bug: reserved climbs, committed does not, and without both
    // numbers the difference is invisible.
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(budgetEnv(4n), new FakeChain(), store);
    await store.incrBy(keys.spendDay(utcDay(new Date())), PER_REQUEST_WEI, 86_400);

    const { body } = await healthz(relayer);
    expect(body.budget.reservedWei).toBe(PER_REQUEST_WEI.toString());
    expect(body.budget.committedWei).toBe('0');
    expect(body.budget.inFlightWei).toBe(PER_REQUEST_WEI.toString());
    expect(body.budget.remainingWei).toBe((PER_REQUEST_WEI * 3n).toString());
  });

  it('never reports negative headroom, however far reserved runs past the limit', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(budgetEnv(1n), new FakeChain(), store);
    await store.incrBy(keys.spendDay(utcDay(new Date())), PER_REQUEST_WEI * 52n, 86_400);

    const { body } = await healthz(relayer);
    expect(body.budget.remainingWei).toBe('0');
    // The overshoot itself stays visible. Clamping `remaining` must not clamp
    // the number that shows how far past the cap the reservations went.
    expect(body.budget.reservedPct).toBe(5200);
  });

  it('reports the budget as unknown rather than as zero when the store is unreachable', async () => {
    // "We cannot see the budget" and "the budget is fine" are different answers,
    // and reporting the second when the first is true is how a relayer spends
    // blind while looking solvent.
    const broken: RelayStore = {
      kind: 'memory',
      incrBy: async () => {
        throw new Error('store down');
      },
      decrBy: async () => {
        throw new Error('store down');
      },
      get: async () => {
        throw new Error('store down');
      },
    };
    const relayer = await buildTestRelayer(budgetEnv(4n), new FakeChain(), broken as never);
    const { status, body } = await healthz(relayer);

    expect(body.budget.committedWei).toBeNull();
    expect(body.budget.reservedWei).toBeNull();
    expect(body.budget.remainingWei).toBeNull();
    expect(body.budget.committedPct).toBeNull();
    expect(body.problems).toContain('quota store is unreachable');
    expect(status).toBe(503);
  });
});

describe('/healthz nonce and submission state', () => {
  it('reports the nonce queue, and the last submission once one exists', async () => {
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(makeEnv(), chain);

    const before = await healthz(relayer);
    expect(before.body.nonce).toEqual({ next: null, inFlight: 0, queued: 0, resyncs: 0 });
    expect(before.body.lastSubmitted).toBeNull();
    expect(before.body.lastSubmittedBlock).toBeNull();

    await relayer.post('/relay', await signedRequest(), { 'x-test-socket-ip': '203.0.113.8' });

    const after = await healthz(relayer);
    expect(after.body.nonce.next).toBe(8); // FakeChain starts at 7
    expect(after.body.nonce.inFlight).toBe(0);
    expect(after.body.nonce.queued).toBe(0);
    expect(after.body.nonce.resyncs).toBe(0);
    expect(after.body.lastSubmitted?.nonce).toBe(7);
    expect(after.body.lastSubmitted?.hash).toBe(chain.sent[0]?.hash);
    expect(Date.parse(after.body.lastSubmitted?.at ?? '')).not.toBeNaN();
  });

  it('reports the block of the last transaction of ours that produced a receipt', async () => {
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(makeEnv(), chain);
    await relayer.post('/relay', await signedRequest(), { 'x-test-socket-ip': '203.0.113.9' });

    const hash = chain.sent[0]?.hash;
    if (hash === undefined) throw new Error('nothing was broadcast');
    chain.receipts.set(hash, {
      status: 'success',
      blockNumber: 9_275_123n,
      gasUsed: 100_000n,
      effectiveGasPrice: 2_600_000n,
    });
    await relayer.watcher?.sweep();

    const { body } = await healthz(relayer);
    expect(body.lastSubmittedBlock).toBe('9275123');
  });

  it('records the block even when the reservation needed no correction', async () => {
    // `reconcile` returns early when the settled cost matches the reservation
    // exactly. Recording the block after that return would make a relayer whose
    // estimates are perfect look like one that has never landed a transaction.
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(makeEnv(), chain);
    await relayer.post('/relay', await signedRequest(), { 'x-test-socket-ip': '203.0.113.10' });

    const hash = chain.sent[0]?.hash;
    if (hash === undefined) throw new Error('nothing was broadcast');
    // gasUsed * effectiveGasPrice == request.gas * maxFeePerGas == the reservation.
    chain.receipts.set(hash, {
      status: 'success',
      blockNumber: 42n,
      gasUsed: 200_000n,
      effectiveGasPrice: 2_600_000n,
    });
    await relayer.watcher?.sweep();

    const { body } = await healthz(relayer);
    expect(body.lastSubmittedBlock).toBe('42');
  });
});
