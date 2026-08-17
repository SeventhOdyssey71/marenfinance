/**
 * The Maren print stylesheet.
 *
 * Documents invert the product's dark palette: light ground, dark text (BRAND.md §7),
 * because they get printed and read in daylight and a grant committee should not have
 * to fight a black PDF.
 *
 * The layout has one deliberate device: argument is set at a readable ~68ch measure,
 * while evidence — tables, code, diagrams, callouts — spans the full text block. The
 * reader can tell prose from proof at a glance without any decoration doing the work.
 */

export const PALETTE = {
  ink: '#111114',
  muted: '#5A5A66',
  subtle: '#8A8A96',
  hairline: '#E6E6EC',
  hairlineSoft: '#F0F0F4',
  paper: '#FFFFFF',
  well: '#FAFAFB',
  violet: '#5B3DF5',
  violetDeep: '#1B1140',
  violetTint: '#F5F3FF',
  btc: '#F7931A',
  musd: '#0F7B5A',
  warning: '#B45309',
  danger: '#B91C1C',
  success: '#0F7B5A',
};

/** Millimetres of printable width at A4 with the brand's 20mm margins. */
export const CONTENT_WIDTH_MM = 170;
/** Measure for running prose. ~68 characters at 10.5pt Satoshi. */
export const PROSE_WIDTH_MM = 126;

const SANS = (satoshi) =>
  satoshi
    ? `'Satoshi', 'Geist Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif`
    : `'Geist Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif`;

const MONO = (mono) =>
  mono
    ? `'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace`
    : `ui-monospace, 'SF Mono', Menlo, monospace`;

