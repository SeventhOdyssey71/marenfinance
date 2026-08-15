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
 *   a bare 0x-prefixed 20-byte address
 *
 * Note the deliberate absence of a `maren://` form. The same reasoning as R12 applies:
 * an https payload resolves through a domain Apple verified against this app, whereas a
 * custom scheme can be claimed by any app that asks for it.
 */

export interface PaymentPayload {
  to: string;
  amount?: string;
}

export const PAYMENT_HOST = 'maren.finance';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** MarenRegistry handles: 3–32 chars of [a-z0-9_]. */
const HANDLE = /^@[a-z0-9_]{3,32}$/;

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
