/**
 * Markdown -> slide deck HTML.
 *
 * The seven documents are prose and are rendered by `markdown.mjs`, which numbers
 * sections, builds a contents page, and lets a block flow across a page break. A deck is
 * the opposite object: a fixed number of fixed-size frames, one idea each, where a break
 * is a design decision rather than a consequence of length. Sharing a renderer between
 * the two would mean teaching the document pipeline about slides, so this is separate and
 * `markdown.mjs` is untouched.
 *
 * SOURCE FORMAT
 *
 * After the YAML frontmatter, every slide opens with a single HTML comment carrying its
 * layout and its optional furniture:
 *
 *     <!-- slide: stat | kicker: The gap | tag: Verified | foot: Read live, 16 Aug 2026 -->
 *
 * The first field is the layout; the rest are `key: value` pairs. HTML comments are
 * invisible to every markdown tool including Prettier, so the source stays a normal
 * document rather than a bespoke dialect.
 *
 * Everything after the comment, up to the next one, is ordinary markdown. Blocks map to
 * slide furniture by kind:
 *
 *     # Heading        the slide headline (one per slide)
 *     paragraph        the supporting line
 *     - bullets        a point list
 *     1. numbered      a numbered point list
 *     | a | table |    a table
 *     ```stat          big figures: one `value | label` per line
 *
 * There is deliberately no way to put two paragraphs on a slide. If a slide needs a
 * paragraph it is two slides, or it is cut.
 */

import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });
marked.use({ tokenizer: { del: () => undefined } });

const SLIDE_RE = /^<!--\s*slide:\s*([\s\S]*?)\s*-->\s*$/;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Curly quotes and proper ellipses, with inline code spans held out. */
function typographic(source) {
  return source
    .split(/(`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/(^|[\s(\[{-])"/gm, '$1“')
            .replace(/"/g, '”')
            .replace(/(\w)'(\w)/g, '$1’$2')
            .replace(/(^|[\s(\[{])'/gm, '$1‘')
            .replace(/'/g, '’')
            .replace(/\.\.\./g, '…'),
    )
    .join('');
}

/** Bold, code, links — rendered, then unwrapped from the paragraph marked adds. */
function inline(text) {
  return marked
    .parseInline(typographic(String(text).trim()))
    .replace(/<code>/g, '<code class="mono">');
}

/** Plain text of an inline run, for measuring and classifying. */
function plain(text) {
  return String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

/**
 * `stat | kicker: The gap | foot: source` -> { layout, kicker, foot }
 *
 * Values may contain colons (a URL, a time), so only the first colon in each field
 * separates the key.
 */
function parseDirective(raw) {
  const fields = raw
    .split('|')
    .map((f) => f.trim())
    .filter(Boolean);
  const out = { layout: 'statement' };
  fields.forEach((field, i) => {
    const at = field.indexOf(':');
    if (i === 0 && at === -1) {
      out.layout = field.toLowerCase();
      return;
    }
    if (at === -1) return;
    const key = field.slice(0, at).trim().toLowerCase();
    const value = field.slice(at + 1).trim();
    if (value) out[key] = value;
  });
  return out;
}

/** Split the document body into slides at each `<!-- slide: … -->` marker. */
export function parseSlides(body) {
  const lines = body.split(/\r?\n/);
  const slides = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(SLIDE_RE);
    if (match) {
      current = { ...parseDirective(match[1]), lines: [] };
      slides.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) {
      throw new Error(
        `deck content before the first slide marker: "${line.trim().slice(0, 60)}". ` +
          'Every slide must open with <!-- slide: layout -->.',
      );
    }
  }

  return slides.map((slide) => ({ ...slide, blocks: parseBlocks(slide.lines) }));
}

/**
 * Group a slide's lines into typed blocks. Slides are short and the grammar is closed,
 * so this is a line scanner rather than a markdown parse: it keeps the mapping from
 * source shape to slide furniture visible in one function.
 */
function parseBlocks(lines) {
  const blocks = [];
  let i = 0;

  const blank = (s) => !s.trim();

  while (i < lines.length) {
    const line = lines[i];

    if (blank(line)) {
      i += 1;
      continue;
    }

    // ```stat … ```
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const kind = (fence[1] ?? '').toLowerCase();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      if (kind !== 'stat') {
        throw new Error(`unknown fenced block "${kind}" in a slide; only \`stat\` is supported`);
      }
      blocks.push({ type: 'stats', rows: buf.filter((l) => l.trim()).map(parseStatRow) });
      continue;
    }

    // # Headline
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'headline', text: heading[1].trim() });
      i += 1;
      continue;
    }

    // | a | table |
    if (/^\|.*\|\s*$/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'table', ...parseTable(buf) });
      continue;
    }

    // - bullet / 1. numbered
    const bullet = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const numbered = /\d/.test(bullet[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (!m) {
          // A wrapped continuation line belongs to the item above it.
          if (!blank(lines[i]) && !/^[#|`]/.test(lines[i]) && items.length > 0) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i += 1;
            continue;
          }
          break;
        }
        items.push(m[3].trim());
        i += 1;
      }
      blocks.push({ type: 'list', numbered, items });
      continue;
    }

    // Anything else is the slide's one supporting line.
    const buf = [line.trim()];
    i += 1;
    while (i < lines.length && !blank(lines[i]) && !/^[#|`\-*]/.test(lines[i])) {
      buf.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'lede', text: buf.join(' ') });
  }

  return blocks;
}

