/**
 * The walkthrough.
 *
 * THIS IS THE FILE THAT GOES STALE. Everything else in tools/demo is about producing a
 * video at all — booting the app, getting a GPU, drawing a cursor, muxing the result. This
 * file is about what the video *shows*, and it is coupled to the current markup: heading
 * text, tab labels, the copy inside a disabled control. When the UI changes, this is what
 * breaks, and it should break loudly rather than quietly filming the wrong thing.
 *
 * Two rules govern every scene below.
 *
 * FILM WHAT IS THERE. No scene fabricates state, stubs a response, or skips a screen it
 * finds unflattering. The Vault scene is the clearest case: Maren's pooled trove is
 * genuinely under its own 180% floor right now, so the borrow control is genuinely refused.
 * A demo that hid that would be showing a product that does not exist. A reviewer watching
 * an app decline an action it cannot safely perform learns more about the engineering than
 * any successful click could tell them.
 *
 * SAY WHAT WAS FILMED. Every scene returns the strings it actually read off the screen.
 * The run log is then a record of the take — which figures were live, which were empty —
 * so the video can be checked against reality without scrubbing through it frame by frame.
 */

import { BEATS, sleep, settle, scrollTo, scrollToSelector, centre, reveal } from './pacing.mjs';

const BASE_PATHS = {
  landing: '/',
  portfolio: '/app',
  vault: '/app/vault',
  pay: '/app/pay',
  earn: '/app/earn',
  activity: '/app/activity',
};

/**
 * Navigate by clicking where a person would click, and fall back to a direct visit.
 *
 * Clicking the real nav is worth the fragility: it shows the app's own navigation working,
 * and it keeps the single-page transitions in shot. But a demo that dies because a nav
 * label was reworded is a bad trade, so a missing link degrades to `page.goto` and says so.
 */
