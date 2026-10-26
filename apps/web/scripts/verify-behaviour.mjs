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

import { connectWallet, installReadOnlyWallet, installWallet } from './injected-wallet.mjs';
import { generatePrivateKey } from 'viem/accounts';
import { createPublicClient, http, parseAbi } from 'viem';

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
 * A throwaway key. Never a literal in this file — a private key committed to a repository
 * is a private key that has been published, even on a testnet where it holds four
 * hundredths of a cent.
 *
 * IT NO LONGER HAS TO BE FUNDED, AND THE SUITE NO LONGER REFUSES TO RUN WITHOUT ONE.
 * Section 4b exercises an account that owns nothing — which is the state most users arrive
 * in and the one the old mock data made impossible to see — and not one of its assertions
 * submits a transaction: every sheet it opens is closed with Escape, and every write
 * button it reaches is disabled. A key generated fresh on each run satisfies all of it,
 * and makes the checks runnable by anyone who clones the repository. Set
 * MAREN_TEST_PRIVATE_KEY to pin a specific account instead.
 */
const TEST_PRIVATE_KEY = process.env.MAREN_TEST_PRIVATE_KEY ?? generatePrivateKey();
const RPC_URL = process.env.MEZO_RPC_URL ?? 'https://rpc.test.mezo.org';

if (!process.env.MAREN_TEST_PRIVATE_KEY) {
  console.log(
    'MAREN_TEST_PRIVATE_KEY unset — generated a fresh key for this run.\n' +
      'The connected checks are about an account that owns nothing, and none of them submit.\n',
  );
}

/**
 * An account with a REAL position: 0.001 BTC of collateral in MarenVault, no debt, no
 * MUSD. Section 4c drives it through a signer that cannot sign, which is how the preflight
 * checks below prove a negative — that no signature is ever requested for a borrow the
 * pooled trove cannot serve.
 */
const VIEW_ACCOUNT = process.env.MAREN_VIEW_ADDRESS ?? '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';

/**
 * Wait for a live registry read to settle, rather than sleeping and hoping.
 *
 * These statuses are backed by a real `MarenRegistry` call over Mezo's public RPC, which
 * routinely takes longer than the 2500ms this script used to sleep for. That made three
 * checks fail intermittently on "Resolving handle…" — a slow network reported as a broken
 * product. Polling until the pending text clears tests the assertion the check is actually
 * about, and still fails if the read never returns.
 */
async function settled(page, selector, pending = 'Resolving|Checking the registry') {
  await page
    .waitForFunction(
      ([sel, src]) => {
        const el = document.querySelector(sel);
        return Boolean(el) && !new RegExp(src).test(el.textContent ?? '');
      },
      [selector, pending],
      { timeout: 20000 },
    )
    .catch(() => {});
  return page.locator(selector).innerText();
}

/**
 * Wait until the DOM actually says the thing a check is about.
 *
 * Every wait below used to be a fixed sleep chosen to be "long enough" for Mezo's public
 * RPC. That is a guess, and a guess that is too short reports a slow network as a broken
 * product while a guess that is too long makes the suite crawl. Each of these now polls
 * for the condition its sleep was standing in for, so the check fails only when the app
 * genuinely never gets there.
 */
async function textReady(page, re, { selector = 'main', timeout = 30_000 } = {}) {
  await page
    .waitForFunction(
      ([sel, src, flags]) => {
        const el = document.querySelector(sel);
        return Boolean(el) && new RegExp(src, flags).test(el.textContent ?? '');
      },
      [selector, re.source, re.flags],
      { timeout },
    )
    .catch(() => {});
  return page.locator(selector).innerText();
}

