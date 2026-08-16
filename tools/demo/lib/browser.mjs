/**
 * Chromium, resolved and launched so that the shaders actually render.
 *
 * THE ONE THING THAT MATTERS HERE IS WEBGL. Maren's hero, its closing CTA band and the
 * pulsing ring around the position-health card are all `@paper-design/shaders-react`
 * canvases, which are WebGL. A Chromium launched with `--disable-gpu` — the reflex flag
 * for headless automation — creates no WebGL context at all. The shader components then
 * fall back to a flat CSS gradient, and the recording shows a page that looks broken in a
 * way no reviewer can diagnose from the video. So: never `--disable-gpu`.
 *
 * `--use-gl=angle` picks ANGLE, which on macOS goes through Metal and on Linux through
 * whatever GL is present. `--enable-unsafe-swiftshader` is the fallback that keeps WebGL
 * alive on a machine with no usable GPU (CI, a headless VM) by rasterising in software.
 * "Unsafe" here means "not hardware isolated", which is irrelevant for rendering our own
 * marketing page and is the only way to get a shader out of a container.
 *
 * The full Chromium build is used rather than Playwright's headless shell. The shell is
 * smaller and faster and cannot do what we need: it ships without the GPU process, so the
 * flags above have nothing to configure.
 */

import { existsSync } from 'node:fs';

/** Mirrors the escape hatch every other Playwright script in this repo already honours. */
const CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE,
  process.env.DEMO_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export const WEBGL_ARGS = [
  '--use-gl=angle',
  '--enable-unsafe-swiftshader',
  // Chromium throttles rAF and timers in backgrounded or occluded windows. Headless
  // windows are frequently considered occluded, and a throttled rAF is a shader that
  // renders at 2fps in the video while looking fine in a screenshot.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  // Deterministic type across machines: no subpixel positioning drift between takes.
  '--font-render-hinting=none',
  '--hide-scrollbars',
  ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
];

/** playwright-core is CJS; an ESM import may hand it back under `default`. */
export async function loadPlaywright() {
  const specifier = process.env.PLAYWRIGHT_CORE ?? 'playwright-core';
  const pw = await import(specifier);
  return pw.chromium ? pw : pw.default;
}

/**
 * @param {{ log: (msg: string) => void }} options
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchChromium({ log }) {
  const { chromium } = await loadPlaywright();

  const base = {
    // `headless: true` alone would select the headless shell. Naming the channel pins the
    // full browser and Chromium's newer headless mode, which keeps the GPU process.
    headless: true,
    args: WEBGL_ARGS,
  };

  const override = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (process.env.CHROME_EXECUTABLE || process.env.DEMO_CHROME) {
    log(`chromium: ${override} (from env)`);
    return chromium.launch({ ...base, executablePath: override });
  }

  try {
    const browser = await chromium.launch({ ...base, channel: 'chromium' });
    log('chromium: playwright-managed build (channel=chromium)');
    return browser;
  } catch (err) {
    if (!override) {
      throw new Error(
        'No Chromium available.\n' +
          '  Install the pinned build:  pnpm --filter @maren/demo browsers\n' +
          '  Or point at your own:      CHROME_EXECUTABLE=/path/to/chrome\n' +
          `  (${err.message.split('\n')[0]})`,
      );
    }
    log(`chromium: falling back to ${override}`);
    return chromium.launch({ ...base, executablePath: override });
  }
}

/**
 * Prove WebGL is live before recording 100 seconds of a page that cannot draw.
 *
 * This is a hard failure rather than a warning on purpose. A silent fallback to the CSS
 * gradient produces a video that looks *plausible* — which is worse than no video, because
 * it gets published.
 *
 * @param {import('playwright-core').Page} page
 */
export async function assertWebGL(page) {
  const report = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { ok: false, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ok: true,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });

  if (!report.ok) {
    throw new Error(
      'WebGL is unavailable in this Chromium, so every shader on the page would render ' +
        'as a flat fallback. Check that --disable-gpu has not been added to WEBGL_ARGS.',
    );
  }
  return report.renderer;
}
