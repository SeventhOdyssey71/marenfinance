import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  numberToHex,
  type Abi,
  type Address,
  type PublicClient,
} from 'viem';
import {
  INTEREST_RATE_BPS,
  MEZO_PRICE_ORACLE_PRECOMPILE,
  MUSD_GAS_COMPENSATION,
  getMarenAddresses,
  getMusdAddresses,
  marenEarnAbi,
  marenRegistryAbi,
  marenVaultAbi,
  priceOracleAbi,
  troveManagerAbi,
} from '@maren/sdk';

/**
 * The live read layer, against a stubbed transport.
 *
 * WHY THE STUB IS AT THE TRANSPORT AND NOT AT THE CLIENT. Mocking `readContract` to
 * return objects would test that this file can call a function that returns objects. It
 * would pass with a mistyped ABI, a wrong output tuple, or a decimals conversion that
 * drops a factor of ten, which are the three things most likely to actually be wrong.
 * So the stub answers `eth_call` with ABI-ENCODED BYTES and a real viem client decodes
 * them: the selectors, the output shapes and the scaling are all exercised, and only the
 * network is absent.
 *
 * That makes these tests an assertion about the transcription in `@maren/sdk/abis.ts` as
 * much as about the mapping here. If somebody adds an output to `getEntireDebtAndColl`
 * that Mezo does not have, the encode side and the decode side agree and the test still
 * passes; that is the limit of what a stub can prove, and it is why the ABI file carries
 * its own provenance trail rather than relying on this.
 */

const NETWORK = 'testnet' as const;
const ACCOUNT: Address = '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const musd = getMusdAddresses(NETWORK);
const maren = getMarenAddresses(NETWORK);

/**
 * What the stub should answer, keyed by `address:functionName`.
 *
 * Addressed as well as named because `balanceOf` exists on both MUSD and MarenEarn with
 * the same selector, and a test that could not tell them apart would happily pass while
 * the Earn screen showed a wallet balance.
 */
type Answers = Record<string, unknown>;

let answers: Answers = {};
let nativeBalance = 0n;
/** Every `eth_call` the code under test made, for asserting on batching and argument passing. */
let calls: { to: string; functionName: string; args: readonly unknown[] }[] = [];

const CANDIDATE_ABIS: Abi[] = [
  priceOracleAbi as unknown as Abi,
  troveManagerAbi as unknown as Abi,
  marenVaultAbi as unknown as Abi,
  marenEarnAbi as unknown as Abi,
  marenRegistryAbi as unknown as Abi,
  erc20Abi as unknown as Abi,
];

/** Which function a piece of calldata is, found by trying each ABI's selectors. */
function identify(data: `0x${string}`) {
  for (const abi of CANDIDATE_ABIS) {
    try {
      const decoded = decodeFunctionData({ abi, data });
      return { abi, functionName: decoded.functionName, args: decoded.args ?? [] };
    } catch {
      // Not this ABI. The next one, or the throw below.
    }
  }
  throw new Error(`No known ABI decodes calldata ${data.slice(0, 10)}.`);
}

function stubClient(): PublicClient {
  return createPublicClient({
    // `retryCount: 0` so a stubbed revert fails immediately. viem's default is to retry
    // with backoff, which is right against a real endpoint and adds seconds per assertion
    // here, where the failure is the point of the test rather than a transient.
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === 'eth_getBalance') return numberToHex(nativeBalance);
          if (method === 'eth_chainId') return numberToHex(31611);
          if (method !== 'eth_call') throw new Error(`Unstubbed RPC method ${method}.`);

          const [call] = params as [{ to: `0x${string}`; data: `0x${string}` }];
          const { abi, functionName, args } = identify(call.data);
          calls.push({ to: call.to.toLowerCase(), functionName, args: args as readonly unknown[] });

          const keyed = `${call.to.toLowerCase()}:${functionName}`;
          const result = keyed in answers ? answers[keyed] : answers[functionName];
          if (result === undefined) {
            // Mezo is entitled to revert, and the code under test has a branch for it. An
            // unstubbed read therefore has to fail the way a revert does, not return zero.
            throw new Error(`execution reverted: no stub for ${keyed}`);
          }
          return encodeFunctionResult({ abi, functionName, result } as never);
        },
      },
      { retryCount: 0 },
    ),
  }) as unknown as PublicClient;
}

vi.mock('../chain/transport', () => ({
  getReadClient: () => stubClient(),
  getLogClient: () => stubClient(),
  getEndpointClients: () => [stubClient()],
}));

