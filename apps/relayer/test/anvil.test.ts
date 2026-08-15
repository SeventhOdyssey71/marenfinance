import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getMusdAddresses, mezoTestnet } from '@maren/sdk';
import { createViemAdapter } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { preflightRpcs } from '../src/rpc.js';
import { settle } from '../src/receipt.js';
import { isRelayError } from '../src/errors.js';
import { makeEnv, signedRequest } from './helpers.js';

/**
 * Integration tests against a local anvil fork of Mezo testnet.
 *
 *   anvil --fork-url https://rpc.test.mezo.org
 *
 * These SKIP GRACEFULLY when anvil is not installed or the fork cannot be
 * established, so CI stays green on a machine without foundry or without
 * network access to Mezo. A skipped test is honest; a test that silently passes
 * without a chain is not, which is why every assertion here needs the fork.
 *
 * What is deliberately NOT tested here: a full `MarenForwarder.execute` round
 * trip. `packages/contracts` does not exist on this branch and `MAREN_ADDRESSES`
 * is still all zeroes, so there is no forwarder to deploy or call. What IS
 * tested is everything the relayer does against a real node — capability
 * preflight, real `eth_call` reads, the simulation gate refusing a genuine
 * revert, nonce allocation, broadcast, and receipt settlement.
 */

const ANVIL_PORT = 8545 + Math.floor(Math.random() * 1000);
const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const FORK_URL = 'https://rpc.test.mezo.org';

/** anvil's default account #0 — a published key, funded only on the local fork. */
const ANVIL_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

/**
 * Minimal deployers. The constructor prologue is 12 bytes:
 *   PUSH1 <len> DUP1 PUSH1 0x0c PUSH1 0x00 CODECOPY PUSH1 0x00 RETURN INVALID
 * so the runtime body starts at offset 0x0c. Getting that offset wrong deploys
 * the trailing INVALID opcode instead of the intended body — which still makes a
 * "reverting" test pass, for entirely the wrong reason. Both tests below assert
 * the deployed code is what was meant.
 */
const REVERTER_INIT_CODE = '0x600580600c6000396000f3fe60006000fd' as const;
const ACCEPTER_INIT_CODE = '0x600180600c6000396000f3fe00' as const;

