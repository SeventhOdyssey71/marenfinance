import { describe, expect, it } from 'vitest';
import { parseClaimLink, claimRecordMatches } from './claim-link';

const secret = `0x${'1'.padStart(64, '0')}`;
const key = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const creator = '0x2222222222222222222222222222222222222222';

describe('claim link credentials', () => {
  it('accepts iOS id links and legacy fragment-only links', () => {
    expect(parseClaimLink(`#${secret}`, '?id=42')).toMatchObject({
      kind: 'valid',
      linkId: 42n,
      linkKey: key,
    });
    expect(parseClaimLink(`#${secret}`, '')).toMatchObject({ kind: 'valid', linkId: null });
  });
  it('never uses a secret from a query parameter', () => {
    expect(parseClaimLink('', `?secret=${secret}&id=42`)).toEqual({ kind: 'missing' });
  });
  it.each(['0x' + '0'.repeat(64), '0x' + 'f'.repeat(64), 'not-a-key'])(
    'rejects invalid private keys',
    (value) => {
      expect(parseClaimLink(`#${value}`, '')).toEqual({ kind: 'invalid' });
    },
  );
  it.each(['?id=-1', '?id=1&id=2', '?id=', '?id=1.5', '?id=0x10', `?id=${2n ** 256n}`])(
    'rejects malformed ids %s',
    (query) => {
      expect(parseClaimLink(`#${secret}`, query)).toEqual({ kind: 'invalid' });
    },
  );
  it('rejects a valid id belonging to a different secret or missing escrow', () => {
    expect(claimRecordMatches(creator, creator, key)).toBe(false);
    expect(claimRecordMatches('0x0000000000000000000000000000000000000000', key, key)).toBe(false);
    expect(claimRecordMatches(creator, key, key)).toBe(true);
  });
});
