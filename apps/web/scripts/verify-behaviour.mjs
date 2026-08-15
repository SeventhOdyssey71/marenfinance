/**
 * Behavioural checks against a running build: reduced-motion shader fallback,
 * FAQ accordion ARIA, keyboard operation, focus rings, landmarks.
 *
 *   pnpm --filter @maren/web build && pnpm --filter @maren/web start &
 *   node apps/web/scripts/verify-behaviour.mjs
 *
 * Uses playwright-core. Override resolution with PLAYWRIGHT_CORE, and point
 * CHROME_EXECUTABLE at an installed Chrome to skip a browser download.
 */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const { chromium } = pw.chromium ? pw : pw.default;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// ---- 1. reduced motion -> no WebGL, static fallback still paints
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
    }
  });
  await page.waitForTimeout(800);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('reduced-motion: zero shader canvases mounted', canvases === 0, `canvases=${canvases}`);

  const fallback = await page.evaluate(() => {
    const el = document.querySelector('.mesh-fallback');
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundImage;
    return bg && bg !== 'none' ? bg.slice(0, 40) : null;
  });
  check('reduced-motion: static gradient fallback present', Boolean(fallback));

  const revealed = await page.evaluate(() =>
    [...document.querySelectorAll('.reveal')].every(
      (el) => Number(getComputedStyle(el).opacity) > 0.99,
    ),
  );
  check('reduced-motion: all content visible (no stuck opacity:0)', revealed);
  await ctx.close();
}

// ---- 2. accordion ARIA
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });

  const triggers = page.locator('#faq button[aria-expanded]');
  const n = await triggers.count();
  check('faq: 8 accordion triggers with aria-expanded', n === 8, `found=${n}`);

  const first = triggers.first();
  const panelId = await first.getAttribute('aria-controls');
  const panel = page.locator(`#${panelId}`);
  check('faq: trigger points at a real panel', (await panel.count()) === 1);
  check(
    'faq: panel is role=region labelled by its trigger',
    (await panel.getAttribute('role')) === 'region' &&
      (await panel.getAttribute('aria-labelledby')) === (await first.getAttribute('id')),
  );

  check('faq: first item open by default', (await first.getAttribute('aria-expanded')) === 'true');
  await first.click();
  check('faq: collapses on click', (await first.getAttribute('aria-expanded')) === 'false');
  check('faq: panel hidden when collapsed', await panel.isHidden());
  await first.click();
  check('faq: reopens on click', (await first.getAttribute('aria-expanded')) === 'true');

  // keyboard: focus the second trigger and activate with Enter
  const second = triggers.nth(1);
  await second.focus();
  await page.keyboard.press('Enter');
  check('faq: keyboard Enter toggles', (await second.getAttribute('aria-expanded')) === 'true');

  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle };
  });
  check(
    'focus ring visible on keyboard focus',
    ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0,
    JSON.stringify(ring),
  );

  // skip link is the first tab stop — reload so focus starts at document top
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check('skip link is first tab stop', firstStop === 'Skip to content', `got="${firstStop}"`);

  check('no 4xx/5xx responses', bad.length === 0, bad.join(', '));
  await ctx.close();
}

// ---- 3. headings / landmarks
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  const h1 = await page.locator('h1').count();
  check('exactly one h1', h1 === 1, `count=${h1}`);
  const landmarks = await page.evaluate(() => ({
    header: document.querySelectorAll('header').length,
    main: document.querySelectorAll('main').length,
    footer: document.querySelectorAll('footer').length,
    navs: document.querySelectorAll('nav[aria-label]').length,
  }));
  check(
    'landmarks present (header/main/footer/labelled navs)',
    landmarks.header === 1 && landmarks.main === 1 && landmarks.footer === 1 && landmarks.navs >= 2,
    JSON.stringify(landmarks),
  );
  const imgAlt = await page.evaluate(() =>
    [...document.querySelectorAll('svg[role=img]')].every((s) => s.hasAttribute('aria-label')),
  );
  check('every role=img svg has an aria-label', imgAlt);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
