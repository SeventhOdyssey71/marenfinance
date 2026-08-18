/**
 * How many JSON-RPC calls one page load actually costs.
 *
 * The number this prints is the reason the multicall work exists, and it is measured
 * rather than reasoned about: Playwright intercepts every request the page makes to
 * Mezo's RPC host, parses the POST body, and counts the JSON-RPC envelopes inside it.
 * Counting HTTP requests alone would undercount a batched transport and overcount a
 * chatty one, so both figures are reported and the per-method histogram is printed under
 * them — a page that made one request containing twenty `eth_call`s has not been
 * optimised, it has been repackaged, and the histogram is what makes that visible.
 *
 *   pnpm --filter @maren/web build
 *   nohup npx next start --port 3111 &
 *   BASE_URL=http://127.0.0.1:3111 \
 *   PLAYWRIGHT_CORE=$(pwd)/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs \
 *   node apps/web/scripts/count-rpc.mjs
 *
 * Reads only. It installs a wallet that cannot sign and never submits anything, so it is
 * safe to run against matsnet as often as you like.
 */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

import { connectWallet, installReadOnlyWallet } from './injected-wallet.mjs';
import { decodeFunctionData, multicall3Abi } from 'viem';

/** `aggregate3((address,bool,bytes)[])`. */
const AGGREGATE3 = '0x82ad56cb';

/**
 * How many contract reads a single `eth_call` actually carries.
 *
 * One request to Multicall3 can hold twenty reads, so counting requests alone would make
 * any batching change look like a 20x win when the node did the same work. Decoding the
 * aggregate3 payload gives the other half of the picture: reads is the workload, calls is
 * the round trips, and the pass is only honest if both are reported.
 */
function readsInCall(envelope) {
  const data = envelope?.params?.[0]?.data;
  if (typeof data !== 'string' || !data.startsWith(AGGREGATE3)) return 1;
  try {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    return decoded.args?.[0]?.length ?? 1;
  } catch {
    return 1;
  }
}

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';

/** The RPC hosts a page load may legitimately reach. Anything else is not counted. */
const RPC_HOSTS = new Set([
  'rpc.test.mezo.org',
  'jsonrpc-mezo.boar.network',
  'mainnet.mezo.public.validationcloud.io',
  'mezo.drpc.org',
]);

const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

/**
 * An account with a real pooled position on matsnet. Measuring against an empty account
 * would understate the cost of every screen: the branches that read a position, a balance
 * and an Earn share only run when there is something there to read.
 */
const VIEW_ACCOUNT = process.env.MAREN_VIEW_ADDRESS ?? '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';

/** Pages worth measuring, in the order a visitor meets them. */
const PATHS = ['/app', '/app/vault', '/app/earn', '/app/activity'];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await installReadOnlyWallet(context, {
  address: VIEW_ACCOUNT,
  chain: mezoTestnet,
  rpcUrl: RPC_URL,
});

const page = await context.newPage();

/** Live tallies, reset between pages. */
let httpRequests = 0;
let rpcCalls = 0;
let contractReads = 0;
let lastRequestAt = Date.now();
const methods = new Map();

page.on('request', (request) => {
  let host;
  try {
    host = new URL(request.url()).host;
  } catch {
    return;
  }
  if (!RPC_HOSTS.has(host)) return;
  if (request.method() !== 'POST') return;

  httpRequests += 1;
  lastRequestAt = Date.now();

  const body = request.postData();
  if (!body) return;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return;
  }
  // A JSON-RPC POST is either one envelope or an array of them. Both shapes are counted
  // as the number of calls they carry, not as one request.
  const envelopes = Array.isArray(payload) ? payload : [payload];
  rpcCalls += envelopes.length;
  for (const envelope of envelopes) {
    const method = envelope?.method ?? 'unknown';
    const reads = method === 'eth_call' ? readsInCall(envelope) : 1;
    contractReads += reads;
    const label = method === 'eth_call' && reads > 1 ? `eth_call (aggregate3 x${reads})` : method;
    methods.set(label, (methods.get(label) ?? 0) + 1);
  }
});

