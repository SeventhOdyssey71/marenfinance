import { describe, expect, it } from 'vitest';
import { createRelayer } from '../src/create.js';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/store.js';
import {
  makeEnv,
  signedRequest,
  SILENT_LOGGER,
  FakeChain,
  buildTestRelayer,
  type ErrorBody,
} from './helpers.js';

/**
 * R8 — gates fail closed.
 *
 * Talise F-A1: a private-beta guard wired to 59 routes read
 * `if (APP_ACCESS_OPEN !== "false") return true;` — a pass-through whenever the
 * variable was unset. This suite exists to make the equivalent impossible here.
 * The headline case is the first one: boot with NOTHING configured and confirm
 * the service will not relay.
 */

describe('fail-closed boot', () => {
  it('boots with a completely empty environment and refuses to relay', async () => {
    const relayer = await createRelayer({
      env: {},
      store: new MemoryStore(),
      logger: SILENT_LOGGER,
    });

    // It boots. It does not crash-loop — an operator can ask it what is wrong.
    expect(relayer.problems.length).toBeGreaterThan(0);
    expect(relayer.service.accepting).toBe(false);

    // And it will not relay.
    const response = await relayer.app.fetch(
      new Request('http://relayer.test/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await signedRequest()),
      }),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('RELAYER_NOT_ACCEPTING');

    // Nothing was signed and no key was needed to get here.
    expect(relayer.chain).toBeNull();
  });

  it('names every missing gate rather than defaulting one of them open', async () => {
    const { problems } = loadConfig({});
    const joined = problems.join('\n');

    expect(joined).toMatch(/forwarder/i);
    expect(joined).toMatch(/allowlist is empty/i);
    expect(joined).toMatch(/RELAYER_MAX_DAILY_SPONSORED_BTC/);
    expect(joined).toMatch(/no signing key configured/i);
  });

  it('reports a refusing relayer as unhealthy on /health', async () => {
    const relayer = await createRelayer({
      env: {},
      store: new MemoryStore(),
      logger: SILENT_LOGGER,
    });
    const response = await relayer.app.fetch(new Request('http://relayer.test/health'));
    expect(response.status).toBe(503);
    const health = (await response.json()) as { accepting: boolean; problems: string[] };
    expect(health.accepting).toBe(false);
    expect(health.problems.length).toBeGreaterThan(0);
  });

  it.each([
    ['RELAYER_MAX_DAILY_SPONSORED_BTC', ''],
    ['RELAYER_MAX_DAILY_SPONSORED_BTC', 'not-a-number'],
    ['RELAYER_MAX_DAILY_SPONSORED_BTC', '0'],
    ['RELAYER_FORWARDER_ADDRESS', ''],
    ['RELAYER_ALLOWED_TARGETS', ''],
    ['RELAYER_PRIVATE_KEY', ''],
  ])('refuses when %s is %j', async (key, value) => {
    const relayer = await buildTestRelayer(makeEnv({ [key]: value }), new FakeChain());
    expect(relayer.service.accepting).toBe(false);

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(503);
    expect(((await response.json()) as ErrorBody).error).toBe('RELAYER_NOT_ACCEPTING');
    // The decisive assertion: nothing was broadcast.
    expect(relayer.chainFake.sent).toHaveLength(0);
  });

  it('treats a malformed numeric limit as zero, never as unlimited', () => {
    const { config, problems } = loadConfig(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: 'lots' }),
    );
    expect(problems.join('\n')).toMatch(/RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY is not an integer/);
    expect(config.policy.maxActionsPerAddressPerDay).toBe(0);
  });

  it('closes the paid tier when no fee is configured rather than making it free', () => {
    const { config } = loadConfig(makeEnv({ RELAYER_FEE_MUSD: '' }));
    // Not 0n. `null` means "the paid tier is shut", which is what policy.ts acts on.
    expect(config.policy.feeMusdWei).toBeNull();
  });

  it('an unknown contract name in the target allowlist is a problem, not a skip', () => {
    const { problems } = loadConfig(
      makeEnv({
        RELAYER_ALLOWED_TARGETS: 'marenAnything:0x2222222222222222222222222222222222222222',
      }),
    );
    expect(problems.join('\n')).toMatch(/unknown contract/);
  });
});