export function documentCss({ fontCss = '', satoshi = true, mono = true } = {}) {
  const p = PALETTE;
  return `
${fontCss}

:root {
  --ink: ${p.ink};
  --muted: ${p.muted};
  --subtle: ${p.subtle};
  --hairline: ${p.hairline};
  --hairline-soft: ${p.hairlineSoft};
  --well: ${p.well};
  --violet: ${p.violet};
  --violet-deep: ${p.violetDeep};
  --violet-tint: ${p.violetTint};
  --sans: ${SANS(satoshi)};
  --mono: ${MONO(mono)};
  --prose: ${PROSE_WIDTH_MM}mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${p.paper};
  color: var(--ink);
  font-family: var(--sans);
  font-size: 10.5pt;
  line-height: 1.62;
  font-weight: 400;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

/* Page-number markers. Visible (white, 2px) only during the measurement pass, so the
   table of contents can read true page numbers back out of the printed PDF. */
.pgmark { visibility: hidden; font-size: 2px; line-height: 0; color: #FFFFFF; letter-spacing: 0; }
body.pass-measure .pgmark { visibility: visible; }

/* A forced break is expressed on the element that follows, not as break-after on a
   zero-height div. break-after on an empty box that has already flowed onto a fresh
   page forces a second break and leaves a blank page behind it; break-before is a no-op
   when the content is already at the top of a page. */
.pagebreak { display: none; }
.pagebreak + * { break-before: page; }

/* ── Headings ──────────────────────────────────────────────────────────────── */

/* A heading must never print as the last thing on a page. Chromium honours the legacy
   page-break-after alias more reliably than break-after for print fragmentation, so
   both are declared. */
h1, h2, h3, h4 {
  font-family: var(--sans);
  color: var(--ink);
  margin: 0;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
}

h1 {
  font-size: 25pt;
  line-height: 1.06;
  font-weight: 700;
  letter-spacing: -0.028em;
  max-width: var(--prose);
}

h2 {
  font-size: 16.5pt;
  line-height: 1.18;
  font-weight: 700;
  letter-spacing: -0.021em;
  margin: 13mm 0 4.5mm;
  padding-top: 4mm;
  border-top: 1px solid var(--hairline);
  max-width: var(--prose);
}

/* Each heading is wrapped with the block that follows it (see browser.mjs) so the pair
   can never be split across a page. */
.keep-with-next {
  page-break-inside: avoid;
  break-inside: avoid;
}

main > h2:first-child,
main > .keep-with-next:first-child > h2 { margin-top: 0; }

/* Chromium resolves an avoid-break between two siblings only when both sides ask for
   it, so the element after a heading declines a break before itself as well. Together
   these two rules are what actually stop an orphaned heading. */
h1 + *, h2 + *, h3 + *, h4 + * {
  page-break-before: avoid;
  break-before: avoid;
}

h3 {
  font-size: 12pt;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: -0.012em;
  margin: 8mm 0 3mm;
  max-width: var(--prose);
}

h4 {
  font-size: 10.5pt;
  font-weight: 700;
  letter-spacing: -0.005em;
  margin: 6mm 0 2mm;
  max-width: var(--prose);
}

/* Section numbers sit above the heading as a violet label, never inline with it. */
.h-num {
  display: block;
  font-family: var(--mono);
  font-size: 7.5pt;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--violet);
  margin-bottom: 1.6mm;
  font-variant-numeric: tabular-nums;
}

h3 .h-num { font-size: 7pt; margin-bottom: 1mm; color: var(--subtle); }

/* ── Prose ─────────────────────────────────────────────────────────────────── */

p, ul, ol, blockquote {
  max-width: var(--prose);
  margin: 0 0 3.6mm;
  orphans: 3;
  widows: 3;
}

ul, ol { padding-left: 5mm; }
li { margin: 0 0 1.6mm; }
li > ul, li > ol { margin-top: 1.6mm; }
li::marker { color: var(--subtle); }

strong { font-weight: 700; }
em { font-style: italic; }

a {
  color: var(--violet);
  text-decoration: none;
  border-bottom: 0.5px solid rgba(91, 61, 245, 0.35);
}

hr {
  border: 0;
  border-top: 1px solid var(--hairline);
  margin: 8mm 0;
  max-width: ${CONTENT_WIDTH_MM}mm;
}

blockquote {
  border-left: 2px solid var(--hairline);
  padding-left: 5mm;
  color: var(--muted);
  font-style: italic;
}
blockquote p:last-child { margin-bottom: 0; }

/* Numerals, addresses, and units are always mono with tabular figures (BRAND.md §3). */
code, kbd, samp {
  font-family: var(--mono);
  font-size: 0.9em;
  font-variant-numeric: tabular-nums;
}

p code, li code, td code, th code {
  background: var(--well);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 0.3mm 1.1mm;
  color: var(--violet-deep);
  white-space: nowrap;
}

/* ── Tables ────────────────────────────────────────────────────────────────── */
/* Horizontal hairlines only, numeric columns right-aligned in mono (BRAND.md §7). */

/* Keep a table whole where it can be. Chromium moves an unsplittable block to the next
   page and only breaks it if it still does not fit, so long tables still paginate —
   but a four-row table can no longer leave a single orphaned row behind a repeated
   header. */
.table-wrap {
  width: ${CONTENT_WIDTH_MM}mm;
  margin: 5mm 0 6mm;
  page-break-inside: avoid;
  break-inside: avoid;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.2pt;
  line-height: 1.45;
}

thead { display: table-header-group; }
tr { break-inside: avoid; }

th {
  font-family: var(--sans);
  font-size: 7.4pt;
  font-weight: 500;
  letter-spacing: 0.075em;
  text-transform: uppercase;
  color: var(--muted);
  text-align: left;
  vertical-align: bottom;
  padding: 0 4mm 2mm 0;
  border-bottom: 1px solid var(--ink);
}

td {
  padding: 2.2mm 4mm 2.2mm 0;
  border-bottom: 1px solid var(--hairline-soft);
  vertical-align: top;
}

th:last-child, td:last-child { padding-right: 0; }

/* Inline code in prose never wraps, but a table full of RPC URLs must be allowed to,
   or the nowrap chips starve the label column and every row header breaks onto three
   lines. Row labels get a floor so they stay on one line where they can. */
td code, th code { white-space: normal; overflow-wrap: anywhere; }
td:first-child { min-width: 26mm; }
tbody tr:last-child td { border-bottom: 1px solid var(--hairline); }

th.num, td.num { text-align: right; }
td.num, td.hex {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 8.6pt;
  white-space: nowrap;
}
td.hex { font-size: 7.6pt; color: var(--muted); }
th.center, td.center { text-align: center; }

td strong { font-weight: 700; }

/* ── Callouts ──────────────────────────────────────────────────────────────── */

.callout {
  width: ${CONTENT_WIDTH_MM}mm;
  margin: 5mm 0 5.5mm;
  padding: 3.5mm 5mm 3.5mm 4.5mm;
  border-radius: 8px;
  border-left: 2.5px solid var(--violet);
  background: var(--violet-tint);
  break-inside: avoid;
  font-size: 9.8pt;
  line-height: 1.55;
}

.callout p, .callout ul, .callout ol { max-width: none; }
.callout > :last-child { margin-bottom: 0; }

.callout-label {
  font-size: 7.2pt;
  font-weight: 500;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  margin: 0 0 1.6mm;
  color: var(--violet);
}

.callout-warning { border-left-color: ${p.btc}; background: #FEF8F0; }
.callout-warning .callout-label { color: ${p.warning}; }

.callout-risk { border-left-color: ${p.danger}; background: #FEF4F4; }
.callout-risk .callout-label { color: ${p.danger}; }

.callout-verified { border-left-color: ${p.success}; background: #F1FAF6; }
.callout-verified .callout-label { color: ${p.success}; }

/* ── Code ──────────────────────────────────────────────────────────────────── */

.codeblock {
  position: relative;
  width: ${CONTENT_WIDTH_MM}mm;
  margin: 4.5mm 0 5.5mm;
  background: var(--well);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  break-inside: avoid;
}

.code-lang {
  position: absolute;
  top: 2mm;
  right: 3mm;
  font-family: var(--sans);
  font-size: 6.6pt;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--subtle);
}

.codeblock pre {
  margin: 0;
  padding: 3.6mm 4mm;
  overflow: visible;
  white-space: pre-wrap;
  word-break: break-word;
}

.codeblock code {
  font-family: var(--mono);
  font-size: 8.2pt;
  line-height: 1.5;
  color: var(--ink);
}

.hljs-keyword, .hljs-built_in, .hljs-literal { color: ${p.violet}; }
.hljs-string, .hljs-regexp { color: ${p.musd}; }
.hljs-comment { color: var(--subtle); font-style: italic; }
.hljs-number { color: ${p.warning}; }
.hljs-type, .hljs-title, .hljs-title.class_, .hljs-title.function_ { color: ${p.violetDeep}; }
.hljs-attr, .hljs-property { color: var(--muted); }
.hljs-meta { color: var(--subtle); }

/* ── Diagrams ──────────────────────────────────────────────────────────────── */

/* App screenshots: framed like the product frames itself — a soft card. */
figure.shot {
  margin: 5mm 0 6mm;
  break-inside: avoid;
}
figure.shot img {
  display: block;
  width: 100%;
  border-radius: 3mm;
  border: 0.4mm solid rgba(20, 18, 35, 0.1);
}
figure.shot figcaption {
  margin-top: 2.4mm;
  font-size: 7.6pt;
  color: rgba(23, 23, 27, 0.55);
  letter-spacing: 0.01em;
}

/* A 66-character transaction hash owns its table cell; if the measure is ever too
   narrow it breaks cleanly mid-string rather than overflowing the page. */
td code { word-break: break-all; }

figure.diagram {
  width: ${CONTENT_WIDTH_MM}mm;
  margin: 6mm 0 7mm;
  padding: 5mm 4mm;
  background: var(--well);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  break-inside: avoid;
  text-align: center;
}

figure.diagram svg {
  max-width: 100%;
  height: auto;
  font-family: var(--sans) !important;
}

/* ── Front matter page ─────────────────────────────────────────────────────── */

.docmeta {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  column-gap: 14mm;
  width: ${CONTENT_WIDTH_MM}mm;
  padding-bottom: 4mm;
  border-bottom: 1px solid var(--hairline);
  margin-bottom: 9mm;
}

.meta-label {
  display: block;
  font-size: 6.8pt;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--subtle);
  margin-bottom: 0.8mm;
}

.meta-value {
  display: block;
  font-family: var(--mono);
  font-size: 8.4pt;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  white-space: nowrap;
}

.lede {
  font-size: 12pt;
  line-height: 1.45;
  letter-spacing: -0.012em;
  color: var(--muted);
  max-width: var(--prose);
  margin: 3mm 0 10mm;
}

/* ── Table of contents ─────────────────────────────────────────────────────── */

.toc { width: ${CONTENT_WIDTH_MM}mm; margin-top: 2mm; }

.toc-title {
  font-size: 7.4pt;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  padding-bottom: 2.5mm;
  border-bottom: 1px solid var(--ink);
  margin-bottom: 3.5mm;
}

.toc-row {
  display: flex;
  align-items: baseline;
  gap: 2.5mm;
  padding: 1.5mm 0;
}

.toc-row.d3 { padding: 0.9mm 0 0.9mm 8mm; }

.toc-num {
  font-family: var(--mono);
  font-size: 8pt;
  font-variant-numeric: tabular-nums;
  color: var(--violet);
  min-width: 8mm;
}

.toc-row.d3 .toc-num { color: var(--subtle); font-size: 7.4pt; min-width: 9mm; }

.toc-label { font-size: 10pt; font-weight: 500; letter-spacing: -0.008em; }
.toc-row.d3 .toc-label { font-size: 9.2pt; font-weight: 400; color: var(--muted); }

.toc-dots {
  flex: 1;
  border-bottom: 1px dotted #C9C9D2;
  transform: translateY(-1mm);
  min-width: 6mm;
}

.toc-page {
  font-family: var(--mono);
  font-size: 8.4pt;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  min-width: 6mm;
  text-align: right;
}

/* ── Closing block ─────────────────────────────────────────────────────────── */

.colophon {
  width: ${CONTENT_WIDTH_MM}mm;
  margin-top: 12mm;
  padding-top: 4mm;
  border-top: 1px solid var(--hairline);
  font-size: 8.2pt;
  line-height: 1.5;
  color: var(--subtle);
  break-inside: avoid;
}

.colophon strong { color: var(--muted); font-weight: 500; }

@page { size: A4; }
`;
}

