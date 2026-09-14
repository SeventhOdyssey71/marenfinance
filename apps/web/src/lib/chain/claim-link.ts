import { privateKeyToAccount } from 'viem/accounts';
import { isAddressEqual, type Address, type Hex } from 'viem';

export type ParsedClaimLink =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; secret: Hex; linkKey: Address; linkId: bigint | null };

/** Read bearer credentials only from the fragment, never a query parameter. */
export function parseClaimLink(hash: string, search: string): ParsedClaimLink {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return { kind: 'missing' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) return { kind: 'invalid' };
  const ids = new URLSearchParams(search).getAll('id');
  if (ids.length > 1 || (ids.length === 1 && !/^(0|[1-9][0-9]{0,77})$/.test(ids[0]!))) {
    return { kind: 'invalid' };
  }
  const linkId = ids.length ? BigInt(ids[0]!) : null;
  if (linkId !== null && linkId >= 2n ** 256n) return { kind: 'invalid' };
  try {
    const secret = raw.toLowerCase() as Hex;
    return { kind: 'valid', secret, linkKey: privateKeyToAccount(secret).address, linkId };
  } catch {
    // Correct-length hex can still be zero or outside the secp256k1 scalar field.
    return { kind: 'invalid' };
  }
}

/** An ID in a shared URL is a hint, never proof that this key owns the escrow. */
export function claimRecordMatches(
  creator: Address,
  recordKey: Address,
  linkKey: Address,
): boolean {
  return (
    creator !== '0x0000000000000000000000000000000000000000' && isAddressEqual(recordKey, linkKey)
  );
}
