#!/usr/bin/env node
/**
 * Maren Finance — document proof sheets.
 *
 *   pnpm docs:preview                        every page of every built PDF
 *   pnpm docs:preview 01-thesis              every page of one document
 *   pnpm docs:preview 01-thesis 3,4,5        selected pages
 *   pnpm docs:preview --scale 2.4            higher resolution
 *   pnpm docs:preview --out /tmp/proofs      somewhere other than docs/.tmp/preview
 *
 * A PDF that builds without warnings can still be ugly: a heading stranded at the foot
 * of a page, a table split one row from its header, a contents entry pointing at the
 * wrong page. None of that is visible from build output. This rasterises the real
 * PDF — the same bytes a reader receives, with the embedded fonts — so the typography
 * can be inspected rather than assumed.
 *
 * Output goes to docs/.tmp/preview, which is gitignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BUILD_DIR = path.join(ROOT, 'docs', 'build');
const DEFAULT_OUT = path.join(ROOT, 'docs', '.tmp', 'preview');

function parseArgs(argv) {
  const args = { filter: null, pages: null, scale: 1.6, out: DEFAULT_OUT };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scale') args.scale = Number(argv[(i += 1)]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[(i += 1)]);
    else rest.push(argv[i]);
  }
  // A bare argument is a filename filter; a bare argument of digits and commas is a
  // page list. "01-thesis 3,4" and "3,4" are both unambiguous.
  for (const value of rest) {
    if (/^[\d,\s-]+$/.test(value)) args.pages = value.split(',').map((n) => Number(n.trim()));
    else args.filter = value;
  }
  return args;
}

async function renderDocument(pdfPath, { pages, scale, out }) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const base = path.basename(pdfPath, '.pdf');
  const wanted = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);

  let written = 0;
  for (const n of wanted) {
    if (!Number.isInteger(n) || n < 1 || n > doc.numPages) continue;
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    // PDF pages are transparent where nothing is painted. Without this the body pages
    // rasterise onto black and every proof sheet looks broken.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    fs.writeFileSync(
      path.join(out, `${base}-p${String(n).padStart(2, '0')}.png`),
      canvas.toBuffer('image/png'),
    );
    written += 1;
  }

  await doc.destroy();
  return { base, written, total: doc.numPages };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let files;
  try {
    files = fs
      .readdirSync(BUILD_DIR)
      .filter((f) => f.endsWith('.pdf'))
      .filter((f) => !args.filter || f.includes(args.filter))
      .sort();
  } catch {
    throw new Error(`no built documents at ${path.relative(ROOT, BUILD_DIR)} — run pnpm docs:pdf`);
  }
  if (files.length === 0) throw new Error('no built documents matched');

  fs.mkdirSync(args.out, { recursive: true });

  for (const file of files) {
    const { base, written, total } = await renderDocument(path.join(BUILD_DIR, file), args);
    console.log(`  ${base.padEnd(16)} ${String(written).padStart(3)}/${total} pages`);
  }
  console.log(`\n→ ${args.out}\n`);
}

main().catch((err) => {
  console.error(`\nPreview failed: ${err.message}`);
  process.exit(1);
});
