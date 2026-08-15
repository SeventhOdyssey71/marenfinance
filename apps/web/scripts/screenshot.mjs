/**
 * Full-page screenshots of the landing page at the two widths that matter:
 * 1440px (desktop reference) and 390px (the narrow end the reference design
 * breaks at). Output lands in apps/web/.screenshots/, which is gitignored.
 *
 *   pnpm --filter @maren/web build
 *   pnpm --filter @maren/web start &
 *   node apps/web/scripts/screenshot.mjs
 *
 * Uses playwright-core. If it is not installed in the workspace, point
 * PLAYWRIGHT_CORE at an existing copy:
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/screenshot.mjs
 */

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '.screenshots');

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * Full-page captures run at deviceScaleFactor 1. Chrome cannot allocate a
 * capture bitmap taller than ~16384 device pixels; at 2x a 9,000px page blows
 * straight through that and Chrome silently wraps the tail of the page back to
 * the top, which looks like duplicated content. Section closeups below run at
 * 2x, where the height is small enough to be safe.
 */
const shots = [
  { name: 'home-1440', path: '/', width: 1440, height: 1000 },
  { name: 'home-390', path: '/', width: 390, height: 844 },
  { name: 'home-360', path: '/', width: 360, height: 780 },
  { name: 'home-2560', path: '/', width: 2560, height: 1400 },
  // The dApp. Every route at desktop, and the two most layout-sensitive at 390px.
  { name: 'app-1440', path: '/app', width: 1440, height: 1000 },
  { name: 'app-390', path: '/app', width: 390, height: 844 },
  { name: 'app-vault-1440', path: '/app/vault', width: 1440, height: 1000 },
  { name: 'app-vault-390', path: '/app/vault', width: 390, height: 844 },
  { name: 'app-pay-1440', path: '/app/pay', width: 1440, height: 1000 },
  { name: 'app-pay-390', path: '/app/pay', width: 390, height: 844 },
  { name: 'app-earn-1440', path: '/app/earn', width: 1440, height: 1000 },
  { name: 'app-activity-1440', path: '/app/activity', width: 1440, height: 1000 },
];

/** Retina closeups, captured at viewport size rather than full page. */
const closeups = [
  { name: 'x2-hero-1440', path: '/', width: 1440, height: 900, scrollTo: null },
  { name: 'x2-problem-1440', path: '/', width: 1440, height: 900, scrollTo: '#problem' },
  {
    name: 'x2-frictions-1440',
    path: '/',
    width: 1440,
    height: 980,
    scrollTo: '#frictions',
  },
  { name: 'x2-product-1440', path: '/', width: 1440, height: 900, scrollTo: '#product' },
  { name: 'x2-faq-1440', path: '/', width: 1440, height: 900, scrollTo: '#faq' },
  { name: 'x2-cta-1440', path: '/', width: 1440, height: 900, scrollTo: '#cta-title' },
  { name: 'x2-hero-390', path: '/', width: 390, height: 844, scrollTo: null },
  { name: 'x2-frictions-390', path: '/', width: 390, height: 844, scrollTo: '#frictions' },
  // The health hero and the borrow slider are where this design either holds or
  // falls apart, so both get a retina closeup.
  { name: 'x2-app-health-1440', path: '/app', width: 1440, height: 900, scrollTo: null },
  { name: 'x2-vault-1440', path: '/app/vault', width: 1440, height: 980, scrollTo: null },
  { name: 'x2-pay-1440', path: '/app/pay', width: 1440, height: 900, scrollTo: null },
  { name: 'x2-earn-1440', path: '/app/earn', width: 1440, height: 900, scrollTo: null },
];

const specifier = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
const pw = await import(specifier);
// playwright-core is CJS, so an ESM import may hand it back under `default`.
const { chromium } = pw.chromium ? pw : pw.default;

await mkdir(outDir, { recursive: true });

// CHROME_EXECUTABLE lets this run against an already-installed Chrome instead
// of a Playwright-managed download.
const executablePath = process.env.CHROME_EXECUTABLE;
const browser = await chromium.launch(
  executablePath ? { executablePath, args: ['--use-gl=angle'] } : {},
);

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  // The page uses `scroll-behavior: smooth` for anchor links. During capture
  // that makes programmatic scrolling asynchronous, so the walk below would
  // never actually reach the bottom and lazy sections would stay unrevealed.
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:auto !important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  });

  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  // Walk the page so every IntersectionObserver-gated section reveals and every
  // lazy shader mounts, then return to the top before capturing.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    const total = document.body.scrollHeight;
    for (let y = 0; y <= total; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 90)));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 900));
  });

  // Every entrance animation should have completed by now.
  const unrevealed = await page.evaluate(
    () =>
      [...document.querySelectorAll('.reveal')].filter(
        (el) => Number(getComputedStyle(el).opacity) < 0.99,
      ).length,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  await page.screenshot({
    path: join(outDir, `${shot.name}.png`),
    fullPage: true,
  });

  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);

  console.log(
    `${shot.name.padEnd(12)} ${String(shot.width).padStart(5)}px  ` +
      `h-overflow=${overflow}px  unrevealed=${unrevealed}  shaders=${canvases}  ` +
      `console-errors=${errors.length}` +
      (errors.length ? `\n  ${errors.join('\n  ')}` : ''),
  );

  await context.close();
}

for (const shot of closeups) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:auto !important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
  });

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 80)));
    }
  });

  if (shot.scrollTo) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const target = el?.closest('section') ?? el;
      window.scrollTo(0, (target?.getBoundingClientRect().top ?? 0) + window.scrollY - 72);
    }, shot.scrollTo);
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(900);

  await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
  console.log(`${shot.name.padEnd(20)} ${shot.width}px @2x`);

  await context.close();
}

await browser.close();
console.log(`\nWrote ${shots.length + closeups.length} screenshots to ${outDir}`);
