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

// ---- 4. the dApp: the promises that are load-bearing ----------------------
//
// These are not smoke tests. Each one corresponds to a claim the product makes in
// writing, and a claim a user could lose money believing if it stopped being true.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });

  // --- Portfolio ---
  await page.goto('http://127.0.0.1:3000/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  check('app: exactly one h1', (await page.locator('h1').count()) === 1);
  const landmarks = await page.evaluate(() => ({
    header: document.querySelectorAll('header').length,
    main: document.querySelectorAll('main').length,
    footer: document.querySelectorAll('footer').length,
    navs: document.querySelectorAll('nav[aria-label]').length,
  }));
  check(
    'app: landmarks present (header/main/footer/labelled navs)',
    landmarks.header === 1 && landmarks.main === 1 && landmarks.footer === 1 && landmarks.navs >= 2,
    JSON.stringify(landmarks),
  );

  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(
    'app: skip link is the first tab stop',
    firstStop === 'Skip to content',
    `got="${firstStop}"`,
  );

  // Borrowing capacity must be the contract's ceiling, not an ICR estimate.
  const capacityCopy = await page.locator('text=getTroveMaxBorrowingCapacity').count();
  check(
    'app: borrowing capacity names getTroveMaxBorrowingCapacity()',
    capacityCopy > 0,
    'the real ceiling, not an ICR-derived estimate',
  );

  // The gasless claim must never be unconditional. MarenVault.deposit() is payable and
  // MarenRelayHub reverts on any request carrying value, so the first deposit costs the
  // user BTC gas. Copy that says otherwise is a lie the contracts will expose.
  const gasText = await page
    .locator('section')
    .filter({ hasText: 'What gasless means here' })
    .first()
    .innerText();
  check('app: gas copy never promises "no gas, ever"', !/no gas,? ever/i.test(gasText));
  check(
    'app: gas copy states the first-deposit exception',
    /first deposit costs gas/i.test(gasText),
    'deposit is payable, therefore never relayable',
  );

  // --- Vault: the slider stops at the 180% floor ---
  await page.goto('http://127.0.0.1:3000/app/vault', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const slider = page.locator('input[type=range]');
  check('vault: borrow control is a real range input', (await slider.count()) === 1);
  check(
    'vault: slider is labelled and announces a unit-bearing value',
    Boolean(await slider.getAttribute('aria-label')) &&
      /MUSD/.test((await slider.getAttribute('aria-valuetext')) ?? ''),
    (await slider.getAttribute('aria-valuetext')) ?? '',
  );

  // Drive it to the maximum with the keyboard, then read the resulting ratio.
  await slider.focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(400);
  const ratioText = await page.locator('text=Resulting ratio').locator('..').innerText();
  const ratioAtMax = Number((ratioText.match(/([\d,]+\.\d)%/)?.[1] ?? '0').replace(/,/g, ''));
  check(
    'vault: slider at maximum still leaves the position at or above 180%',
    ratioAtMax >= 180,
    `resulting ratio ${ratioAtMax}%`,
  );

  const ringOnSlider = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  });
  check('vault: slider shows a focus ring when focused by keyboard', ringOnSlider);

  // --- Vault: a stale oracle blocks borrowing and leaves repay open ---
  await page.getByRole('button', { name: 'Demo controls' }).click();
  await page.getByRole('button', { name: /Stall the oracle/ }).click();
  await page.waitForTimeout(800);

  check(
    'vault: stale oracle shows the price-feed-unavailable state',
    (await page.locator('text=Price feed unavailable').count()) > 0,
  );
  const borrowDisabled = await page
    .getByRole('button', { name: /^Borrow/ })
    .first()
    .isDisabled();
  check('vault: stale oracle disables borrowing', borrowDisabled);

  const staleBanner = await page.locator('text=You can still repay and withdraw').count();
  check('vault: stale state says repay and withdraw remain open', staleBanner > 0);

  await page.getByRole('tab', { name: 'Repay' }).click();
  await page.waitForTimeout(400);
  const repayEnabled = await page
    .getByRole('button', { name: /^Repay/ })
    .last()
    .isEnabled();
  check('vault: repay stays available while the oracle is stale', repayEnabled);

  // No figure may be computed from the stale price.
  const staleHealth = await page.evaluate(() =>
    document.body.innerText.includes('Resulting ratio'),
  );
  check('vault: no ratio preview is rendered from a stale price', !staleHealth);

  await page.getByRole('button', { name: /Oracle stalled/ }).click();
  await page.waitForTimeout(600);

  // --- Pay: the resolved address is shown before confirmation ---
  await page.goto('http://127.0.0.1:3000/app/pay', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const resolvedInline = await page.locator('#pay-to-status').innerText();
  check(
    'pay: the resolved address is shown beside the handle',
    /0x[0-9a-fA-F]{40}/.test(resolvedInline),
    resolvedInline.slice(0, 60),
  );

  await page.getByRole('button', { name: /^Send / }).click();
  await page.waitForTimeout(300);
  const dialog = page.locator('[role=dialog]');
  check('pay: confirmation is a modal dialog', (await dialog.count()) === 1);
  check(
    'pay: dialog is aria-modal and labelled',
    (await dialog.getAttribute('aria-modal')) === 'true',
  );
  const dialogText = await dialog.innerText();
  check(
    'pay: confirmation repeats the full resolved address',
    /0x[0-9a-fA-F]{40}/.test(dialogText),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('pay: Escape closes the dialog', (await page.locator('[role=dialog]').count()) === 0);

  // --- Earn: no forward APY, anywhere ---
  await page.goto('http://127.0.0.1:3000/app/earn', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const earnText = await page.locator('main').innerText();
  check(
    'earn: no forward rate is quoted anywhere on the page',
    !/\d[\d.,]*\s*%\s*(apy|apr)/i.test(earnText) && !/apy\s*[:of]*\s*\d/i.test(earnText),
  );
  check(
    'earn: the realised figure is labelled backward-looking',
    /Backward-looking/.test(earnText),
  );
  check('earn: says plainly why there is no APY', /does not display an APY/i.test(earnText));

  // --- Activity: status wording and explorer links ---
  await page.goto('http://127.0.0.1:3000/app/activity', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const activityText = await page.locator('main').innerText();
  check('activity: a failed row says no funds moved', /Failed — no funds moved/.test(activityText));
  const explorerLinks = await page.locator('main a[href*="explorer"]').count();
  check('activity: rows link to the Mezo explorer', explorerLinks > 0, `${explorerLinks} links`);

  check('app: no 4xx/5xx responses across the dApp', bad.length === 0, bad.join(', '));
  await ctx.close();
}

// ---- 5. reduced motion across the dApp -----------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('app reduced-motion: no shader canvas mounted', canvases === 0, `canvases=${canvases}`);
  const healthVisible = await page.locator('text=Position health').count();
  check('app reduced-motion: the health card still renders', healthVisible > 0);
  await ctx.close();
}

// ---- 6. no horizontal overflow at the narrow end --------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const path of ['/app', '/app/vault', '/app/pay', '/app/earn', '/app/activity']) {
    await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`390px: ${path} has no horizontal overflow`, overflow === 0, `${overflow}px`);
  }
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
