/**
 * Payment payload parsing for the QR scanner.
 *
 * A QR code is untrusted input handed over by a stranger, so this is a strict,
 * allowlisted parse with no clever fallbacks. It lives in its own module, free of React
 * Native imports, so it can be unit tested directly — the scanner screen is a thin shell
 * over it.
 *
 * Accepted, and nothing else:
 *   https://maren.finance/pay?to=@handle|0xaddress[&amount=…]
 *   https://maren.finance/claim?id=N#<0x…64-hex bearer secret>
 *   a bare 0x-prefixed 20-byte address
 *
 * Note the deliberate absence of a `maren://` form. The same reasoning as R12 applies:
 * an https payload resolves through a domain Apple verified against this app, whereas a
 * custom scheme can be claimed by any app that asks for it.
 */

import type { Hex } from 'viem';

export interface PaymentPayload {
  to: string;
  amount?: string;
}

export const PAYMENT_HOST = 'maren.finance';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** MarenRegistry handles: 3–32 chars of [a-z0-9_]. */
const HANDLE = /^@[a-z0-9_]{3,32}$/;
/** A one-time secp256k1 private key: 0x + exactly 32 bytes of hex. */
const SECRET = /^0x[0-9a-fA-F]{64}$/;

export function parsePaymentPayload(raw: string): PaymentPayload | null {
  const value = raw.trim();

  if (ADDRESS.test(value)) return { to: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  // Host allowlist, checked before any parameter is read.
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== PAYMENT_HOST) return null;
  if (url.pathname !== '/pay') return null;

  const to = url.searchParams.get('to');
  if (!to) return null;
  if (!HANDLE.test(to) && !ADDRESS.test(to)) return null;

  const amount = url.searchParams.get('amount');
  // A malformed amount drops the amount rather than the whole payload: the recipient is
  // still trustworthy, and the user can type the figure. It is never passed through
  // unvalidated.
  if (amount !== null && /^\d+(\.\d+)?$/.test(amount)) return { to, amount };

  return { to };
}

/** Build the payload the Request screen encodes. */
export function buildPaymentPayload(to: string, amount?: string): string {
  const url = new URL(`https://${PAYMENT_HOST}/pay`);
  url.searchParams.set('to', to);
  if (amount && /^\d+(\.\d+)?$/.test(amount)) url.searchParams.set('amount', amount);
  return url.toString();
}

/**
 * Build the shareable link for a claimable payment.
 *
 * THE SECRET GOES IN THE FRAGMENT, DELIBERATELY. `#secret` is never sent to a server by any
 * browser — it stays on the device that opens the link — so the one-time private key that
 * authorises the claim does not leak to `maren.finance`'s logs or to any proxy in between.
 * This mirrors MarenPay's own design note on `createLink`: the private key travels in the URL
 * fragment and never touches the chain until the claimer signs their own address with it.
 *
 * The id is the on-chain `linkId`. Both are required; a link missing either cannot be claimed.
 * The secret is a bearer token — anyone holding this string can claim the funds — so it is
 * shown once, shared by the user, and never logged.
 */
export function buildClaimLink(linkId: bigint, secret: string): string {
  const url = new URL(`https://${PAYMENT_HOST}/claim`);
  url.searchParams.set('id', linkId.toString());
  url.hash = secret;
  return url.toString();
}

export interface ClaimLink {
  linkId: bigint;
  /** The bearer signing key. A secret — hold it only as long as the claim needs it. */
  secret: Hex;
}

/**
 * Parse a claimable-link URL back into its id and bearer secret.
 *
 * The mirror of `buildClaimLink`, and as strict as the payment parser above: a claim link
 * is untrusted input handed over by a stranger, so this is an allowlisted parse with no
 * fallbacks. A malformed link returns `null` and the screen fails closed with an honest
 * message rather than reaching for the chain.
 *
 * THE SECRET IS READ ONLY FROM THE FRAGMENT, NEVER THE QUERY. `#secret` is never sent to a
 * server, which is the entire reason `buildClaimLink` puts it there; reading it from the
 * query instead would defeat that, so a link that carries anything secret-shaped in a query
 * parameter is not honoured — the fragment is the only place looked at. The id is read from
 * the query. Both must be present and well-formed or the whole link is rejected.
 */
export function parseClaimLink(raw: string): ClaimLink | null {
  const value = raw.trim();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  // Host allowlist, checked before any parameter is read.
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== PAYMENT_HOST) return null;
  if (url.pathname !== '/claim') return null;

  const id = url.searchParams.get('id');
  if (id === null || !/^\d+$/.test(id)) return null;
  let linkId: bigint;
  try {
    linkId = BigInt(id);
  } catch {
    return null;
  }
  // Link ids start at 1 on-chain (`nextLinkId = 1`); a zero id is never a real link.
  if (linkId <= 0n) return null;

  // Only the fragment. `url.hash` is `#<secret>` or empty; anything not exactly a 32-byte
  // hex key is rejected, so a truncated or tampered fragment fails closed.
  const secret = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  if (!SECRET.test(secret)) return null;

  return { linkId, secret: secret.toLowerCase() as Hex };
}