// Imported after the mock is registered, so the module under test binds to the stub.
const live = await import('./live');
const { setReadContext } = await import('./context');

beforeEach(() => {
  answers = {};
  nativeBalance = 0n;
  calls = [];
  live.setForcedStaleSeconds(0);
  setReadContext({ network: NETWORK, account: ACCOUNT });
});

// ── price ────────────────────────────────────────────────────────────────────

describe('readPrice', () => {
  /** Mezo's precompile reports 8 decimals, Chainlink style. Everything else here is 1e18. */
  function oracleAt(priceUsd: bigint, updatedAt: number, decimals = 8) {
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:decimals`] = decimals;
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:latestRoundData`] = [
      1n,
      priceUsd * 10n ** BigInt(decimals),
      BigInt(updatedAt),
      BigInt(updatedAt),
      1n,
    ];
  }

  it('scales the precompile answer up to 1e18', async () => {
    oracleAt(63_000n, 1_760_000_000);
    const observation = await live.readPrice();
    expect(observation.priceWei).toBe(63_000n * 10n ** 18n);
  });

  it('scales correctly when the precompile reports a different precision', async () => {
    oracleAt(63_000n, 1_760_000_000, 6);
    const observation = await live.readPrice();
    expect(observation.priceWei).toBe(63_000n * 10n ** 18n);
  });

  it('carries the oracle’s own observation timestamp, not the wall clock', async () => {
    oracleAt(63_000n, 1_759_999_400);
    const observation = await live.readPrice();
    expect(observation.updatedAt).toBe(1_759_999_400);
  });

  /**
   * A non-positive answer is not a cheap price, it is a broken feed. Returning it would
   * put a zero into every collateral valuation on the home screen.
   */
  it('refuses a non-positive price rather than passing it on', async () => {
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:decimals`] = 8;
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:latestRoundData`] = [1n, 0n, 1n, 1n, 1n];
    await expect(live.readPrice()).rejects.toThrow(/non-positive/);
  });

  it('reports a transport failure rather than a price', async () => {
    // No stub registered: the oracle read reverts, exactly as an outage would.
    await expect(live.readPrice()).rejects.toThrow();
  });
});

/**
 * The developer stale toggle.
 *
 * The behaviour under test is the honest one: the CHAIN IS STILL READ, the price it
 * answered with is returned unchanged, and only the observation timestamp moves back. A
 * toggle that substituted a fabricated price would exercise the banner and not the logic,
 * and would go green while the real staleness path was broken.
 */
