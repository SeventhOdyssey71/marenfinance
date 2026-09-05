import { describe, expect, it } from 'vitest';
import { buildTestRelayer, makeEnv } from './helpers.js';

/**
 * CORS. The web app POSTs /relay from the browser, cross-origin, so the relayer
 * must echo an allowed Origin or the browser blocks the call before it is sent.
 * The allowlist is explicit (RELAYER_ALLOWED_ORIGINS): an origin that is not on
 * it — or an empty list — gets no allow-origin header. No credentials are used,
 * so this never becomes a wildcard-with-credentials.
 */

async function requestWithOrigin(
  relayer: Awaited<ReturnType<typeof buildTestRelayer>>,
  path: string,
  origin: string,
  method = 'GET',
): Promise<Response> {
  const headers: Record<string, string> = { origin };
  if (method === 'OPTIONS') {
    headers['access-control-request-method'] = 'POST';
    headers['access-control-request-headers'] = 'content-type';
  }
  return relayer.app.fetch(new Request(`http://relayer.test${path}`, { method, headers }));
}

describe('CORS', () => {
  it('echoes an allowed origin on the preflight and on a real request', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_ALLOWED_ORIGINS: 'https://app.example,http://localhost:3000' }),
    );

    const preflight = await requestWithOrigin(relayer, '/relay', 'https://app.example', 'OPTIONS');
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example');

    const real = await requestWithOrigin(relayer, '/healthz', 'http://localhost:3000');
    expect(real.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('does not echo an origin that is not on the allowlist', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_ALLOWED_ORIGINS: 'https://app.example' }),
    );
    const res = await requestWithOrigin(relayer, '/healthz', 'https://evil.example');
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  });

  it('adds no CORS headers when the allowlist is empty (deny cross-origin by default)', async () => {
    const relayer = await buildTestRelayer(makeEnv());
    const res = await requestWithOrigin(relayer, '/healthz', 'https://app.example');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
