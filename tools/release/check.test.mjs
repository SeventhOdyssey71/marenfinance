import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRelease, healthProblems, DEFAULTS } from './check.mjs';

const healthy = {
  ok: true,
  accepting: true,
  chainId: 31611,
  network: 'testnet',
  singleInstance: true,
  store: 'durable',
  relayer: '0xd90245ee16B2f58eD8654961BBf2fa835046df89',
  problems: [],
  budget: { halted: false, pendingRefunds: 0 },
};

function responding({
  health = healthy,
  healthStatus = 200,
  corsOrigin = DEFAULTS.web,
  webApp = false,
} = {}) {
  return async (url, init) => {
    assert.notEqual(init?.method, 'POST'); // This check must never submit a transaction.
    if (String(url).endsWith('/healthz')) return Response.json(health, { status: healthStatus });
    if (init?.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': corsOrigin,
          'access-control-allow-methods': 'GET,POST',
          'access-control-allow-headers': 'Content-Type',
        },
      });
    return new Response('<html><body>Maren</body></html>', {
      status: new URL(url).pathname.startsWith('/app') && !webApp ? 404 : 200,
      headers: { 'content-type': 'text/html' },
    });
  };
}

test('passes healthy HTTP infrastructure and labels the limits of the evidence', async () => {
  const report = await checkRelease({ fetchImpl: responding() });
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 8);
  assert.match(report.scope, /Does not prove transaction settlement/);
});

test('requires the dashboard to be reachable when the web release is selected', async () => {
  assert.equal((await checkRelease({ webApp: true, fetchImpl: responding() })).passed, false);
  assert.equal(
    (await checkRelease({ webApp: true, fetchImpl: responding({ webApp: true }) })).passed,
    true,
  );
});

test('refuses a 503 even with an accepting health body', async () => {
  const report = await checkRelease({ fetchImpl: responding({ healthStatus: 503 }) });
  assert.equal(report.passed, false);
});

test('release recovery gate refuses an older deployment and a blocked or undrained journal', async () => {
  const recovery = {
    durable: true,
    blocked: false,
    replacementPolicy: 'rebroadcast-identical',
    pending: 0,
    pendingRefunds: 0,
    oldestPendingAt: null,
  };
  assert.equal(
    (await checkRelease({ requireRecovery: true, fetchImpl: responding() })).passed,
    false,
  );
  for (const invalid of [
    { ...recovery, blocked: true },
    { ...recovery, pending: 1 },
    { ...recovery, pendingRefunds: 1 },
    { ...recovery, oldestPendingAt: '2026-09-13T00:00:00Z' },
    {},
  ]) {
    assert.ok(healthProblems({ ...healthy, recovery: invalid }, true).length > 0);
  }
  const report = await checkRelease({
    requireRecovery: true,
    fetchImpl: responding({ health: { ...healthy, recovery } }),
  });
  assert.equal(report.passed, true);
  assert.equal(report.requiresDrainedDurableRecovery, true);
});

test('refuses mainnet, missing fields, memory storage, and pending refunds', () => {
  for (const body of [
    null,
    {},
    { ...healthy, chainId: 31612 },
    { ...healthy, store: 'memory' },
    { ...healthy, budget: { halted: false, pendingRefunds: 1 } },
    { ...healthy, accepting: false },
  ]) {
    assert.ok(healthProblems(body).length > 0);
  }
});

test('fails an origin mismatch even when the service is healthy', async () => {
  const report = await checkRelease({
    fetchImpl: responding({ corsOrigin: 'https://elsewhere.test' }),
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find((c) => c.name === 'browser relay CORS').status, 'fail');
});

test('records a network outage as failure without leaking the error payload', async () => {
  const report = await checkRelease({
    fetchImpl: async () => {
      throw new TypeError('private provider credential');
    },
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.length, 8);
  assert.ok(!JSON.stringify(report).includes('private provider credential'));
});

test('HTTP 200 without an app document is not a passing web check', async () => {
  const report = await checkRelease({
    fetchImpl: async (url, init) =>
      String(url).includes('workers.dev') ? responding()(url, init) : Response.json({ ok: true }),
  });
  assert.equal(report.passed, false);
  assert.equal(report.checks.filter((c) => c.status === 'fail').length, 6);
});
