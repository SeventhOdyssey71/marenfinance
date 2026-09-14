import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULTS = {
  web: 'https://marenfinance.vercel.app',
  relayer: 'https://maren-relayer.rolandojude18.workers.dev',
};

// A health response is an infrastructure observation, never transaction proof.
export function healthProblems(body, requireRecovery = false) {
  const problems = [];
  if (body?.ok !== true || body?.accepting !== true) problems.push('not accepting');
  if (body?.chainId !== 31611 || body?.network !== 'testnet') problems.push('wrong network');
  if (body?.singleInstance !== true || body?.store !== 'durable')
    problems.push('unexpected deployment topology');
  if (!/^0x[0-9a-f]{40}$/i.test(body?.relayer ?? '')) problems.push('missing signer');
  if (!Array.isArray(body?.problems) || body.problems.length !== 0)
    problems.push('reported or missing boot problems');
  if (body?.budget?.halted !== false) problems.push('budget halted or unavailable');
  if (body?.budget?.pendingRefunds !== 0) problems.push('refunds pending or unavailable');
  if (requireRecovery) {
    const recovery = body?.recovery;
    if (
      recovery?.durable !== true ||
      recovery?.blocked !== false ||
      recovery?.replacementPolicy !== 'rebroadcast-identical'
    )
      problems.push('durable transaction recovery unavailable or blocked');
    if (
      recovery?.pending !== 0 ||
      recovery?.pendingRefunds !== 0 ||
      recovery?.oldestPendingAt !== null
    )
      problems.push('recovery backlog is not drained');
  }
  return problems;
}

export async function checkRelease({
  web = DEFAULTS.web,
  relayer = DEFAULTS.relayer,
  webApp = false,
  requireRecovery = false,
  timeoutMs = 15_000,
  fetchImpl = fetch,
} = {}) {
  const checks = [];
  const probe = async (name, url, inspect, init = {}) => {
    const start = Date.now();
    try {
      const response = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const detail = await inspect(response);
      checks.push({
        name,
        status: detail === null ? 'pass' : 'fail',
        httpStatus: response.status,
        detail,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      // Do not write response bodies, request signatures or provider errors into
      // grant artifacts. A class name suffices to distinguish timeouts from HTTP failures.
      checks.push({
        name,
        status: 'fail',
        detail: `request failed (${error?.name ?? 'unknown'})`,
        durationMs: Date.now() - start,
      });
    }
  };
  await Promise.all([
    ...['/', '/app', '/app/finance', '/app/pay', '/claim', '/docs'].map((path) =>
      probe(`web ${path}`, new URL(path, web), async (response) => {
        const expectedStatus = path.startsWith('/app') && !webApp ? 404 : 200;
        if (response.status !== expectedStatus) return `expected HTTP ${expectedStatus}`;
        if (!response.headers.get('content-type')?.includes('text/html')) return 'expected HTML';
        return (await response.text()).includes('</html>') ? null : 'incomplete HTML response';
      }),
    ),
    probe('relayer health', new URL('/healthz', relayer), async (response) => {
      if (response.status !== 200) return 'expected HTTP 200';
      const problems = healthProblems(await response.json(), requireRecovery);
      return problems.length === 0 ? null : problems.join('; ');
    }),
    probe(
      'browser relay CORS',
      new URL('/relay', relayer),
      async (response) => {
        if (![200, 204].includes(response.status)) return 'preflight refused';
        if (response.headers.get('access-control-allow-origin') !== new URL(web).origin)
          return 'web origin not allowed';
        const methods =
          response.headers
            .get('access-control-allow-methods')
            ?.split(',')
            .map((s) => s.trim().toUpperCase()) ?? [];
        const headers =
          response.headers
            .get('access-control-allow-headers')
            ?.split(',')
            .map((s) => s.trim().toLowerCase()) ?? [];
        return methods.includes('POST') && headers.includes('content-type')
          ? null
          : 'POST or content-type not allowed';
      },
      {
        method: 'OPTIONS',
        headers: {
          origin: new URL(web).origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      },
    ),
  ]);
  checks.sort((a, b) => a.name.localeCompare(b.name));
  return {
    checkedAt: new Date().toISOString(),
    releaseSurface: webApp ? 'ios-and-web' : 'ios-first (web dashboard intentionally disabled)',
    requiresDrainedDurableRecovery: requireRecovery,
    scope:
      'Testnet HTTP availability and relay configuration only. Does not prove transaction settlement, user traction, deployed source parity, or mainnet safety.',
    passed: checks.every((check) => check.status === 'pass'),
    checks,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      web: { type: 'string', default: DEFAULTS.web },
      relayer: { type: 'string', default: DEFAULTS.relayer },
      out: { type: 'string' },
      'web-app': { type: 'boolean', default: false },
      'require-recovery': { type: 'boolean', default: false },
      'timeout-ms': { type: 'string', default: '15000' },
    },
  });
  const timeoutMs = Number(values['timeout-ms']);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error('--timeout-ms must be between 1 and 60000');
  const report = await checkRelease({
    web: values.web,
    relayer: values.relayer,
    webApp: values['web-app'],
    requireRecovery: values['require-recovery'],
    timeoutMs,
  });
  try {
    report.localCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    report.localChanges =
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8',
      }).trim().length > 0;
  } catch {
    report.localCommit = null;
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.out) {
    const path = resolve(values.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json);
  }
  process.stdout.write(json);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
