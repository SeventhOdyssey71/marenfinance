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

/** Override with BASE_URL when port 3000 is taken. */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  args: ['--use-gl=angle'],
});

import { connectWallet, installWallet } from './injected-wallet.mjs';

/**
 * Mezo matsnet, stated here rather than imported.
 *
 * `@maren/sdk` is TypeScript source consumed through the Next build; a plain `.mjs` run
 * by node cannot import it. Two fields is a small enough duplication to accept, and both
 * are checked against the running app: a mismatch shows up immediately as the wallet
 * failing to connect.
 */
const mezoTestnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
};

/**
 * A throwaway key, supplied by the environment. Never a literal in this file — a private
 * key committed to a repository is a private key that has been published, even on a
 * testnet where it holds four hundredths of a cent.
 *
 * The account needs only gas. Every connected assertion below is about an account that
 * owns nothing, which is the state that matters most and the one the old mock data made
 * impossible to see.
 */
const TEST_PRIVATE_KEY = process.env.MAREN_TEST_PRIVATE_KEY;
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';

if (!TEST_PRIVATE_KEY) {
  console.error(
    'MAREN_TEST_PRIVATE_KEY is not set. The connected checks sign real transactions on\n' +
      'Mezo matsnet, so they need a funded throwaway key. Export one and re-run.',
  );
  process.exit(1);
}

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
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
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
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

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
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
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
//
// THE SHAPE OF THIS SECTION CHANGED when the mock data source was deleted. It used to
// drive a "Demo controls" panel to reach states — an empty account, a stalled oracle —
// that only existed inside `mock.ts`. There is no mock and no demo panel any more, so the
// states are reached the way a user reaches them: disconnected, and then connected to
// matsnet with a real key. Everything below runs against the deployed contracts.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });

  // --- Portfolio, with no wallet -----------------------------------------
  //
  // This is now the FIRST thing every visitor sees, so it carries the most checks. It
  // used to be a populated demo portfolio; the whole point of these assertions is that it
  // is not one again.
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

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

  // The borrowing ceiling must be the contract's real one, not an ICR estimate, and the
  // provenance must stay checkable. It lives on the protocol panel now, because that is
  // the panel a disconnected visitor sees.
  const capacityProvenance = await page.locator('text=getTroveMaxBorrowingCapacity').count();
  check(
    'app: the borrowing ceiling can still be traced to the contract call',
    capacityProvenance > 0,
    'the real ceiling, not an ICR-derived estimate',
  );

  const capacityVisible = await page.evaluate(() =>
    [...document.querySelectorAll('details')].some(
      (d) => !d.open && d.textContent.includes('getTroveMaxBorrowingCapacity'),
    ),
  );
  check(
    'app: the contract name sits behind an info affordance, not in the card body',
    capacityVisible,
    'BRAND.md: no function names in the primary UI',
  );

  // The gasless claim must never be unconditional. MarenVault.deposit() is payable and
  // MarenRelayHub reverts on any request carrying value, so the first deposit costs the
  // user BTC gas no matter what is running.
  const gasText = await page.locator('section:has([data-contrast="gas-copy"])').first().innerText();
  check('app: gas copy never promises "no gas, ever"', !/no gas,? ever/i.test(gasText));
  check(
    'app: gas copy states the first-deposit exception',
    /first deposit costs gas/i.test(gasText),
    'deposit is payable, therefore never relayable',
  );

  // And while no relayer is deployed, it must not claim sponsorship at all. The old copy
  // said "Maren pays the Bitcoin gas for payments, Earn, and pooled borrow, repay and
  // withdraw" — describing a service that exists in the architecture and nowhere else.
  check(
    'app: gas copy does not claim Maren pays, while no relayer is deployed',
    !/Maren pays the Bitcoin (network )?(gas|fee)/i.test(gasText),
    'RELAYER_AVAILABLE is false',
  );

  // No figure anywhere in the dApp may be an unbounded number. Sixteen consecutive
  // digits is far past any real balance and far short of a 2^255 sentinel.
  const appBody = await page.locator('main').innerText();
  check(
    'app: no figure runs to 16+ digits',
    !/\d[\d,]{15,}/.test(appBody.replace(/,/g, '')),
    (appBody.match(/\d[\d,]{15,}/) ?? [''])[0].slice(0, 40),
  );

  // --- The fabrication checks -------------------------------------------
  //
  // The reason this whole pass happened: `/app/activity` rendered invented rows —
  // `@nadia`, `@okonkwo`, `@mira`, amounts, and invented transaction hashes as working
  // explorer links — under a header reading "Live from Mezo testnet". These four
  // assertions exist so that cannot come back without a check going red.

  check(
    'app (no wallet): quotes no liquidation price',
    !/liquidation price[\s\S]{0,40}?[\d]/i.test(appBody),
    'a visitor with no position has no liquidation price',
  );

  const placeholderDashes = await page.evaluate(
    () =>
      [...document.querySelectorAll('main span, main div')].filter(
        (el) => el.textContent.trim() === '—',
      ).length,
  );
  check(
    'app (no wallet): a purposeful empty state, not a grid of dashes',
    /No wallet connected/.test(appBody) && placeholderDashes === 0,
    `${placeholderDashes} placeholder dashes`,
  );

  const deletedHandles = /@(nadia|okonkwo|mira)\b/i;
  check(
    'app (no wallet): names no invented counterparty',
    !deletedHandles.test(appBody),
    'the mock cast must not reappear',
  );

  const txLinks = await page.locator('main a[href*="/tx/"]').count();
  check(
    'app (no wallet): links to no transaction it cannot have seen',
    txLinks === 0,
    `${txLinks} tx links on a page for an account that does not exist`,
  );

  // ...but the panel must still show something TRUE. A disconnected visit that renders
  // nothing at all would have been a cheaper way to pass the checks above, and a worse
  // product. These are live contract reads.
  check(
    'app (no wallet): shows the live BTC/USD oracle price',
    /BTC \/ USD/.test(appBody) && /\$[\d,]+\.\d\d/.test(appBody),
    'read from the Mezo price precompile',
  );
  check(
    'app (no wallet): shows the pooled trove’s real collateral ratio',
    /trove ratio/i.test(appBody) && /\d+\.\d+%/.test(appBody),
    'MarenVault.troveStatus()',
  );

  // --- Vault, with no wallet ---------------------------------------------
  await page.goto(BASE + '/app/vault', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const vaultAnon = await page.locator('main').innerText();
  check(
    'vault (no wallet): offers a connect prompt, not a slider attached to nothing',
    (await page.locator('input[type=range]').count()) === 0 &&
      /Connect to open a position/.test(vaultAnon),
  );
  check(
    'vault (no wallet): quotes no liquidation price',
    !/liquidation price[\s\S]{0,40}?[\d]/i.test(vaultAnon),
  );

  // --- Activity, with no wallet ------------------------------------------
  await page.goto(BASE + '/app/activity', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const activityAnon = await page.locator('main').innerText();
  check(
    'activity (no wallet): says history is per-account rather than inventing a feed',
    /Connect to see your history/.test(activityAnon),
  );
  const anonTxLinks = await page.locator('main a[href*="/tx/"]').count();
  check(
    'activity (no wallet): renders no transaction links at all',
    anonTxLinks === 0,
    `${anonTxLinks} links`,
  );

  // --- Earn, with no wallet ----------------------------------------------
  await page.goto(BASE + '/app/earn', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const earnAnon = await page.locator('main').innerText();
  check(
    'earn: no forward rate is quoted anywhere on the page',
    !/\d[\d.,]*\s*%\s*(apy|apr)/i.test(earnAnon) && !/apy\s*[:of]*\s*\d/i.test(earnAnon),
  );
  check('earn: says plainly why there is no APY', /does not display an APY/i.test(earnAnon));

  // --- Pay, with no wallet -----------------------------------------------
  await page.goto(BASE + '/app/pay', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const payAnon = await page.locator('main').innerText();
  check(
    'pay (no wallet): never describes a payment as free while no relayer is deployed',
    !/no gas/i.test(payAnon) && /You pay the Bitcoin gas/.test(payAnon),
  );
  check('pay (no wallet): prefills no invented recipient', !deletedHandles.test(payAnon));

  check('app: no 4xx/5xx responses across the dApp', bad.length === 0, bad.join(', '));
  await ctx.close();
}

// ---- 4b. the dApp with a real signer on matsnet ---------------------------
//
// A wallet is injected at `window.ethereum` and backed by a real private key — see
// `scripts/injected-wallet.mjs`. Reads go to Mezo's RPC; nothing here is stubbed. The
// account is a throwaway with no collateral and no MUSD, which is precisely the state
// most users arrive in and the one the interface has to be best at.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const wallet = await installWallet(ctx, {
    privateKey: TEST_PRIVATE_KEY,
    chain: mezoTestnet,
    rpcUrl: RPC_URL,
  });
  const page = await ctx.newPage();

  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const connected = await connectWallet(page);
  await page.waitForTimeout(2500);

  const connectedBody = await page.locator('main').innerText();
  check('app: a real injected signer connects', connected, wallet.address);
  check(
    'app: the connected account is shown, and it is the one that signed',
    connectedBody.includes(wallet.address.slice(0, 10)),
    wallet.address,
  );

  // An account that exists but owns nothing. Every figure below is a real contract read
  // returning zero — which is a fact about this address, not a placeholder.
  check(
    'app (empty account): quotes no liquidation price',
    !/liquidation price[\s\S]{0,40}?[\d]/i.test(connectedBody),
  );
  const connectedDashes = await page.evaluate(
    () =>
      [...document.querySelectorAll('main span, main div')].filter(
        (el) => el.textContent.trim() === '—',
      ).length,
  );
  check(
    'app (empty account): a purposeful empty state, not a grid of dashes',
    /No position yet/.test(connectedBody) && connectedDashes === 0,
    `${connectedDashes} placeholder dashes`,
  );

  // --- Vault, connected --------------------------------------------------
  await page.goto(BASE + '/app/vault', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check(
    'vault (empty account): lands on Deposit rather than an unusable Borrow slider',
    (await page.getByRole('tab', { name: 'Deposit' }).getAttribute('aria-selected')) === 'true',
  );

  // MarenVault.MIN_DEPOSIT is 0.001 BTC. The refusal happens in the form, before a wallet
  // ever opens, rather than as a `DepositBelowMinimum` revert the user pays to discover.
  const amountInput = page.locator('input#amount, input[inputmode=decimal]').first();
  await amountInput.fill('0.0001');
  await page.waitForTimeout(400);
  const belowMin = await page.locator('main').innerText();
  check(
    'vault: a deposit under the 0.001 BTC minimum is refused before signing',
    /minimum deposit/i.test(belowMin),
    'MarenVault.MIN_DEPOSIT, checked in the form',
  );
  const depositDisabled = await page
    .getByRole('button', { name: /^Deposit/ })
    .last()
    .isDisabled();
  check('vault: the deposit button is disabled below the minimum', depositDisabled);

  // Borrowing against nothing. The panel refuses rather than showing a slider bounded by
  // zero, which is a control that cannot be moved and explains nothing.
  await page.getByRole('tab', { name: 'Borrow' }).click();
  await page.waitForTimeout(800);
  const borrowPanel = await page.locator('main').innerText();
  check(
    'vault: borrowing with no collateral explains itself instead of offering a dead slider',
    /Deposit first/.test(borrowPanel),
  );

  // --- Activity, connected ------------------------------------------------
  await page.goto(BASE + '/app/activity', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const activityLive = await page.locator('main').innerText();
  check(
    'activity: states the block range it actually read',
    /Read (every block from|blocks)\s/.test(activityLive),
    'the span is part of the answer, not a footnote',
  );
  check(
    'activity: an empty history is stated as a fact about the whole chain, not a guess',
    /Nothing here yet/.test(activityLive) && /since the contracts were deployed/.test(activityLive),
  );
  const liveTxLinks = await page.locator('main a[href*="/tx/"]').count();
  check(
    'activity: an account with no history links to no transactions',
    liveTxLinks === 0,
    `${liveTxLinks} links`,
  );

  // --- Pay, connected -----------------------------------------------------
  await page.goto(BASE + '/app/pay', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // `@sele` is registered on matsnet to the deploying account. This resolves it through
  // MarenRegistry.tryResolve — a real read against a real registration.
  await page.locator('#pay-to').fill('@sele');
  await page.waitForTimeout(2500);
  const resolvedInline = await page.locator('#pay-to-status').innerText();
  check(
    'pay: a real handle resolves and its address is shown beside it',
    /0x[0-9a-fA-F]{40}/.test(resolvedInline),
    resolvedInline.slice(0, 70),
  );

  // An unregistered handle must fail loudly rather than falling back to anything.
  await page.locator('#pay-to').fill('@nosuchhandle_zzz');
  await page.waitForTimeout(2500);
  const unresolved = await page.locator('#pay-to-status').innerText();
  check(
    'pay: an unregistered handle fails loudly rather than resolving to something',
    /No such handle/.test(unresolved),
    unresolved.slice(0, 60),
  );

  // The confirmation sheet, reached through Request — which moves no funds and so works
  // for an account holding no MUSD.
  await page.getByRole('tab', { name: 'Request' }).click();
  await page.waitForTimeout(600);
  await page.locator('input[inputmode=decimal]').first().fill('10');
  await page.waitForTimeout(400);
  await page
    .getByRole('button', { name: /^Request / })
    .last()
    .click();
  await page.waitForTimeout(600);
  const dialog = page.locator('[role=dialog]');
  check('pay: confirmation is a modal dialog', (await dialog.count()) === 1);
  check(
    'pay: dialog is aria-modal and labelled',
    (await dialog.getAttribute('aria-modal')) === 'true',
  );
  const dialogText = await dialog.innerText();
  check(
    'pay: the sheet states who pays the gas, and does not claim it is free',
    /you pay the/i.test(dialogText) && !/no gas/i.test(dialogText),
    dialogText.slice(0, 80).replace(/\n/g, ' '),
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('pay: Escape closes the dialog', (await page.locator('[role=dialog]').count()) === 0);

  // --- The handle registration flow --------------------------------------
  await page.getByRole('tab', { name: 'Handle' }).click();
  await page.waitForTimeout(600);
  const handlePanel = await page.locator('main').innerText();
  check(
    'handle: registration is presented as two steps with the 60s wait explained',
    /step 1 — commit/i.test(handlePanel) &&
      /step 2 — claim/i.test(handlePanel) &&
      /60 seconds/i.test(handlePanel),
  );
  check(
    'handle: the claim step is disabled until a commitment exists',
    await page
      .getByRole('button', { name: /^Claim/ })
      .last()
      .isDisabled(),
  );

  // Availability is a live registry read, not an optimistic assumption.
  await page.locator('#handle-input').fill('sele');
  await page.waitForTimeout(2500);
  check(
    'handle: an already-registered handle is reported as taken',
    /already registered/i.test(await page.locator('#handle-status').innerText()),
    'MarenRegistry.available()',
  );
  check(
    'handle: committing to a taken handle is refused',
    await page
      .getByRole('button', { name: /^Commit/ })
      .last()
      .isDisabled(),
  );

  await ctx.close();
}

// ---- 5. reduced motion across the dApp -----------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('app reduced-motion: no shader canvas mounted', canvases === 0, `canvases=${canvases}`);
  // With no wallet there is no position-health card; the card that must survive
  // `prefers-reduced-motion` is the one a disconnected visitor actually gets.
  const panelVisible = await page.locator('text=The pooled trove').count();
  check('app reduced-motion: the protocol panel still renders', panelVisible > 0);
  await ctx.close();
}

// ---- 6. no horizontal overflow at the narrow end --------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const path of ['/app', '/app/vault', '/app/pay', '/app/earn', '/app/activity']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
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
