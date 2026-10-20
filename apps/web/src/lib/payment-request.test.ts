import { describe, expect, it } from 'vitest';
import { parsePaymentRequest } from './payment-request';

describe('native payment-link web handoff', () => {
  it('accepts a handle and a decimal amount without preparing a transaction', () => {
    expect(parsePaymentRequest(new URLSearchParams('to=%40alice&amount=12.50'))).toEqual({
      to: '@alice',
      amount: '12.50',
    });
  });
  it('accepts an address without an amount', () => {
    const to = `0x${'12'.repeat(20)}`;
    expect(parsePaymentRequest(new URLSearchParams({ to }))).toEqual({ to });
  });
  it.each([
    'to=@alice&to=@bob',
    'to=@alice&amount=1&amount=2',
    'to=@alice&amount=-1',
    'to=@alice&amount=1e3',
    'to=@alice&amount=1.0000000000000000001',
    'to=https://other.test',
  ])('rejects ambiguous or invalid prefills: %s', (search) => {
    expect(parsePaymentRequest(new URLSearchParams(search))).toBeNull();
  });
});
