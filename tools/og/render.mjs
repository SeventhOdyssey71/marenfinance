#!/usr/bin/env node
/**
 * Render the Open Graph / Twitter card to `apps/web/public/og.png`.
 *
 * WHY A RENDERED PNG RATHER THAN next/og. `ImageResponse` runs on Satori, which
 * supports a subset of CSS and needs TTF/OTF fonts. This card's brand fidelity comes
 * from the site's own woff2 faces and from the phone's concentric radii and layered
 * shadow — Satori renders neither faithfully. A headless Chromium renders the exact
 * same CSS the site ships, so the card cannot drift from the brand it represents.
 *
 * The cost is that the PNG is a build artefact that can go stale, which is why this
 * script is committed beside the template: regenerating is one command, and the
 * template is the source of truth rather than a binary nobody can edit.
 *
 * Rendered at 2x and downsampled with a high-quality filter. At 1x the thin type
 * picks up hinting artefacts that are obvious in a feed.
 *
 * Usage:  node tools/og/render.mjs
 */
import { copyFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { launchChromium } from '../demo/lib/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const web = join(repo, 'apps/web');
const OUT = join(web, 'public/og.png');
const SCALE = 2;

/** Assets the template references by bare filename, copied in beside it. */
const ASSETS = [
  [join(web, 'src/fonts/SFProRounded-Regular.woff2'), 'SFProRounded-Regular.woff2'],
  [join(web, 'src/fonts/NeueMontreal-Regular.woff2'), 'NeueMontreal-Regular.woff2'],
  [join(web, 'public/brand/maren-mark.png'), 'maren-mark.png'],
  [join(web, 'public/app-home.png'), 'app-home.png'],
];

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}\n${err.slice(-2000)}`))));
  });
}

let browser;
let dir;
try {
  for (const [src] of ASSETS) {
    if (!existsSync(src)) throw new Error(`missing asset: ${src}`);
  }
  dir = await mkdtemp(join(tmpdir(), 'maren-og-'));
  await copyFile(join(here, 'card.html'), join(dir, 'card.html'));
  for (const [src, name] of ASSETS) await copyFile(src, join(dir, name));

  browser = await launchChromium({ log: () => {} });
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(dir, 'card.html')).href, { waitUntil: 'load' });

  // "Loaded" is not "decoded". Without this the first frame can catch fallback type
  // or a half-painted screenshot, and the card ships with the wrong font.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  });

  const raw = join(dir, 'raw.png');
  await page.screenshot({ path: raw, animations: 'disabled' });
  await mkdir(dirname(OUT), { recursive: true });
  await run('ffmpeg', ['-y', '-i', raw, '-vf', `scale=1200:630:flags=lanczos`, '-pix_fmt', 'rgb24', OUT]);
  process.stdout.write(`wrote ${OUT} (1200x630, rendered at ${SCALE}x)\n`);
} finally {
  await browser?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
}
