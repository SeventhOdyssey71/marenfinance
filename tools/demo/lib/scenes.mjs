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
  const { page, pointer, log } = ctx;
  const seen = {};

  await scrollToSelector(page, '#problem', { duration: 2_000 });
  await sleep(BEATS.read);

  // `.num` is the unit span ("MUSD", "troves", "BTC"), not the figure beside it, so reading
  // it alone reports a list of units and no numbers. The whole section is pulled instead and
  // the three figures recovered from it — which also means the log records the copy as
  // written rather than a guess at which element holds it.
  const section = (await page.locator('#problem').innerText()).replace(/\s+/g, ' ');
  seen.stats = [
    section.match(/([\d,]+)\s*MUSD/)?.[0],
    section.match(/(\d+)\s*troves/)?.[0],
    section.match(/([\d.]+)\s*BTC/)?.[0],
  ].filter(Boolean);
  log(`  problem stats: ${seen.stats.join(' | ')}`);

  // Walk down the section rather than jumping, so the figures arrive in sequence instead of
  // all at once. Two stops, not three: the third is the same argument as the scale bar in
  // the next scene, and making it twice costs eight seconds to say one thing.
  for (const stat of ['1,800', '26']) {
    const target = page.locator('#problem').getByText(stat, { exact: false }).first();
    if ((await target.count()) === 0) continue;
    await centre(page, target, { duration: 1_000, bias: 0.42 }).catch(() => {});
    await pointer.moveToElement(target, { duration: 700, settle: 0 }).catch(() => {});
    await sleep(BEATS.read);
  }

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
 * Launch the app and connect the wallet.
 *
 * THE AUTO-RECONNECT PROBLEM. wagmi's injected connector discovers our EIP-6963 provider the
 * moment the page loads and connects to it without being asked, exactly as a real unlocked
 * wallet would on a return visit. Correct behaviour, and it means the app arrives at
 * /app already connected and the connect flow never happens on camera.
 *
 * So the scene signs out first, through the app's own account menu, and connects again from
 * there. Nothing is faked: it is the product's real Disconnect button followed by its real
 * connect menu, and the disconnected screen in between is the one every first-time visitor
 * actually sees. The alternative — asserting a connect step the viewer never watched — would
 * be narrating over an event that did not occur.
 */
