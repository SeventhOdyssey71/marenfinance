/**
 * Chrome discovery, a local origin to print from, and the print itself.
 *
 * We drive the Chrome that is already installed rather than downloading a Chromium:
 * a 170MB download per clone to render two PDFs is not a reasonable dependency. If no
 * local Chrome exists we fall back to puppeteer's bundled browser, and only if that is
 * also absent do we fail.
 *
 * Pages are served over a short-lived loopback HTTP server rather than injected with
 * setContent, because mermaid ships as an ES module that lazy-loads its diagram chunks;
 * module resolution needs a real same-origin document.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.MAREN_PDF_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const LAUNCH_ARGS = [
  '--allow-file-access-from-files',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
];

export async function launchBrowser({ log, warn }) {
  const executablePath = CHROME_CANDIDATES.find((p) => fsSync.existsSync(p));

  if (executablePath) {
    const puppeteer = (await import('puppeteer-core')).default;
    log(`browser: ${executablePath}`);
    return puppeteer.launch({ executablePath, headless: true, args: LAUNCH_ARGS });
  }

  warn('no local Chrome found — falling back to puppeteer\u2019s bundled browser');
  try {
    const puppeteer = (await import('puppeteer')).default;
    return await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  } catch (err) {
    throw new Error(
      'No Chrome available. Install Google Chrome, or set MAREN_PDF_CHROME to a ' +
        `Chrome/Chromium binary, or add \`puppeteer\` to tools/pdf. (${err.message})`,
    );
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/**
 * Serves one in-memory HTML document at /doc.html plus a read-only mount of the
 * mermaid dist directory at /vendor/mermaid/.
 */
export async function startServer({ vendorDir }) {
  const state = { html: '<!doctype html><title>empty</title>' };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/doc.html') {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(state.html);
        return;
      }
      if (url.pathname.startsWith('/vendor/mermaid/') && vendorDir) {
        const rel = url.pathname.slice('/vendor/mermaid/'.length);
        const file = path.resolve(vendorDir, rel);
        if (!file.startsWith(path.resolve(vendorDir))) {
          res.writeHead(403).end('forbidden');
          return;
        }
        const body = await fs.readFile(file);
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'access-control-allow-origin': '*',
        });
        res.end(body);
        return;
      }
      res.writeHead(404).end('not found');
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    setHtml(html) {
      state.html = html;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const MERMAID_THEME = {
  theme: 'base',
  themeVariables: {
    fontFamily: 'Satoshi, -apple-system, Helvetica, Arial, sans-serif',
    fontSize: '15px',
    background: '#FAFAFB',
    primaryColor: '#F5F3FF',
    primaryBorderColor: '#5B3DF5',
    primaryTextColor: '#111114',
    secondaryColor: '#FFFFFF',
    secondaryBorderColor: '#C9C9D2',
    secondaryTextColor: '#111114',
    tertiaryColor: '#FFFFFF',
    tertiaryBorderColor: '#E6E6EC',
    lineColor: '#5A5A66',
    textColor: '#111114',
    mainBkg: '#F5F3FF',
    nodeBorder: '#5B3DF5',
    clusterBkg: '#FFFFFF',
    clusterBorder: '#E6E6EC',
    edgeLabelBackground: '#FFFFFF',
    actorBkg: '#F5F3FF',
    actorBorder: '#5B3DF5',
    actorTextColor: '#111114',
    actorLineColor: '#C9C9D2',
    signalColor: '#5A5A66',
    signalTextColor: '#111114',
    labelBoxBkgColor: '#F5F3FF',
    labelBoxBorderColor: '#5B3DF5',
    labelTextColor: '#111114',
    loopTextColor: '#5A5A66',
    noteBkgColor: '#FFF9E9',
    noteBorderColor: '#F7931A',
    noteTextColor: '#111114',
    sequenceNumberColor: '#FFFFFF',
  },
  flowchart: { useMaxWidth: true, curve: 'basis', htmlLabels: true, padding: 10 },
  sequence: {
    useMaxWidth: true,
    diagramMarginX: 8,
    diagramMarginY: 8,
    boxMargin: 8,
    mirrorActors: false,
    actorMargin: 42,
    messageFontSize: 12,
    noteFontSize: 11,
  },
};

/** Render every ```mermaid block that markdown.mjs held back, in page, to inline SVG. */
export async function renderMermaid(page, sources, { warn }) {
  if (sources.length === 0) return;

  const failures = await page.evaluate(
    async (srcs, theme) => {
      const mod = await import('/vendor/mermaid/mermaid.esm.min.mjs');
      const mermaid = mod.default ?? mod.mermaid ?? window.mermaid;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', ...theme });

      const failed = [];
      const slots = document.querySelectorAll('.mermaid-slot');
      for (const slot of slots) {
        const index = Number(slot.dataset.mermaid);
        try {
          const { svg } = await mermaid.render(`mmd-${index}`, srcs[index]);
          slot.innerHTML = svg;
          const el = slot.querySelector('svg');
          if (el) {
            // Fit the diagram inside the printable box, preserving its aspect ratio and
            // scaling up as readily as down. Forcing width alone lets a tall diagram
            // grow past the page height, where it prints as a blank frame.
            const box = el.viewBox?.baseVal;
            el.removeAttribute('width');
            el.removeAttribute('height');
            if (box && box.width > 0 && box.height > 0) {
              const maxW = 160; // mm, inside the figure's padding
              const maxH = 196; // mm, one page less the caption and frame
              const mmPerUnit = Math.min(maxW / box.width, maxH / box.height);
              el.style.width = `${box.width * mmPerUnit}mm`;
              el.style.height = `${box.height * mmPerUnit}mm`;
            } else {
              el.style.maxWidth = '100%';
              el.style.height = 'auto';
            }
          }
        } catch (err) {
          failed.push(`diagram ${index + 1}: ${err?.message ?? String(err)}`);
          slot.innerHTML =
            '<p style="color:#B91C1C;font-size:9pt">diagram failed to render</p>';
        }
      }
      return failed;
    },
    sources,
    MERMAID_THEME,
  );

  for (const f of failures) warn(`mermaid ${f}`);
}

/**
 * Stop headings printing as the last thing on a page.
 *
 * Chromium does not reliably honour `break-after: avoid` on a heading during print
 * fragmentation — declaring it, its legacy alias, and a matching `break-before: avoid`
 * on the next sibling all still leave orphaned headings at a page foot. What Chromium
 * does honour is `break-inside: avoid`. So each heading is bound to the block that
 * follows it inside a container that cannot be split, which makes the guarantee
 * structural rather than advisory.
 *
 * This runs identically on both print passes, so it cannot shift pagination between
 * the measurement pass and the final one.
 */
async function bindHeadingsToContent(page) {
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return;
    for (const heading of Array.from(main.querySelectorAll('h1, h2, h3, h4'))) {
      const next = heading.nextElementSibling;
      if (!next || next.classList.contains('pagebreak')) continue;
      const keep = document.createElement('div');
      keep.className = 'keep-with-next';
      heading.parentNode.insertBefore(keep, heading);
      keep.appendChild(heading);
      keep.appendChild(next);
    }
  });
}

export async function loadPage(browser, server, html, { mermaid = [], warn }) {
  server.setHtml(html);
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
  await page.goto(`${server.origin}/doc.html`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.emulateMediaType('print');
  await renderMermaid(page, mermaid, { warn });
  await bindHeadingsToContent(page);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
