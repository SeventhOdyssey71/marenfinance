/**
 * The Maren slide stylesheet.
 *
 * The seven documents invert the product palette to light (BRAND.md §7) because they get
 * printed. The deck does not: it gets projected, in a room with the lights down, so it
 * stays on the product's near-black ground with the violet accent. That divergence is
 * recorded in BRAND.md §7.1 rather than left as an undocumented exception here.
 *
 * The page is 1280 x 720 CSS px, which is 13.333in x 7.5in at 96dpi — 16:9 exactly, and
 * the same coordinate space as every other slide tool, so a size chosen here means the
 * same thing anywhere else.
 *
 * Everything is sized for a projector six feet away, which is the only constraint that
 * actually decides the type scale. Nothing carrying meaning is set below 20px, and the
 * one palette token that fails WCAG AA on dark (`text-subtle` #6B6B75, noted in the
 * project context) is used for decoration only — never for a word anyone has to read.
 */

import { grainTile } from './noise.mjs';

/** The slide canvas, in CSS px. 16:9. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/** Inches, for puppeteer's page size. 1280/96 and 720/96. */
export const SLIDE_W_IN = SLIDE_W / 96;
export const SLIDE_H_IN = SLIDE_H / 96;

export const DECK_PALETTE = {
  bg: '#08080A',
  surface: '#101013',
  surfaceRaised: '#17171B',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  violet400: '#8B77FF',
  violet500: '#5B3DF5',
  violet900: '#1B1140',
  btc: '#F7931A',
  musd: '#3ECF8E',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  subtle: '#6B6B75',
};

const SANS = (satoshi) =>
  satoshi
    ? `'Satoshi', 'Geist Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif`
    : `'Geist Sans', -apple-system, 'Helvetica Neue', Arial, sans-serif`;

const MONO = (mono) =>
  mono
    ? `'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace`
    : `ui-monospace, 'SF Mono', Menlo, monospace`;

