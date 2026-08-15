import { describe, expect, it } from 'vitest';
import type { Hash, TransactionReceipt } from 'viem';

import {
  AUTH_REDIRECT_URI,
  InsecureRedirectError,
  assertVerifiableRedirect,
  parseCallback,
  timingSafeEqualString,
} from './auth/webAuth';
import { classifyPrice, priceGate, usablePrice, STALE_AFTER_SECONDS } from './chain/price';
import { confirmTransaction } from './chain/receipt';
import { parsePaymentPayload, buildPaymentPayload } from './lib/payment';

/**
 * Tests for the three rules the brief calls out by number.
 *
 * These are deliberately the only tests in the app. They cover the assertions that, if
 * they silently regressed, would reproduce a finding from Talise's audit — not the
 * rendering of a card.
 */

const HASH = '0xaaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990' as Hash;

// ── R12: no bare custom URL scheme ───────────────────────────────────────────

describe('R12 — auth redirect must be a verified universal link', () => {
  it('rejects the exact failure mode Talise shipped: a custom scheme', () => {
    // Talise M1: the bearer token arrived over `talise://`, claimable by any other app.
    expect(() => assertVerifiableRedirect('maren://auth/callback')).toThrow(InsecureRedirectError);
    expect(() => assertVerifiableRedirect('finance.maren.app://callback')).toThrow(
      InsecureRedirectError,
    );
  });

  it('rejects http, even on the right host', () => {
    expect(() => assertVerifiableRedirect('http://maren.finance/auth/callback')).toThrow(
      InsecureRedirectError,
    );
  });

  it('rejects an https redirect on a look-alike origin', () => {
    expect(() => assertVerifiableRedirect('https://maren.finance.evil.com/auth/callback')).toThrow(
      InsecureRedirectError,
    );
    expect(() => assertVerifiableRedirect('https://marenfinance.com/auth/callback')).toThrow(
      InsecureRedirectError,
    );
  });

  it('accepts the configured universal link', () => {
    expect(() => assertVerifiableRedirect(AUTH_REDIRECT_URI)).not.toThrow();
  });
});