async function sceneConnect(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  const launch = page.getByRole('link', { name: /Launch App/i }).first();
  await centre(page, launch, { duration: 1_200, bias: 0.45 }).catch(() => {});
  await pointer.click(launch);
  await page.waitForURL('**/app', { timeout: 20_000 }).catch(() => {});
  await sleep(BEATS.transition);

  // If the provider already connected itself, sign out so the connect can be filmed.
  const accountPill = page.locator('header button').filter({ hasText: /0x/ }).first();
  if ((await accountPill.count()) > 0) {
    await pointer.click(accountPill, { after: BEATS.react });
    const disconnect = page.getByRole('menuitem', { name: /Disconnect/i }).first();
    if (await disconnect.isVisible().catch(() => false)) {
      await sleep(BEATS.glance);
      await pointer.click(disconnect, { after: BEATS.react });
      log('  signed out first, so the connect flow happens on camera');
      await sleep(BEATS.glance);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  // The account pill is the app's own evidence that wagmi has an account. Everything below
  // waits on it rather than on a duration.
  const pill = page.locator('header .num').first();

  /**
   * One attempt at the connect menu.
   *
   * The connector is picked by name. `.first()` was not good enough: the menu is rebuilt on
   * every render and, mid-disconnect, the account menu's own Disconnect item can still be
   * the first `menuitem` in the tree — clicking it signs out again, which is precisely the
   * failure that produced a take of the entire app in its signed-out state.
   */
  const attemptConnect = async () => {
    const connect = page.getByRole('button', { name: /Connect wallet/i }).first();
    if ((await connect.count()) === 0) return false;

    await pointer.click(connect, { after: BEATS.react });

    const option = page
      .getByRole('menuitem')
      .filter({ hasNotText: /Disconnect/i })
      .first();
    if (!(await option.waitFor({ state: 'visible', timeout: 8_000 }).then(
      () => true,
      () => false,
    ))) {
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }

    // Long enough for the menu to be read before it is dismissed by the choice.
    await sleep(BEATS.glance);
    await pointer.click(option);

    return pill.waitFor({ state: 'visible', timeout: 12_000 }).then(
      () => true,
      () => false,
    );
  };

  // The disconnected screen is a real screen and worth a beat of its own: it is what a
  // first-time visitor sees, and it deliberately shows no sample position.
  await sleep(BEATS.read);

  // wagmi's reconnect is genuinely racy right after a disconnect — one take in three lost
  // it — and a lost connect invalidates every scene after this one. Retrying costs a few
  // seconds on a bad day and saves the whole run.
  let connected = false;
  for (let attempt = 1; attempt <= 3 && !connected; attempt += 1) {
    connected = await attemptConnect();
    if (!connected && attempt < 3) {
      log(`  connect attempt ${attempt} did not take — trying again`);
      await sleep(BEATS.glance);
    }
  }

  seen.account = connected ? (await pill.innerText()).replace(/\s+/g, ' ').trim() : null;

  await settle(page, { log });
  // A beat on the connected header before the Portfolio scene starts reading cards.
  await sleep(BEATS.glance);

  log(`  connected as: ${seen.account ?? 'NOT CONNECTED'}`);
  if (!seen.account) {
    // Loud, because every screen after this one is worth less. The take still completes:
    // the anon app is a real screen, and a run that stops has nothing to show at all.
    log('  ! CONNECT FAILED — every app screen below is the signed-out state.');
    log('  ! Do not ship this take. Re-run; if it repeats, the connect menu has changed.');
  }

  return seen;
}

/* ── 3-7. The app ───────────────────────────────────────────────────────────────────── */

/**
 * Portfolio: position health, collateral ratio, borrow capacity.
 *
 * Three cards, filmed in the order a person reads them — who am I, how safe am I, what can I
 * do. The collateral-ratio dial is the centrepiece: it renders the 180% floor and the 110%
 * liquidation threshold on the same scale as the position, so the distance between "where I
 * am" and "where I would be liquidated" is a length rather than a number to compute.
 */
async function scenePortfolio(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await settle(page, { log });
  await sleep(BEATS.read);

  const heading = page.locator('main h1').first();
  seen.heading = await reveal(page, heading, { hold: BEATS.glance, log });

  // The oracle price, with its own age. Every other figure on the screen derives from it.
  const price = page.getByText(/oracle updated/i).first();
  if ((await price.count()) > 0) {
    await pointer.moveToElement(price, { duration: 900, settle: 0 }).catch(() => {});
    seen.price = (await price.locator('..').innerText()).replace(/\s+/g, ' ').trim();
    log(`  price: ${seen.price}`);
    await sleep(BEATS.glance);
  }

  // Position health and the collateral-ratio dial.
  const health = page.getByText('Position health', { exact: false }).first();
  if ((await health.count()) > 0) {
    await centre(page, health, { duration: 1_200, bias: 0.34 });
    await pointer.moveToElement(health, { duration: 1_000, settle: 0 }).catch(() => {});
    seen.health = (await health.locator('..').innerText()).replace(/\s+/g, ' ').trim().slice(0, 160);
    log(`  health: ${seen.health}`);
    await sleep(BEATS.dwell);
  }

  // Borrowing capacity — the number the 180% floor is currently holding down.
  const capacity = page.getByText('Borrowing capacity', { exact: false }).first();
  if ((await capacity.count()) > 0) {
    await centre(page, capacity, { duration: 1_300, bias: 0.34 });
    await pointer.moveToElement(capacity, { duration: 900, settle: 0 }).catch(() => {});
    seen.capacity = (await capacity.locator('..').innerText()).replace(/\s+/g, ' ').trim().slice(0, 200);
    log(`  capacity: ${seen.capacity}`);
    await sleep(BEATS.dwell);
  }

  // The balances that back it are read into the log but not given a stop of their own: the
  // Vault scene is thirty seconds away and opens on the same 0.001 BTC, and a walkthrough
  // that shows the identical figure twice spends its two scarcest seconds saying nothing new.
  const balances = page.getByText('Bitcoin collateral', { exact: false }).first();
  if ((await balances.count()) > 0) {
    seen.collateral = (await balances.locator('..').innerText()).replace(/\s+/g, ' ').trim();
    log(`  collateral: ${seen.collateral}`);
  }

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
  //
  // These strings are not paraphrases. `describeRevert()` in lib/chain/errors.ts builds the
  // disabled control's explanation from the very arguments the contract would have reverted
  // with, so the sentence filmed here is character-for-character the sentence a user would
  // have read after paying gas for the revert. Matching on the app's own words is therefore
  // also an assertion that the app is still saying them.
  const reasons = [
    // The one that fires today: the pooled trove is under MIN_TROVE_CR.
    page.getByText(/The shared trove is too thin to lend against/i).first(),
    page.getByText(/the pool itself is fully drawn right now/i).first(),
    // Your position, rather than the pool's — a different fix, so a different sentence.
    page.getByText(/Not enough collateral behind this loan/i).first(),
    // The wallet has no collateral at all. True screen, thinner demo.
    page.getByText(/Nothing to borrow against/i).first(),
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

  // Stay on Send. `Pay` opens on it, and the other three tabs are different screens: Handle
  // is where you claim a name of your own, not where you spend. An earlier cut of this
  // walkthrough clicked Handle and filmed the registration form while the narration talked
  // about sending money, which is the exact class of mistake this file exists to avoid.
  const sendTab = page.getByRole('tab', { name: /^Send/i }).first();
  if ((await sendTab.count()) > 0 && (await sendTab.getAttribute('aria-selected')) !== 'true') {
    await pointer.click(sendTab, { after: BEATS.react });
  }

  // `#pay-to` and `#pay-to-status` are the app's own ids, and the status region is wired to
  // the input through aria-describedby — so pointing at it here films the same thing a
  // screen reader would announce.
  const field = page.locator('#pay-to');
  if ((await field.count()) > 0) {
    await centre(page, field, { duration: 1_000, bias: 0.4 }).catch(() => {});
    await pointer.moveToElement(field, { duration: 900, settle: 220 });
    await page.mouse.down();
    await page.mouse.up();
    // Typed a character at a time. A field that fills instantly reads as a scripted stub;
    // watching the handle arrive letter by letter is what makes the resolution legible.
    await field.pressSequentially(ctx.handle, { delay: 95 });
    seen.typed = ctx.handle;
    log(`  typed handle: ${ctx.handle}`);
  } else {
    log('  ! no #pay-to field on Pay — the send form has been restructured');
  }

  // Resolution is a real MarenRegistry lookup over RPC. Wait for the status line to stop
  // saying it is working rather than guessing a duration.
  const status = page.locator('#pay-to-status');
  if ((await status.count()) > 0) {
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#pay-to-status');
          return el ? !/Resolving handle/i.test(el.textContent ?? '') : false;
        },
        undefined,
        { timeout: 12_000 },
      )
      .catch(() => log('  ! the handle lookup did not settle in 12s — filming it as it is'));
    seen.resolved = await reveal(page, status, { hold: BEATS.dwell, log });
    log(`  resolution: ${seen.resolved}`);
  }

  // The amount field, filled but never submitted. The walkthrough does not spend anything —
  // and with the read-only provider it structurally cannot.
  const amount = page.locator('input[inputmode="decimal"]').first();
  if ((await amount.count()) > 0) {
    await pointer.moveToElement(amount, { duration: 800, settle: 200 });
    await page.mouse.down();
    await page.mouse.up();
    await amount.pressSequentially('25', { delay: 130 });
    seen.amount = '25';
    await sleep(BEATS.read);
  }

  return seen;
}

/**
 * Earn: what the pool has actually paid, and no rate anywhere.
 *
 * There is no APY on this screen. Not a small one, not a range, not a "historical" one with
 * an asterisk — the page does not contain the number, because Earn's yield is liquidation
 * gains and those can be zero for months. What it says instead is that returns are
 * irregular, and then it reports the realised figure, which for this account is nothing yet.
 *
 * So the honest shot is an empty result. `No return to report yet` is filmed and held for as
 * long as a populated card would have been. A demo that skipped to a wallet with gains would
 * be showing the same product with better luck, and this audience will check.
 */
async function sceneEarn(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Earn/i, path: '/app/earn', label: 'Earn' });
  await settle(page, { log });
  await sleep(BEATS.glance);

  // The framing sentence, which is the anti-APY in the app's own voice.
  const framing = page.getByText(/Returns come from liquidations, which are irregular/i).first();
  if ((await framing.count()) > 0) {
    seen.framing = await reveal(page, framing, { hold: BEATS.read, log });
    log(`  framing: ${seen.framing}`);
  }

  // Either the realised-yield card (an account with gains) or the empty state (this one).
  // Both are true; whichever is present gets the same hold.
  const result = page
    .getByText(/Realised over the last|No return to report yet/i)
    .first();
  if ((await result.count()) > 0) {
    await centre(page, result, { duration: 1_100, bias: 0.4 });
    await pointer.moveToElement(result, { duration: 900, settle: 0 }).catch(() => {});
    seen.result = await reveal(page, result, { hold: BEATS.dwell, log });
    log(`  earn result: ${seen.result}`);
  } else {
    log('  ! neither a realised figure nor the empty state is on Earn');
  }

  // Belt and braces: assert to the run log that no percentage rate is being advertised.
  // If a forward APY ever appears on this screen, the take should say so out loud.
  const body = await page.locator('main').innerText();
  const apy = body.match(/\b\d+(\.\d+)?\s*%\s*(APY|APR)/i);
  seen.advertisedRate = apy ? apy[0] : null;
  log(`  advertised rate on Earn: ${seen.advertisedRate ?? 'none — as designed'}`);

  return seen;
}