/**
 * `29,360 | People holding MUSD` -> { figure, unit, label }
 *
 * A trailing unit on the figure ("0.001 BTC") is split off so it can be set smaller and
 * muted: the eye should land on the number, and BRAND.md §8 still requires the unit to
 * be there.
 */
function parseStatRow(row) {
  const [rawFigure, ...rest] = row.split('|');
  const figure = (rawFigure ?? '').trim();
  const label = rest.join('|').trim();
  const split = figure.match(/^([^\s]+)\s+(.+)$/);
  return split ? { figure: split[1], unit: split[2], label } : { figure, unit: null, label };
}

const NUMERIC_RE = /^[~≈<>≥≤±+\-−]{0,2}\s*[$]?\d[\d,._]*\s*(?:%|BTC|MUSD|USD|×|x|pp|bps)?$/i;
const HEX_RE = /^0x[0-9a-fA-F]{6,}$/;

/** GitHub-flavoured pipe table -> header, rows, and a class per column. */
function parseTable(lines) {
  const cells = (line) =>
    line
      .replace(/^\||\|\s*$/g, '')
      .split('|')
      .map((c) => c.trim());

  const header = cells(lines[0]);
  const bodyLines = lines.slice(1).filter((l) => !/^\|[\s:|-]+\|?\s*$/.test(l));
  const rows = bodyLines.map(cells);

  const classes = header.map((_, c) => {
    const column = rows.map((r) => plain(r[c] ?? '')).filter(Boolean);
    if (column.length === 0) return '';
    if (column.filter((t) => HEX_RE.test(t)).length / column.length >= 0.6) return 'hex';
    if (column.filter((t) => NUMERIC_RE.test(t)).length / column.length >= 0.6) return 'num';
    return '';
  });

  // A table whose header cells are all blank is a two-column list of facts, not a table
  // with an empty heading row. The closing slide's contact block is written that way.
  const hasHeader = header.some((h) => h !== '');

  return { header, rows, classes, hasHeader };
}

/** Headline size is a function of its length, so no slide needs a hand-tuned override. */
function headlineClass(text) {
  const n = plain(text).length;
  if (n <= 30) return 'headline short';
  if (n >= 62) return 'headline long';
  return 'headline';
}

function renderStats(block) {
  const n = block.rows.length;
  const shape = n >= 3 ? ' trio' : n === 2 ? ' pair' : ' solo';
  const items = block.rows
    .map(
      (row) =>
        `<div class="stat">` +
        `<span class="figure">${escapeHtml(row.figure)}` +
        (row.unit ? `<span class="unit">${escapeHtml(row.unit)}</span>` : '') +
        `</span>` +
        (row.label ? `<span class="label">${inline(row.label)}</span>` : '') +
        `</div>`,
    )
    .join('');
  return `<div class="stats${shape}">${items}</div>`;
}

function renderList(block) {
  // Four or more short items read better in two columns than as a tall thin stack.
  const longest = Math.max(...block.items.map((t) => plain(t).length));
  const split = block.items.length >= 4 && longest <= 52 ? ' split' : '';
  const items = block.items.map((text) => `<li>${inline(text)}</li>`).join('');
  return `<ul class="points${block.numbered ? ' numbered' : ''}${split}">${items}</ul>`;
}

