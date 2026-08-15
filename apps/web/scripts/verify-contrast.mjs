/**
 * Measures the worst-case contrast of hero copy against whatever the shader
 * actually paints behind it. Hides the text, screenshots the hero, decodes the
 * PNG inside the browser, and finds the LIGHTEST background pixel in each text
 * box — the worst case for light-on-dark copy.
 */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

const targets = [
  { sel: '#hero-title', fg: '#FAFAFA', label: 'hero headline (white)' },
  { sel: '#hero-title + p', fg: '#A1A1AA', label: 'hero subhead (muted)' },
  { sel: '#cta-title', fg: '#FAFAFA', label: 'cta headline (white)' },
  { sel: '#cta-title + p', fg: '#A1A1AA', label: 'cta subhead (muted)' },
];

const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const width of [390, 1440]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = 'html{scroll-behavior:auto !important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(s));
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 80)));
    }
  });

  console.log(`\n=== ${width}px`);

  for (const t of targets) {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      return null;
    }, t.sel);
    void box;
    await page.waitForTimeout(700);

    // Hide the text so we can read the background it sits on.
    const rect = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      el.dataset.hidden = '1';
      el.style.visibility = 'hidden';
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, t.sel);
    if (!rect || rect.w < 1) {
      console.log(`  ${t.label.padEnd(26)} SKIP (not found)`);
      continue;
    }

    const shot = (await page.screenshot({ type: 'png' })).toString('base64');

    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.style.visibility = '';
    }, t.sel);

    const lightest = await page.evaluate(
      async ({ shot, rect }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + shot;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const x = Math.max(0, Math.round(rect.x));
        const y = Math.max(0, Math.round(rect.y));
        const w = Math.min(Math.round(rect.w), c.width - x);
        const h = Math.min(Math.round(rect.h), c.height - y);
        if (w <= 0 || h <= 0) return null;
        const d = g.getImageData(x, y, w, h).data;
        let best = null;
        let bestL = -1;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (l > bestL) {
            bestL = l;
            best = [d[i], d[i + 1], d[i + 2]];
          }
        }
        return best;
      },
      { shot, rect },
    );

    if (!lightest) {
      console.log(`  ${t.label.padEnd(26)} SKIP (offscreen)`);
      continue;
    }
    const r = ratio(hexToRgb(t.fg), lightest);
    const hex = '#' + lightest.map((v) => v.toString(16).padStart(2, '0')).join('');
    console.log(
      `  ${t.label.padEnd(26)} worst-bg=${hex}  contrast=${r.toFixed(2)}:1  ${
        r >= 4.5 ? 'PASS' : 'FAIL'
      }`,
    );
  }
  await ctx.close();
}

await browser.close();