async function navigate(ctx, { linkName, path, label }) {
  const { page, pointer, log } = ctx;
  const link = page.getByRole('link', { name: linkName }).first();
  if ((await link.count()) > 0 && (await link.isVisible().catch(() => false))) {
    await pointer.click(link);
  } else {
    log(`  ! no visible nav link matching ${linkName} — navigating directly`);
    await page.goto(`${ctx.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForURL(`**${path}`, { timeout: 15_000 }).catch(() => {});
  await sleep(BEATS.react);
  await settle(page, { log });
  log(`→ ${label}`);
}

/* ── 1. Landing ─────────────────────────────────────────────────────────────────────── */

/**
 * The hero, held long enough for the shader to be seen moving.
 *
 * The opening shot is static in composition and moving in texture, which is the only moment
 * in the video where doing nothing is the right call: cutting away early from a WebGL hero
 * makes it look like a still image.
 */
async function sceneHero(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await page.goto(`${ctx.baseUrl}${BASE_PATHS.landing}`, { waitUntil: 'networkidle' });
  // The shader mounts on an effect after hydration; starting the pan before it paints
  // would open the video on a flat background.
  await page.waitForSelector('canvas', { timeout: 15_000 });
  await sleep(1_200);

  seen.headline = await reveal(page, page.locator('#hero-title'), { hold: BEATS.dwell, log });
  log(`  hero: ${seen.headline}`);

  // A slow drift across the hero. The pointer is not clicking anything here; it exists so
  // the frame has a subject that moves with intent while the headline is read.
  await pointer.moveTo(1_180, 620, { duration: 2_200 });
  await sleep(BEATS.glance);

  seen.stats = await reveal(page, page.locator('#hero-stats, header + * .num').first(), {
    hold: BEATS.glance,
    log,
  });

  return seen;
}

/**
 * The problem section: what Mezo's minimum actually costs, in three figures.
 *
 * These numbers are the argument. They are read off the page rather than hardcoded here so
 * that the run log reports the values the camera saw — if the copy is updated to a fresher
 * trove count, the log shows the new one instead of silently disagreeing with the video.
 */
async function sceneProblem(ctx) {
  const { page, log } = ctx;
  const seen = {};

  await scrollToSelector(page, '#problem', { duration: 2_000 });
  await sleep(BEATS.read);

  const stats = page.locator('#problem .num');
  const count = await stats.count();
  seen.stats = [];
  for (let i = 0; i < Math.min(count, 4); i += 1) {
    const text = (await stats.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    seen.stats.push(text);
  }
  log(`  problem stats: ${seen.stats.join(' | ')}`);

  // Walk down the section rather than jumping, so the three figures arrive in sequence
  // instead of all at once.
  await scrollTo(page, await page.evaluate(() => window.scrollY + 320), { duration: 1_500 });
  await sleep(BEATS.dwell);

  return seen;
}

/**
 * The drawn-to-scale bar. This is the thesis, so it is the longest hold in the video.
 *
 * The violet bar is 1.27% of the grey one: Maren's floor against Mezo's minimum, at true
 * proportion rather than as an icon. Everything else in the walkthrough is a consequence of
 * this picture, and a viewer who misses it has missed the product.
 */
async function sceneScaleBar(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  const caption = page.getByText(/is 1\.27% of the grey one/i).first();
  if ((await caption.count()) === 0) {
    log('  ! the drawn-to-scale bar is gone from the landing page — skipping the thesis shot');
    return { missing: true };
  }

  const bar = page.getByText(/Minimum to open/i).first();
  await centre(page, bar, { duration: 2_000, bias: 0.3 });
  await settle(page, { log });
  await sleep(BEATS.read);

  // Trace the two bars with the cursor: the long grey one, then the short violet one. The
  // travel between them is the comparison, and it is worth spending two seconds on.
  const mezoRow = page.getByText('Mezo trove minimum').first();
  const marenRow = page.getByText('Maren pooled floor').first();
  if ((await mezoRow.count()) > 0) {
    await pointer.moveToElement(mezoRow, { duration: 900, settle: 0 });
    seen.mezo = (await mezoRow.locator('..').innerText()).replace(/\s+/g, ' ').trim();
    await sleep(BEATS.read);
  }
  if ((await marenRow.count()) > 0) {
    await pointer.moveToElement(marenRow, { duration: 1_100, settle: 0 });
    seen.maren = (await marenRow.locator('..').innerText()).replace(/\s+/g, ' ').trim();
    await sleep(BEATS.read);
  }

  seen.caption = await reveal(page, caption, { hold: BEATS.dwell, log });
  log(`  scale bar: ${seen.mezo ?? '?'} vs ${seen.maren ?? '?'}`);
  log(`  caption: ${seen.caption}`);

  return seen;
}

/* ── 2. Launch and connect ──────────────────────────────────────────────────────────── */

/**
 * Launch the app and connect the injected signer.
 *
 * The wallet is a real EIP-1193 provider backed by a real private key (see
 * apps/web/scripts/injected-wallet.mjs) — reads go to Mezo, writes are signed in Node. The
 * connect menu is clicked with the visible pointer rather than Playwright's direct
 * `.click()`, so the viewer can see the choice being made.
 */
async function sceneConnect(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  const launch = page.getByRole('link', { name: /Launch App/i }).first();
  await centre(page, launch, { duration: 1_200, bias: 0.45 }).catch(() => {});
  await pointer.click(launch);
  await page.waitForURL('**/app', { timeout: 20_000 }).catch(() => {});
  await sleep(BEATS.transition);

  const connect = page.getByRole('button', { name: /Connect wallet/i }).first();
  if ((await connect.count()) === 0) {
    log('  wallet reconnected on its own — no connect button to click');
  } else {
    await pointer.click(connect, { after: BEATS.react });
    const option = page.getByRole('menuitem').first();
    await option.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
    if (await option.isVisible().catch(() => false)) {
      // Long enough for the menu to be read before it is dismissed by the choice.
      await sleep(BEATS.glance);
      await pointer.click(option);
    }
  }

  await sleep(2_400);
  await settle(page, { log });

  const pill = page.locator('header .num').first();
  seen.account = (await pill.count()) > 0 ? await pill.innerText() : null;
  log(`  connected as: ${seen.account ?? 'NOT CONNECTED'}`);
  if (!seen.account) log('  ! the walkthrough continues, but every app screen will be the anon state');

  return seen;
}

/* ── 3-7. The app ───────────────────────────────────────────────────────────────────── */

/** Portfolio: position health, collateral ratio, borrow capacity. */
async function scenePortfolio(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await settle(page, { log });
  await sleep(BEATS.read);

  const heading = page.locator('main h1').first();
  seen.heading = await reveal(page, heading, { hold: BEATS.glance, log });

  // The health card is the one thing on this screen a viewer must actually look at, so the
  // pointer goes to it and stays.
  const health = page.getByText(/Position health|Collateral ratio/i).first();
  if ((await health.count()) > 0) {
    await pointer.moveToElement(health, { duration: 1_000, settle: 0 });
    await sleep(BEATS.dwell);
  }

  const metrics = page.locator('main .num');
  const n = await metrics.count();
  seen.metrics = [];
  for (let i = 0; i < Math.min(n, 8); i += 1) {
    const t = (await metrics.nth(i).innerText()).replace(/\s+/g, ' ').trim();
    if (t) seen.metrics.push(t);
  }
  log(`  portfolio: ${seen.heading} — ${seen.metrics.join(' | ')}`);

  await scrollTo(page, 420, { duration: 1_400 });
  await sleep(BEATS.read);

  return seen;
}

/**
 * Vault: the position, and the borrow control refusing to act.
 *
 * The refusal is the point of this scene. Maren's shared trove sits under the 180%
 * collateral floor the vault enforces on itself, so new borrowing would revert on chain —
 * and the UI says exactly that instead of letting someone submit a transaction that cannot
 * succeed. We open the Borrow tab, hold on whichever gate is rendered, and read its reason
 * into the log verbatim.
 *
 * Which gate appears depends on the connected wallet: a wallet with collateral gets the
 * disabled slider and its cap; a wallet with none gets "deposit first". Both are true
 * screens and neither is staged, so the scene films whichever one it finds.
 */
async function sceneVault(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Vault/i, path: '/app/vault', label: 'Vault' });
  await sleep(BEATS.read);

  const borrowTab = page.getByRole('tab', { name: /^Borrow/i }).first();
  if ((await borrowTab.count()) > 0) {
    await pointer.click(borrowTab, { after: BEATS.react });
    await settle(page, { log });
    await sleep(BEATS.read);
  } else {
    log('  ! no Borrow tab found');
  }

  // Every reason the app might give for not letting someone borrow, in the order we would
  // rather film them. The first one present is the shot.
  const reasons = [
    page.getByText(/under the 180% floor/i).first(),
    page.getByText(/Capped by Maren.s 180% floor/i).first(),
    page.getByText(/New borrowing reverts/i).first(),
    page.getByText(/Deposit first/i).first(),
  ];

  for (const reason of reasons) {
    if ((await reason.count()) === 0) continue;
    await centre(page, reason, { duration: 1_100, bias: 0.42 });
    await pointer.moveToElement(reason, { duration: 900, settle: 0 }).catch(() => {});
    seen.reason = await reveal(page, reason, { hold: BEATS.dwell + 900, log });
    log(`  borrow refused: ${seen.reason}`);
    break;
  }
  if (!seen.reason) log('  ! no borrow-gate reason on screen — the 180% floor may have cleared');

  // The disabled control itself, so the video shows the button as well as the sentence.
  const submit = page.getByRole('button', { name: /^Borrow/i }).last();
  if ((await submit.count()) > 0) {
    seen.borrowDisabled = await submit.isDisabled().catch(() => null);
    log(`  borrow button disabled: ${seen.borrowDisabled}`);
    if (seen.borrowDisabled) {
      await pointer.moveToElement(submit, { duration: 900, settle: 0 }).catch(() => {});
      await sleep(BEATS.read);
    }
  }

  // The pooled trove's live figures — the reason behind the reason.
  const ratio = page.getByText(/TROVE RATIO/i).first();
  if ((await ratio.count()) > 0) {
    await centre(page, ratio, { duration: 1_200, bias: 0.4 });
    seen.trove = (await ratio.locator('..').innerText()).replace(/\s+/g, ' ').trim();
    log(`  trove: ${seen.trove}`);
    await sleep(BEATS.dwell);
  }

  return seen;
}

/** Pay: the send form, and a handle resolving to an address. */
async function scenePay(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Pay/i, path: '/app/pay', label: 'Pay' });
  await sleep(BEATS.read);

  const handleTab = page.getByRole('tab', { name: /Handle/i }).first();
  if ((await handleTab.count()) > 0) {
    await pointer.click(handleTab, { after: BEATS.react });
    await sleep(BEATS.glance);
  }

  const field = page
    .locator('input[placeholder*="@"], input[name="to"], input[type="text"]')
    .first();
  if ((await field.count()) > 0) {
    await pointer.moveToElement(field, { duration: 900, settle: 220 });
    await page.mouse.down();
    await page.mouse.up();
    // Typed a character at a time. A field that fills instantly reads as a scripted stub;
    // watching the handle arrive letter by letter is what makes the resolution legible.
    await field.pressSequentially(ctx.handle, { delay: 110 });
    seen.typed = ctx.handle;
    log(`  typed handle: ${ctx.handle}`);
    // Resolution is an on-chain read; give it room and then hold on the answer.
    await sleep(BEATS.dwell);
    await settle(page, { log });
  } else {
    log('  ! no recipient field found on Pay');
  }

  const resolved = page.getByText(/0x[a-fA-F0-9]{4}/).first();
  if ((await resolved.count()) > 0) {
    seen.resolved = await reveal(page, resolved, { hold: BEATS.read, log });
    log(`  resolved to: ${seen.resolved}`);
  } else {
    const unresolved = page.getByText(/not registered|no such handle|couldn.t find/i).first();
    if ((await unresolved.count()) > 0) {
      seen.resolved = await reveal(page, unresolved, { hold: BEATS.read, log });
      log(`  handle did not resolve: ${seen.resolved}`);
    }
  }

  // The amount field, filled but never submitted. The walkthrough does not spend anything.
  const amount = page.locator('input[inputmode="decimal"]').first();
  if ((await amount.count()) > 0) {
    await pointer.moveToElement(amount, { duration: 800, settle: 200 });
    await page.mouse.down();
    await page.mouse.up();
    await amount.pressSequentially('25', { delay: 180 });
    await sleep(BEATS.dwell);
    seen.amount = '25';
  }

  return seen;
}

/**
 * Earn: trailing yield, and the deliberate absence of a forward APY.
 *
 * The empty space where a projected rate would sit is the interesting part of this screen.
 * Maren shows what the vault has actually paid and refuses to advertise what it might pay,
 * so the scene holds on that refusal rather than treating it as a gap to scroll past.
 */
async function sceneEarn(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Earn/i, path: '/app/earn', label: 'Earn' });
  await settle(page, { log });
  await sleep(BEATS.read);

  const trailing = page.getByText(/trailing|realised|realized|has paid/i).first();
  if ((await trailing.count()) > 0) {
    await centre(page, trailing, { duration: 1_100, bias: 0.4 });
    await pointer.moveToElement(trailing, { duration: 900, settle: 0 }).catch(() => {});
    seen.trailing = await reveal(page, trailing, { hold: BEATS.dwell, log });
    log(`  trailing yield: ${seen.trailing}`);
  }

  const noForward = page.getByText(/forward|making it up|do not project|projected/i).first();
  if ((await noForward.count()) > 0) {
    await centre(page, noForward, { duration: 1_000, bias: 0.42 });
    seen.noForward = await reveal(page, noForward, { hold: BEATS.dwell, log });
    log(`  no forward rate: ${seen.noForward}`);
  }

  return seen;
}

/** Activity: real history, ending on the explorer link. */
async function sceneActivity(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Activity/i, path: '/app/activity', label: 'Activity' });
  // The activity feed scans logs in ranged chunks; this is genuinely several round trips to
  // Mezo and is the slowest read in the app.
  await sleep(6_000);
  await settle(page, { log });
  await sleep(BEATS.read);

  const rows = page.locator('main li, main tbody tr');
  seen.rowCount = await rows.count();
  log(`  activity rows: ${seen.rowCount}`);

  if (seen.rowCount > 0) {
    await pointer.moveToElement(rows.first(), { duration: 1_000, settle: 0 }).catch(() => {});
    seen.firstRow = (await rows.first().innerText()).replace(/\s+/g, ' ').trim();
    log(`  first row: ${seen.firstRow}`);
    await sleep(BEATS.dwell);
    await scrollTo(page, 300, { duration: 1_300 });
    await sleep(BEATS.read);
  } else {
    // An empty feed is a real screen and gets the same hold as a full one.
    const empty = page.getByText(/nothing here|no activity|no transactions/i).first();
    if ((await empty.count()) > 0) {
      seen.empty = await reveal(page, empty, { hold: BEATS.dwell, log });
      log(`  activity is empty: ${seen.empty}`);
    }
  }

  // The closing shot: the link out to the explorer, where every figure in this video can be
  // checked by hand.
  const explorer = page
    .getByRole('link', { name: /explorer|blockscout|view on/i })
    .first();
  if ((await explorer.count()) > 0) {
    await centre(page, explorer, { duration: 1_100, bias: 0.45 }).catch(() => {});
    await pointer.moveToElement(explorer, { duration: 1_200, settle: 0 });
    seen.explorer = await explorer.getAttribute('href');
    log(`  explorer link: ${seen.explorer}`);
    // Hold on the hover state. This is the last frame of the walkthrough.
    await sleep(BEATS.dwell + 800);
  } else {
    log('  ! no explorer link found for the closing shot');
    await sleep(BEATS.read);
  }

  return seen;
}

/** The running order. Exported so `record.mjs` can filter it with --only. */
export const SCENES = [
  { id: 'hero', title: 'Landing — hero', run: sceneHero },
  { id: 'problem', title: 'Landing — the problem', run: sceneProblem },
  { id: 'scale', title: 'Landing — drawn to scale', run: sceneScaleBar },
  { id: 'connect', title: 'Launch app and connect', run: sceneConnect },
  { id: 'portfolio', title: 'Portfolio', run: scenePortfolio },
  { id: 'vault', title: 'Vault — borrowing refused', run: sceneVault },
  { id: 'pay', title: 'Pay', run: scenePay },
  { id: 'earn', title: 'Earn', run: sceneEarn },
  { id: 'activity', title: 'Activity', run: sceneActivity },
];