function renderTable(block) {
  const cls = (c) => (block.classes[c] ? ` class="${block.classes[c]}"` : '');
  const head = block.hasHeader
    ? `<thead><tr>${block.header.map((h, c) => `<th${cls(c)}>${inline(h)}</th>`).join('')}</tr></thead>`
    : '';
  const body = block.rows
    .map(
      (row) =>
        '<tr>' + row.map((cell, c) => `<td${cls(c)}>${inline(cell)}</td>`).join('') + '</tr>',
    )
    .join('');
  return (
    `<div class="table-wrap"><table${block.hasHeader ? '' : ' class="no-head"'}>` +
    `${head}<tbody>${body}</tbody></table></div>`
  );
}

function renderStage(slide) {
  const out = [];
  if (slide.kicker) out.push(`<p class="kicker">${inline(slide.kicker)}</p>`);

  for (const block of slide.blocks) {
    if (block.type === 'headline') {
      out.push(`<h2 class="${headlineClass(block.text)}">${inline(block.text)}</h2>`);
    } else if (block.type === 'lede') {
      out.push(`<p class="lede">${inline(block.text)}</p>`);
    } else if (block.type === 'stats') {
      out.push(renderStats(block));
    } else if (block.type === 'list') {
      out.push(renderList(block));
    } else if (block.type === 'table') {
      out.push(renderTable(block));
    }
  }

  const hasHeadline = slide.blocks.some((b) => b.type === 'headline');
  return `<div class="stage${hasHeadline ? ' has-headline' : ''}">${out.join('')}</div>`;
}

/** The title slide is the one place the wordmark is set at display size. */
function renderTitleStage(slide, meta) {
  const headline = slide.blocks.find((b) => b.type === 'headline');
  const lede = slide.blocks.find((b) => b.type === 'lede');

  const cells = [
    ['Presented by', meta.presenter],
    ['Date', meta.date],
    ['Network', meta.network],
  ].filter(([, v]) => v);

  return (
    `<div class="stage">` +
    `<div class="title-rule"></div>` +
    `<h1 class="wordmark-xl">${inline(headline ? headline.text : meta.title)}</h1>` +
    (lede ? `<p class="tagline">${inline(lede.text)}</p>` : '') +
    (cells.length
      ? `<div class="title-meta">` +
        cells
          .map(
            ([label, value]) =>
              `<div class="cell"><span class="cell-label">${escapeHtml(label)}</span>` +
              `<span class="cell-value">${escapeHtml(value)}</span></div>`,
          )
          .join('') +
        `</div>`
      : '') +
    `</div>`
  );
}

function renderFoot(slide) {
  const parts = [];
  if (slide.tag) parts.push(`<span class="foot-tag">${escapeHtml(slide.tag)}</span>`);
  if (slide.foot) parts.push(`<span class="foot-text">${inline(slide.foot)}</span>`);
  return `<div class="foot${parts.length ? '' : ' empty'}">${parts.join('')}</div>`;
}

function renderSlide(slide, index, total, meta) {
  const isTitle = slide.layout === 'title';
  const number = String(index + 1).padStart(2, '0');

  const chrome = isTitle
    ? `<div class="chrome"><div class="wordmark"><span class="mark"></span>Maren</div><div class="slide-no"></div></div>`
    : `<div class="chrome"><div class="wordmark"><span class="mark"></span>Maren</div>` +
      `<div class="slide-no">${number} / ${String(total).padStart(2, '0')}</div></div>`;

  return (
    `<section class="slide layout-${escapeHtml(slide.layout)}">` +
    `<div class="bleed"></div><div class="grain"></div>` +
    chrome +
    (isTitle ? renderTitleStage(slide, meta) : renderStage(slide)) +
    renderFoot(slide) +
    `<div class="accent"></div>` +
    `</section>`
  );
}

/**
 * @returns {{ html: string, count: number }} the full deck document and its slide count.
 */
export function renderDeck({ body, meta, css }) {
  const slides = parseSlides(body);
  if (slides.length === 0) throw new Error('the deck has no slides');

  const sections = slides.map((slide, i) => renderSlide(slide, i, slides.length, meta)).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<style>${css}</style>
</head>
<body>
${sections}
</body></html>`;

  return { html, count: slides.length };
}