/** Activity: real history, ending on the explorer link. */
async function sceneActivity(ctx) {
  const { page, pointer, log } = ctx;
  const seen = {};

  await navigate(ctx, { linkName: /^Activity/i, path: '/app/activity', label: 'Activity' });
  // The activity feed scans logs in ranged chunks; this is genuinely several round trips to
  // Mezo and is the slowest read in the app.
  // Wait for the scan to finish rather than sleeping a guessed amount: the footnote naming
  // the block range is only rendered once the range has actually been read.
  await page
    .waitForSelector('text=/Read every block from|Read blocks/i', { timeout: 20_000 })
    .catch(() => log('  ! the log scan did not report a block range in 20s'));
  await settle(page, { log });
  await sleep(BEATS.glance);

  // A row is a transaction, and a transaction is the thing with a hash linking out to the
  // explorer. The obvious `main li` is wrong here: the only <li>s on this screen are the
  // bullets inside the collapsed "What these statuses mean" disclosure, so counting them
  // reports four rows on a screen showing one and reads an empty string off a hidden node.
  const rows = page.locator('main a[href*="/tx/"]');
  seen.rowCount = await rows.count();
  log(`  activity rows: ${seen.rowCount}`);

  if (seen.rowCount > 0) {
    // The row proper is the card around the link, which is where the title, the timestamp
    // and the amount live.
    const firstRow = rows.first().locator('xpath=ancestor::div[2]');
    await pointer.moveToElement(rows.first(), { duration: 1_000, settle: 0 }).catch(() => {});
    seen.firstRow = (await firstRow.innerText().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim();
    log(`  first row: ${seen.firstRow}`);
    await sleep(BEATS.dwell);
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
    .getByRole('link', { name: /open on|explorer|blockscout|view on/i })
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
