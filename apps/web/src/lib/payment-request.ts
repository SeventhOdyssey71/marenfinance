/** Shared native payment links only prefill an unsigned reviewable payment. */
export function parsePaymentRequest(
  query: URLSearchParams,
): { to: string; amount?: string } | null {
  const recipients = query.getAll('to');
  const amounts = query.getAll('amount');
  if (recipients.length !== 1 || amounts.length > 1) return null;
  const to = recipients[0]!;
  if (!/^@[a-z0-9_]{3,32}$/.test(to) && !/^0x[0-9a-fA-F]{40}$/.test(to)) return null;
  const amount = amounts[0];
  if (amount !== undefined && !/^\d{1,60}(?:\.\d{1,18})?$/.test(amount)) return null;
  return { to, ...(amount !== undefined ? { amount } : {}) };
}
