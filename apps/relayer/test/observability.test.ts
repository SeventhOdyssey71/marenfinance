import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { privateKeyToAccount } from 'viem/accounts';
import { buildTestRelayer, FakeChain, makeEnv, signedRequest } from './helpers.js';
import { NEAR_LIMIT_FRACTION } from '../src/service.js';

/**
 * Runtime tripwires for the limits.
 *
 * The 52x budget overshoot found in adversarial round 2 was found by a test, not
 * by the running service: a relayer in that state reported `accepting: true` and
 * a budget it believed was intact. `/healthz` now exposes the counters
 * (healthz.test.ts); these tests cover the other half, which is a log line at
 * the moment a limit starts to matter rather than at the moment it bites.
 *
 * Two properties, and the second is the one that makes the first useful:
 *
 *   - WARN on the request that CROSSES 80% of a cap.
 *   - Exactly once per crossing. A line per request above the threshold turns
 *     the last 20% of every cap into a flood, and a flood is how a real signal
 *     gets filtered out by whoever is on call.
 */

interface LogLine {
  level: number;
  event?: string;
  kind?: string;
  used?: number;
  limit?: number;
  pct?: number;
  payer?: string;
  ipHash?: string;
  reservedWei?: string;
  limitWei?: string;
  msg?: string;
}

/** A real pino logger writing into an array, so the assertions see real output. */
function capturingLogger(): { logger: pino.Logger; lines: () => LogLine[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const logger = pino(
    {
      level: 'trace',
      formatters: {
        log(object) {
          // Mirrors createLogger: bigints must survive JSON.stringify.
          return JSON.parse(
            JSON.stringify(object, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
          ) as Record<string, unknown>;
        },
      },
    },
    stream,
  );
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as LogLine),
  };
}

const WARN = 40;

function nearLimitLines(lines: LogLine[], kind: 'address' | 'ip'): LogLine[] {
  return lines.filter((line) => line.event === 'quota.near_limit' && line.kind === kind);
}

/** Sequential relays from one address, advancing the forwarder nonce each time. */
async function relayTimes(
  relayer: Awaited<ReturnType<typeof buildTestRelayer>>,
  chain: FakeChain,
  count: number,
  options: { account?: ReturnType<typeof privateKeyToAccount>; ip?: string } = {},
): Promise<number[]> {
  const account = options.account ?? privateKeyToAccount(`0x${'01'.repeat(32)}`);
  const statuses: number[] = [];
  for (let nonce = 0; nonce < count; nonce += 1) {
    chain.nonces_.set(account.address.toLowerCase(), BigInt(nonce));
    const response = await relayer.post(
      '/relay',
      await signedRequest({ account, nonce: BigInt(nonce) }),
      { 'x-test-socket-ip': options.ip ?? '198.51.100.4' },
    );
    statuses.push(response.status);
  }
  return statuses;
}

