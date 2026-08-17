/**
 * Markdown -> document HTML.
 *
 * Beyond CommonMark this layer adds the things a Maren document needs:
 *   - auto-numbered sections (1, 1.1) that feed the table of contents;
 *   - an invisible page marker per heading, so the TOC can learn real page numbers
 *     from the printed PDF rather than guessing from continuous layout;
 *   - tables with numeric columns detected and set right-aligned in mono (BRAND.md §7);
 *   - callouts written as GitHub-style alerts: > [!NOTE] / [!WARNING] / [!RISK] / [!VERIFIED];
 *   - ```mermaid fences held back as placeholders for in-page rendering;
 *   - syntax highlighting, including a small Solidity mode highlight.js does not ship.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Marked } from 'marked';
import hljs from 'highlight.js';

/** Token the page-number pass looks for. Rendered at 1px and hidden in the final pass. */
export const MARK_PREFIX = '<<MZ:';
export const MARK_SUFFIX = '>>';

hljs.registerLanguage('solidity', (hl) => ({
  name: 'Solidity',
  keywords: {
    keyword:
      'pragma solidity contract interface library abstract is using for function modifier ' +
      'constructor event error enum struct mapping returns return if else while do break ' +
      'continue new delete emit try catch revert require assert import from as type ' +
      'public private internal external pure view payable virtual override immutable ' +
      'constant memory storage calldata indexed unchecked receive fallback',
    type:
      'address bool string bytes byte int int8 int16 int32 int64 int128 int256 uint uint8 ' +
      'uint16 uint32 uint64 uint96 uint128 uint256 bytes1 bytes4 bytes8 bytes20 bytes32',
    literal: 'true false wei gwei ether seconds minutes hours days weeks',
    built_in: 'msg block tx abi this super now keccak256 ecrecover selfdestruct',
  },
  contains: [
    hl.C_LINE_COMMENT_MODE,
    hl.C_BLOCK_COMMENT_MODE,
    hl.QUOTE_STRING_MODE,
    hl.APOS_STRING_MODE,
    hl.C_NUMBER_MODE,
    { className: 'meta', begin: /@[A-Za-z_]\w*/ },
  ],
}));

