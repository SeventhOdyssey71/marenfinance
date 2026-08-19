import {
  encodeFunctionData,
  getAddress,
  parseEther,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import pino from 'pino';
import type { ChainAdapter } from '../src/chain.js';
import type { Env } from '../src/config.js';
import { createRelayer, type Relayer } from '../src/create.js';
import { FORWARD_REQUEST_TYPES, forwarderDomain, type ForwardRequest } from '../src/forwarder.js';
import { MemoryStore } from '../src/store.js';
import { RELAYABLE_FUNCTIONS } from '../src/registry.js';
import type { ReceiptLike } from '../src/receipt.js';
import type { GasFees, SubmitContext } from '../src/nonce.js';

export const SILENT_LOGGER = pino({ level: 'silent' });

/** anvil account #0 — a published test key, never used for anything real. */
export const RELAYER_KEY: Hex =
  '0xac0976bf9e2feb37b8bb0d1a2c1e1b0dc48b8ab9d8f7b6e5a4c3d2e1f0a9b8c7';
/** anvil account #1's key, used as the *user* signing ForwardRequests. */
export const USER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

export const USER = privateKeyToAccount(USER_KEY);

export const FORWARDER: Address = getAddress('0x1111111111111111111111111111111111111111');
export const MAREN_PAY: Address = getAddress('0x2222222222222222222222222222222222222222');
/** A second MarenPay deployment, so a `to` tamper can clear the allowlist and
 *  still be caught by signature verification rather than by R4. */
export const MAREN_PAY_2: Address = getAddress('0x7777777777777777777777777777777777777777');
/** A second, DIFFERENT Maren contract, so selector scoping can be tested across two
 *  targets that both have relayable functions of their own. */
export const MAREN_VAULT: Address = getAddress('0x3333333333333333333333333333333333333333');
export const NOT_ALLOWLISTED: Address = getAddress('0x9999999999999999999999999999999999999999');

export const TEST_CHAIN_ID = 31611;

/** A complete, valid environment. Tests override single keys to break one thing. */
export function makeEnv(overrides: Env = {}): Env {
  return {
    RELAYER_NETWORK: 'testnet',
    RELAYER_RPC_URLS: 'https://rpc.test.mezo.org',
    RELAYER_FORWARDER_ADDRESS: FORWARDER,
    RELAYER_ALLOWED_TARGETS: `marenPay:${MAREN_PAY},marenPay:${MAREN_PAY_2},marenVault:${MAREN_VAULT}`,
    RELAYER_MAX_DAILY_SPONSORED_BTC: '0.01',
    RELAYER_FEE_MUSD: '0.05',
    RELAYER_PRIVATE_KEY: RELAYER_KEY,
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// a chain that does what the test tells it to
// ---------------------------------------------------------------------------

export interface FakeChainOptions {
  readonly simulateReverts?: boolean;
  readonly submitDelayMs?: number;
  readonly balanceWei?: bigint;
}

export class FakeChain implements ChainAdapter {
  readonly account: Address = getAddress('0x4444444444444444444444444444444444444444');
  readonly chainId = TEST_CHAIN_ID;

  balanceWei = parseEther('1');
  fees: GasFees = { maxFeePerGas: 2_600_000n, maxPriorityFeePerGas: 1n };
  simulateReverts = false;
  submitDelayMs = 0;
  contractAccounts = new Set<string>();
  forwarderVerifyResult = true;
  nonces_ = new Map<string, bigint>();

  /** Every broadcast, in order, with the nonce it was given. */
  readonly sent: Array<{ nonce: number; hash: Hash }> = [];
  /** Simulations that were run. Used to prove a reverting call never reached submit. */
  simulations = 0;
  receipts = new Map<Hash, ReceiptLike>();

  #chainNonce = 7;

  constructor(options: FakeChainOptions = {}) {
    if (options.simulateReverts !== undefined) this.simulateReverts = options.simulateReverts;
    if (options.submitDelayMs !== undefined) this.submitDelayMs = options.submitDelayMs;
    if (options.balanceWei !== undefined) this.balanceWei = options.balanceWei;
  }

  async balance(): Promise<bigint> {
    return this.balanceWei;
  }

  async transactionCount(): Promise<number> {
    return this.#chainNonce;
  }

  async nonces(owner: Address): Promise<bigint> {
    return this.nonces_.get(owner.toLowerCase()) ?? 0n;
  }

  async hasCode(address: Address): Promise<boolean> {
    return this.contractAccounts.has(address.toLowerCase());
  }

  async verify(): Promise<boolean> {
    return this.forwarderVerifyResult;
  }

  async estimateFees(): Promise<GasFees> {
    return this.fees;
  }

  async simulate(): Promise<bigint> {
    this.simulations += 1;
    if (this.simulateReverts) {
      const { RelayError } = await import('../src/errors.js');
      throw new RelayError(
        'SIMULATION_REVERTED',
        422,
        'the forwarded call reverts in simulation: ERC20InsufficientBalance',
      );
    }
    return 120_000n;
  }

  async sendExecute(_request: ForwardRequest, ctx: SubmitContext): Promise<Hash> {
    if (this.submitDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.submitDelayMs));
    }
    const hash = `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash;
    this.sent.push({ nonce: ctx.nonce, hash });
    this.#chainNonce = Math.max(this.#chainNonce, ctx.nonce + 1);
    return hash;
  }

  async getReceipt(hash: Hash): Promise<ReceiptLike | null> {
    return this.receipts.get(hash) ?? null;
  }
}

// ---------------------------------------------------------------------------
// building requests
// ---------------------------------------------------------------------------

function mustFind(name: string) {
  const found = RELAYABLE_FUNCTIONS.marenPay.find((f) => f.abi.name === name);
  if (found === undefined) throw new Error(`marenPay.${name} missing from the registry`);
  return found;
}
const PAY = mustFind('pay');

/**
 * `MarenPay.pay(address,uint256,string)`, exactly as the Solidity declares it.
 *
 * There is no `relayFee` argument any more, on this or any other Maren function: the
 * trailing-fee design was withdrawn in favour of `MarenRelayHub.executeWithFee`, which
 * puts the fee in the hub's own signed struct. See the header of `src/registry.ts`.
 */
export function payCalldata(
  to: Address = getAddress('0x5555555555555555555555555555555555555555'),
  amount = parseEther('10'),
  memo = 'lunch',
): Hex {
  return encodeFunctionData({ abi: [PAY.abi], args: [to, amount, memo] });
}

export interface BuildRequestOptions {
  readonly to?: Address;
  readonly data?: Hex;
  readonly value?: bigint;
  readonly gas?: bigint;
  readonly nonce?: bigint;
  readonly deadline?: bigint;
  readonly from?: Address;
  readonly forwarder?: Address;
  readonly chainId?: number;
  /** Sign as somebody other than the default user. */
  readonly account?: ReturnType<typeof privateKeyToAccount>;
}

/** Build and SIGN a ForwardRequest as the user would. */
export async function signedRequest(
  options: BuildRequestOptions = {},
): Promise<Record<string, string>> {
  const signer = options.account ?? USER;
  const request = {
    from: options.from ?? signer.address,
    to: options.to ?? MAREN_PAY,
    value: options.value ?? 0n,
    gas: options.gas ?? 200_000n,
    nonce: options.nonce ?? 0n,
    deadline: options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600),
    data: options.data ?? payCalldata(),
  };
  const signature = await signer.signTypedData({
    domain: forwarderDomain(options.chainId ?? TEST_CHAIN_ID, options.forwarder ?? FORWARDER),
    types: FORWARD_REQUEST_TYPES,
    primaryType: 'ForwardRequest',
    message: {
      from: request.from,
      to: request.to,
      value: request.value,
      gas: request.gas,
      nonce: request.nonce,
      deadline: Number(request.deadline),
      data: request.data,
    },
  });
  return serialise({ ...request, signature });
}

/** JSON body form: bigints become decimal strings, as a real client would send. */
function serialise(request: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(request)) {
    out[key] = typeof value === 'bigint' ? value.toString() : String(value);
  }
  return out;
}

export type RequestBody = Record<string, string>;

export function tamper(body: RequestBody, changes: RequestBody): RequestBody {
  return { ...body, ...changes };
}

// ---------------------------------------------------------------------------
// relayer under test
// ---------------------------------------------------------------------------

export interface TestRelayer extends Relayer {
  readonly chainFake: FakeChain;
  readonly store: MemoryStore;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  get(path: string): Promise<Response>;
}

export async function buildTestRelayer(
  env: Env = makeEnv(),
  chainFake: FakeChain = new FakeChain(),
  store: MemoryStore = new MemoryStore(),
  /** Silent unless a test is asserting on what was logged. */
  logger: pino.Logger = SILENT_LOGGER,
): Promise<TestRelayer> {
  const relayer = await createRelayer({
    env,
    store,
    chain: chainFake,
    logger,
    // The fake chain replaces the transport entirely, so there is nothing to
    // preflight. The preflight itself is tested directly in rpc.test.ts.
    skipPreflight: true,
    // `app.fetch(new Request(...))` has no TCP peer, so tests state the socket
    // address explicitly via a header the production path never reads.
    socketIp: (c) => c.req.header('x-test-socket-ip'),
  });
  return {
    ...relayer,
    chainFake,
    store,
    post: async (path, body, headers = {}) =>
      relayer.app.fetch(
        new Request(`http://relayer.test${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
      ),
    get: async (path) => relayer.app.fetch(new Request(`http://relayer.test${path}`)),
  };
}

export interface ErrorBody {
  error: string;
  detail: string;
  meta: Record<string, unknown>;
}
