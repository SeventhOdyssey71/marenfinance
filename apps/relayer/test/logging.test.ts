import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createLogger, ephemeralIpSalt, hashIp, REDACT_PATHS } from '../src/logger.js';
import { buildTestRelayer, makeEnv, signedRequest, USER } from './helpers.js';
import { createRelayer } from '../src/create.js';
import { FakeChain } from './helpers.js';
import { MemoryStore } from '../src/store.js';

/**
 * R13 applied to us: "do not claim an attestation you have not implemented."
 *
 * `logger.ts` claims three things — signatures and keys are never logged, the
 * calldata is reduced to a selector, and client IPs are hashed rather than
 * stored. Review found all three unverified: mutating the redaction list or
 * making `hashIp` return its input broke no test. Either the claims get tested
 * or they come out of the comment. They are tested here.
 */

describe('hashIp', () => {
  const salt = 'a-fixed-salt';

  it('does not return the address it was given', () => {
    // The mutation that motivated this test: `return ip`.
    expect(hashIp('203.0.113.9', salt)).not.toBe('203.0.113.9');
    expect(hashIp('203.0.113.9', salt)).not.toContain('203.0.113');
  });

  it('is a fixed-width hex digest', () => {
    expect(hashIp('203.0.113.9', salt)).toMatch(/^[0-9a-f]{24}$/);
  });

  it('is stable for the same address, so rate limiting works at all', () => {
    expect(hashIp('203.0.113.9', salt)).toBe(hashIp('203.0.113.9', salt));
  });

  it('separates different addresses', () => {
    expect(hashIp('203.0.113.9', salt)).not.toBe(hashIp('203.0.113.10', salt));
  });

  it('separates the same address under different salts', () => {
    // This is exactly why a per-instance random salt breaks a shared limit.
    expect(hashIp('203.0.113.9', 'salt-a')).not.toBe(hashIp('203.0.113.9', 'salt-b'));
  });

  it('generates distinct ephemeral salts', () => {
    expect(ephemeralIpSalt()).not.toBe(ephemeralIpSalt());
  });
});

/**
 * These exercise the REAL `createLogger` against the REAL `REDACT_PATHS`.
 *
 * The previous version rebuilt an approximation of the config with an inline
 * copy of the path list, so emptying `redact.paths` in `logger.ts` left the
 * suite green — and the copy had already drifted to 6 of the 12 entries. A test
 * that cannot fail when the thing it names is deleted is not a test.
 */
describe('pino redaction', () => {
  function realLogger(): { logger: ReturnType<typeof createLogger>; output: () => string } {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    return { logger: createLogger('trace', stream), output: () => chunks.join('') };
  }

  /** One sensitive value per configured path, so every entry is covered. */
  const SECRET = 'S3CRET-CANARY';

  function payloadFor(path: string): Record<string, unknown> {
    // Build the nested object a given redaction path would match.
    const segments = path.split('.');
    const leaf = segments.at(-1)!;
    if (segments.length === 1) return { [leaf]: SECRET };
    const parent = segments[0] === '*' ? 'someContainer' : segments[0]!;
    return { [parent]: { [leaf]: SECRET } };
  }

  it('censors a value at EVERY configured redaction path', () => {
    expect(REDACT_PATHS.length).toBeGreaterThan(0);

    for (const path of REDACT_PATHS) {
      const { logger, output } = realLogger();
      logger.info(payloadFor(path), 'test');
      const text = output();
      expect(
        text.includes(SECRET),
        `redaction path ${JSON.stringify(path)} did not censor its value: ${text}`,
      ).toBe(false);
      expect(text).toContain('[redacted]');
    }
  });

  it('covers the fields that actually carry secrets in this service', () => {
    // Named explicitly so removing one from logger.ts fails here by name rather
    // than only shrinking a loop that still passes.
    for (const required of [
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
    ]) {
      expect(REDACT_PATHS, `${required} must stay in REDACT_PATHS`).toContain(required);
    }
  });

  it('keeps non-sensitive context, or the logs would be useless', () => {
    const { logger, output } = realLogger();
    logger.info({ signature: SECRET, payer: '0xabc', fn: 'marenPay.pay' }, 'test');
    const text = output();
    expect(text).not.toContain(SECRET);
    expect(text).toContain('0xabc');
    expect(text).toContain('marenPay.pay');
  });

  it('serialises bigints instead of throwing', () => {
    const { logger, output } = realLogger();
    expect(() => logger.info({ wei: 1_300_000n }, 'fees')).not.toThrow();
    expect(output()).toContain('1300000');
  });
});

describe('the relay path never logs a signature or a raw IP', () => {
  it('logs the selector and payer, but not the signature, calldata or IP', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const logger = pino({ level: 'trace' }, stream);

    const relayer = await createRelayer({
      env: makeEnv(),
      store: new MemoryStore(),
      chain: new FakeChain(),
      logger,
      skipPreflight: true,
      socketIp: (c) => c.req.header('x-test-socket-ip'),
    });

    const body = await signedRequest();
    const response = await relayer.app.fetch(
      new Request('http://relayer.test/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-socket-ip': '203.0.113.77' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(202);

    const output = chunks.join('');
    expect(output.length).toBeGreaterThan(0);

    // The three claims, checked against real output from a real relay.
    expect(output).not.toContain(body['signature']!);
    expect(output).not.toContain(body['data']!);
    expect(output).not.toContain('203.0.113.77');

    // And the useful things ARE there.
    expect(output).toContain(USER.address);
    expect(output).toContain('marenPay.pay');
    expect(output).toContain('relay.submitted');
  });

  it('does not log the request body on a rejected request either', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const relayer = await createRelayer({
      env: makeEnv(),
      store: new MemoryStore(),
      chain: new FakeChain(),
      logger: pino({ level: 'trace' }, stream),
      skipPreflight: true,
    });

    const body = await signedRequest({ value: 10n ** 18n });
    await relayer.app.fetch(
      new Request('http://relayer.test/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

    expect(chunks.join('')).not.toContain(body['signature']!);
  });
});

describe('request ids', () => {
  it('echoes a caller-supplied request id and returns it on errors', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', { nonsense: true }, { 'x-request-id': 'abc-123' });
    expect(response.headers.get('x-request-id')).toBe('abc-123');
    expect(((await response.json()) as { requestId: string }).requestId).toBe('abc-123');
  });

  it('generates one when the caller does not supply it', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.get('/health');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
