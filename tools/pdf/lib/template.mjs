/**
 * HTML shells for the cover page and the document body.
 *
 * The cover and the body are printed as separate PDFs and merged: the cover needs a
 * zero-margin page so its gradient reaches the trim edge, while the body needs 20mm
 * margins and a running footer. Merging is the only way to have both without
 * compromising either.
 */

import { documentCss, coverCss } from './styles.mjs';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Investment & Grant Thesis" -> "Investment &amp; Grant <span class=thin>Thesis</span>" */
function styleTitle(title) {
  const parts = String(title).split(' — ');
  if (parts.length === 2) {
    return `${esc(parts[0])}<br><span class="thin">${esc(parts[1])}</span>`;
  }
  return esc(title);
}

export function coverHtml({ meta, fonts }) {
  const cells = [
    ['Document', meta.docId],
    ['Date', meta.date],
    meta.version ? ['Version', meta.version] : null,
    meta.audience ? ['Prepared for', meta.audience] : null,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title)}</title>
<style>${coverCss({ fontCss: fonts.css, satoshi: fonts.satoshi, mono: fonts.mono })}</style>
</head>
<body>
  <div class="cover">
    <div class="grain"></div>
    <div class="frame">
      <div class="top">
        <div class="wordmark"><span class="mark"></span>Maren</div>
        <div class="classification">${esc(meta.classification)}</div>
      </div>
      <div class="spacer"></div>
      <div class="rule"></div>
      <h1 class="title">${styleTitle(meta.title)}</h1>
      <p class="subtitle">${esc(meta.subtitle)}</p>
      <div class="meta">
        ${cells
          .map(
            ([label, value]) =>
              `<div><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`,
          )
          .join('\n        ')}
      </div>
      <div class="footline">Maren Finance · Bitcoin liquidity, gasless spending, and yield · Built on Mezo Chain</div>
    </div>
    <div class="accent"></div>
  </div>
</body></html>`;
}

/**
 * @param pageNumbers  slug -> page number, or null on the measurement pass.
 */
export function bodyHtml({ meta, content, toc, fonts, pageNumbers = null, colophon = '' }) {
  const measuring = pageNumbers === null;

  const tocRows = toc
    .map((entry) => {
      const page = pageNumbers?.[entry.slug];
      return (
        `<div class="toc-row d${entry.depth}">` +
        `<span class="toc-num">${esc(entry.number)}</span>` +
        `<span class="toc-label">${esc(entry.text)}</span>` +
        `<span class="toc-dots"></span>` +
        `<span class="toc-page">${page ? esc(page) : '—'}</span>` +
        `</div>`
      );
    })
    .join('\n      ');

  const metaCells = [
    ['Document', meta.docId],
    ['Date', meta.date],
    ['Classification', meta.classification],
    meta.version ? ['Version', meta.version] : null,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title)}</title>
<style>${documentCss({ fontCss: fonts.css, satoshi: fonts.satoshi, mono: fonts.mono })}</style>
</head>
<body class="${measuring ? 'pass-measure' : 'pass-final'}">
  <header>
    <div class="docmeta">
      ${metaCells
        .map(
          ([label, value]) =>
            `<div class="cell"><span class="meta-label">${esc(label)}</span><span class="meta-value">${esc(value)}</span></div>`,
        )
        .join('\n      ')}
    </div>
    <h1>${esc(meta.title)}</h1>
    <p class="lede">${esc(meta.subtitle)}</p>
  </header>

  <nav class="toc">
    <div class="toc-title">Contents</div>
    ${tocRows}
  </nav>

  <div class="pagebreak"></div>

  <main>
${content}
  </main>

  ${colophon}
</body></html>`;
}

/**
 * Running footer. BRAND.md §7 requires `Maren Finance · <Doc title> · <page>/<total>`
 * on every page; it is set across the text block so the page number lands under the
 * right edge of the measure.
 */
export function footerTemplate({ title, fontCss = '' }) {
  const family = fontCss
    ? `'Satoshi', -apple-system, Helvetica, Arial, sans-serif`
    : `-apple-system, Helvetica, Arial, sans-serif`;
  return `<style>
${fontCss}
#mf {
  box-sizing: border-box;
  width: 170mm;
  margin: 0 auto 6mm;
  padding-top: 2.2mm;
  border-top: 1px solid #E6E6EC;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-family: ${family};
  font-size: 7pt;
  font-weight: 500;
  letter-spacing: 0.045em;
  color: #8A8A96;
  -webkit-print-color-adjust: exact;
}
#mf .r { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
<div id="mf">
  <span>Maren Finance &nbsp;&middot;&nbsp; ${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>
  <span class="r"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

export const EMPTY_HEADER = '<span style="display:none"></span>';