export function deckCss({ fontCss = '', satoshi = true, mono = true } = {}) {
  const P = DECK_PALETTE;

  // One low-opacity grain pass, as on the document cover, so the large flat fields of
  // near-black do not band on a projector. See lib/noise.mjs for why this is a raster
  // tile here and an SVG filter there.
  const grain = grainTile({ size: 128 });

  return `
${fontCss}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${P.bg};
  color: ${P.text};
  font-family: ${SANS(satoshi)};
  -webkit-font-smoothing: antialiased;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page { size: ${SLIDE_W_IN}in ${SLIDE_H_IN}in; margin: 0; }

/* ── The slide frame ─────────────────────────────────────────────────────── */

.slide {
  position: relative;
  width: ${SLIDE_W}px;
  height: ${SLIDE_H}px;
  overflow: hidden;
  background: ${P.bg};
  display: flex;
  flex-direction: column;
  padding: 46px 76px 40px;
  break-after: page;
  page-break-after: always;
  break-inside: avoid;
  page-break-inside: avoid;
}

.slide:last-child { break-after: auto; page-break-after: auto; }

/* No mix-blend-mode here, deliberately. A blend mode forces Chrome to flatten the
   whole slide into a full-frame bitmap at print time: with it, the 15-slide deck printed
   as 240 1366x768 images and weighed 15 MB. Plain opacity keeps the gradients as vector
   shadings and the grain as one tiled image, for the same look at a fraction of the
   size. A deck gets emailed; its weight is a feature of the design. */
.slide .grain {
  position: absolute;
  inset: 0;
  background-image: url("${grain}");
  background-size: 160px 160px;
  opacity: 0.03;
  pointer-events: none;
}

/* A single violet bleed, top-right, at an opacity that never touches text contrast.
   BRAND.md §2: the only saturated colour on a default screen is the violet. */
.slide .bleed {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(52% 62% at 100% 0%, rgba(91, 61, 245, 0.30) 0%, rgba(91, 61, 245, 0) 62%),
    radial-gradient(46% 54% at 0% 100%, rgba(27, 17, 64, 0.55) 0%, rgba(27, 17, 64, 0) 70%);
  pointer-events: none;
}

/* The 2.4mm accent rule from the document cover, restated at slide scale. */
.slide .accent {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5px;
  background: linear-gradient(90deg, ${P.violet500} 0%, ${P.violet400} 42%, rgba(139, 119, 255, 0) 100%);
}

.slide > .chrome,
.slide > .stage,
.slide > .foot { position: relative; z-index: 1; }

/* ── Running chrome ──────────────────────────────────────────────────────── */

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  height: 26px;
}

.wordmark {
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: ${P.text};
}

.wordmark .mark {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: ${P.text};
  box-shadow: 0 0 0 4px rgba(250, 250, 250, 0.10);
}

.slide-no {
  font-family: ${MONO(mono)};
  font-size: 14px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
  color: ${P.muted};
}

/* ── Stage: everything between the chrome and the footline ───────────────── */

.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18px 0;
}

.kicker {
  margin: 0 0 20px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.20em;
  text-transform: uppercase;
  color: ${P.violet400};
}

/* text-wrap: balance is doing real work here, not decoration. Left to itself a
   headline strands its last word on a line of its own ("… inside / it."), which on a
   projected slide reads as a mistake. Balancing evens the lines instead, and it is the
   reason no headline in the deck carries a hand-placed break. */
.headline {
  margin: 0;
  font-size: 62px;
  line-height: 1.06;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: ${P.text};
  max-width: 1000px;
  text-wrap: balance;
  hyphens: manual;
}

.headline .em { color: ${P.violet400}; }

/* A headline that has to carry a longer sentence steps down one notch rather than
   wrapping to four lines. Set by the renderer from the character count, not by hand. */
.headline.long { font-size: 52px; max-width: 1060px; }
.headline.short { font-size: 76px; max-width: 900px; }

.lede {
  margin: 26px 0 0;
  font-size: 27px;
  line-height: 1.42;
  font-weight: 400;
  color: ${P.muted};
  max-width: 46ch;
  text-wrap: pretty;
}

.lede strong { color: ${P.text}; font-weight: 500; }

/* Every numeral in the deck is mono and tabular (BRAND.md §3). */
code, .num, .mono {
  font-family: ${MONO(mono)};
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* Inline code is set in mono and left otherwise unadorned. An early version gave it a
   filled, bordered, rounded chip; at slide scale that reads as a button, and a line with
   two of them in it stops being a sentence. The typeface change is the whole signal. */
.stage code {
  font-size: 0.90em;
  color: ${P.text};
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* A standards-style identifier, wrapped by the renderer's IDENTIFIER_RE. The hyphen in
   "EIP-7702" is a legal break opportunity to the layout engine, so without this a
   footline wrapped it as "EIP-" / "7702" and the name of the standard stopped reading as
   one thing. The span carries no other styling: this is a line-breaking rule, not a
   decoration. */
.nb { white-space: nowrap; }

/* ── Statistics ──────────────────────────────────────────────────────────── */

.stats {
  display: flex;
  align-items: flex-start;
  gap: 84px;
  margin-top: 6px;
}

.stats.pair { gap: 132px; }

.stat { flex: 0 1 auto; min-width: 0; }

.stat .figure {
  display: block;
  font-family: ${MONO(mono)};
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 148px;
  line-height: 0.92;
  letter-spacing: -0.045em;
  color: ${P.text};
  white-space: nowrap;
}

.stat .figure .unit {
  font-size: 0.40em;
  letter-spacing: -0.01em;
  color: ${P.muted};
  margin-left: 0.16em;
}

.stat .label {
  display: block;
  margin-top: 22px;
  font-size: 22px;
  line-height: 1.35;
  font-weight: 400;
  color: ${P.muted};
  max-width: 17ch;
}

/* Three or more figures on one slide cannot each be 148px. */
.stats.trio .figure { font-size: 92px; }
.stats.trio .label { font-size: 19px; max-width: 18ch; }
.stats.trio { gap: 64px; }

/* A slide holding exactly one figure is that figure, and its label is the sentence
   underneath it rather than a caption squeezed to the figure's width. */
.stats.solo { display: block; }
.stats.solo .label { font-size: 28px; line-height: 1.35; max-width: 24ch; margin-top: 30px; }

/* A stat set beneath a headline is supporting evidence, not the subject. */
.has-headline .stats { margin-top: 40px; }
.has-headline .stat .figure { font-size: 84px; }
.has-headline .stat .label { font-size: 19px; margin-top: 14px; max-width: 18ch; }
.has-headline .stats.trio .figure { font-size: 68px; }
.has-headline .stats.trio .label { font-size: 18px; }

/* ── Point lists ─────────────────────────────────────────────────────────── */

.points {
  list-style: none;
  margin: 38px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  counter-reset: pt;
}

.points li {
  position: relative;
  padding-left: 46px;
  font-size: 27px;
  line-height: 1.36;
  font-weight: 400;
  color: ${P.text};
  max-width: 44ch;
}

.points li strong { font-weight: 700; }
.points li .qual { color: ${P.muted}; font-weight: 400; }

.points li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0.52em;
  width: 11px;
  height: 11px;
  border-radius: 999px;
  background: ${P.violet500};
}

.points.numbered { counter-reset: pt; }

.points.numbered li::before {
  counter-increment: pt;
  content: counter(pt);
  left: 0;
  top: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  background: none;
  font-family: ${MONO(mono)};
  font-variant-numeric: tabular-nums;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.84;
  color: ${P.violet400};
}

/* Four short lines read better in two columns than as a tall thin stack. */
.points.split {
  flex-flow: column wrap;
  max-height: 220px;
  gap: 16px 64px;
}

.points.split li { max-width: 30ch; font-size: 24px; }

/* ── Tables ──────────────────────────────────────────────────────────────── */

.table-wrap { margin-top: 34px; }

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: 0 0 12px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${P.muted};
  border-bottom: 1px solid ${P.borderStrong};
  white-space: nowrap;
}

td {
  padding: 13px 0;
  font-size: 23px;
  line-height: 1.3;
  color: ${P.text};
  border-bottom: 1px solid ${P.border};
  vertical-align: baseline;
}

tr:last-child td { border-bottom: none; }

th + th, td + td { padding-left: 40px; }

td.num, th.num { text-align: right; }

td.num, td.hex {
  font-family: ${MONO(mono)};
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

td.hex { font-size: 20px; color: ${P.muted}; white-space: nowrap; }
td.num { font-size: 23px; }

td strong { font-weight: 700; }

/* A headerless table is a list of facts. Its first column labels, its second states. */
table.no-head tr:first-child td { border-top: 1px solid ${P.borderStrong}; }
table.no-head td:first-child { color: ${P.muted}; width: 24%; }
table.no-head td { padding: 20px 0; }

/* ── Title and closing slides ────────────────────────────────────────────── */

.slide.layout-title,
.slide.layout-close { padding: 56px 76px 52px; }

.slide.layout-title .bleed {
  background:
    radial-gradient(72% 78% at 88% 4%, rgba(91, 61, 245, 0.52) 0%, rgba(91, 61, 245, 0) 60%),
    radial-gradient(62% 62% at 2% 100%, rgba(27, 17, 64, 0.85) 0%, rgba(27, 17, 64, 0) 68%);
}

.slide.layout-title .stage { justify-content: flex-end; }

.title-rule {
  width: 100%;
  height: 1px;
  background: rgba(250, 250, 250, 0.16);
  margin-bottom: 34px;
}

.wordmark-xl {
  margin: 0;
  font-size: 96px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.035em;
  color: ${P.text};
}

.tagline {
  margin: 24px 0 0;
  font-size: 44px;
  line-height: 1.14;
  font-weight: 400;
  letter-spacing: -0.02em;
  color: rgba(250, 250, 250, 0.74);
}

.title-meta {
  margin-top: 44px;
  padding-top: 22px;
  border-top: 1px solid rgba(250, 250, 250, 0.14);
  display: flex;
  gap: 72px;
}

.title-meta .cell { display: block; }

.title-meta .cell-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(250, 250, 250, 0.46);
  margin-bottom: 8px;
}

.title-meta .cell-value {
  display: block;
  font-family: ${MONO(mono)};
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  color: rgba(250, 250, 250, 0.92);
  white-space: nowrap;
}

/* ── Footline ────────────────────────────────────────────────────────────── */

.foot {
  flex: 0 0 auto;
  min-height: 20px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 15px;
  line-height: 1.35;
  font-weight: 400;
  color: ${P.muted};
  border-top: 1px solid ${P.border};
  padding-top: 14px;
}

.foot .foot-tag {
  font-family: ${MONO(mono)};
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: ${P.violet400};
  white-space: nowrap;
}

.foot .foot-text { font-family: ${MONO(mono)}; font-size: 14px; color: ${P.muted}; }

/* An empty footline still holds the rule, so the baseline does not jump between
   slides that carry a source and slides that do not. */
.foot.empty { border-top-color: rgba(255,255,255,0.05); }
`;
}
