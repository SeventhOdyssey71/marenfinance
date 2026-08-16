#!/usr/bin/env node
/**
 * Maren Finance — branded document build.
 *
 *   pnpm docs:pdf                 build every document in docs/src
 *   pnpm docs:pdf -- --only 01    build only documents whose filename contains "01"
 *   pnpm docs:pdf -- --keep-html  leave the intermediate HTML in docs/.tmp for inspection
 *
 * Markdown in docs/src/*.md, with YAML frontmatter, becomes a branded A4 PDF in
 * docs/build. Each document is printed in three parts and merged:
 *
 *   cover   zero-margin A4 so the violet-to-near-black gradient reaches the trim edge
 *   body    20mm margins, running footer, contents page with real page numbers
 *   merge   pdf-lib stitches them and stamps the document metadata
 *
 * Fonts are embedded as base64 so the PDF renders identically on any machine. Nothing
 * about font acquisition is allowed to fail the build; everything else is.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { PDFDocument } from 'pdf-lib';

import { buildFontCss, footerFontCss } from './lib/fonts.mjs';
import { renderMarkdown } from './lib/markdown.mjs';
import { coverHtml, bodyHtml, footerTemplate, EMPTY_HEADER } from './lib/template.mjs';
import { launchBrowser, startServer, loadPage } from './lib/browser.mjs';
import { extractPageNumbers } from './lib/pages.mjs';
import { renderDeck } from './lib/deck.mjs';
import { deckCss, SLIDE_W, SLIDE_H, SLIDE_W_IN, SLIDE_H_IN } from './lib/deck-styles.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC_DIR = path.join(ROOT, 'docs', 'src');
const OUT_DIR = path.join(ROOT, 'docs', 'build');
const TMP_DIR = path.join(ROOT, 'docs', '.tmp');
const FONT_CACHE = path.join(TMP_DIR, 'fonts');

const REQUIRED_FRONTMATTER = ['title', 'subtitle', 'docId', 'date', 'classification'];

const t0 = Date.now();
const warnings = [];

const log = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n• ${msg}`);
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  ! ${msg}`);
};

function parseArgs(argv) {
  const args = { only: null, keepHtml: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') args.only = argv[i + 1];
    else if (argv[i] === '--keep-html') args.keepHtml = true;
  }
  return args;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * YAML turns an unquoted 2026-08-15 into a Date, whose toString is a locale-dependent
 * wall of text. Documents get a fixed, unambiguous long form instead.
 */
function formatDate(value) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.valueOf())) return String(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function isoDate(value) {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

/** Split `---\nyaml\n---\nbody` into its two halves. */
function splitFrontmatter(raw, file) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${path.basename(file)} has no YAML frontmatter block`);
  }
  const meta = yaml.load(match[1]) ?? {};
  const missing = REQUIRED_FRONTMATTER.filter((k) => !meta[k]);
  if (missing.length > 0) {
    throw new Error(`${path.basename(file)} frontmatter is missing: ${missing.join(', ')}`);
  }

  meta.isoDate = isoDate(meta.date);
  meta.date = formatDate(meta.date);
  if (meta.version !== undefined) meta.version = String(meta.version);

  // The footer already says "Maren Finance", so the title it carries must not repeat it.
  meta.shortTitle = meta.shortTitle ?? String(meta.title).replace(/^Maren Finance\s+—\s+/, '');

  return { meta, body: match[2] };
}

function mermaidDistDir() {
  try {
    return path.dirname(require.resolve('mermaid/dist/mermaid.esm.min.mjs'));
  } catch {
    try {
      return path.join(path.dirname(require.resolve('mermaid/package.json')), 'dist');
    } catch {
      return null;
    }
  }
}

function colophonHtml(meta) {
  if (!meta.colophon) return '';
  const text = String(meta.colophon)
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.trim().replace(/\n/g, ' ')}</p>`)
    .join('');
  return `<div class="colophon">${text}</div>`;
}

async function printCover({ browser, server, meta, fonts, mermaid = [] }) {
  const html = coverHtml({ meta, fonts });
  const page = await loadPage(browser, server, html, { mermaid, warn });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    pageRanges: '1',
  });
  await page.close();
  return { pdf, html };
}

