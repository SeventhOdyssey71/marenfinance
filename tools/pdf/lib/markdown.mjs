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
 */
function createMarked(state) {
  const marked = new Marked({ gfm: true, breaks: false });
  const usedSlugs = new Set();
  const counters = [0, 0, 0];

  const renderer = {
    heading(token) {
      const depth = token.depth;
      const inline = this.parser.parseInline(token.tokens);
      const text = plain(token.text);

      // Sections and subsections are numbered and indexed; anything deeper is neither.
      let number = '';
      if (depth === 2) {
        counters[0] += 1;
        counters[1] = 0;
        number = `${counters[0]}`;
      } else if (depth === 3) {
        counters[1] += 1;
        number = `${counters[0]}.${counters[1]}`;
      }

      const slug = slugify(text, usedSlugs);
      const mark =
        depth <= 3
          ? `<span class="pgmark">${escapeHtml(MARK_PREFIX + slug + MARK_SUFFIX)}</span>`
          : '';

      if (depth === 2 || depth === 3) {
        state.toc.push({ slug, depth, number, text });
      }

      const num = number ? `<span class="h-num">${number}</span>` : '';
      return `<h${depth} id="${slug}">${num}${inline}${mark}</h${depth}>\n`;
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
 * @returns {{ html: string, toc: Array, mermaid: string[] }}
 */
export function renderMarkdown(source) {
  const state = { toc: [], mermaid: [] };
  const marked = createMarked(state);
  const html = marked.parse(typographic(source));
  return { html, toc: state.toc, mermaid: state.mermaid };
}