const CALLOUTS = {
  NOTE: { cls: 'note', label: 'Note' },
  WARNING: { cls: 'warning', label: 'Warning' },
  RISK: { cls: 'risk', label: 'Risk' },
  VERIFIED: { cls: 'verified', label: 'Verified' },
};

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(text, used) {
  const base =
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'section';
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/** Strip inline markdown so cell contents can be classified. */
function plain(s) {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

const NUMERIC_RE =
  /^[~≈<>≥≤±+\-−]{0,2}\s*[$]?\d[\d,._  ]*(?:\s*[×x]\s*10\s*[⁰-₟^\-\d]+)?\s*(?:%|bps|BTC|MUSD|USD|wei|gwei|kB|KB|MB|bytes|blocks?|txs?|s|d|ms|APR|decimals?|x|×)?$/i;

const HEX_RE = /^0x[0-9a-fA-F]{6,}$/;

function isNumericCell(text) {
  const t = plain(text);
  if (!t || t === '—' || t === '-') return true; // neutral: does not vote either way
  return NUMERIC_RE.test(t.replace(/ /g, ''));
}

function hasDigits(text) {
  return /\d/.test(plain(text));
}

function isHexCell(text) {
  return HEX_RE.test(plain(text));
}

/**
 * Build the renderer. `state` collects the TOC and the mermaid blocks as a side effect
 * of rendering, which keeps a single pass over the document.
 *
 * `outline` carries the two facts that can only be known by looking at the whole
 * document before rendering any of it: which heading level its sections start at, and
 * whether it numbers them itself. See `readOutline`.
 */
function createMarked(state, outline, baseDir) {
  const marked = new Marked({ gfm: true, breaks: false });
  const usedSlugs = new Set();
  const counters = [0, 0, 0];

  const renderer = {
    /**
     * Screenshots. Inlined as data URIs at render time, AFTER the typographic pass,
     * because smart quotes applied to a src attribute produce a broken image with no
     * error. A missing file throws and fails the build instead of printing a gap.
     */
    image(token) {
      const file = path.resolve(baseDir, token.href);
      const bytes = readFileSync(file);
      const mime = /\.jpe?g$/i.test(token.href) ? 'image/jpeg' : 'image/png';
      const caption = token.text ? `<figcaption>${token.text}</figcaption>` : '';
      return (
        `<figure class="shot"><img src="data:${mime};base64,${bytes.toString('base64')}" alt="">` +
        caption +
        `</figure>`
      );
    },
    heading(token) {
      const inline = this.parser.parseInline(token.tokens);
      const text = plain(token.text);

      // A document that starts its sections at `#` and one that starts them at `##` are
      // the same document as far as the reader is concerned, so both are rendered as
      // h2/h3. Normalising here rather than in the sources means the six documents share
      // one visual hierarchy without any of them having to be rewritten.
      const level = Math.min(token.depth - outline.minDepth + 2, 4);

      // Sections and subsections are numbered and indexed; anything deeper is neither.
      let number = '';
      if (outline.autoNumber) {
        if (level === 2) {
          counters[0] += 1;
          counters[1] = 0;
          number = `${counters[0]}`;
        } else if (level === 3) {
          counters[1] += 1;
          number = `${counters[0]}.${counters[1]}`;
        }
      }

      const slug = slugify(text, usedSlugs);
      const mark =
        level <= 3
          ? `<span class="pgmark">${escapeHtml(MARK_PREFIX + slug + MARK_SUFFIX)}</span>`
          : '';

      if (level === 2 || level === 3) {
        state.toc.push({ slug, depth: level, number, text });
      }

      const num = number ? `<span class="h-num">${number}</span>` : '';
      return `<h${level} id="${slug}">${num}${inline}${mark}</h${level}>\n`;
    },

    code(token) {
      const lang = (token.lang || '').trim().split(/\s+/)[0];

      if (lang === 'mermaid') {
        const index = state.mermaid.length;
        state.mermaid.push(token.text);
        return `<figure class="diagram"><div class="mermaid-slot" data-mermaid="${index}"></div></figure>\n`;
      }

      let body;
      try {
        body = lang
          ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value
          : escapeHtml(token.text);
      } catch {
        body = escapeHtml(token.text);
      }
      const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      return `<div class="codeblock">${label}<pre><code class="hljs">${body}</code></pre></div>\n`;
    },

    blockquote(token) {
      const first = token.tokens[0];
      const raw = first?.raw ?? '';
      const alert = raw.match(/^\s*\[!(NOTE|WARNING|RISK|VERIFIED)\]\s*/i);

      if (alert) {
        const kind = CALLOUTS[alert[1].toUpperCase()];
        // Drop the marker from the first paragraph, keep everything else intact.
        const clone = structuredClone(token.tokens);
        if (clone[0]?.tokens?.length) {
          const lead = clone[0].tokens[0];
          if (lead && typeof lead.text === 'string') {
            lead.text = lead.text.replace(/^\s*\[![A-Z]+\]\s*\n?/i, '');
            lead.raw = lead.text;
          }
        }
        const inner = this.parser.parse(clone);
        return `<aside class="callout callout-${kind.cls}"><p class="callout-label">${kind.label}</p>${inner}</aside>\n`;
      }

      return `<blockquote>${this.parser.parse(token.tokens)}</blockquote>\n`;
    },

    table(token) {
      const cols = token.header.length;
      const align = token.header.map((h) => h.align || null);

      // Classify each column from its body cells: numeric columns go right-aligned in
      // mono, hex columns stay left but in mono so addresses stay comparable.
      const numeric = [];
      const hexish = [];
      for (let c = 0; c < cols; c += 1) {
        const cells = token.rows.map((r) => r[c]?.text ?? '').filter((t) => plain(t) !== '');
        const withDigits = cells.filter(hasDigits);
        const numericVotes = cells.filter(isNumericCell).length;
        numeric.push(
          withDigits.length > 0 && cells.length > 0 && numericVotes / cells.length >= 0.6,
        );
        hexish.push(cells.length > 0 && cells.filter(isHexCell).length / cells.length >= 0.6);
      }

      const cls = (c) => {
        const parts = [];
        if (align[c] === 'right' || (align[c] === null && numeric[c])) parts.push('num');
        else if (align[c] === 'center') parts.push('center');
        if (hexish[c]) parts.push('hex');
        return parts.length ? ` class="${parts.join(' ')}"` : '';
      };

      const head = token.header
        .map((cell, c) => `<th${cls(c)}>${this.parser.parseInline(cell.tokens)}</th>`)
        .join('');

      const body = token.rows
        .map(
          (row) =>
            '<tr>' +
            row
              .map((cell, c) => `<td${cls(c)}>${this.parser.parseInline(cell.tokens)}</td>`)
              .join('') +
            '</tr>',
        )
        .join('\n');

      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>\n`;
    },

    html(token) {
      const text = token.text ?? '';
      if (/^\s*<!--\s*pagebreak\s*-->\s*$/.test(text)) return '<div class="pagebreak"></div>\n';
      if (/^\s*<!--/.test(text)) return '';
      return text;
    },

    link(token) {
      const href = escapeHtml(token.href || '');
      const inner = this.parser.parseInline(token.tokens);
      return `<a href="${href}">${inner}</a>`;
    },
  };

  marked.use({ renderer });

  // These documents are full of figures like ~$5,000 and ~0.079 BTC. GFM reads a pair
  // of tildes on one line as strikethrough and silently deletes the text between them,
  // which turned a load-bearing number into a struck-through one. No Maren document
  // needs strikethrough, so the tokenizer is removed rather than worked around.
  marked.use({ tokenizer: { del: () => undefined } });

  return marked;
}

/**
 * Curly quotes and proper ellipses, applied to the markdown source with fenced blocks
 * and inline code spans held out. Doing this before parsing rather than after keeps it
 * away from HTML attributes, which is where a naive quote substitution breaks links.
 */
function typographic(source) {
  const parts = source.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/(^|[\s(\[{—-])"/gm, '$1“')
            .replace(/"/g, '”')
            .replace(/(\w)'(\w)/g, '$1’$2')
            .replace(/(^|[\s(\[{])'/gm, '$1‘')
            .replace(/'/g, '’')
            .replace(/\.\.\./g, '…'),
    )
    .join('');
}

/**
 * A heading that already carries its own identifier: "1. Onboarding", "M1 — Mainnet
 * deployment", "R-1 — The pooled vault", "Phase 2".
 */
const SELF_NUMBERED_RE = /^(?:\d+[.)]\s|[A-Z]{1,2}-?\d+\b|Phase\s+\d)/;

/**
 * Look at every heading before rendering any of them.
 *
 * Two documents in this set start their sections at `#` and four start at `##`; both
 * conventions are legitimate markdown and neither should be the one the pipeline
 * happens to support. Rendering keyed off the raw depth silently dropped every `#`
 * from the contents page and promoted the subsections in its place, so the contents
 * of a document could list the wrong things entirely.
 *
 * The second fact is whether the document numbers its own sections. Some do, in the
 * heading text, and cross-reference those numbers in their prose. Auto-numbering those
 * as well produces "2 1. Onboarding" and renumbers sections out from under their own
 * cross-references. A document therefore either numbers itself or is numbered by the
 * pipeline, and this decides which.
 */
function readOutline(source) {
  const tokens = new Marked({ gfm: true, breaks: false }).lexer(source);
  const headings = [];
  const walk = (list) => {
    for (const token of list ?? []) {
      if (token.type === 'heading') headings.push(token);
      if (Array.isArray(token.tokens) && token.type !== 'heading') walk(token.tokens);
    }
  };
  walk(tokens);

  if (headings.length === 0) return { minDepth: 2, autoNumber: true };

  const minDepth = Math.min(...headings.map((h) => h.depth));
  const sections = headings.filter((h) => h.depth === minDepth);
  const selfNumbered = sections.filter((h) => SELF_NUMBERED_RE.test(plain(h.text))).length;

  // One stray "1. …" is not a convention; two or more is.
  return { minDepth, autoNumber: selfNumbered < 2 };
}

/**
 * @returns {{ html: string, toc: Array, mermaid: string[] }}
 */
export function renderMarkdown(source, { baseDir = process.cwd() } = {}) {
  const state = { toc: [], mermaid: [] };
  const prepared = typographic(source);
  const marked = createMarked(state, readOutline(prepared), baseDir);
  const html = marked.parse(prepared);
  return { html, toc: state.toc, mermaid: state.mermaid };
}