/** The same idea for a condition that is not text. Resolves false on timeout. */
async function domReady(page, fn, arg = null, timeout = 30_000) {
  return page
    .waitForFunction(fn, arg, { timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * THE VAULT, READ INDEPENDENTLY OF THE APP.
 *
 * The social-vault panel's whole claim is that its figures are contract reads anybody can
 * repeat. An assertion that only checked "a percentage is on screen" would pass just as
 * happily against a number the app made up, which is the exact failure this suite was
 * written after. So the checks below read `MarenVault` themselves, over the same public
 * RPC and with no app code in the path, and compare what the chain says to what the screen
 * says.
 *
 * The two formatters here are deliberately NOT imported from `@maren/sdk` — a plain `.mjs`
 * cannot import its TypeScript source, and more importantly an assertion that reuses the
 * implementation it is testing proves nothing. They are the display rules written out
 * independently: truncate, never round.
 */
const VAULT_ADDRESS =
  process.env.MAREN_VAULT_ADDRESS ?? '0x46252B00AB59384518d9dB6D1f210ffF1221645b';

const MUSD_ADDRESS = process.env.MAREN_MUSD_ADDRESS ?? '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';

const vaultAbi = parseAbi([
  'function totalCollateral() view returns (uint256)',
  'function depositCap() view returns (uint256)',
  'function MIN_TROVE_CR() view returns (uint256)',
  'function troveStatus() view returns (uint256,uint256,uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

const rpc = createPublicClient({ transport: http(RPC_URL) });

/**
 * Read the vault, now.
 *
 * Called at each comparison rather than once at startup, because `troveStatus().icr` is
 * priced: it moves whenever the BTC oracle moves, which over the eight minutes this suite
 * takes is often enough to change the tenth of a percent the app displays. A single read
 * at the top would have turned "the oracle ticked" into "the app is lying".
 */
async function readVault() {
  const read = (functionName, args) =>
    rpc.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName, args });
  try {
    const [totalCollateral, depositCap, minTroveCr, status] = await Promise.all([
      read('totalCollateral'),
      read('depositCap'),
      read('MIN_TROVE_CR'),
      read('troveStatus'),
    ]);
    return { totalCollateral, depositCap, minTroveCr, icr: status[2] };
  } catch (error) {
    console.log(`Could not read MarenVault directly: ${error.shortMessage ?? error.message}`);
    return null;
  }
}

/** MUSD in a wallet, for the checks whose whole subject is whether it is empty. */
async function readMusd(address) {
  try {
    return await rpc.readContract({
      address: MUSD_ADDRESS,
      abi: vaultAbi,
      functionName: 'balanceOf',
      args: [address],
    });
  } catch {
    return null;
  }
}

/**
 * Does the screen show a ratio the chain agrees with?
 *
 * Every ratio rendered as `NNN.N%` is collected and compared numerically against the
 * contract's own figure, with half a percentage point of room for the oracle to have
 * ticked between the render and this read. That is far tighter than any invented number
 * would survive and far looser than the noise it has to tolerate.
 */
const ratioAgrees = (text, icrWei) => {
  // A 1e18 ratio is a MULTIPLE, not a percentage: 2.218e18 is 221.8%. Scaling by 100
  // rather than 10,000 makes every comparison here 2.21 against 221.8, which is how this
  // helper's first run failed three checks that were reporting the truth.
  const actual = Number((icrWei * 10_000n) / 10n ** 18n) / 100;
  return [...text.matchAll(/(\d[\d,]*)\.(\d)%/g)]
    .map((match) => Number(`${match[1].replace(/,/g, '')}.${match[2]}`))
    .some((shown) => Math.abs(shown - actual) <= 0.5);
};

/** A share of a whole, as the app prints it: one decimal, truncated. */
const percentText = (part, whole) => {
  const tenths = whole === 0n ? 1000n : (part * 1000n) / whole;
  return `${tenths / 10n}.${tenths % 10n}%`;
};

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
  // The reveals finishing is the condition the old 800ms sleep was buying.
  await domReady(page, () =>
    [...document.querySelectorAll('.reveal')].every(
      (el) => Number(getComputedStyle(el).opacity) > 0.99,
    ),
  );
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('reduced-motion: zero shader canvases mounted', canvases === 0, `canvases=${canvases}`);

  // The landing no longer mounts a shader at all (the square redesign, 2026-10-23), so
  // there is no gradient fallback to look for; "zero canvases" above is the whole check.

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
  // Four questions, the same four as before the redesign; this said 8 and was stale.
  check('faq: 4 accordion triggers with aria-expanded', n === 4, `found=${n}`);

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

  /**
   * The skip link is GONE, on the owner's direct instruction, so this no longer asserts
   * that it is the first tab stop — it asserts what replaced it.
   *
   * The check is kept rather than deleted because tab order is still load-bearing: the
   * first thing a keyboard user reaches must be a real, labelled control in the header,
   * not a stray focusable div or something buried below the fold. If the skip link is
   * ever restored, this flips back to expecting "Skip to content".
   */
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const firstStop = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      label: el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '',
      inHeader: Boolean(el?.closest('header')),
      skipLink: el?.textContent?.trim() === 'Skip to content',
    };
  });
  check('skip link is not present as a tab stop', !firstStop.skipLink, `got="${firstStop.label}"`);
  check(
    'first tab stop is a labelled control in the header',
    firstStop.inHeader && firstStop.label.length > 0,
    JSON.stringify(firstStop),
  );

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
  const iosCtas = await page
    .locator('a', { hasText: 'Get iOS app' })
    .evaluateAll((links) =>
      links.map((link) => ({ href: link.href, target: link.target, rel: link.rel })),
    );
  check(
    'public iOS calls to action are pinned to TestFlight',
    iosCtas.length === 4 &&
      iosCtas.every(
        (link) =>
          link.href === 'https://testflight.apple.com/join/uhmv9YPE' &&
          link.target === '_blank' &&
          link.rel.includes('noopener'),
      ),
    JSON.stringify(iosCtas),
  );
  check(
    'landing page no longer advertises the browser app',
    (await page.locator('a[href="/app"]').count()) === 0,
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
  // The protocol panel is backed by live contract reads; wait for one to land.
  await textReady(page, /\d+\.\d+%/);

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

  // Same change as the landing page: the skip link was removed on the owner's
  // instruction, so tab order is asserted on what is actually first now.
  await page.keyboard.press('Tab');
  const appFirstStop = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      label: el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '',
      inHeader: Boolean(el?.closest('header')),
      skipLink: el?.textContent?.trim() === 'Skip to content',
    };
  });
  check('app: skip link is not present as a tab stop', !appFirstStop.skipLink, appFirstStop.label);
  check(
    'app: first tab stop is a labelled control in the header',
    appFirstStop.inHeader && appFirstStop.label.length > 0,
    JSON.stringify(appFirstStop),
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

  /**
   * THE GAS CHECKS MOVED, BECAUSE THE GAS COPY MOVED.
   *
   * The portfolio used to carry a "Gas" panel carrying a `data-contrast="gas-copy"` hook,
   * and these three assertions read it from this screen. The light-theme pass deleted
   * that panel deliberately: the disclosure now lives where the gas is actually paid, on
   * the button that spends it. This locator therefore matched nothing and the whole suite
   * died on a 30-second timeout before reaching a single dApp assertion.
   *
   * The guarantee is unchanged and the checks are not weakened; they run in 4c, against
   * the deposit panel, which is the screen a user is on when the claim matters.
   */

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
    // The disconnected Home is a question now, not a "No wallet connected" card.
    /What do you want to do with your Bitcoin\?/.test(appBody) && placeholderDashes === 0,
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
  const vaultOnPortfolio = await readVault();
  check(
    'app (no wallet): shows the social vault’s real health, and it is the contract’s figure',
    /vault health/i.test(appBody) &&
      (vaultOnPortfolio === null || ratioAgrees(appBody, vaultOnPortfolio.icr)),
    vaultOnPortfolio === null
      ? 'MarenVault.troveStatus() could not be read directly'
      : `MarenVault.troveStatus().icr is ${vaultOnPortfolio.icr}`,
  );

  // --- Vault, with no wallet ---------------------------------------------
  await page.goto(BASE + '/app/vault', { waitUntil: 'networkidle' });
  await textReady(page, /connect/i);
  await textReady(page, /vault health/i);
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

  /**
   * THE SOCIAL VAULT PANEL.
   *
   * The pooled position is the thing Maren invented, and it used to appear in the product
   * as a tag reading "Pooled trove" plus a paragraph shown only to whoever had already
   * been routed into it. It is now a panel of its own on the screen it belongs to, before
   * any wallet is connected, because the vault is public.
   *
   * These assertions are about the figures being the CHAIN'S. Each one is compared with a
   * `MarenVault` read this script performed itself.
   */
  // Panel titles and metric labels carry `text-transform: uppercase`, and `innerText`
  // reports what is rendered rather than what is written, so every assertion on a label
  // is case-insensitive. A case-sensitive one passes locally and fails on the label it
  // was written for.
  const vaultNow = await readVault();
  check(
    'vault (no wallet): the social vault is a first-class panel, not a routing footnote',
    /the social vault/i.test(vaultAnon) && /vault health/i.test(vaultAnon),
    'the pooled position is the product, and it is on screen without a wallet',
  );
  check(
    'vault: the vault health shown is the ICR MarenVault.troveStatus() reports',
    vaultNow === null || ratioAgrees(vaultAnon, vaultNow.icr),
    vaultNow === null ? 'vault unreadable' : `chain says ${vaultNow.icr}`,
  );
  check(
    'vault: the health figure is marked against the 180% floor and the 250% target',
    /180 floor/i.test(vaultAnon) && /250 target/i.test(vaultAnon),
    'MIN_TROVE_CR and MAREN_POLICY.targetCr, both on the scale',
  );
  check(
    'vault: capacity used is the contract’s totalCollateral against its own depositCap',
    vaultNow === null ||
      vaultAnon.includes(percentText(vaultNow.totalCollateral, vaultNow.depositCap)),
    vaultNow === null
      ? 'vault unreadable'
      : `chain says ${percentText(vaultNow.totalCollateral, vaultNow.depositCap)}`,
  );

  // The bar is decoration to a sighted user and the only capacity signal to a screen
  // reader, so it carries the same two figures the caption does.
  const capacityBar = await page.evaluate(() =>
    [...document.querySelectorAll('[role=img]')]
      .map((el) => el.getAttribute('aria-label') ?? '')
      .find((label) => /deposit cap is used/.test(label)),
  );
  check(
    'vault: the capacity bar states the room left rather than being a bare rectangle',
    Boolean(capacityBar) && /of room is left/.test(capacityBar ?? ''),
    (capacityBar ?? '').slice(0, 90),
  );

  /**
   * THE RISK LINE IS ON THE PANEL, NOT BEHIND THE AFFORDANCE. A product that leads with
   * "one shared position, from 0.001 BTC" and files the consequence of sharing under a
   * disclosure nobody opens has sold the upside and hidden the downside.
   */
  const riskInBody = await page.evaluate(() => {
    const details = [...document.querySelectorAll('details')];
    const inDetails = details.some((d) => /segregated in/.test(d.textContent ?? ''));
    const inMain = /segregated in/.test(document.querySelector('main')?.textContent ?? '');
    return { inDetails, inMain };
  });
  check(
    'vault: the pooling risk is stated in the panel body, not filed behind an info toggle',
    riskInBody.inMain && !riskInBody.inDetails,
    JSON.stringify(riskInBody),
  );
  check(
    'vault: that sentence says both what is shared and what sharing can cost',
    /accounting, not custody/.test(vaultAnon) && /socialise losses/.test(vaultAnon),
  );

  // --- Activity, with no wallet ------------------------------------------
  await page.goto(BASE + '/app/activity', { waitUntil: 'networkidle' });
  await textReady(page, /connect/i);
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
  await textReady(page, /does not display an APY/i);
  const earnAnon = await page.locator('main').innerText();
  check(
    'earn: no forward rate is quoted anywhere on the page',
    !/\d[\d.,]*\s*%\s*(apy|apr)/i.test(earnAnon) && !/apy\s*[:of]*\s*\d/i.test(earnAnon),
  );
  check('earn: says plainly why there is no APY', /does not display an APY/i.test(earnAnon));

  // --- Pay, with no wallet -----------------------------------------------
  await page.goto(BASE + '/app/pay', { waitUntil: 'networkidle' });
  await textReady(page, /connect/i);
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
  await domReady(page, () => document.querySelector('main') !== null);
  const connected = await connectWallet(page);
  // The account rendering IS the handshake completing; poll for it rather than guessing.
  await textReady(page, new RegExp(wallet.address.slice(0, 10)));
  await textReady(page, /No position yet|collateral ratio/i);

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
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));
  // The default tab is chosen from the position read, so wait for a tab to be selected.
  await domReady(page, () =>
    [...document.querySelectorAll('[role=tab]')].some(
      (t) => t.getAttribute('aria-selected') === 'true',
    ),
  );
  check(
    'vault (empty account): lands on Deposit rather than an unusable Borrow slider',
    (await page.getByRole('tab', { name: 'Deposit' }).getAttribute('aria-selected')) === 'true',
  );

  // MarenVault.MIN_DEPOSIT is 0.001 BTC. The refusal happens in the form, before a wallet
  // ever opens, rather than as a `DepositBelowMinimum` revert the user pays to discover.
  const amountInput = page.locator('input#amount, input[inputmode=decimal]').first();
  await amountInput.fill('0.0001');
  await textReady(page, /minimum deposit/i);
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
  const borrowPanel = await textReady(page, /Deposit first/);
  check(
    'vault: borrowing with no collateral explains itself instead of offering a dead slider',
    /Deposit first/.test(borrowPanel),
  );

  // --- Activity, connected ------------------------------------------------
  await page.goto(BASE + '/app/activity', { waitUntil: 'networkidle' });
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));
  // A log scan over the whole deployed range; the block-range line is what it produces.
  const activityLive = await textReady(page, /Read (every block from|blocks)\s/, {
    timeout: 60_000,
  });
  check(
    'activity: states the block range it actually read',
    /Read (every block from|blocks)\s/.test(activityLive),
    'the span is part of the answer, not a footnote',
  );
  /**
   * THE EMPTY STATE NEVER OVERSTATES WHAT IT READ.
   *
   * This used to assert the completeness branch outright: "Nothing here yet", plus "every
   * block since the contracts were deployed". That was true while the contracts were
   * younger than the scanner's six-window horizon, and it expired on its own. Matsnet is
   * now further past block 14,911,471 than 60,000 blocks, so `logs.ts` returns
   * `complete: false` and the screen correctly switches to the narrower claim.
   *
   * Raising `MAX_WINDOWS` would make this green again for about two more days. The
   * comment on that constant already ruled it out in advance: "when it starts biting, the
   * answer is an indexer, not a bigger number here." It has started biting. So the check
   * asserts the invariant that does not expire, and it is the stronger one — whichever
   * branch renders, the page's coverage claim has to match the scan it actually
   * performed, and the two branches are mutually exclusive.
   */
  const claimsWholeHistory =
    /Nothing here yet/.test(activityLive) && /since the contracts were deployed/.test(activityLive);
  const admitsAPartialScan =
    /Nothing in the blocks we could read/.test(activityLive) &&
    /not claimed to be absent/.test(activityLive) &&
    /older history needs an indexer/.test(activityLive);
  check(
    'activity: an empty history never claims more coverage than the scan actually had',
    claimsWholeHistory !== admitsAPartialScan,
    claimsWholeHistory ? 'read every block since deployment' : 'says what it did not look at',
  );
  check(
    'activity: a partial scan is never dressed up as the whole story',
    !(admitsAPartialScan && /that is the whole story|the complete history/.test(activityLive)),
  );
  const liveTxLinks = await page.locator('main a[href*="/tx/"]').count();
  check(
    'activity: an account with no history links to no transactions',
    liveTxLinks === 0,
    `${liveTxLinks} links`,
  );

  // --- Pay, connected -----------------------------------------------------
  await page.goto(BASE + '/app/pay', { waitUntil: 'networkidle' });
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));

  // Send is deliberately paced Amount → Recipient. This throwaway account owns no MUSD,
  // so it cannot (and should not) advance past Amount merely to expose the resolver. Split
  // renders the same live handle resolver immediately and lets us test that contract read
  // without weakening the empty-wallet precondition in the product.
  await page.getByRole('tab', { name: 'Split' }).click();
  const splitRecipient = page.locator('input[id^="split-recipient-"]').first();
  await splitRecipient.waitFor({ state: 'visible' });

  // `@sele` is registered on matsnet to the deploying account. This resolves it through
  // MarenRegistry.tryResolve — a real read against a real registration.
  await splitRecipient.fill('@sele');
  const splitStatus = `#${await splitRecipient.getAttribute('id')}-status`;
  const resolvedInline = await settled(page, splitStatus);
  check(
    'pay: a real handle resolves and its address is shown beside it',
    /0x[0-9a-fA-F]{40}/.test(resolvedInline),
    resolvedInline.slice(0, 70),
  );

  // An unregistered handle must fail loudly rather than falling back to anything.
  await splitRecipient.fill('@nosuchhandle_zzz');
  const unresolved = await settled(page, splitStatus);
  check(
    'pay: an unregistered handle fails loudly rather than resolving to something',
    /No such handle/.test(unresolved),
    unresolved.slice(0, 60),
  );

  // The confirmation sheet, reached through Request — which moves no funds and so works
  // for an account holding no MUSD.
  await page.getByRole('tab', { name: 'Request' }).click();
  await page.locator('input[inputmode=decimal]').first().waitFor({ state: 'visible' });
  await page.locator('input[inputmode=decimal]').first().fill('10');
  const requestButton = page.getByRole('button', { name: /^Request / }).last();
  await domReady(page, () =>
    [...document.querySelectorAll('button')].some(
      (b) => /^Request /.test(b.textContent ?? '') && !b.disabled,
    ),
  );
  await requestButton.click();
  const dialog = page.locator('[role=dialog]');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
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
  await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  check('pay: Escape closes the dialog', (await page.locator('[role=dialog]').count()) === 0);

  // --- The handle registration flow --------------------------------------
  await page.getByRole('tab', { name: 'Handle' }).click();
  const handlePanel = await textReady(page, /two transactions, 60 seconds apart/i);
  check(
    'handle: registration is presented as two steps with the 60s wait explained',
    (await page.locator('ol > li').count()) === 2 &&
      /\bCommit\b/.test(handlePanel) &&
      /\bClaim\b/.test(handlePanel) &&
      /two transactions, 60 seconds apart/i.test(handlePanel),
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
  const handleStatus = await settled(page, '#handle-status');
  check(
    'handle: an already-registered handle is reported as taken',
    /already registered/i.test(handleStatus),
    'MarenRegistry.available()',
  );
  // The button's disabled state follows the same read, so poll for it rather than
  // assuming React has committed the render by now.
  await domReady(page, () =>
    [...document.querySelectorAll('button')].some(
      (b) => /^Commit/.test(b.textContent ?? '') && b.disabled,
    ),
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

// ---- 4c. THE PREFLIGHT: nothing that cannot succeed is ever offered --------
//
// The reason this section exists, in one sentence: the owner dragged the borrow slider to
// 17.95 MUSD, pressed Borrow, paid the gas, and got a revert that the app could have
// predicted for free from a contract it had already called.
//
// The signer here is READ-ONLY and structurally incapable of signing — see
// `installReadOnlyWallet`. That is what turns "no signature was requested" from a claim
// into a measurement: every attempt is recorded, and the assertion is that the record is
// empty. `prove-preflight.mjs` runs the same idea end to end and additionally checks the
// account's nonce on chain before and after.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const wallet = await installReadOnlyWallet(ctx, {
    address: VIEW_ACCOUNT,
    chain: mezoTestnet,
    rpcUrl: RPC_URL,
  });
  const page = await ctx.newPage();

  await page.goto(BASE + '/app/vault', { waitUntil: 'networkidle' });
  await domReady(page, () => document.querySelector('main') !== null);
  await connectWallet(page);
  // The tab strip only renders once the position read lands, which is the handshake
  // completing. Waiting on it is what the 4s sleep here was standing in for.
  await domReady(page, () =>
    [...document.querySelectorAll('[role=tab]')].some(
      (t) => t.getAttribute('aria-selected') === 'true',
    ),
  );
  await page.getByRole('tab', { name: 'Borrow' }).click();
  // The slider's range is a function of live reads, so wait for the control itself.
  await page.locator('input[type=range]').waitFor({ state: 'visible', timeout: 30_000 });

  const borrowPanel = await page.locator('main').innerText();
  const slider = page.locator('input[type=range]');
  const vaultAtBorrow = await readVault();
  const poolBelowFloor = vaultAtBorrow !== null && vaultAtBorrow.icr < vaultAtBorrow.minTroveCr;

  /**
   * LIVE ECONOMIC STATE CHANGES WITHOUT A DEPLOYMENT.
   *
   * The pooled trove has crossed its 180% floor in both directions as BTC moves and the
   * keeper operates it. A permanent assertion for either the open or closed state would
   * eventually demand a lie. The invariant is the useful one: THE PANEL AGREES WITH THE
   * CONTRACT. When the contract refuses, the panel refuses first and for free; when the
   * contract accepts, the panel offers a control whose whole range the contract accepts.
   */
  check(
    `preflight: borrowing ${poolBelowFloor ? 'is refused' : 'is offered'} exactly as the pooled trove requires`,
    poolBelowFloor
      ? /shared trove is too thin to lend against/i.test(borrowPanel) && (await slider.isDisabled())
      : !/shared trove is too thin to lend against/i.test(borrowPanel) &&
          !(await slider.isDisabled()),
    vaultAtBorrow
      ? `ICR=${vaultAtBorrow.icr}; floor=${vaultAtBorrow.minTroveCr}`
      : 'direct MarenVault read unavailable',
  );

  /**
   * A depositor's own stake in the shared position, as a figure rather than as the word
   * "pooled". This account holds 0.001 BTC of the vault's collateral, and the panel says
   * so and says what fraction of the whole that is.
   */
  check(
    'vault (in the vault): the panel states this account’s share of the shared position',
    /your collateral in it/i.test(borrowPanel) && /% of the vault/i.test(borrowPanel),
    'MarenVault.collateral(you) against totalCollateral()',
  );
  check(
    'vault (in the vault): the user’s debt is named as theirs alone, not the vault’s',
    /your debt in it/i.test(borrowPanel) && /yours alone, not the vault/i.test(borrowPanel),
    'debt is per-user; only the collateral is pooled',
  );

  const sliderMax = Number((await slider.getAttribute('max')) ?? '0');
  check(
    `preflight: the slider ${poolBelowFloor ? 'cannot submit while the pool is closed' : 'has a usable live range'}`,
    sliderMax > 0 && (poolBelowFloor ? await slider.isDisabled() : !(await slider.isDisabled())),
    `max=${sliderMax}`,
  );
  check(
    `preflight: the slider describes ${poolBelowFloor ? 'why borrowing is unavailable' : 'the maximum it can reach'}`,
    poolBelowFloor
      ? /Borrowing is unavailable/.test((await slider.getAttribute('aria-valuetext')) ?? '')
      : /of a maximum/.test((await slider.getAttribute('aria-valuetext')) ?? '') &&
          !/Borrowing is unavailable/.test((await slider.getAttribute('aria-valuetext')) ?? ''),
    (await slider.getAttribute('aria-valuetext')) ?? '',
  );

  /**
   * The slider is driven to a value rather than trusted to arrive at one.
   *
   * It seeds itself from `recommendedBorrow`, which is the draw that lands the position on
   * the 250% target. This account is ALREADY at 250%, so the recommendation is genuinely
   * zero and the button is correctly disabled at the default. Asserting "enabled on
   * arrival" would now be asserting that the panel offers a borrow the position does not
   * have room for. The guarantee under test is the one that survives either state: a value
   * inside the range the panel advertises is a value the panel will submit.
   */
  const borrowButton = page.getByRole('button', { name: /^Borrow/ }).last();
  if (poolBelowFloor) {
    check(
      'preflight: the Borrow button stays disabled while the pooled trove is below its floor',
      await borrowButton.isDisabled(),
      'no wallet prompt can be opened from a transaction that would revert',
    );
  } else {
    await slider.fill('500');
    await domReady(page, () =>
      [...document.querySelectorAll('button')].some(
        (b) => /^Borrow [\d,]/.test(b.textContent ?? '') && !b.disabled,
      ),
    );
    check(
      'preflight: the Borrow button is enabled at a valid amount inside the slider’s range',
      !(await borrowButton.isDisabled()),
      (await slider.getAttribute('aria-valuetext')) ?? '',
    );
    check(
      'preflight: the panel names which ceiling is binding, so the number is falsifiable',
      /Capped by (Mezo’s per-trove ceiling|Maren’s)/.test(borrowPanel),
      'borrowCeiling() reports the binding constraint, and the panel states it',
    );
  }

  /**
   * The open state has to keep the promise the closed state kept: reaching a confirmation
   * is not the same as signing. The signer here CANNOT sign, and the measurement is that
   * nothing ever asked it to. Nothing below is broadcast — the sheet is opened and closed.
   */
  if (!poolBelowFloor) {
    await borrowButton.click();
    const borrowSheet = page.locator('[role=dialog]');
    await borrowSheet.waitFor({ state: 'visible', timeout: 20_000 });
    check(
      'preflight: an offered borrow opens a confirmation, and it is a labelled modal dialog',
      (await borrowSheet.getAttribute('aria-modal')) === 'true' &&
        (await borrowSheet.getAttribute('data-tx-phase')) === 'confirm',
    );
    await page.keyboard.press('Escape');
    await borrowSheet.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  }
  check(
    'preflight: NO SIGNATURE WAS REQUESTED, at any point',
    wallet.signatureRequests.length === 0,
    `${wallet.signatureRequests.length} requests recorded`,
  );

  // Exits stay open. This is the product's own promise, and it holds whether or not
  // entries happen to be open today.
  await page.getByRole('tab', { name: 'Withdraw' }).click();
  await page.locator('input[inputmode=decimal]').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /BTC$/ }).first().click();
  await domReady(page, () => {
    const el = document.querySelector('input[inputmode=decimal]');
    return Boolean(el) && el.value !== '' && el.value !== '0';
  });
  check(
    'preflight: withdrawal is OPEN, and is never the thing that closes first',
    !(await page
      .getByRole('button', { name: /^Withdraw/ })
      .last()
      .isDisabled()),
    'if Maren ever closes entries, exits are the last thing to go',
  );

  /**
   * REPAY, ON AN ACCOUNT THAT NOW OWES SOMETHING.
   *
   * This used to assert the refusal on a debt-free account: "Nothing to repay", button
   * disabled. The account has since drawn 25.73 MUSD against its 0.001 BTC, so that
   * assertion would now be demanding a refusal the contract would not give, and it would
   * have failed for the right reason and been "fixed" for the wrong one.
   *
   * What is asserted instead is the promise that does not depend on the balance: an exit
   * is always reachable, and the ERC-20 approval it needs is shown as its own transaction
   * rather than folded into the repay, where only one of the two wallet prompts would ever
   * get a receipt read.
   */
  await page.getByRole('tab', { name: 'Repay' }).click();
  await page.locator('input[inputmode=decimal]').first().waitFor({ state: 'visible' });
  await page.locator('input[inputmode=decimal]').first().fill('1');
  const repayPanel = await textReady(page, /allowance|Repay 1\.00 MUSD/i);
  const repayReachable = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(
      (b) => /^(Repay|Approve) /.test(b.textContent ?? '') && !b.disabled,
    ),
  );
  check(
    'preflight: an exit is reachable for an account that owes MUSD and holds MUSD',
    repayReachable,
    'repay is never paused and never gated on the oracle',
  );
  check(
    'preflight: the allowance repay needs is its own step, not slipped in behind the repay',
    /allowance/i.test(repayPanel) ||
      !(await page
        .getByRole('button', { name: /^Repay/ })
        .last()
        .isDisabled()),
    'approval stated, or already granted and the repay offered',
  );

  // The confirmation sheet, reached through the one vault action that IS available.
  await page.getByRole('tab', { name: 'Deposit' }).click();
  await page.locator('input[inputmode=decimal]').first().waitFor({ state: 'visible' });
  await page.locator('input[inputmode=decimal]').first().fill('0.001');

  /**
   * THE ROUTE DECISION IS ON SCREEN, WITH BOTH OPTIONS AND A STATED RECOMMENDATION.
   *
   * The app has always routed by collateral. It used to do it silently and report the
   * result in a row reading "Route after: Pooled", which is a decision disclosed as a
   * side effect. Both routes now appear before the amount field with the live threshold
   * that separates them.
   */
  const depositPanel = await textReady(page, /Your own trove/);
  const recommendedTags = await page.evaluate(
    () =>
      [...document.querySelectorAll('main span')].filter(
        (el) => el.textContent.trim() === 'Recommended',
      ).length,
  );
  check(
    'deposit: both routes are presented, with the threshold that separates them',
    /Your own trove/.test(depositPanel) &&
      /The social vault/.test(depositPanel) &&
      /from[\s\S]{0,12}0\.001 BTC/.test(depositPanel),
    'directTroveThreshold() and MarenVault.MIN_DEPOSIT, side by side',
  );
  check(
    'deposit: exactly one route is recommended, so the routing is visible rather than silent',
    recommendedTags === 1,
    `${recommendedTags} recommendations on screen`,
  );
  check(
    'deposit: the recommendation is a sentence with this account’s own figures in it',
    /short of a trove of your own|past the [\d.]+ BTC a trove of your own needs/.test(depositPanel),
    'stated, not implied by a tag',
  );

  /**
   * AND IT MUST NOT PROMISE A ROUTE THE BUTTON DOES NOT TAKE. `MarenVault.deposit()` has
   * no branch that opens a trove of your own; every deposit is pooled, whatever the
   * collateral afterwards would qualify for. The old row said "Route after: Direct trove"
   * for a deposit that went into the vault like every other one.
   */
  check(
    'deposit: names the destination the contract actually takes, on every route',
    /Where it goes/.test(depositPanel) &&
      /The social vault/.test(depositPanel) &&
      !/Route after/.test(depositPanel),
    'MarenVault.deposit() always pools',
  );

  /**
   * THE GAS CLAIM, CHECKED WHERE IT IS NOW MADE. These three moved here from the
   * portfolio, which no longer carries a gas panel. A deposit is payable and
   * MarenRelayHub reverts on any request carrying value, so it can never be sponsored.
   */
  check('vault: gas copy never promises "no gas, ever"', !/no gas,? ever/i.test(depositPanel));
  check(
    'vault: gas copy states that a deposit costs gas and always will',
    /deposit costs Bitcoin gas and always will/i.test(depositPanel),
    'deposit is payable, therefore never relayable',
  );
  check(
    'vault: gas copy does not claim Maren pays, while no relayer is deployed',
    !/Maren pays the Bitcoin (network )?(gas|fee)/i.test(depositPanel),
    'RELAYER_AVAILABLE is false',
  );

  await domReady(page, () =>
    [...document.querySelectorAll('button')].some(
      (b) => /^Deposit/.test(b.textContent ?? '') && !b.disabled,
    ),
  );
  await page
    .locator('main')
    .getByRole('button', { name: /^Deposit/ })
    .last()
    .click();
  const sheet = page.locator('[role=dialog]');
  await sheet.waitFor({ state: 'visible', timeout: 15_000 });
  await domReady(page, () => {
    const d = document.querySelector('[role=dialog]');
    return Boolean(d) && d.getAttribute('data-tx-phase') === 'confirm';
  });
  check(
    'sheet: an available action opens a confirmation, and it is a labelled modal dialog',
    (await sheet.getAttribute('aria-modal')) === 'true' &&
      (await sheet.getAttribute('data-tx-phase')) === 'confirm',
  );
  check(
    'sheet: the confirm state states who pays the gas, and does not claim it is free',
    /you pay the/i.test(await sheet.innerText()) && !/no gas/i.test(await sheet.innerText()),
  );
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  check('sheet: Escape closes it', (await page.locator('[role=dialog]').count()) === 0);
  check(
    'preflight: still no signature requested after opening and closing a sheet',
    wallet.signatureRequests.length === 0,
    JSON.stringify(wallet.signatureRequests),
  );

  /**
   * THE PORTFOLIO SAYS WHERE THE POSITION LIVES, IN THE PRODUCT'S OWN WORDS.
   *
   * This account's Bitcoin is in the social vault. The portfolio used to describe that as
   * a "pooled route" hint on a balance row and a "Pooled trove" tag on the capacity panel,
   * which are two pieces of internal vocabulary for the thing the product is built around.
   */
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' });
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));
  await textReady(page, /vault health/i);
  // Route and shared-custody risk are expert detail by design, one deliberate tap down.
  // Open that disclosure before asserting its contents instead of treating collapsed
  // details as absent from the product.
  await page.getByText('Position details', { exact: true }).click();
  const portfolioLive = await textReady(page, /the social vault/i);
  const vaultOnHome = await readVault();
  check(
    'portfolio: a position in the vault is framed as being in the social vault',
    /in the social vault/i.test(portfolioLive) && !/pooled route/i.test(portfolioLive),
    'no internal vocabulary on the surface',
  );
  check(
    'portfolio: it carries the vault’s health, and it is the contract’s figure',
    /vault health/i.test(portfolioLive) &&
      (vaultOnHome === null || ratioAgrees(portfolioLive, vaultOnHome.icr)),
    vaultOnHome === null ? 'vault unreadable' : `chain says ${vaultOnHome.icr}`,
  );
  check(
    'portfolio: the pooling risk follows the position onto the home screen',
    /accounting, not custody/i.test(portfolioLive) && /socialise losses/i.test(portfolioLive),
    'a disclosure that only exists on one screen is a disclosure that can be missed',
  );

  /**
   * --- Pay and Earn: what a wallet can do with the MUSD it holds -------------
   *
   * These two used to assert the refusal outright: this account held no MUSD, so Send and
   * Earn were closed and said why. It has since borrowed 25.73 MUSD against its collateral
   * and both are open, so a check that still demanded "No MUSD to send" would be asserting
   * something false about the chain.
   *
   * The balance is therefore read first and the assertion branches on it. What is being
   * tested is unchanged and is the invariant: a control is offered exactly when the wallet
   * can back it, and when it cannot, the refusal says where MUSD comes from.
   */
  const musdHeld = await readMusd(VIEW_ACCOUNT);
  const holdsMusd = musdHeld !== null && musdHeld > 0n;

  await page.goto(BASE + '/app/pay', { waitUntil: 'networkidle' });
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));
  const payLive = await textReady(page, holdsMusd ? /you pay the bitcoin gas/i : /No MUSD to send/);
  if (holdsMusd) {
    check(
      'preflight: Send is open for a wallet that holds MUSD, and still never calls it free',
      !/No MUSD to send/.test(payLive) && !/no gas/i.test(payLive),
      `wallet holds ${musdHeld} wei of MUSD`,
    );
  } else {
    check(
      'preflight: Send is disabled with a plain reason when the wallet holds no MUSD',
      /No MUSD to send/.test(payLive) &&
        (await page.getByRole('button', { name: /^Send/ }).last().isDisabled()),
    );
    check(
      'preflight: that reason explains where MUSD comes from rather than stopping at "no"',
      /borrowing against Bitcoin in the Vault/.test(payLive),
    );
  }

  await page.goto(BASE + '/app/earn', { waitUntil: 'networkidle' });
  await connectWallet(page);
  await domReady(page, () => document.querySelector('header button[aria-haspopup="menu"] .mono'));
  const earnLive = await textReady(
    page,
    holdsMusd ? /does not display an APY/i : /No MUSD to deposit/,
  );
  check(
    holdsMusd
      ? 'preflight: Earn is open for a wallet that holds MUSD, and quotes no forward rate for it'
      : 'preflight: Earn deposits are disabled with a plain reason on an empty wallet',
    holdsMusd
      ? !/No MUSD to deposit/.test(earnLive) && !/\d[\d.,]*\s*%\s*(apy|apr)/i.test(earnLive)
      : /No MUSD to deposit/.test(earnLive) &&
          (await page
            .getByRole('button', { name: /^Deposit into Earn/ })
            .last()
            .isDisabled()),
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
  await textReady(page, /the social vault/i);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check('app reduced-motion: no shader canvas mounted', canvases === 0, `canvases=${canvases}`);
  // With no wallet there is no position-health card; the card that must survive
  // `prefers-reduced-motion` is the one a disconnected visitor actually gets.
  const panelVisible = await page.locator('text=The social vault').count();
  check('app reduced-motion: the protocol panel still renders', panelVisible > 0);
  await ctx.close();
}

// ---- 6. no horizontal overflow at the narrow end --------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const path of ['/app', '/app/vault', '/app/pay', '/app/earn', '/app/activity']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await domReady(page, () => document.querySelector('main') !== null);
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
