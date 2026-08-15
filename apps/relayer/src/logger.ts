import { createHash, randomUUID } from 'node:crypto';
import pino, { type Logger } from 'pino';

/**
 * Structured logging.
 *
 * Rules, enforced by construction rather than by discipline:
 *   - We never log a private key, a signature, or a full request body. The
 *     redaction list below is the second line of defence; the first is that
 *     nothing in this codebase passes a raw body to the logger.
 *   - `data` (the signed calldata) is logged only as its 4-byte selector plus a
 *     length. Calldata contains recipients and amounts; the selector does not.
 *   - Client IPs are logged as a salted hash, never in the clear. Rate limiting
 *     needs to distinguish IPs, not to know them.
 */

const REDACT_PATHS = [
  'signature',
  '*.signature',
  'req.signature',
  'request.signature',
  'privateKey',
  '*.privateKey',
  'password',
  '*.password',
  'RELAYER_PRIVATE_KEY',
  'RELAYER_KEYSTORE_PASSWORD',
  'body',
  '*.body',
  'headers.authorization',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'maren-relayer' },
    // BigInt is everywhere in this service and JSON.stringify throws on it.
    serializers: {
      err: pino.stdSerializers.err,
    },
    formatters: {
      log(object) {
        return normaliseBigints(object) as Record<string, unknown>;
      },
    },
  });
}

function normaliseBigints(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normaliseBigints);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normaliseBigints(v);
    }
    return out;
  }
  return value;
}

export function newRequestId(): string {
  return randomUUID();
}

/**
 * Salted, truncated hash of a client IP. Not reversible to an address in a log
 * dump, but stable enough to rate-limit on.
 *
 * The salt MUST come from `RELAYER_IP_SALT` in any multi-instance deployment:
 * a per-process random salt would give each serverless instance a different key
 * for the same IP, which silently multiplies the per-IP limit by the instance
 * count. When the variable is absent we fall back to a random salt and the
 * caller is expected to surface it as a degraded-posture warning.
 */
const IP_SALT = process.env['RELAYER_IP_SALT']?.trim() || randomUUID();

export const IP_SALT_IS_EPHEMERAL = !process.env['RELAYER_IP_SALT']?.trim();

export function hashIp(ip: string): string {
  return createHash('sha256').update(IP_SALT).update(ip).digest('hex').slice(0, 24);
}

export type { Logger };
