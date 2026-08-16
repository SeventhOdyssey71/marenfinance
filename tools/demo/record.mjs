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

  let account = null;
  if (process.env.MAREN_TEST_PRIVATE_KEY) {
    // Reused rather than reimplemented: the same provider the behaviour checks and the
    // on-chain proof script connect through, so the video cannot diverge from what the
    // tests exercise. Key material stays in Node; the page only ever sees the interface.
    const { installWallet } = await import(join(webDir, 'scripts', 'injected-wallet.mjs'));
    const wallet = await installWallet(context, {
      privateKey: process.env.MAREN_TEST_PRIVATE_KEY,
      chain: MEZO_MATSNET,
      rpcUrl: MEZO_MATSNET.rpcUrls.default.http[0],
    });
    account = wallet.address;
    log(`signer injected: ${account}`);
  } else {
    log('! MAREN_TEST_PRIVATE_KEY unset — filming the disconnected app.');
    log('  Every app screen will be the anon state. That is a real screen, but a thin demo.');
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
