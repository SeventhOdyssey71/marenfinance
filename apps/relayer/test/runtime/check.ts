/** Actual local workerd/SQLite persistence + alarm integration. Starts a fresh,
 * unforked Anvil; broadcasts cannot reach any public network. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const directory = await mkdtemp(resolve(tmpdir(), 'maren-do-runtime-'));
const children = new Set<ChildProcess>();
const output = new Map<ChildProcess, string>();
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function port(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return value;
}
function start(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: 'true',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: resolve(directory, 'wrangler.log'),
    },
  });
  children.add(child);
  output.set(child, '');
  const collect = (chunk: Buffer) =>
    output.set(child, ((output.get(child) ?? '') + chunk.toString()).slice(-6000));
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.on('error', (error) => collect(Buffer.from(error.message)));
  return child;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return;
  }
  child.kill('SIGTERM');
  for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++)
    await delay(100);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.delete(child);
}
/**
 * The budget is for a SLOW MACHINE, not for a fast assertion.
 *
 * The whole suite runs in about 7s locally, so 30s looked generous — but the checks that
 * matter here stop the worker, start a fresh one and then wait for an alarm to fire and
 * settle, and a cold workerd boot on a CI runner is several times slower than a warm one
 * locally. 'alarm rebroadcast + settlement' duly timed out at 30s on GitHub Actions while
 * passing in 7s on a laptop.
 *
 * Raising the ceiling does not weaken anything: the predicate is unchanged, so a genuine
 * regression still fails, it just no longer fails on a runner having a slow minute.
 */
async function until(
  check: () => Promise<boolean>,
  label: string,
  timeout = 90_000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* Wait for local listener/receipt. */
    }
    await delay(150);
  }
  throw new Error(`${label} timed out\n${[...output.values()].join('\n').slice(-8000)}`);
}

try {
  const anvilPort = await port();
  const workerPort = await port();
  const rpc = `http://127.0.0.1:${anvilPort}`;
  const base = `http://127.0.0.1:${workerPort}`;
  start('anvil', [
    '--host',
    '127.0.0.1',
    '--port',
    String(anvilPort),
    '--chain-id',
    '31611',
    '--silent',
  ]);
  const chain = defineChain({
    id: 31611,
    name: 'Disposable local Anvil',
    nativeCurrency: { name: 'Test BTC', symbol: 'BTC', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const account = privateKeyToAccount(TEST_KEY);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpc, { retryCount: 0, timeout: 1000 }),
  });
  const wallet = createWalletClient({ chain, account, transport: http(rpc) });
  await until(async () => (await publicClient.getChainId()) === 31611, 'local Anvil');
  // STOP runtime accepts encoded execute calldata; this tests the production
  // adapter/journal, not forwarder authorization (covered by contract suites).
  const deployment = await wallet.sendTransaction({ data: '0x600180600c6000396000f3fe00' });
  const forwarder = (await publicClient.waitForTransactionReceipt({ hash: deployment }))
    .contractAddress as Address;
  const initialNonce = await publicClient.getTransactionCount({ address: account.address });
  let previousInstance: string | undefined;
  async function worker(): Promise<ChildProcess> {
    const child = start(process.execPath, [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--config',
      'test/runtime/wrangler.jsonc',
      '--ip',
      '127.0.0.1',
      '--port',
      String(workerPort),
      '--inspector-port',
      '0',
      '--persist-to',
      resolve(directory, 'state'),
      '--var',
      `RPC_URL:${rpc}`,
      '--var',
      `FORWARDER:${forwarder}`,
      '--log-level',
      'error',
    ]);
    await until(async () => {
      const response = await fetch(`${base}/state`);
      if (!response.ok) return false;
      const snapshot = (await response.json()) as { instance: string };
      if (!snapshot.instance || snapshot.instance === previousInstance) return false;
      previousInstance = snapshot.instance;
      return true;
    }, 'new local workerd object instance');
    return child;
  }
  interface State {
    instance: string;
    active: number;
    spent: string;
    committed: string;
    lifetime: string;
    alarmRuns: number;
  }
  const state = async () => (await (await fetch(`${base}/state`)).json()) as State;
  const post = (path: string, id = 'unused') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  let running = await worker();
  assert.equal((await post('/reserve', 'unsigned')).status, 200);
  assert.equal((await state()).active, 1);
  await stop(running);
  running = await worker();
  assert.equal((await state()).active, 0);
  assert.equal((await state()).spent, '0');
  assert.equal((await state()).lifetime, '0');

  const prepared = (await (await post('/prepare', 'before-broadcast')).json()) as {
    hash: Hash;
    nonce: number;
  };
  assert.equal(prepared.nonce, initialNonce);
  assert.equal(await publicClient.getTransactionCount({ address: account.address }), initialNonce);
  await stop(running);
  running = await worker();
  assert.equal((await state()).active, 1);
  await post('/arm');
  await until(async () => {
    const s = await state();
    return s.active === 0 && s.alarmRuns >= 2;
  }, 'alarm rebroadcast + settlement');
  const firstReceipt = await publicClient.getTransactionReceipt({ hash: prepared.hash });
  const firstCost = firstReceipt.gasUsed * firstReceipt.effectiveGasPrice;
  assert.equal((await state()).spent, firstCost.toString());
  assert.equal((await state()).committed, firstCost.toString());
  assert.equal(
    await publicClient.getTransactionCount({ address: account.address }),
    initialNonce + 1,
  );
  const alarmCount = (await state()).alarmRuns;
  await post('/arm');
  await until(async () => (await state()).alarmRuns > alarmCount, 'duplicate empty alarm');
  assert.equal((await state()).spent, firstCost.toString());

  const second = (await (await post('/prepare', 'lost-broadcast-response')).json()) as {
    hash: Hash;
  };
  assert.equal((await post('/broadcast-drop')).status, 503);
  await stop(running);
  running = await worker();
  await post('/arm');
  await until(async () => (await state()).active === 0, 'lost-response receipt settlement');
  const secondReceipt = await publicClient.getTransactionReceipt({ hash: second.hash });
  const total = firstCost + secondReceipt.gasUsed * secondReceipt.effectiveGasPrice;
  assert.equal((await state()).spent, total.toString());
  assert.equal((await state()).committed, total.toString());
  assert.equal((await state()).lifetime, '2');
  assert.equal(
    await publicClient.getTransactionCount({ address: account.address }),
    initialNonce + 2,
  );
  await stop(running);
  running = await worker();
  assert.equal((await state()).spent, total.toString());
  assert.equal((await state()).active, 0);
  console.log(
    JSON.stringify({
      ok: true,
      runtime: 'local workerd with SQLite Durable Object storage',
      chain: 'unforked local Anvil',
      checks: [
        'unsigned restart refund',
        'prepared restart persistence',
        'actual alarm rebroadcast and settlement',
        'duplicate alarm accounting',
        'lost broadcast response restart',
        'settled counters survive restart',
      ],
      publicTransactions: 0,
    }),
  );
} finally {
  for (const child of children) await stop(child);
  await rm(directory, { recursive: true, force: true });
}