function reset() {
  httpRequests = 0;
  rpcCalls = 0;
  contractReads = 0;
  lastRequestAt = Date.now();
  methods.clear();
}

/**
 * When one page load is over.
 *
 * A fixed wait cannot answer this. Too short and a cold Activity scan — eighteen
 * sequential `eth_getLogs` at about a second each — is still running when counting stops,
 * so its requests get charged to whichever page is measured next. Too long and the
 * fifteen-second price poll and thirty-second protocol poll land inside the window, and a
 * screen that costs one request to open is reported as costing three because it was
 * watched for half a minute.
 *
 * So counting stops when the page goes QUIET: `QUIET_MS` with no request to the RPC. Four
 * seconds is longer than the widest gap inside a healthy scan and shorter than the
 * shortest refetch interval on any of these screens, which is the whole gap the number has
 * to fall into. `MAX_WAIT_MS` stops a screen that never settles from hanging the run.
 */
const QUIET_MS = Number(process.env.QUIET_MS ?? 4_000);
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 90_000);

// Warm the app and connect once, before any counting: the connector handshake is a
// one-time cost and charging it to whichever page happens to be measured first would be
// misleading.
await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
await page.waitForSelector('main', { timeout: 30_000 });
await connectWallet(page);
await page.waitForTimeout(3_000);

/**
 * Refuse to report a number measured against a disconnected app.
 *
 * Every per-account read — position, balances, Earn, activity — is gated on a connected
 * wallet, so a run where the handshake silently failed would print a small, flattering
 * figure that describes a screen nobody uses.
 */
const connectedPill = await page.locator('header .num').count();
if (connectedPill === 0) {
  console.error(
    'The wallet did not connect, so every per-account read would be skipped and the\n' +
      'counts below would describe a disconnected app. Refusing to report them.',
  );
  await context.close();
  await browser.close();
  process.exit(1);
}

const rows = [];

async function measure(label, path) {
  reset();
  await page.goto(BASE + path, { waitUntil: 'networkidle' });

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() - lastRequestAt < QUIET_MS && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }

  const histogram = [...methods.entries()].sort((a, b) => b[1] - a[1]);
  rows.push({ path: label, httpRequests, rpcCalls, contractReads, histogram });
}

for (const path of PATHS) {
  await measure(path, path);
}

/**
 * Activity, measured twice on purpose.
 *
 * The first visit is the whole history from the deployment block. The second is the same
 * screen a minute later, and the only honest way to show the cache is worth having is to
 * count what it costs to arrive at the same coverage line the second time. If the coverage
 * line below is not identical to the first visit's, the cache has bought a smaller number
 * by making a smaller claim, and the win is fake.
 */
await measure('/app/activity (revisit, warm cache)', '/app/activity');

const coverage = (await page.locator('main').innerText()).match(/Read [^.]*\./)?.[0] ?? 'not shown';
const cacheKeys = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith('maren.activity')),
);

await context.close();
await browser.close();

console.log(`\nRPC cost per page load — ${BASE}`);
console.log(`account ${VIEW_ACCOUNT}, counted until ${QUIET_MS}ms of RPC silence\n`);

let totalCalls = 0;
let totalHttp = 0;
let totalReads = 0;
for (const row of rows) {
  totalCalls += row.rpcCalls;
  totalHttp += row.httpRequests;
  totalReads += row.contractReads;
  console.log(`${row.path}`);
  console.log(`  json-rpc calls   ${row.rpcCalls}`);
  console.log(`  http requests    ${row.httpRequests}`);
  console.log(`  chain reads      ${row.contractReads}  (aggregate3 members counted singly)`);
  for (const [method, count] of row.histogram) {
    console.log(`    ${method.padEnd(34)} ${count}`);
  }
  console.log('');
}
console.log(
  `total across ${rows.length} loads: ${totalCalls} json-rpc calls, ` +
    `${totalHttp} POSTs, ${totalReads} chain reads`,
);
console.log(`\nActivity coverage after the revisit: ${coverage}`);
console.log(`Activity cache keys held: ${cacheKeys.join(', ') || 'none'}`);