describe('a rate limit warns before it bites', () => {
  it('is 80%, and the constant is the one the service uses', () => {
    // Imported rather than restated: a duplicated threshold in a test is a
    // threshold that can drift silently, which logging.test.ts already caught
    // once with the redaction list.
    expect(NEAR_LIMIT_FRACTION).toBe(0.8);
  });

  it('WARNs on the request that takes an address across 80% of its daily cap', async () => {
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    // Cap 5, so the threshold is ceil(5 * 0.8) = 4.
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '5', RELAYER_MAX_ACTIONS_PER_IP_DAY: '999' }),
      chain,
      undefined,
      logger,
    );

    const statuses = await relayTimes(relayer, chain, 3);
    expect(statuses.every((s) => s === 202)).toBe(true);
    expect(nearLimitLines(lines(), 'address')).toHaveLength(0);

    await relayTimes(relayer, chain, 1);
    const warned = nearLimitLines(lines(), 'address');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.level).toBe(WARN);
    expect(warned[0]?.used).toBe(4);
    expect(warned[0]?.limit).toBe(5);
    expect(warned[0]?.pct).toBe(80);
  });

  it('warns once per crossing, not once per request above the threshold', async () => {
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '5', RELAYER_MAX_ACTIONS_PER_IP_DAY: '999' }),
      chain,
      undefined,
      logger,
    );

    // Ten attempts against a cap of five: four admitted after the crossing, and
    // five rejected outright. Neither may add a second warning.
    await relayTimes(relayer, chain, 10);
    expect(nearLimitLines(lines(), 'address')).toHaveLength(1);
  });

  it('warns for an IP bucket by its hash, never by its address', async () => {
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '5', RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '999' }),
      chain,
      undefined,
      logger,
    );

    await relayTimes(relayer, chain, 4, { ip: '198.51.100.77' });
    const warned = nearLimitLines(lines(), 'ip');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.used).toBe(4);
    expect(warned[0]?.ipHash).toMatch(/^[0-9a-f]{24}$/);
    // The raw client address must not reach the logger by any route.
    expect(JSON.stringify(lines())).not.toContain('198.51.100.77');
  });

  it('does not warn for traffic it rejected and refunded', async () => {
    // The same mistake as latching the budget halt on reserved rather than
    // committed spend: a burst of doomed requests would otherwise let anyone
    // fill the log with limit warnings for traffic that consumed nothing.
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain({ simulateReverts: true });
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '5', RELAYER_MAX_ACTIONS_PER_IP_DAY: '5' }),
      chain,
      undefined,
      logger,
    );

    const statuses = await relayTimes(relayer, chain, 5);
    expect(statuses.every((s) => s === 422)).toBe(true);
    expect(chain.sent).toHaveLength(0);
    expect(nearLimitLines(lines(), 'address')).toHaveLength(0);
    expect(nearLimitLines(lines(), 'ip')).toHaveLength(0);
  });

  it('does not warn at all when a cap is disabled', async () => {
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    // Zero means "no actions allowed", not "no limit": every request is
    // rejected, and a rejected request never warns. Either way there is no
    // division by zero and no warning storm.
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '0', RELAYER_MAX_ACTIONS_PER_IP_DAY: '999' }),
      chain,
      undefined,
      logger,
    );
    await relayTimes(relayer, chain, 3);
    expect(nearLimitLines(lines(), 'address')).toHaveLength(0);
  });
});

describe('the daily BTC budget warns before it halts', () => {
  const PER_REQUEST_WEI = 200_000n * 2_600_000n;

  it('WARNs when reservations cross 80% of the daily budget, once', async () => {
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    // Budget for exactly five requests: the fourth crosses 80%.
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(PER_REQUEST_WEI * 5n) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '999',
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '999',
      }),
      chain,
      undefined,
      logger,
    );

    await relayTimes(relayer, chain, 3);
    expect(lines().filter((l) => l.event === 'budget.near_limit')).toHaveLength(0);

    await relayTimes(relayer, chain, 2);
    const warned = lines().filter((l) => l.event === 'budget.near_limit');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.level).toBe(WARN);
    expect(warned[0]?.pct).toBe(80);
    expect(warned[0]?.reservedWei).toBe((PER_REQUEST_WEI * 4n).toString());
  });

  it('still halts on committed spend, and says so at ERROR', async () => {
    // The warning is a warning. It must not become the thing that stops the
    // relayer, and the halt must still fire on its own terms.
    const { logger, lines } = capturingLogger();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(PER_REQUEST_WEI * 2n) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '999',
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '999',
      }),
      chain,
      undefined,
      logger,
    );

    await relayTimes(relayer, chain, 2);
    expect(chain.sent).toHaveLength(2);
    expect(lines().filter((l) => l.event === 'relay.budget_halt')).toHaveLength(1);

    const healthz = (await (await relayer.get('/healthz')).json()) as {
      budget: { halted: boolean; committedPct: number };
    };
    expect(healthz.budget.halted).toBe(true);
    expect(healthz.budget.committedPct).toBe(100);
  });
});
