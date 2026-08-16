#!/usr/bin/env node
/**
 * Record the Maren demo-day walkthrough.
 *
 *   CI=true pnpm --filter @maren/web build
 *   MAREN_TEST_PRIVATE_KEY=0x... node tools/demo/record.mjs
 *
 * Writes docs/demo/maren-walkthrough.webm, plus an .mp4 beside it when an ffmpeg is
 * already on the machine. Nothing about the run is interactive: same command, same video.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT AS A SCREEN RECORDING. A demo video made by hand is
 * accurate for exactly as long as nobody touches the UI, and re-making it costs an
 * afternoon and a steady hand. This costs two minutes and an unattended terminal, which
 * means the video can be regenerated on the morning it is shown rather than being a
 * six-week-old artefact everyone quietly knows is out of date.
 *
 * WHAT IS AND IS NOT REAL. Every figure in the recording is read from Mezo matsnet over
 * JSON RPC at record time — the price, the trove ratio, the balances, the history. Nothing
 * is seeded, stubbed or mocked. The wallet is a genuine EIP-1193 provider whose key lives
 * in Node and never enters the page. The walkthrough deliberately submits no transaction:
 * it fills the Pay form and stops, so a take costs gas of exactly zero and can be run as
 * many times as needed.
 *
 * FLAGS
 *   --out <path>     override the output .webm path
 *   --only a,b,c     record a subset of scenes (ids are in lib/scenes.mjs)
 *   --frames <n>     how many contact-sheet stills to extract afterwards (default 14)
 *   --no-frames      skip the stills
 *
 * ENVIRONMENT
 *   MAREN_TEST_PRIVATE_KEY  signer injected into the page. Without it the app is filmed
 *                           in its disconnected state, which is a real screen but a
 *                           thinner demo. NEVER commit this value.
 *   MEZO_RPC_URL            defaults to https://rpc.test.mezo.org
 *   MAREN_DEMO_HANDLE       handle typed into Pay (default @sele)
 *   DEMO_BASE_URL           record against a server you already have running
 *   CHROME_EXECUTABLE       use a specific Chromium instead of the managed one
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { startWebServer } from './lib/server.mjs';
import { launchChromium, assertWebGL } from './lib/browser.mjs';
import { installCursor, Pointer } from './lib/cursor.mjs';
import { finalise, extractFrames } from './lib/encode.mjs';
import { SCENES } from './lib/scenes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const webDir = join(repoRoot, 'apps', 'web');

/* ── arguments ──────────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const outWebm = resolve(flag('out', join(repoRoot, 'docs', 'demo', 'maren-walkthrough.webm')));
const only = flag('only', null)
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wantFrames = !argv.includes('--no-frames');
const frameCount = Number(flag('frames', 14));

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(7);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

/* ── the recording ──────────────────────────────────────────────────────────────────── */

/**
 * The account the walkthrough films.
 *
 * It holds 0.001 BTC of collateral in MarenVault and no debt — a real position, opened by a
 * real transaction, which is why the Vault screen has something to show. The same address is
 * the `VIEW_ACCOUNT` in apps/web/scripts/verify-behaviour.mjs, so the video and the
 * behaviour checks are looking at exactly the same on-chain state.
 */
const VIEW_ACCOUNT = '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';

const MEZO_MATSNET = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org'] } },
};

let server;
let browser;
let videoDir;