/**
 * The cover is printed on its own, at exact A4 with no margins.
 *
 * Light and flat, matching the product itself: off-white page, dark ink, the brand
 * mark, and one violet accent bar. The earlier cover was a violet-blur-on-black
 * gradient; it read as crypto-formal, which is the opposite of what the app now is.
 */
export function coverCss({ fontCss = '', satoshi = true, mono = true } = {}) {
  const grain = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">` +
      `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/></filter>` +
      `<rect width="240" height="240" filter="url(#n)" opacity="0.55"/></svg>`,
  );

  return `
${fontCss}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  width: 210mm;
  height: 297mm;
  font-family: ${SANS(satoshi)};
  color: #17171B;
  -webkit-font-smoothing: antialiased;
}

.cover {
  position: relative;
  width: 210mm;
  height: 297mm;
  overflow: hidden;
  background: #F7F6FB;
}

/* A single low-opacity grain pass kills gradient banding and gives the page a
   printed-paper quality (BRAND.md §5, GrainGradient in spirit). */
.grain { display: none; }

.frame {
  position: relative;
  height: 100%;
  padding: 24mm 22mm 20mm;
  display: flex;
  flex-direction: column;
}

.top { display: flex; align-items: center; justify-content: space-between; }

.wordmark {
  display: flex;
  align-items: center;
  gap: 2.6mm;
  font-size: 13pt;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.mark {
  height: 6mm;
  width: auto;
  display: block;
}

.classification {
  font-family: ${MONO(mono)};
  font-size: 7.4pt;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(23, 23, 27, 0.6);
  border: 1px solid rgba(20, 18, 35, 0.2);
  border-radius: 999px;
  padding: 1.6mm 4mm;
}

.spacer { flex: 1; }

.rule {
  width: 100%;
  height: 1px;
  background: rgba(20, 18, 35, 0.14);
  margin-bottom: 9mm;
}

.title {
  font-size: 40pt;
  line-height: 1.02;
  font-weight: 700;
  letter-spacing: -0.032em;
  margin: 0 0 6mm;
  max-width: 150mm;
}

.title .thin { font-weight: 400; color: rgba(23, 23, 27, 0.55); }

.subtitle {
  font-size: 12.5pt;
  line-height: 1.5;
  font-weight: 400;
  color: rgba(23, 23, 27, 0.66);
  max-width: 118mm;
  margin: 0 0 14mm;
}

.meta {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  column-gap: 16mm;
  padding-top: 6mm;
  border-top: 1px solid rgba(20, 18, 35, 0.12);
}

.meta .label {
  display: block;
  font-size: 6.6pt;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(23, 23, 27, 0.45);
  margin-bottom: 1.4mm;
}

.meta .value {
  display: block;
  font-family: ${MONO(mono)};
  font-size: 8.6pt;
  font-variant-numeric: tabular-nums;
  color: rgba(23, 23, 27, 0.9);
  white-space: nowrap;
}

.footline {
  margin-top: 11mm;
  font-size: 8pt;
  letter-spacing: 0.02em;
  color: rgba(23, 23, 27, 0.42);
}

.accent {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2.4mm;
  background: linear-gradient(90deg, #5B3DF5 0%, #8B77FF 42%, rgba(139, 119, 255, 0) 100%);
}

@page { size: A4; margin: 0; }
`;
}
