// Render PDF pages to PNG so the typography can actually be inspected.
import fs from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '/Users/eromonseleodigie/mezo-talise/.claude/worktrees/agent-a67a0f0d676601cfb/node_modules/.pnpm/@napi-rs+canvas@0.1.100/node_modules/@napi-rs/canvas/index.js';

const [, , pdfPath, outDir, pagesArg, scaleArg] = process.argv;
const scale = Number(scaleArg || 1.6);
fs.mkdirSync(outDir, { recursive: true });

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;

const pages = pagesArg
  ? pagesArg.split(',').map(Number)
  : Array.from({ length: doc.numPages }, (_, i) => i + 1);

const base = path.basename(pdfPath, '.pdf');
for (const n of pages) {
  if (n < 1 || n > doc.numPages) continue;
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const out = path.join(outDir, `${base}-p${String(n).padStart(2, '0')}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(out);
}
console.log(`pages=${doc.numPages}`);
await doc.destroy();
