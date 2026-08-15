/**
 * Font acquisition and embedding.
 *
 * Documents must render identically on a grant committee's machine, a printer, and a
 * phone. That means the typefaces travel inside the PDF, so every face is fetched once,
 * cached under docs/.tmp/fonts, and inlined into the stylesheet as a base64 data URI.
 *
 * Nothing here is allowed to fail the build. If a face cannot be fetched we warn and
 * fall back — per BRAND.md §3, Satoshi falls back to Geist Sans and then to the system
 * grotesque, never silently to Inter.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);

const SATOSHI_ZIP_URL = 'https://api.fontshare.com/v2/fonts/download/satoshi';
const GOOGLE_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap';

/** A modern-browser UA, so Google Fonts serves woff2 rather than legacy ttf. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SATOSHI_FACES = [
  { file: 'Satoshi-Regular.woff2', weight: 400, style: 'normal' },
  { file: 'Satoshi-Medium.woff2', weight: 500, style: 'normal' },
  { file: 'Satoshi-Bold.woff2', weight: 700, style: 'normal' },
  { file: 'Satoshi-Black.woff2', weight: 900, style: 'normal' },
  { file: 'Satoshi-Italic.woff2', weight: 400, style: 'italic' },
];

const GEIST_MONO_FACES = [
  { file: 'GeistMono-Regular.woff2', weight: 400, style: 'normal' },
  { file: 'GeistMono-Medium.woff2', weight: 500, style: 'normal' },
];

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchBuffer(url, { warn }) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!res.ok) {
      warn(`fetch ${url} -> HTTP ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    warn(`fetch ${url} -> ${err.message}`);
    return null;
  }
}

/** Recursively collect files under `dir` whose basename matches `re`. */
async function findFiles(dir, re, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await findFiles(full, re, out);
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Satoshi ships from Fontshare as a zip. Unpack it with the system `unzip`, pull the
 * WEB/woff2 faces out, and cache them flat so later runs never touch the network.
 */
async function ensureSatoshi(cacheDir, { warn, log }) {
  const missing = [];
  for (const face of SATOSHI_FACES) {
    if (!(await exists(path.join(cacheDir, face.file)))) missing.push(face.file);
  }
  if (missing.length === 0) return;

  log(`fetching Satoshi from Fontshare (${missing.length} face(s) missing from cache)`);

  const zip = await fetchBuffer(SATOSHI_ZIP_URL, { warn });
  if (!zip) {
    warn('Satoshi could not be downloaded — falling back to Geist Sans / system grotesque');
    return;
  }

  const zipPath = path.join(cacheDir, 'satoshi.zip');
  const unpackDir = path.join(cacheDir, 'satoshi-unpacked');
  await fs.writeFile(zipPath, zip);
  await fs.rm(unpackDir, { recursive: true, force: true });

  try {
    await exec('unzip', ['-o', '-q', zipPath, '-d', unpackDir]);
  } catch (err) {
    warn(`could not unpack the Satoshi archive (${err.message}) — falling back`);
    return;
  }

  const found = await findFiles(unpackDir, /^Satoshi-[A-Za-z]+\.woff2$/);
  for (const src of found) {
    const dest = path.join(cacheDir, path.basename(src));
    if (!(await exists(dest))) await fs.copyFile(src, dest);
  }

  await fs.rm(unpackDir, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
}

/**
 * Geist Mono, in order of preference:
 *   1. the `geist` npm package, if some workspace has already installed it;
 *   2. Google Fonts, parsing the css2 response for its woff2 URLs.
 */
async function ensureGeistMono(cacheDir, repoRoot, { warn, log }) {
  const missing = [];
  for (const face of GEIST_MONO_FACES) {
    if (!(await exists(path.join(cacheDir, face.file)))) missing.push(face);
  }
  if (missing.length === 0) return;

  const local = await findFiles(
    path.join(repoRoot, 'node_modules'),
    /^GeistMono-(Regular|Medium)\.woff2$/,
  );
  for (const src of local) {
    const dest = path.join(cacheDir, path.basename(src));
    if (!(await exists(dest))) await fs.copyFile(src, dest);
  }

  const stillMissing = [];
  for (const face of GEIST_MONO_FACES) {
    if (!(await exists(path.join(cacheDir, face.file)))) stillMissing.push(face);
  }
  if (stillMissing.length === 0) return;

  log(`fetching Geist Mono from Google Fonts (${stillMissing.length} face(s) missing from cache)`);
  const cssBuf = await fetchBuffer(GOOGLE_CSS_URL, { warn });
  if (!cssBuf) {
    warn('Geist Mono could not be downloaded — falling back to the system monospace');
    return;
  }

  // Take the `latin` block for each weight: it carries every glyph a Maren document uses.
  const css = cssBuf.toString('utf8');
  const blocks = css.split('@font-face').slice(1);
  for (const face of stillMissing) {
    const weight = String(face.weight);
    const block = blocks.find(
      (b) => b.includes(`font-weight: ${weight}`) && b.includes('U+0000-00FF'),
    );
    const url = block?.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
    if (!url) {
      warn(`Geist Mono ${weight} not present in the Google Fonts response`);
      continue;
    }
    const buf = await fetchBuffer(url, { warn });
    if (buf) await fs.writeFile(path.join(cacheDir, face.file), buf);
  }
}

async function faceCss(cacheDir, family, faces, { warn }) {
  const out = [];
  for (const face of faces) {
    const file = path.join(cacheDir, face.file);
    if (!(await exists(file))) {
      warn(`${family} ${face.weight}${face.style === 'italic' ? ' italic' : ''} unavailable`);
      continue;
    }
    const b64 = (await fs.readFile(file)).toString('base64');
    out.push(
      `@font-face{font-family:'${family}';font-style:${face.style};font-weight:${face.weight};` +
        `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`,
    );
  }
  return out.join('\n');
}

/**
 * Returns `{ css, satoshi, mono }` — the @font-face block to inline, plus flags telling
 * the caller which families actually made it in, so the stylesheet can adjust.
 */
export async function buildFontCss({ cacheDir, repoRoot, log, warn }) {
  await fs.mkdir(cacheDir, { recursive: true });

  await ensureSatoshi(cacheDir, { warn, log });
  await ensureGeistMono(cacheDir, repoRoot, { warn, log });

  const satoshiCss = await faceCss(cacheDir, 'Satoshi', SATOSHI_FACES, { warn });
  const monoCss = await faceCss(cacheDir, 'Geist Mono', GEIST_MONO_FACES, { warn });

  const satoshi = satoshiCss.length > 0;
  const mono = monoCss.length > 0;

  if (!satoshi) warn('no Satoshi faces embedded — documents will use the fallback stack');
  if (!mono) warn('no Geist Mono faces embedded — numerals will use the system monospace');

  return { css: [satoshiCss, monoCss].filter(Boolean).join('\n'), satoshi, mono };
}

/** Just the regular Satoshi face — used by the page footer, which renders in its own document. */
export async function footerFontCss({ cacheDir }) {
  const file = path.join(cacheDir, 'Satoshi-Medium.woff2');
  if (!(await exists(file))) return '';
  const b64 = (await fs.readFile(file)).toString('base64');
  return (
    `@font-face{font-family:'Satoshi';font-style:normal;font-weight:500;font-display:block;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2')}`
  );
}