describe('R12 — CSRF state is compared in constant time', () => {
  it('matches only identical strings', () => {
    expect(timingSafeEqualString('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualString('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualString('abc123', 'abc12')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString('a', '')).toBe(false);
  });

  it('walks the full length regardless of where the difference is', () => {
    // Not a timing measurement — that is unreliable in CI. This asserts the property we
    // can assert deterministically: an early difference and a late difference are both
    // reported, and neither short-circuits into a different result shape.
    expect(timingSafeEqualString('xbcdef', 'abcdef')).toBe(false);
    expect(timingSafeEqualString('abcdex', 'abcdef')).toBe(false);
  });
});

describe('R12 — callback validation', () => {
  const state = 'f'.repeat(64);

  it('returns the code when origin and state both check out', () => {
    const result = parseCallback(`${AUTH_REDIRECT_URI}?code=abc&state=${state}`, state);
    expect(result).toEqual({ kind: 'success', code: 'abc' });
  });

  it('reports a CSRF mismatch rather than reading the code', () => {
    const result = parseCallback(`${AUTH_REDIRECT_URI}?code=abc&state=${'e'.repeat(64)}`, state);
    expect(result.kind).toBe('csrf-mismatch');
  });

  it('refuses a callback that arrives on an untrusted origin', () => {
    const result = parseCallback(`https://evil.example/auth/callback?code=abc&state=${state}`, state);
    expect(result.kind).toBe('error');
  });

  it('refuses a callback delivered over a custom scheme', () => {
    const result = parseCallback(`maren://auth/callback?code=abc&state=${state}`, state);
    expect(result.kind).toBe('error');
  });
});

// ── R15: a transaction hash is not a success ─────────────────────────────────

function clientReturning(receipt: Partial<TransactionReceipt>) {
  return {
    waitForTransactionReceipt: async () => receipt as TransactionReceipt,
  };
}

describe('R15 — only a receipt with status success is a delivery', () => {
  it('treats status "success" as delivered', async () => {
    const outcome = await confirmTransaction(
      clientReturning({
        status: 'success',
        blockNumber: 100n,
        gasUsed: 21_000n,
        effectiveGasPrice: 1_000_000_000n,
      }),
      HASH,
    );
    expect(outcome.kind).toBe('delivered');
  });

  it('treats status "reverted" as a failure even though a hash exists', async () => {
    // This is the Talise finding: a digest-bearing FailedTransaction returned as 200.
    const outcome = await confirmTransaction(
      clientReturning({ status: 'reverted', blockNumber: 100n, gasUsed: 21_000n }),
      HASH,
    );
    expect(outcome.kind).toBe('reverted');
  });

  it('distinguishes a timeout from a failure', async () => {
    const outcome = await confirmTransaction(
      {
        waitForTransactionReceipt: async () => {
          throw new Error('Timed out while waiting for transaction receipt.');
        },
      },
      HASH,
    );
    // Critically NOT 'reverted' — the transaction may still land.
    expect(outcome.kind).toBe('timeout');
  });

  it('distinguishes an unreachable node from a failure', async () => {
    const outcome = await confirmTransaction(
      {
        waitForTransactionReceipt: async () => {
          throw new Error('fetch failed');
        },
      },
      HASH,
    );
    expect(outcome.kind).toBe('unreachable');
  });

  it('reports zero user-paid gas when the relayer sponsored the transaction', async () => {
    const outcome = await confirmTransaction(
      clientReturning({
        status: 'success',
        blockNumber: 1n,
        gasUsed: 150_000n,
        effectiveGasPrice: 1_200_000_000n,
      }),
      HASH,
      { sponsored: true },
    );
    expect(outcome.kind).toBe('delivered');
    if (outcome.kind === 'delivered') expect(outcome.receipt.gasPaidByUser).toBe(0n);
  });
});

// ── Oracle staleness ─────────────────────────────────────────────────────────

describe('price feed staleness', () => {
  const NOW = 1_800_000_000;
  const price = 63_000n * 10n ** 18n;

  it('uses the protocol’s own 60 second limit', () => {
    expect(STALE_AFTER_SECONDS).toBe(60);
  });

  it('is live exactly at the boundary', () => {
    const feed = classifyPrice({ priceWei: price, updatedAt: NOW - 60 }, NOW);
    expect(feed.state).toBe('live');
  });

  it('is stale one second past the boundary', () => {
    const feed = classifyPrice({ priceWei: price, updatedAt: NOW - 61 }, NOW);
    expect(feed.state).toBe('stale');
  });

  it('never exposes a usable price once stale', () => {
    const feed = classifyPrice({ priceWei: price, updatedAt: NOW - 120 }, NOW);
    expect(usablePrice(feed)).toBeNull();
  });

  it('gates borrowing closed on every non-live state', () => {
    expect(priceGate(classifyPrice(null, NOW)).allowed).toBe(false);
    expect(priceGate(classifyPrice({ priceWei: price, updatedAt: NOW - 900 }, NOW)).allowed).toBe(false);
    expect(priceGate({ state: 'loading' }).allowed).toBe(false);
    expect(priceGate(classifyPrice({ priceWei: price, updatedAt: NOW }, NOW)).allowed).toBe(true);
  });

  it('gives a reason whenever it denies', () => {
    const gate = priceGate(classifyPrice({ priceWei: price, updatedAt: NOW - 300 }, NOW));
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/60s/);
  });
});

// ── QR payload allowlist ─────────────────────────────────────────────────────

describe('payment QR parsing is allowlisted', () => {
  const addr = '0x8F3a4C21B7dE05aE9c1f6b2E4D8a70915cC3B4d2';

  it('accepts a bare address', () => {
    expect(parsePaymentPayload(addr)).toEqual({ to: addr });
  });

  it('accepts a Maren payment URL with a handle', () => {
    expect(parsePaymentPayload('https://maren.finance/pay?to=@sele&amount=25.50')).toEqual({
      to: '@sele',
      amount: '25.50',
    });
  });

  it('rejects another host', () => {
    expect(parsePaymentPayload('https://evil.example/pay?to=@sele')).toBeNull();
  });

  it('rejects a custom scheme payload', () => {
    expect(parsePaymentPayload('maren://pay?to=@sele')).toBeNull();
  });

  it('rejects http', () => {
    expect(parsePaymentPayload('http://maren.finance/pay?to=@sele')).toBeNull();
  });

  it('rejects a malformed handle', () => {
    expect(parsePaymentPayload('https://maren.finance/pay?to=@Bad-Handle!')).toBeNull();
  });

  it('drops a malformed amount but keeps a valid recipient', () => {
    expect(parsePaymentPayload('https://maren.finance/pay?to=@sele&amount=1e9')).toEqual({
      to: '@sele',
    });
  });

  it('round-trips what it builds', () => {
    const built = buildPaymentPayload('@sele', '12.34');
    expect(parsePaymentPayload(built)).toEqual({ to: '@sele', amount: '12.34' });
  });
});