describe('setForcedStaleSeconds', () => {
  beforeEach(() => {
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:decimals`] = 8;
    answers[`${MEZO_PRICE_ORACLE_PRECOMPILE.toLowerCase()}:latestRoundData`] = [
      1n,
      63_000n * 10n ** 8n,
      1_760_000_000n,
      1_760_000_000n,
      1n,
    ];
  });

  it('backdates the observation by exactly the seconds asked for', async () => {
    live.setForcedStaleSeconds(90);
    const observation = await live.readPrice();
    expect(observation.updatedAt).toBe(1_760_000_000 - 90);
  });

  it('leaves the price the chain reported completely untouched', async () => {
    live.setForcedStaleSeconds(90);
    const stale = await live.readPrice();
    live.setForcedStaleSeconds(0);
    const fresh = await live.readPrice();
    expect(stale.priceWei).toBe(fresh.priceWei);
    expect(stale.priceWei).toBe(63_000n * 10n ** 18n);
  });

  it('still reads the oracle while the toggle is on', async () => {
    live.setForcedStaleSeconds(90);
    await live.readPrice();
    expect(calls.map((c) => c.functionName)).toContain('latestRoundData');
  });

  it('reports its own setting back', () => {
    live.setForcedStaleSeconds(45);
    expect(live.getForcedStaleSeconds()).toBe(45);
  });
});

// ── position ─────────────────────────────────────────────────────────────────

describe('readPosition', () => {
  const WAD = 10n ** 18n;

  /** `getEntireDebtAndColl` returns six values on Mezo, not Liquity v1's four. */
  function trove(coll: bigint, principal: bigint, interest: bigint) {
    answers[`${musd.troveManager.toLowerCase()}:getEntireDebtAndColl`] = [
      coll,
      principal,
      interest,
      0n,
      0n,
      0n,
    ];
  }

  function vault(collateral: bigint, debt: bigint, capacity: bigint) {
    answers[`${maren.marenVault.toLowerCase()}:collateral`] = collateral;
    answers[`${maren.marenVault.toLowerCase()}:previewDebtOf`] = debt;
    answers[`${maren.marenVault.toLowerCase()}:troveMaxBorrowingCapacity`] = capacity;
  }

  it('prefers a direct trove over the pooled position', async () => {
    trove(WAD / 2n, 12_200n * WAD, 100n * WAD);
    answers[`${musd.troveManager.toLowerCase()}:getTroveMaxBorrowingCapacity`] = 24_500n * WAD;
    vault(5n * WAD, 9_000n * WAD, 80_000n * WAD);

    const position = await live.readPosition();
    expect(position.route).toBe('direct');
    expect(position.collateralWei).toBe(WAD / 2n);
  });

  /**
   * Mezo's TroveManager reports `principal` WITH the 200 MUSD gas compensation already
   * inside it. `debtWei` is the total, which is what CR is computed against;
   * `principalWei` is the net amount drawn, which is the figure a person recognises as
   * "what I borrowed". Adding the compensation twice, or failing to remove it from the
   * net figure, both overstate a debt.
   */
  it('reports total debt whole and net principal without gas compensation', async () => {
    const principal = 12_000n * WAD + MUSD_GAS_COMPENSATION;
    const interest = 42n * WAD;
    trove(WAD / 2n, principal, interest);
    answers[`${musd.troveManager.toLowerCase()}:getTroveMaxBorrowingCapacity`] = 24_500n * WAD;
    vault(0n, 0n, 0n);

    const position = await live.readPosition();
    expect(position.debtWei).toBe(principal + interest);
    expect(position.principalWei).toBe(12_000n * WAD);
    expect(position.interestWei).toBe(interest);
    expect(position.interestRateBps).toBe(INTEREST_RATE_BPS);
  });

  it('adds pending collateral and pending debt into the totals', async () => {
    answers[`${musd.troveManager.toLowerCase()}:getEntireDebtAndColl`] = [
      WAD / 2n,
      10_000n * WAD,
      10n * WAD,
      WAD / 4n,
      1_000n * WAD,
      5n * WAD,
    ];
    answers[`${musd.troveManager.toLowerCase()}:getTroveMaxBorrowingCapacity`] = 24_500n * WAD;
    vault(0n, 0n, 0n);

    const position = await live.readPosition();
    expect(position.collateralWei).toBe(WAD / 2n + WAD / 4n);
    expect(position.debtWei).toBe(11_015n * WAD);
  });

  /**
   * "We could not read your borrowing ceiling" and "your borrowing ceiling is zero" are
   * different sentences and only one of them is true. Substituting a zero would tell a
   * borrower their limit was reached.
   */
  it('refuses to substitute a zero when the borrowing ceiling is unreadable', async () => {
    trove(WAD / 2n, 12_000n * WAD, 0n);
    // getTroveMaxBorrowingCapacity is deliberately left unstubbed, so it reverts.
    vault(0n, 0n, 0n);
    await expect(live.readPosition()).rejects.toThrow(/borrowing capacity/);
  });

  it('falls back to the pooled position when there is no trove of the user’s own', async () => {
    trove(0n, 0n, 0n);
    vault(3n * WAD, 9_000n * WAD, 80_000n * WAD);

    const position = await live.readPosition();
    expect(position.route).toBe('pooled');
    expect(position.collateralWei).toBe(3n * WAD);
    // A pooled position carries no per-user gas compensation, so previewDebtOf IS the debt.
    expect(position.debtWei).toBe(9_000n * WAD);
    expect(position.principalWei).toBe(9_000n * WAD);
    expect(position.maxBorrowingCapacityWei).toBe(80_000n * WAD);
  });

  it('reports route "none" for an address with nothing anywhere', async () => {
    trove(0n, 0n, 0n);
    vault(0n, 0n, 80_000n * WAD);

    const position = await live.readPosition();
    expect(position.route).toBe('none');
    expect(position.collateralWei).toBe(0n);
  });

  it('reads for the account in the context and no other', async () => {
    trove(0n, 0n, 0n);
    vault(0n, 0n, 0n);
    await live.readPosition();

    const troveCall = calls.find((c) => c.functionName === 'getEntireDebtAndColl');
    expect(troveCall?.args[0]).toBe(ACCOUNT);
  });

  it('refuses to read anything when no account is loaded', async () => {
    setReadContext({ network: NETWORK, account: null });
    await expect(live.readPosition()).rejects.toThrow(/No account/);
    await expect(live.readBalances()).rejects.toThrow(/No account/);
    await expect(live.readEarn()).rejects.toThrow(/No account/);
  });
});

// ── balances and Earn ────────────────────────────────────────────────────────

describe('readBalances', () => {
  it('reads MUSD from the token and BTC as the native balance', async () => {
    answers[`${musd.musd.toLowerCase()}:balanceOf`] = 3_420n * 10n ** 18n;
    nativeBalance = 15_000_000_000_000n;

    const balances = await live.readBalances();
    expect(balances.musdWei).toBe(3_420n * 10n ** 18n);
    expect(balances.btcWei).toBe(15_000_000_000_000n);
  });
});

describe('readEarn', () => {
  it('reads shares and assets from MarenEarn, not from the wallet', async () => {
    answers[`${maren.marenEarn.toLowerCase()}:balanceOf`] = 2_500n * 10n ** 18n;
    answers[`${maren.marenEarn.toLowerCase()}:maxWithdraw`] = 2_553_500_000_000_000_000_000n;
    answers[`${musd.musd.toLowerCase()}:balanceOf`] = 1n;

    const earn = await live.readEarn();
    expect(earn.sharesWei).toBe(2_500n * 10n ** 18n);
    expect(earn.assetsWei).toBe(2_553_500_000_000_000_000_000n);
  });

  /**
   * Realised yield is event history and the app has no indexer, so the live path reports
   * a zero-length window. That is the honest answer and the Earn screen renders it as
   * "not measured" rather than as "zero return". A fabricated trailing figure would be
   * the forward-APY dishonesty that screen exists to avoid, only backdated.
   */
  it('reports an unmeasured trailing window rather than inventing a return', async () => {
    answers[`${maren.marenEarn.toLowerCase()}:balanceOf`] = 2_500n * 10n ** 18n;
    answers[`${maren.marenEarn.toLowerCase()}:maxWithdraw`] = 2_553n * 10n ** 18n;

    const earn = await live.readEarn();
    expect(earn.trailing.windowDays).toBe(0);
    expect(earn.trailing.realisedWei).toBe(0n);
    expect(earn.trailing.liquidationEvents).toBe(0);
    expect(earn.trailing.lastGainAt).toBeNull();
    expect(earn.depositedWei).toBe(0n);
  });
});

// ── handles ──────────────────────────────────────────────────────────────────

describe('resolveHandle', () => {
  it('resolves a handle to the address the registry holds', async () => {
    answers[`${maren.marenRegistry.toLowerCase()}:tryResolve`] = ACCOUNT;
    const handle = await live.resolveHandle('@sele');
    expect(handle).toEqual({ handle: '@sele', address: ACCOUNT });
  });

  it('accepts a handle with or without the leading at sign', async () => {
    answers[`${maren.marenRegistry.toLowerCase()}:tryResolve`] = ACCOUNT;
    await live.resolveHandle('@sele');
    await live.resolveHandle('sele');
    const queries = calls.filter((c) => c.functionName === 'tryResolve').map((c) => c.args[0]);
    expect(queries).toEqual(['sele', 'sele']);
  });

  /** address(0) is the registry saying "no such handle". It is an answer, not an error. */
  it('reads address zero as unregistered rather than as an address', async () => {
    answers[`${maren.marenRegistry.toLowerCase()}:tryResolve`] = ZERO_ADDRESS;
    expect(await live.resolveHandle('@nobody')).toBeNull();
  });

  it('does not call the chain for an empty query', async () => {
    expect(await live.resolveHandle('  @  '.replace('@', ''))).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('reverseResolve', () => {
  it('returns the primary handle with an at sign', async () => {
    answers[`${maren.marenRegistry.toLowerCase()}:primaryHandle`] = 'sele';
    expect(await live.reverseResolve(ACCOUNT)).toBe('@sele');
  });

  it('returns null for an address with no registration', async () => {
    answers[`${maren.marenRegistry.toLowerCase()}:primaryHandle`] = '';
    expect(await live.reverseResolve(ACCOUNT)).toBeNull();
  });
});

// ── the local-effect surface ─────────────────────────────────────────────────

describe('mutate', () => {
  /**
   * Live mode has nothing to mutate: the chain moved and the next read is the truth.
   * The methods exist so callers do not have to know which module they hold, and they
   * do nothing so that no figure is ever written down locally and then contradicted.
   */
  it('does not throw and does not pretend to move anything', () => {
    expect(() => live.mutate.borrow(1n)).not.toThrow();
    expect(() => live.mutate.depositBtc(1n)).not.toThrow();
    expect(() => live.mutate.earnWithdraw(1n)).not.toThrow();
  });
});