async function printBody({ browser, server, html, mermaid, meta, footerCss }) {
  const page = await loadPage(browser, server, html, { mermaid, warn });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: EMPTY_HEADER,
    footerTemplate: footerTemplate({ title: meta.shortTitle, fontCss: footerCss }),
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
  });
  await page.close();
  return pdf;
}

/**
 * Fixed dates from the document's own date, so a rebuild of unchanged sources produces
 * an unchanged file rather than a new timestamp.
 */
function applyMetadata(out, meta) {
  const stamp = new Date(`${meta.isoDate ?? '1970-01-01'}T00:00:00Z`);
  out.setTitle(meta.title);
  out.setAuthor('Maren Finance');
  out.setSubject(meta.subtitle);
  out.setProducer('Maren document pipeline (tools/pdf)');
  out.setCreator('Maren Finance');
  out.setKeywords([meta.docId, meta.classification, 'Mezo', 'MUSD', 'Bitcoin']);
  if (!Number.isNaN(stamp.valueOf())) {
    out.setCreationDate(stamp);
    out.setModificationDate(stamp);
  }
}

async function merge({ coverPdf, bodyPdf, meta }) {
  const out = await PDFDocument.create();

  for (const bytes of [coverPdf, bodyPdf]) {
    const src = await PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }

  applyMetadata(out, meta);
  return out.save({ useObjectStreams: true });
}

/**
 * The deck.
 *
 * A document is printed in two passes and three parts because its pagination is
 * discovered rather than declared. A deck has neither problem: every slide is exactly one
 * page of a known size, so this is one print of one document, and the only thing worth
 * checking afterwards is that the page count came out equal to the slide count. When it
 * does not, a slide has overflowed its frame and spilled onto a second page — the single
 * failure this layout can have, and the build refuses it rather than shipping it.
 */
