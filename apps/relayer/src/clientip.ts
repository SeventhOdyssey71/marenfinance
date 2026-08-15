/**
 * Client IP resolution for rate limiting.
 *
 * THE BUG THIS FIXES: an earlier revision read `x-forwarded-for` directly. That
 * header is attacker-controlled — anyone can send a fresh value on every request
 * and the per-IP limit evaporates. Combined with unlimited free Sybil addresses,
 * that was the first link in a real kill chain against the sponsorship budget.
 *
 * The rule now:
 *
 *   1. A forwarding header is honoured ONLY when the request reached us from a
 *      proxy we were told to trust, or when the platform sets a header the
 *      client cannot forge (Vercel strips and rewrites `x-vercel-forwarded-for`
 *      at the edge).
 *   2. When we do parse `x-forwarded-for`, we take the RIGHTMOST hop that is not
 *      itself a trusted proxy. The leftmost entry is whatever the client wrote;
 *      the rightmost is what our infrastructure observed. Everything to the left
 *      of a trusted hop is unverifiable.
 *   3. Otherwise we use the socket address.
 *   4. If we cannot determine anything, the request goes in a single shared
 *      `unknown` bucket. Unattributable must never mean cheaper (R8).
 *
 * Note the direction of every failure here: when in doubt we attribute traffic
 * to FEWER distinct identities, never more. Over-attribution costs an honest
 * user behind a misconfigured proxy some throughput; under-attribution costs us
 * the whole rate limit.
 */

export type IpSource = 'platform' | 'proxy' | 'socket' | 'unknown';

export interface ResolvedIp {
  /** The value to bucket on. `unknown` when nothing could be established. */
  readonly ip: string;
  readonly source: IpSource;
}

// ---------------------------------------------------------------------------
// CIDR matching
// ---------------------------------------------------------------------------

export interface Cidr {
  readonly base: bigint;
  readonly bits: number;
  readonly size: 32 | 128;
  readonly text: string;
}

