/**
 * Typed relayer failures.
 *
 * R16 — "Prefer an explicit typed failure over a silent fallback."
 * Every rejection path in this service produces one of these codes. There is no
 * path that quietly spends Maren's BTC because a check was inconclusive, and no
 * path that returns 200 with an empty body when something went wrong.
 *
 * The `code` is part of the public API contract: clients switch on it. The
 * `detail` is for humans and MUST NOT contain a signature, a private key, or any
 * raw request body.
 */

export type RelayErrorCode =
  // --- request shape -------------------------------------------------------
  | 'MALFORMED_REQUEST'
  | 'UNSUPPORTED_CHAIN'
  // --- signature / identity (R1, R2) --------------------------------------
  | 'INVALID_SIGNATURE'
  | 'SIGNER_MISMATCH'
  | 'NONCE_MISMATCH'
  | 'REQUEST_EXPIRED'
  | 'DEADLINE_TOO_FAR'
  // --- allowlist (R4) ------------------------------------------------------
  | 'TARGET_NOT_ALLOWED'
  | 'SELECTOR_NOT_ALLOWED'
  | 'CALLDATA_UNDECODABLE'
  // --- custody (R3) --------------------------------------------------------
  | 'VALUE_NOT_PERMITTED'
  | 'GAS_LIMIT_TOO_HIGH'
  // --- sponsorship economics (R16) ----------------------------------------
  | 'SPONSORSHIP_FEE_REQUIRED'
  | 'SPONSORSHIP_UNAVAILABLE'
  | 'FEE_BELOW_REQUIRED'
  | 'ADDRESS_RATE_LIMIT'
  | 'IP_RATE_LIMIT'
  | 'GLOBAL_DAILY_BUDGET_EXHAUSTED'
  // --- execution -----------------------------------------------------------
  | 'SIMULATION_REVERTED'
  | 'SUBMISSION_FAILED'
  | 'RELAYER_UNDERFUNDED'
  // --- posture (R8) --------------------------------------------------------
  | 'RELAYER_NOT_ACCEPTING'
  | 'RELAYER_SHUTTING_DOWN'
  | 'STORE_UNAVAILABLE'
  // --- lookups -------------------------------------------------------------
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR';

/** Extra machine-readable context. Never contains secrets. */
export type RelayErrorMeta = Record<string, string | number | boolean | null>;

export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly status: number;
  readonly meta: RelayErrorMeta;

  constructor(code: RelayErrorCode, status: number, detail: string, meta: RelayErrorMeta = {}) {
    super(detail);
    this.name = 'RelayError';
    this.code = code;
    this.status = status;
    this.meta = meta;
  }

  toJSON(): { error: RelayErrorCode; detail: string; meta: RelayErrorMeta } {
    return { error: this.code, detail: this.message, meta: this.meta };
  }
}

export const bad = (code: RelayErrorCode, detail: string, meta?: RelayErrorMeta): RelayError =>
  new RelayError(code, 400, detail, meta);

export const unauthorized = (
  code: RelayErrorCode,
  detail: string,
  meta?: RelayErrorMeta,
): RelayError => new RelayError(code, 401, detail, meta);

export const forbidden = (
  code: RelayErrorCode,
  detail: string,
  meta?: RelayErrorMeta,
): RelayError => new RelayError(code, 403, detail, meta);

/**
 * 402 Payment Required. Used for exactly one thing: the address has spent its
 * free sponsored actions and the signed request does not carry a sufficient
 * in-band MUSD fee. We never fall back to paying for it ourselves (R16).
 */
export const paymentRequired = (
  code: RelayErrorCode,
  detail: string,
  meta?: RelayErrorMeta,
): RelayError => new RelayError(code, 402, detail, meta);

export const rateLimited = (
  code: RelayErrorCode,
  detail: string,
  meta?: RelayErrorMeta,
): RelayError => new RelayError(code, 429, detail, meta);

export const conflict = (code: RelayErrorCode, detail: string, meta?: RelayErrorMeta): RelayError =>
  new RelayError(code, 409, detail, meta);

export const unavailable = (
  code: RelayErrorCode,
  detail: string,
  meta?: RelayErrorMeta,
): RelayError => new RelayError(code, 503, detail, meta);

export const notFound = (detail: string, meta?: RelayErrorMeta): RelayError =>
  new RelayError('NOT_FOUND', 404, detail, meta);

export const upstream = (detail: string, meta?: RelayErrorMeta): RelayError =>
  new RelayError('UPSTREAM_ERROR', 502, detail, meta);

export function isRelayError(err: unknown): err is RelayError {
  return err instanceof RelayError;
}
