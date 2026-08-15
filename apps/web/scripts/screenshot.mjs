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

const shots = [
  { name: 'home-1440', path: '/', width: 1440, height: 1000 },
  { name: 'home-390', path: '/', width: 390, height: 844 },
  { name: 'home-360', path: '/', width: 360, height: 780 },
  { name: 'home-2560', path: '/', width: 2560, height: 1400 },
  { name: 'app-1440', path: '/app', width: 1440, height: 1000 },
];

const specifier = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
const { chromium } = await import(specifier);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
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
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 600));
  });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  await page.screenshot({
    path: join(outDir, `${shot.name}.png`),
    fullPage: true,
  });

  console.log(
    `${shot.name.padEnd(12)} ${String(shot.width).padStart(5)}px  ` +
      `h-overflow=${overflow}px  console-errors=${errors.length}` +
      (errors.length ? `\n  ${errors.join('\n  ')}` : ''),
  );

  await context.close();
}

await browser.close();
console.log(`\nWrote ${shots.length} screenshots to ${outDir}`);