try {
  server = await startWebServer({ webDir, log });
  browser = await launchChromium({ log });

  videoDir = await mkdtemp(join(tmpdir(), 'maren-demo-'));

  const context = await browser.newContext({
    // 1080p is the format every demo-day projector, Zoom share and YouTube upload agrees
    // on. deviceScaleFactor 2 renders the page at 3840x2160 and lets Playwright downsample
    // into the 1920x1080 frame, which is why the type in the recording has clean edges
    // instead of the soft, slightly broken look of a 1x capture.
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
  });

  // `scroll-behavior: smooth` in globals.css makes programmatic scrolling asynchronous and
  // un-awaitable; lib/pacing.mjs supplies its own easing instead, so the pace of the video
  // is a decision rather than a side effect. See the note in scrollTo().
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:auto !important}';
    const attach = () => document.head?.appendChild(style);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }
  });

  await installCursor(context);

  // Reused rather than reimplemented: the same providers the behaviour checks and the
  // on-chain proof script connect through, so the video cannot diverge from what the tests
  // already exercise.
  const { installWallet, installReadOnlyWallet } = await import(
    join(webDir, 'scripts', 'injected-wallet.mjs'),
  );

  let account = null;
  let wallet = null;

  if (process.env.MAREN_TEST_PRIVATE_KEY) {
    // A wallet that can genuinely sign. Nothing in the walkthrough asks it to, but the
    // option exists for a take that intends to submit something. Key material stays in
    // Node; the page only ever sees the EIP-1193 interface.
    wallet = await installWallet(context, {
      privateKey: process.env.MAREN_TEST_PRIVATE_KEY,
      chain: MEZO_MATSNET,
      rpcUrl: MEZO_MATSNET.rpcUrls.default.http[0],
    });
    account = wallet.address;
    log(`signer injected (can sign): ${account}`);
  } else {
    // THE DEFAULT, AND THE MORE INTERESTING CASE.
    //
    // The walkthrough films an account that holds a real position: 0.001 BTC of collateral
    // in MarenVault, no debt. Its private key is not in this repository and is not on the
    // machine, which turns out not to matter — the recording submits nothing, so a provider
    // that reads from Mezo and is structurally incapable of signing is not a compromise. It
    // is a guarantee. A take can be re-run any number of times and cannot spend, cannot
    // disturb the position it is filming, and cannot leave a transaction behind.
    //
    // Every read is still live: eth_call, eth_getLogs and the oracle all go to matsnet. The
    // only capability missing is one the script never exercises.
    account = process.env.MAREN_DEMO_ADDRESS ?? VIEW_ACCOUNT;
    wallet = await installReadOnlyWallet(context, {
      address: account,
      chain: MEZO_MATSNET,
      rpcUrl: MEZO_MATSNET.rpcUrls.default.http[0],
    });
    log(`view account injected (cannot sign): ${account}`);
  }

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Prove the GPU before spending two minutes filming a page that cannot draw its shaders.
  await page.goto(`${server.baseUrl}/`, { waitUntil: 'domcontentloaded' });
  log(`webgl: ${await assertWebGL(page)}`);

  const ctx = {
    page,
    pointer: new Pointer(page),
    baseUrl: server.baseUrl,
    account,
    handle: process.env.MAREN_DEMO_HANDLE ?? '@sele',
    log,
  };

  const running = only ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  if (only) log(`recording a subset: ${running.map((s) => s.id).join(', ')}`);

  const observed = {};
  for (const scene of running) {
    const at = (Date.now() - started) / 1000;
    log(`── ${scene.title}`);
    observed[scene.id] = { at, ...(await scene.run(ctx)) };
  }

  // A beat of stillness so the video does not end on a hard cut mid-motion.
  await new Promise((r) => setTimeout(r, 1_200));

  const result = await finalise({ page, context, outWebm, log });

  if (wantFrames && result.webm) {
    await extractFrames({
      video: result.webm,
      outDir: join(dirname(outWebm), 'frames'),
      count: frameCount,
      log,
    });
  }

  /* ── the run report ───────────────────────────────────────────────────────────────── */

  console.log('\n──────── take ────────');
  console.log(`duration    ${result.seconds ? `${result.seconds.toFixed(1)}s` : 'unknown'}`);
  console.log(`webm        ${result.webm}`);
  console.log(`mp4         ${result.mp4 ?? 'not produced (no ffmpeg)'}`);
  console.log(`signer      ${account ?? 'none — disconnected take'}`);
  // The walkthrough is supposed to fill forms and submit nothing. With the read-only
  // provider this is measured rather than asserted: the page's every request to sign is
  // recorded, and an empty record is the proof that the take cost nothing and moved nothing.
  if (wallet?.signatureRequests) {
    const n = wallet.signatureRequests.length;
    console.log(
      `signatures  ${n} requested${n === 0 ? ' — the take submitted nothing' : ` (${wallet.signatureRequests.map((r) => r.method).join(', ')})`}`,
    );
  }
  console.log('\nwhat the camera saw:');
  for (const [id, seen] of Object.entries(observed)) {
    const { at, ...rest } = seen;
    const summary = Object.entries(rest)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 120)}`)
      .join('  ');
    console.log(`  ${String(at.toFixed(1)).padStart(6)}s  ${id.padEnd(10)} ${summary}`);
  }

  if (consoleErrors.length) {
    console.log(`\n! ${consoleErrors.length} console error(s) during the take:`);
    for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log(`  ${e.slice(0, 200)}`);
  }

  if (result.seconds && (result.seconds < 80 || result.seconds > 130)) {
    console.log(
      `\n! ${result.seconds.toFixed(0)}s is outside the 90-120s the narration in ` +
        'docs/demo/SCRIPT.md is written to. Adjust BEATS in lib/pacing.mjs, not the script.',
    );
  }
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  if (videoDir) await rm(videoDir, { recursive: true, force: true }).catch(() => {});
}
