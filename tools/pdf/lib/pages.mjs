/**
 * Turning printed pages back into a table of contents.
 *
 * There is no honest way to compute the page a heading lands on from continuous
 * layout — Chrome only decides where the breaks fall while it paginates, and the
 * whole point of the break rules is that they move things. So we print twice:
 *
 *   pass 1  every heading carries a 2px white marker token; we read the text layer
 *           of the resulting PDF and learn which page each token printed on;
 *   pass 2  the same document, byte-for-byte identical in layout, with the marker
 *           hidden and the real page numbers substituted into the contents page.
 *
 * The two passes paginate identically because only the digits in the right-hand
 * column of a fixed-width contents row change between them.
 */

import { MARK_PREFIX, MARK_SUFFIX } from './markdown.mjs';

let pdfjs = null;

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/**
 * @param {Uint8Array} pdfBytes
 * @param {Array<{slug:string}>} toc
 * @returns {Promise<Record<string, number>>} slug -> 1-based page number
 */
export async function extractPageNumbers(pdfBytes, toc, { warn }) {
  const found = {};

  try {
    const { getDocument } = await loadPdfjs();
    const doc = await getDocument({
      data: new Uint8Array(pdfBytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;

    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Join without a separator: a marker can be split across text items, and no
      // marker token contains whitespace, so concatenation is the safe reading.
      const text = content.items.map((i) => i.str ?? '').join('');
      for (const entry of toc) {
        const token = MARK_PREFIX + entry.slug + MARK_SUFFIX;
        if (found[entry.slug] === undefined && text.includes(token)) {
          found[entry.slug] = n;
        }
      }
      page.cleanup();
    }
    await doc.destroy();
  } catch (err) {
    warn(`could not read page numbers back from the PDF (${err.message})`);
  }

  // Any heading we failed to locate inherits the last page we did locate, so the
  // contents page degrades to slightly-wrong rather than blank.
  let last = 1;
  const resolved = {};
  let misses = 0;
  for (const entry of toc) {
    if (found[entry.slug] !== undefined) {
      last = found[entry.slug];
    } else {
      misses += 1;
    }
    resolved[entry.slug] = last;
  }
  if (misses > 0) warn(`${misses} of ${toc.length} contents entries fell back to an estimate`);

  return resolved;
}
