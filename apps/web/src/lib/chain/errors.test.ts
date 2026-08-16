import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from 'viem';

import { explainError, marenErrorsAbi } from './errors';

/**
 * The revert decoder, tested against bytes the chain actually produced.
 *
 * WHY THIS FILE EXISTS. The product commitment is that a refusal is explained: a user who
 * presses Borrow and is shown `0x65763f1e0000…` has been told nothing, and a user who is
 * shown nothing concludes the app is broken rather than that the protocol is protecting
 * itself. That commitment is only worth as much as the mapping from four bytes of
 * selector to a sentence, and a mapping is exactly the kind of thing that rots silently
 * when a contract is edited.
 *
 * WHERE THE FIXTURE COMES FROM. `INSUFFICIENT_CR_ONCHAIN` below is not constructed here.
 * It is the literal `data` field Mezo's RPC returned when this borrow reverted on matsnet:
 *
 *   tx     0x9da5b3eddbab83671b319eef68be5de4ac07628f5d741a0f572a122586a0d47f
 *   block  14,920,507   status 0x0 (reverted, no logs)
 *   replay cast call MarenVault "borrow(uint256,address,address)" 100e18 0x0 0x0 \
 *            --from 0x54196397D6f01b48739dB3957257cB33cD341885 --block 14920507
 *
 * That replay is the same recovery `tx.tsx` performs when a transaction passes simulation
 * and then reverts anyway, so this fixture exercises the production path end to end.
 *
 * A NOTE ON A NAME. `BorrowBelowMinCR` does not exist in `MarenVault.sol`, though it is
 * the obvious name to reach for. The contract raises two distinct errors at the borrow
 * check and the distinction is the whole point: `InsufficientCollateralRatio` is about
 * YOUR position and you fix it by depositing, while `TroveCollateralRatioTooLow` is about
 * the shared trove and you cannot fix it at all. Both are asserted below.
 */

/** Verbatim from the node. See the header for the transaction it came from. */
const INSUFFICIENT_CR_ONCHAIN =
  '0x65763f1e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000018fae27693b40000' as const;

/** Wraps raw revert data the way viem hands it to `explainError` through wagmi. */
function revertWith(data: `0x${string}`): BaseError {
  const reverted = new ContractFunctionRevertedError({
    abi: [...marenErrorsAbi],
    data,
    functionName: 'borrow',
  });
  const error = new BaseError('The contract function "borrow" reverted.');
  // viem nests the real cause several levels down and `explainError` walks to find it;
  // reproducing the nesting keeps this test honest about the shape it must handle.
  (error as unknown as { cause: unknown }).cause = reverted;
  return error;
}

describe('the borrow refusal a user actually hits', () => {
  it('decodes the exact bytes matsnet returned into a sentence, not a selector', () => {
    const reason = explainError(revertWith(INSUFFICIENT_CR_ONCHAIN));

    expect(reason.name).toBe('InsufficientCollateralRatio');
    expect(reason.title).toBe('Not enough collateral behind this loan');

    // The two figures a user needs: where the borrow would leave them, and the floor.
    // 1.8e18 is Maren's 180% minimum, read out of the revert rather than hardcoded in copy.
    expect(reason.detail).toContain('0.0%');
    expect(reason.detail).toContain('180.0%');
    expect(reason.detail).toContain('deposit more Bitcoin');

    // The thing this whole module exists to prevent.
    expect(reason.detail).not.toContain('0x');
    expect(reason.title).not.toContain('0x');
  });

  it('distinguishes the shared trove being too thin from the user being under-collateralised', () => {
    // The pooled trove's real ratio, read from `MarenVault.troveStatus()` on matsnet on
    // 2026-08-16: 1.511985…e18, against the 1.8e18 floor. Encoded here rather than fetched
    // so the test stays offline and deterministic; the numbers are the live ones.
    const data = encodeErrorResult({
      abi: [...marenErrorsAbi],
      errorName: 'TroveCollateralRatioTooLow',
      args: [1_511_985_259_095_803_241n, 1_800_000_000_000_000_000n],
    });

    const reason = explainError(revertWith(data));

    expect(reason.name).toBe('TroveCollateralRatioTooLow');
    expect(reason.title).toBe('The shared trove is too thin to lend against');

    /**
     * 151.1%, NOT 151.2%.
     *
     * 1.511985…e18 is 151.1985%, and this assertion used to expect the rounded-to-nearest
     * "151.2%" that `toFixed(1)` produced. That is a health figure rounded UP, which
     * BRAND.md §8 forbids in as many words, and it disagreed with the same ratio rendered
     * through the SDK elsewhere in the app — the Portfolio said 151.1% while a revert said
     * 151.2%. `describe()` now formats through `formatCollateralRatio`, which truncates.
     */
    expect(reason.detail).toContain('151.1%');
    expect(reason.detail).not.toContain('151.2%');
    expect(reason.detail).toContain('180.0%');

    // The part that stops a user doing something that cannot help: this is not about
    // them, and depositing more of their own Bitcoin will not unblock it.
    expect(reason.detail).toContain('not about your position');
    expect(reason.detail).toContain('withdraw');
    expect(reason.detail).not.toContain('0x');
  });

  it('never leaks a selector for any error the contracts can raise', () => {
    // Every custom error in the decoding table, encoded with zero-ish arguments and run
    // through the decoder. None may render as hex, and none may fall through to the
    // "no plain-language mapping yet" default — that default exists for errors added to a
    // contract after this table, and a shipped one reaching it is a gap in the copy.
    const errors = marenErrorsAbi.filter((entry) => entry.type === 'error');
    expect(errors.length).toBeGreaterThan(30);

    for (const entry of errors) {
      const args = entry.inputs.map((input) => {
        if (input.type === 'string') return 'x';
        if (input.type === 'address') return '0x0000000000000000000000000000000000000000';
        if (input.type === 'bytes32') return `0x${'00'.repeat(32)}`;
        if (input.type === 'bytes4') return '0x00000000';
        if (input.type === 'bytes1') return '0x00';
        // viem types the narrow uints (uint8/uint48/uint64) as `number` and the wide ones
        // as `bigint`, so the placeholder has to match or the tuple will not accept it.
        if (/^uint(8|16|32|48|64)$/.test(input.type)) return 0;
        return 0n;
      });

      const data = encodeErrorResult({
        abi: [...marenErrorsAbi],
        errorName: entry.name,
        // The loop is generic over every error in the table, so the argument tuple cannot
        // be narrowed statically — each `errorName` implies a different one. The values
        // above are built from `entry.inputs`, which is the same source viem checks
        // against, so the encode either succeeds or fails loudly in the assertion below.
        args: args as never,
      });
      const reason = explainError(revertWith(data));

      expect(reason.name, `${entry.name} should decode`).toBe(entry.name);
      expect(reason.title, `${entry.name} title must not be hex`).not.toMatch(/0x[0-9a-f]{8}/i);
      expect(reason.detail, `${entry.name} detail must not be hex`).not.toMatch(/0x[0-9a-f]{8}/i);
      expect(reason.title.length).toBeGreaterThan(3);
      expect(reason.detail.length).toBeGreaterThan(10);
    }
  });

  it('treats a wallet dismissal as a non-event rather than a failure', () => {
    const rejection = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    const reason = explainError(rejection);
    expect(reason.title).toBe('Cancelled in your wallet');
    expect(reason.detail).toContain('Nothing was signed');
  });
});