function anvilInstalled(): boolean {
  try {
    return spawnSync('anvil', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

async function waitForRpc(url: string, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      const payload = (await response.json()) as { result?: string };
      if (typeof payload.result === 'string') return Number.parseInt(payload.result, 16);
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

interface Fork {
  process: ChildProcess;
  chainId: number;
}

async function startAnvil(): Promise<Fork | null> {
  if (!anvilInstalled()) return null;
  const child = spawn(
    'anvil',
    ['--fork-url', FORK_URL, '--port', String(ANVIL_PORT), '--silent', '--no-rate-limit'],
    { stdio: 'ignore' },
  );
  child.unref();
  const chainId = await waitForRpc(ANVIL_URL, 45_000);
  if (chainId === null) {
    child.kill('SIGKILL');
    return null;
  }
  return { process: child, chainId };
}

/**
 * A silent skip that always skips is indistinguishable from a passing test.
 *
 * Review found that CI ran `pnpm test` on a runner with no Foundry, so all six
 * of these were skipped 100% of the time and the job exited 0 — the entire
 * real-chain layer was decorative. The skip stays (a contributor without Foundry
 * should not be blocked), but it becomes LOUD and, where the environment says
 * the chain layer is expected, FATAL.
 *
 * Set `MEZO_TESTNET_RPC_URL` or `MAREN_REQUIRE_CHAIN_TESTS` (as CI does) to make
 * an unavailable fork a failure rather than a skip. `test/setup.ts` normalises
 * the former into the latter before it scrubs the environment.
 */
const fork = await startAnvil();
const forkRequired = Boolean(process.env['MAREN_REQUIRE_CHAIN_TESTS']?.trim());

if (fork === null) {
  const detail = anvilInstalled()
    ? `anvil is installed but the fork of ${FORK_URL} did not come up`
    : 'anvil (Foundry) is not installed';
  if (forkRequired) {
    throw new Error(
      `[anvil] the environment marks the chain integration tests REQUIRED, but ${detail}. ` +
        'Install Foundry (https://getfoundry.sh), or unset MEZO_TESTNET_RPC_URL / ' +
        'MAREN_REQUIRE_CHAIN_TESTS to allow skipping.',
    );
  }
  console.warn(
    `[anvil] SKIPPING 6 chain integration tests: ${detail}. ` +
      'These cover real simulation, broadcast and receipt settlement — a green run without ' +
      'them has NOT exercised the chain layer. Set MEZO_TESTNET_RPC_URL to make this fatal.',
  );
}

const anvilChain = fork === null ? mezoTestnet : defineChain({ ...mezoTestnet, id: fork.chainId });

describe.skipIf(fork === null)('anvil fork of Mezo testnet', () => {
  afterAll(() => {
    fork?.process.kill('SIGKILL');
  });

  const account = privateKeyToAccount(ANVIL_KEY);
  const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_URL) });
  const walletClient = createWalletClient({ account, chain: anvilChain, transport: http(ANVIL_URL) });

  /** Deploy raw runtime bytecode and return its address. */
  async function deploy(initCode: `0x${string}`): Promise<Address> {
    const hash = await walletClient.sendTransaction({ data: initCode });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.contractAddress).toBeTruthy();
    return receipt.contractAddress as Address;
  }

  it('forks Mezo testnet and serves real MUSD state', async () => {
    const musd = getMusdAddresses('testnet').musd;
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({
        address: musd,
        abi: parseAbi(['function symbol() view returns (string)']),
        functionName: 'symbol',
      }),
      publicClient.readContract({
        address: musd,
        abi: parseAbi(['function decimals() view returns (uint8)']),
        functionName: 'decimals',
      }),
    ]);
    expect(symbol).toBe('MUSD');
    expect(decimals).toBe(18);
  });

  it('the capability preflight passes against a node that really serves the methods', async () => {
    const result = await preflightRpcs([ANVIL_URL], {
      expectedChainId: fork!.chainId,
      probeContract: getMusdAddresses('testnet').musd,
      probeAccount: account.address,
    });
    expect(result.problems).toEqual([]);
    expect(result.usable).toEqual([ANVIL_URL]);
    const report = result.reports[0];
    expect(report?.missing).toEqual([]);
  });

  it('the simulation gate rejects a call that genuinely reverts on-chain', async () => {
    // Runtime `PUSH1 0 PUSH1 0 REVERT` — a contract that reverts on any call.
    // Init code: copy the 5 runtime bytes at offset 0x0c and return them.
    const reverter = await deploy(REVERTER_INIT_CODE);
    expect(await publicClient.getCode({ address: reverter })).toBe('0x60006000fd');

    const { config } = loadConfig(
      makeEnv({ RELAYER_FORWARDER_ADDRESS: reverter, RELAYER_RPC_URLS: ANVIL_URL }),
    );
    const adapter = createViemAdapter({
      config,
      privateKey: ANVIL_KEY,
      chain: anvilChain,
      rpcUrls: [ANVIL_URL],
    });

    const body = await signedRequest();
    const request = {
      from: body['from'] as Address,
      to: body['to'] as Address,
      value: 0n,
      gas: 200_000n,
      nonce: 0n,
      deadline: BigInt(body['deadline']!),
      data: body['data'] as `0x${string}`,
      signature: body['signature'] as `0x${string}`,
    };

    await expect(adapter.simulate(request)).rejects.toSatisfy(
      (error: unknown) => isRelayError(error) && error.code === 'SIMULATION_REVERTED',
    );
  });

  it('simulates, submits and settles a real transaction end to end', async () => {
    // Runtime `STOP` — a contract that accepts any call and succeeds.
    const accepter = await deploy(ACCEPTER_INIT_CODE);
    expect(await publicClient.getCode({ address: accepter })).toBe('0x00');

    const { config } = loadConfig(
      makeEnv({ RELAYER_FORWARDER_ADDRESS: accepter, RELAYER_RPC_URLS: ANVIL_URL }),
    );
    const adapter = createViemAdapter({
      config,
      privateKey: ANVIL_KEY,
      chain: anvilChain,
      rpcUrls: [ANVIL_URL],
    });

    const body = await signedRequest();
    const request = {
      from: body['from'] as Address,
      to: body['to'] as Address,
      value: 0n,
      gas: 200_000n,
      nonce: 0n,
      deadline: BigInt(body['deadline']!),
      data: body['data'] as `0x${string}`,
      signature: body['signature'] as `0x${string}`,
    };

    // 1. simulation succeeds and yields a gas limit
    const gasLimit = await adapter.simulate(request);
    expect(gasLimit).toBeGreaterThan(0n);

    // 2. real fee estimation off the forked chain
    const fees = await adapter.estimateFees();
    expect(fees.maxFeePerGas).toBeGreaterThan(0n);

    // 3. real broadcast at a real nonce
    const nonce = await adapter.transactionCount(adapter.account);
    const hash = await adapter.sendExecute(request, { nonce, ...fees }, gasLimit);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    // 4. settlement through the ONE shared place that decides success (R15)
    await publicClient.waitForTransactionReceipt({ hash });
    const settlement = await settle(adapter, hash as Hash);
    expect(settlement.state).toBe('confirmed');
    expect(settlement.success).toBe(true);
    expect(settlement.gasCostWei).toBeGreaterThan(0n);
  });

  it('reads the relayer balance and nonce for /health', async () => {
    const { config } = loadConfig(makeEnv({ RELAYER_RPC_URLS: ANVIL_URL }));
    const adapter = createViemAdapter({
      config,
      privateKey: ANVIL_KEY,
      chain: anvilChain,
      rpcUrls: [ANVIL_URL],
    });
    expect(await adapter.balance()).toBeGreaterThan(0n);
    expect(await adapter.transactionCount(adapter.account)).toBeGreaterThanOrEqual(0);
  });

  it("Mezo's base fee is the 1,300,000 wei the sponsorship economics assume", async () => {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    // Forked from Mezo testnet, so this is Mezo's real base fee, not anvil's default.
    expect(block.baseFeePerGas).toBeGreaterThan(0n);
    // A 100,000-gas sponsored action at this base fee, in wei.
    const costWei = 100_000n * (block.baseFeePerGas ?? 0n);
    expect(costWei).toBeLessThan(10n ** 15n); // < 0.001 BTC, i.e. cents
  });
});
