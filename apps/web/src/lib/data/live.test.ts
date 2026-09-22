import { describe, expect, it, vi } from 'vitest';
import { type PublicClient } from 'viem';
import { WAD } from '@maren/sdk';
import { readPosition, readProtocolStats, type LiveContext } from './live';
import { readTrovePosition } from '../chain/hints';

const entireTrove = [3n * WAD, 2200n * WAD, 3n * WAD, WAD, 40n * WAD, WAD] as const;

function context(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    getEntireDebtAndColl: entireTrove,
    getTroveMaxBorrowingCapacity: 3000n * WAD,
    collateral: WAD,
    previewDebtOf: 0n,
    maxBorrowable: 100n * WAD,
    troveMaxBorrowingCapacity: 3000n * WAD,
    getTroveDebt: 2203n * WAD,
    totalCollateral: 4n * WAD,
    // The legacy vault's helper can double-count pending values; its ICR is read
    // directly from Mezo, but collateral/debt must come from the authoritative tuple.
    troveStatus: [4n * WAD, 2044n * WAD, 2n * WAD],
    reserveMUSD: 9n * WAD,
    borrowingRate: WAD / 1000n,
    depositsPaused: false,
    borrowingPaused: false,
    troveOpen: true,
    depositCap: 5n * WAD,
    idleCollateral: 0n,
    decimals: 18,
    latestRoundData: [1n, 63_000n * WAD, 1n, 1n, 1n],
    getTCR: 2n * WAD,
    checkRecoveryMode: false,
    ...overrides,
  };
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
    const value = values[functionName];
    if (value instanceof Error) throw value;
    return value;
  });
  const ctx: LiveContext = {
    account: '0x1111111111111111111111111111111111111111',
    network: 'testnet',
    client: { readContract } as unknown as PublicClient,
  };
  return { ctx, readContract };
}

describe('Mezo lending read semantics', () => {
  it('does not add pending redistribution components twice to the direct position', async () => {
    const { ctx } = context();
    expect(await readPosition(ctx)).toMatchObject({
      collateralWei: 3n * WAD,
      principalWei: 2000n * WAD,
      interestWei: 3n * WAD,
      debtWei: 2203n * WAD,
      route: 'direct',
    });
  });

  it('uses the same already-inclusive values when calculating sorted-trove hints', async () => {
    const { ctx } = context();
    expect(await readTrovePosition(ctx.client, ctx.network)).toEqual({
      collWei: 3n * WAD,
      debtWei: 2203n * WAD,
    });
  });

  it('reads the accounting reserve and live fee, and avoids legacy double-counted pool debt', async () => {
    const { ctx, readContract } = context();
    expect(await readProtocolStats(ctx)).toMatchObject({
      reserveMusdWei: 9n * WAD,
      borrowingRateWei: WAD / 1000n,
      troveCollateralWei: 3n * WAD,
      troveNetDebtWei: 2003n * WAD,
    });
    expect(readContract.mock.calls.some(([call]) => call.functionName === 'balanceOf')).toBe(false);
  });

  it('preserves an unavailable fee instead of silently using a constant', async () => {
    const { ctx } = context({ borrowingRate: new Error('unavailable') });
    expect((await readProtocolStats(ctx)).borrowingRateWei).toBeNull();
  });
});
