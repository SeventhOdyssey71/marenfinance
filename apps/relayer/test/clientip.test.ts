import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ipInCidr,
  parseCidr,
  parseIp,
  resolveClientIp,
  type Cidr,
} from '../src/clientip.js';
import { loadConfig } from '../src/config.js';
import { buildTestRelayer, FakeChain, makeEnv, signedRequest, type ErrorBody } from './helpers.js';

/**
 * H1 — the per-IP rate limit must not be keyed on a header the client controls.
 *
 * The attack it stops: an attacker sets a fresh `x-forwarded-for` on every
 * request, so every request looks like a new IP and the per-IP limit never
 * fires. Combined with unlimited free Sybil addresses that was the first link in
 * a working kill chain against the sponsorship budget.
 */

const cidrs = (...values: string[]): Cidr[] =>
  values.map((value) => {
    const parsed = parseCidr(value);
    if (parsed === null) throw new Error(`bad test CIDR ${value}`);
    return parsed;
  });

describe('IP parsing and CIDR matching', () => {
  it('parses IPv4, IPv6 and IPv4-mapped IPv6', () => {
    expect(parseIp('192.168.1.1')?.size).toBe(32);
    expect(parseIp('2001:db8::1')?.size).toBe(128);
    // IPv4-mapped normalises to IPv4 so it cannot dodge an IPv4 proxy rule.
    expect(parseIp('::ffff:10.0.0.1')?.size).toBe(32);
    expect(parseIp('::ffff:10.0.0.1')?.value).toBe(parseIp('10.0.0.1')?.value);
  });

  it('rejects malformed addresses instead of coercing them', () => {
    for (const bad of ['', 'not-an-ip', '999.1.1.1', '1.2.3', '2001:db8::1::2', '1.2.3.4.5']) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it('matches inside a CIDR and not outside it', () => {
    const [ten] = cidrs('10.0.0.0/8');
    expect(ipInCidr('10.4.5.6', ten!)).toBe(true);
    expect(ipInCidr('11.0.0.1', ten!)).toBe(false);
    const [v6] = cidrs('2001:db8::/32');
    expect(ipInCidr('2001:db8:1::9', v6!)).toBe(true);
    expect(ipInCidr('2001:dba::9', v6!)).toBe(false);
  });

  it('never matches an IPv6 address against an IPv4 range', () => {
    const [ten] = cidrs('10.0.0.0/8');
    expect(ipInCidr('2001:db8::1', ten!)).toBe(false);
  });

  it('rejects a malformed CIDR rather than accepting a permissive one', () => {
    for (const bad of ['10.0.0.0/33', '10.0.0.0/-1', 'garbage/8', '10.0.0.0/8/9']) {
      expect(parseCidr(bad)).toBeNull();
    }
  });
});

describe('resolveClientIp', () => {
  const header = (values: Record<string, string>) => (name: string) => values[name.toLowerCase()];

  it('IGNORES x-forwarded-for when no proxy is trusted', () => {
    const resolved = resolveClientIp({
      socketIp: '203.0.113.9',
      header: header({ 'x-forwarded-for': '1.2.3.4' }),
      trustedProxies: [],
      platformHeader: null,
    });
    // The socket address wins. The attacker's header is not even consulted.
    expect(resolved).toEqual({ ip: '203.0.113.9', source: 'socket' });
  });

  it('IGNORES x-forwarded-for when the request did not come from a trusted proxy', () => {
    const resolved = resolveClientIp({
      socketIp: '203.0.113.9',
      header: header({ 'x-forwarded-for': '1.2.3.4' }),
      trustedProxies: cidrs('10.0.0.0/8'),
      platformHeader: null,
    });
    expect(resolved).toEqual({ ip: '203.0.113.9', source: 'socket' });
  });

  it('honours x-forwarded-for from a trusted proxy, taking the RIGHTMOST untrusted hop', () => {
    const resolved = resolveClientIp({
      socketIp: '10.0.0.5',
      // The client wrote "1.2.3.4"; our edge appended what it actually saw.
      header: header({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7, 10.0.0.5' }),
      trustedProxies: cidrs('10.0.0.0/8'),
      platformHeader: null,
    });
    expect(resolved).toEqual({ ip: '198.51.100.7', source: 'proxy' });
  });

  it('cannot be tricked by an attacker appending fake trusted hops', () => {
    // Attacker sends: "<spoof>, 10.0.0.9" hoping we take the leftmost.
    const resolved = resolveClientIp({
      socketIp: '10.0.0.5',
      header: header({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9, 10.0.0.5' }),
      trustedProxies: cidrs('10.0.0.0/8'),
      platformHeader: null,
    });
    // Rightmost non-trusted hop is the spoofed value only because the attacker
    // controls everything left of our edge — but note it is NOT 1.2.3.4 chosen
    // blindly; hops we trust are skipped from the right.
    expect(resolved.ip).toBe('1.2.3.4');
    expect(resolved.source).toBe('proxy');
  });

  it('prefers an unforgeable platform header over everything else', () => {
    const resolved = resolveClientIp({
      socketIp: '10.0.0.5',
      header: header({
        'x-vercel-forwarded-for': '198.51.100.20',
        'x-forwarded-for': '1.2.3.4',
      }),
      trustedProxies: cidrs('10.0.0.0/8'),
      platformHeader: 'x-vercel-forwarded-for',
    });
    expect(resolved).toEqual({ ip: '198.51.100.20', source: 'platform' });
  });

  it('falls back to one shared bucket when nothing can be established', () => {
    const resolved = resolveClientIp({
      socketIp: undefined,
      header: header({ 'x-forwarded-for': '1.2.3.4' }),
      trustedProxies: [],
      platformHeader: null,
    });
    // Not exempt. Shared. Unattributable must never be cheaper (R8).
    expect(resolved).toEqual({ ip: 'unknown', source: 'unknown' });
  });

  it('ignores a malformed platform header value rather than bucketing on garbage', () => {
    const resolved = resolveClientIp({
      socketIp: '203.0.113.9',
      header: header({ 'x-vercel-forwarded-for': 'not-an-ip' }),
      trustedProxies: [],
      platformHeader: 'x-vercel-forwarded-for',
    });
    expect(resolved).toEqual({ ip: '203.0.113.9', source: 'socket' });
  });
});

describe('config', () => {
  it('trusts no proxy by default', () => {
    const { config } = loadConfig(makeEnv());
    expect(config.trustedProxies).toEqual([]);
    expect(config.clientIpHeader).toBeNull();
  });

  it('defaults to the platform header on Vercel', () => {
    const { config } = loadConfig(makeEnv({ VERCEL: '1', RELAYER_STORE: 'redis' }));
    expect(config.clientIpHeader).toBe('x-vercel-forwarded-for');
  });

  it('treats a malformed trusted-proxy entry as a problem, not a trusted one', () => {
    const { config, problems } = loadConfig(
      makeEnv({ RELAYER_TRUSTED_PROXIES: '10.0.0.0/8,garbage' }),
    );
    expect(problems.join('\n')).toMatch(/RELAYER_TRUSTED_PROXIES entry "garbage"/);
    expect(config.trustedProxies).toHaveLength(1);
  });
});

describe('end to end: the per-IP limit cannot be bypassed with a header', () => {
  it('a spoofed x-forwarded-for does NOT buy a fresh IP bucket', async () => {
    const relayer = await buildTestRelayer(makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '1' }));

    // Same attacker socket, a different forged XFF on each request.
    const first = await relayer.post('/relay', await signedRequest(), {
      'x-test-socket-ip': '203.0.113.50',
      'x-forwarded-for': '1.1.1.1',
    });
    expect(first.status).toBe(202);

    relayer.chainFake.nonces_.set(
      privateKeyToAccount(
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      ).address.toLowerCase(),
      1n,
    );
    const second = await relayer.post('/relay', await signedRequest({ nonce: 1n }), {
      'x-test-socket-ip': '203.0.113.50',
      'x-forwarded-for': '2.2.2.2', // fresh forged value
    });

    expect(second.status).toBe(429);
    expect(((await second.json()) as ErrorBody).error).toBe('IP_RATE_LIMIT');
    expect(relayer.chainFake.sent).toHaveLength(1);
  });

  it('distinct real socket addresses do get distinct buckets', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '1' }),
      new FakeChain(),
    );
    const user = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );

    const first = await relayer.post('/relay', await signedRequest(), {
      'x-test-socket-ip': '203.0.113.50',
    });
    expect(first.status).toBe(202);

    relayer.chainFake.nonces_.set(user.address.toLowerCase(), 1n);
    const second = await relayer.post('/relay', await signedRequest({ nonce: 1n }), {
      'x-test-socket-ip': '203.0.113.51',
    });
    expect(second.status).toBe(202);
  });

  it('honours a forwarded IP only when it arrives from a configured trusted proxy', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '1',
        RELAYER_TRUSTED_PROXIES: '10.0.0.0/8',
      }),
    );
    const user = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );

    const first = await relayer.post('/relay', await signedRequest(), {
      'x-test-socket-ip': '10.0.0.5',
      'x-forwarded-for': '198.51.100.7, 10.0.0.5',
    });
    expect(first.status).toBe(202);

    // Different real client behind the same trusted proxy: separate bucket.
    relayer.chainFake.nonces_.set(user.address.toLowerCase(), 1n);
    const second = await relayer.post('/relay', await signedRequest({ nonce: 1n }), {
      'x-test-socket-ip': '10.0.0.5',
      'x-forwarded-for': '198.51.100.8, 10.0.0.5',
    });
    expect(second.status).toBe(202);

    // Same real client again: limited.
    relayer.chainFake.nonces_.set(user.address.toLowerCase(), 2n);
    const third = await relayer.post('/relay', await signedRequest({ nonce: 2n }), {
      'x-test-socket-ip': '10.0.0.5',
      'x-forwarded-for': '198.51.100.7, 10.0.0.5',
    });
    expect(third.status).toBe(429);
  });
});