async function buildDeck({ browser, server, meta, body, fonts, keepHtml, base }) {
  const css = deckCss({ fontCss: fonts.css, satoshi: fonts.satoshi, mono: fonts.mono });
  const { html, count } = renderDeck({ body, meta, css });
  log(`${count} slides, ${SLIDE_W}x${SLIDE_H} (16:9)`);

  const page = await loadPage(browser, server, html, {
    warn,
    viewport: { width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 },
  });
  const pdf = await page.pdf({
    width: `${SLIDE_W_IN}in`,
    height: `${SLIDE_H_IN}in`,
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();

  const doc = await PDFDocument.load(pdf);
  const pages = doc.getPageCount();
  if (pages !== count) {
    throw new Error(
      `the deck printed ${pages} pages from ${count} slides — a slide has overflowed ` +
        'its 16:9 frame. Shorten it or split it in two.',
    );
  }
  applyMetadata(doc, meta);
  const merged = await doc.save({ useObjectStreams: true });

  const outFile = path.join(OUT_DIR, `${base}.pdf`);
  await fs.writeFile(outFile, merged);
  if (keepHtml) await fs.writeFile(path.join(TMP_DIR, `${base}.deck.html`), html);

  const kb = Math.round(merged.byteLength / 1024);
  log(`${count} slides, ${kb} kB → docs/build/${base}.pdf`);

  return { base, title: meta.title, docId: meta.docId, pages: count, kb, unit: 'sl' };
}

async function buildDocument({ browser, server, file, fonts, footerCss, keepHtml }) {
  const raw = await fs.readFile(file, 'utf8');
  const { meta, body } = splitFrontmatter(raw, file);
  const base = path.basename(file, '.md');

  step(`${base}.md  →  ${meta.title}`);

  // A deck is a different object from a document and takes a different path: fixed 16:9
  // frames, no cover, no contents, no running footer, and the dark palette (BRAND.md
  // §7.1). Everything below this line is the document pipeline, unchanged.
  if (meta.format === 'deck') {
    return buildDeck({ browser, server, meta, body, fonts, keepHtml, base });
  }

  const { html: content, toc, mermaid } = renderMarkdown(body);
  log(`${toc.length} contents entries, ${mermaid.length} diagram(s)`);

  const { pdf: coverPdf, html: coverSource } = await printCover({
    browser,
    server,
    meta,
    fonts,
  });

  const colophon = colophonHtml(meta);
  const shared = { meta, content, toc, fonts, colophon };

  // Pass 1: markers visible, contents page numbers unknown.
  const measureHtml = bodyHtml({ ...shared, pageNumbers: null });
  const measurePdf = await printBody({
    browser,
    server,
    html: measureHtml,
    mermaid,
    meta,
    footerCss,
  });
  const pageNumbers = await extractPageNumbers(measurePdf, toc, { warn });

  // Pass 2: markers hidden, contents page numbers real.
  const finalHtml = bodyHtml({ ...shared, pageNumbers });
  const bodyPdf = await printBody({
    browser,
    server,
    html: finalHtml,
    mermaid,
    meta,
    footerCss,
  });

  const measurePages = (await PDFDocument.load(measurePdf)).getPageCount();
  const bodyPages = (await PDFDocument.load(bodyPdf)).getPageCount();
  if (measurePages !== bodyPages) {
    warn(
      `pagination shifted between passes (${measurePages} → ${bodyPages} pages); ` +
        'contents page numbers may be off by one',
    );
  }

  const merged = await merge({ coverPdf, bodyPdf, meta });
  const outFile = path.join(OUT_DIR, `${base}.pdf`);
  await fs.writeFile(outFile, merged);

  if (keepHtml) {
    await fs.writeFile(path.join(TMP_DIR, `${base}.cover.html`), coverSource);
    await fs.writeFile(path.join(TMP_DIR, `${base}.body.html`), finalHtml);
  }

  const kb = Math.round(merged.byteLength / 1024);
  log(`${bodyPages + 1} pages (1 cover + ${bodyPages}), ${kb} kB → docs/build/${base}.pdf`);

  return { base, title: meta.title, docId: meta.docId, pages: bodyPages + 1, kb };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('\nMaren Finance · document build');

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });

  let entries;
  try {
    // `*-notes.md` is companion prose for a document rather than a document: the deck's
    // speaker notes live beside the deck so the two are edited together, but they are a
    // script to read before walking on, not something to print. They carry no
    // frontmatter, so without this they would fail the build rather than be skipped.
    entries = (await fs.readdir(SRC_DIR))
      .filter((f) => f.endsWith('.md') && !f.endsWith('-notes.md'))
      .sort();
  } catch {
    throw new Error(`no document sources at ${path.relative(ROOT, SRC_DIR)}`);
  }
  if (args.only) entries = entries.filter((f) => f.includes(args.only));
  if (entries.length === 0) throw new Error('no matching documents in docs/src');

  step('fonts');
  const fonts = await buildFontCss({ cacheDir: FONT_CACHE, repoRoot: ROOT, log, warn });
  const footerCss = await footerFontCss({ cacheDir: FONT_CACHE });
  log(
    `Satoshi ${fonts.satoshi ? 'embedded' : 'FALLBACK'} · ` +
      `Geist Mono ${fonts.mono ? 'embedded' : 'FALLBACK'} · ` +
      `${Math.round(fonts.css.length / 1024)} kB of @font-face`,
  );

  const vendorDir = mermaidDistDir();
  if (!vendorDir) warn('mermaid is not installed — diagrams will not render');

  const server = await startServer({ vendorDir });
  const browser = await launchBrowser({ log, warn });

  const built = [];
  try {
    for (const entry of entries) {
      built.push(
        await buildDocument({
          browser,
          server,
          file: path.join(SRC_DIR, entry),
          fonts,
          footerCss,
          keepHtml: args.keepHtml,
        }),
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n── built ${built.length} document(s) in ${seconds}s`);
  for (const doc of built) {
    const unit = doc.unit ?? 'pp';
    console.log(`   ${doc.docId.padEnd(18)} ${String(doc.pages).padStart(3)} ${unit}   ${doc.title}`);
  }
  if (warnings.length > 0) {
    console.log(`\n   ${warnings.length} warning(s) — the build completed anyway.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\nDocument build failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