function ipv4ToBigInt(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

function ipv6ToBigInt(value: string): bigint | null {
  let text = value;
  // Strip a zone index (fe80::1%eth0) and brackets ([::1]).
  text = text.replace(/^\[/, '').replace(/\]$/, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const expand = (group: string): string[] => (group === '' ? [] : group.split(':'));
  let head = expand(halves[0] ?? '');
  let tail = halves.length === 2 ? expand(halves[1] ?? '') : [];

  // A trailing IPv4 literal (::ffff:127.0.0.1) occupies two groups.
  const last = (tail.length > 0 ? tail : head).at(-1);
  if (last !== undefined && last.includes('.')) {
    const v4 = ipv4ToBigInt(last);
    if (v4 === null) return null;
    const high = (v4 >> 16n) & 0xffffn;
    const low = v4 & 0xffffn;
    const replacement = [high.toString(16), low.toString(16)];
    if (tail.length > 0) tail = [...tail.slice(0, -1), ...replacement];
    else head = [...head.slice(0, -1), ...replacement];
  }

  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;

  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  let out = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out = (out << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return out;
}

export interface ParsedIp {
  readonly value: bigint;
  readonly size: 32 | 128;
}

/** Parse an IPv4 or IPv6 literal. IPv4-mapped IPv6 is normalised to IPv4. */
export function parseIp(value: string): ParsedIp | null {
  const text = value.trim();
  if (text === '') return null;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text.replace(/^\[|\]$/g, ''));
  if (mapped?.[1] !== undefined) {
    const v4 = ipv4ToBigInt(mapped[1]);
    return v4 === null ? null : { value: v4, size: 32 };
  }
  if (text.includes(':')) {
    const v6 = ipv6ToBigInt(text);
    return v6 === null ? null : { value: v6, size: 128 };
  }
  const v4 = ipv4ToBigInt(text);
  return v4 === null ? null : { value: v4, size: 32 };
}

/** Parse `10.0.0.0/8`, `::1`, `192.168.1.1` … Invalid entries return null. */
export function parseCidr(value: string): Cidr | null {
  const text = value.trim();
  if (text === '') return null;
  const [address, prefix, ...rest] = text.split('/');
  if (address === undefined || rest.length > 0) return null;

  const parsed = parseIp(address);
  if (parsed === null) return null;

  const bits = prefix === undefined ? parsed.size : Number(prefix);
  if (!Number.isInteger(bits) || bits < 0 || bits > parsed.size) return null;

  const shift = BigInt(parsed.size - bits);
  const base = (parsed.value >> shift) << shift;
  return { base, bits, size: parsed.size, text };
}

export function ipInCidr(ip: string, cidr: Cidr): boolean {
  const parsed = parseIp(ip);
  if (parsed === null || parsed.size !== cidr.size) return false;
  const shift = BigInt(cidr.size - cidr.bits);
  return (parsed.value >> shift) << shift === cidr.base;
}

export function ipInAny(ip: string, cidrs: readonly Cidr[]): boolean {
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Prefix width used to bucket an address for rate limiting.
 *
 * IPv4 is bucketed at /32 — one address, one bucket, which is what an IPv4
 * client actually costs an attacker.
 *
 * IPv6 is bucketed at a 64-bit prefix. A single ordinary residential allocation
 * is a /64 (often a /56 or /48), so every host inside it can mint a fresh /128
 * for free. Keying the bucket on the full literal meant `2001:db8:abcd:1234::1`
 * and `...::2` were separate buckets, and the per-IP cap braked nothing at all
 * for any IPv6 client. A /64 is the smallest unit an operator is normally
 * assigned, so it is the smallest unit that costs an attacker something.
 */
export const IPV6_BUCKET_PREFIX = 64;

/**
 * The value the per-IP rate limiter buckets on. NOT the address itself.
 *
 * Returns a canonical string, so the same /64 always produces the same key
 * regardless of which host inside it sent the request.
 */
export function ipBucketKey(ip: string): string {
  if (ip === 'unknown') return 'unknown';
  const parsed = parseIp(ip);
  if (parsed === null) return 'unknown';
  if (parsed.size === 32) return `v4:${parsed.value.toString(16)}`;

  const shift = BigInt(128 - IPV6_BUCKET_PREFIX);
  const prefix = (parsed.value >> shift) << shift;
  return `v6/${IPV6_BUCKET_PREFIX}:${prefix.toString(16)}`;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export interface ClientIpInput {
  /** The peer address of the TCP connection, if the runtime exposes it. */
  readonly socketIp: string | undefined;
  readonly header: (name: string) => string | undefined;
  readonly trustedProxies: readonly Cidr[];
  /**
   * A header set by the platform that the client cannot forge, e.g.
   * `x-vercel-forwarded-for`. Trusted unconditionally when configured, because
   * the platform overwrites it at the edge.
   */
  readonly platformHeader: string | null;
}

export function resolveClientIp(input: ClientIpInput): ResolvedIp {
  // 1. Platform-provided, unforgeable.
  if (input.platformHeader !== null) {
    const raw = input.header(input.platformHeader);
    const first = raw?.split(',')[0]?.trim();
    if (first !== undefined && first !== '' && parseIp(first) !== null) {
      return { ip: first, source: 'platform' };
    }
  }

  // 2. `x-forwarded-for`, but only from a proxy we trust.
  const socketIp = input.socketIp?.trim();
  if (
    socketIp !== undefined &&
    socketIp !== '' &&
    input.trustedProxies.length > 0 &&
    ipInAny(socketIp, input.trustedProxies)
  ) {
    const forwarded = input.header('x-forwarded-for');
    if (forwarded !== undefined) {
      const hops = forwarded
        .split(',')
        .map((hop) => hop.trim())
        .filter((hop) => hop !== '' && parseIp(hop) !== null);
      // Rightmost hop that is not itself a trusted proxy. Anything further left
      // was written by someone we have no reason to believe.
      for (let i = hops.length - 1; i >= 0; i -= 1) {
        const hop = hops[i];
        if (hop !== undefined && !ipInAny(hop, input.trustedProxies)) {
          return { ip: hop, source: 'proxy' };
        }
      }
    }
  }

  // 3. The socket address.
  if (socketIp !== undefined && socketIp !== '' && parseIp(socketIp) !== null) {
    return { ip: socketIp, source: 'socket' };
  }

  // 4. One shared bucket. Unattributable is not cheaper.
  return { ip: 'unknown', source: 'unknown' };
}
