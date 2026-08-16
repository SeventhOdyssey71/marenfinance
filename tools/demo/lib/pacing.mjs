/**
 * Timing, scrolling, and the rule that nothing is filmed while it is still loading.
 *
 * A walkthrough recorded at the speed a machine can click is unwatchable. Every duration in
 * this file is deliberately longer than it needs to be for correctness, because the
 * constraint is not "did the click land" but "could a person following along have read the
 * screen before it changed". The house numbers are in BEATS below; scenes reference those
 * rather than inventing their own, so the whole video shares one sense of rhythm.
 *
 * The other job here is `settle()`. Maren reads every figure it shows from Mezo over JSON
 * RPC, so there is a window after each navigation where the layout is final but the numbers
 * are not. Filming that window produces the single worst demo artefact: a confident-looking
 * dashboard full of placeholders. `settle()` blocks until the page stops saying it is
 * reading, so the camera only ever dwells on values that arrived.
 */

export const BEATS = {
  /** After a click, before anything else is asserted. Lets a transition finish. */
  react: 700,
  /** Reading a label, a chip, a single number. */
  glance: 1_400,
  /** Reading a card: a heading plus two or three figures. */
  read: 2_600,
  /** The shots the whole demo exists for. Hold longer than feels comfortable. */
  dwell: 4_200,
  /** Between one screen and the next. */
  transition: 1_100,
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scroll with our own easing.
 *
 * `globals.css` sets `html { scroll-behavior: smooth }` for anchor links. Left alone, a
 * programmatic `scrollTo` becomes asynchronous and un-awaitable, so the recording drifts
 * out of sync with the script and lands mid-travel. The init script in `record.mjs` forces
 * `scroll-behavior: auto`, and this function supplies the easing instead — which means the
 * pace is ours to choose rather than Chromium's.
 */
export async function scrollTo(page, y, { duration = 1_400 } = {}) {
  await page.evaluate(
    ([targetY, ms]) =>
      new Promise((resolve) => {
        const startY = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const endY = Math.max(0, Math.min(targetY, max));
        const delta = endY - startY;
        if (Math.abs(delta) < 1 || ms <= 0) {
          window.scrollTo(0, endY);
          resolve();
          return;
        }
        const start = performance.now();
        // Ease in-out cubic: the page accelerates away and decelerates into place, which
        // reads as intent. Linear scrolling reads as a machine.
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const t = Math.min(1, (now - start) / ms);
          window.scrollTo(0, startY + delta * ease(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [y, duration],
  );
}

/** Bring a section to just under the sticky header, at a readable speed. */
export async function scrollToSelector(page, selector, { offset = 96, duration = 1_600 } = {}) {
  const y = await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return el.getBoundingClientRect().top + window.scrollY - off;
    },
    [selector, offset],
  );
  if (y === null) throw new Error(`nothing matches ${selector}`);
  await scrollTo(page, y, { duration });
}

/** Centre an element in the viewport, so the pause has the subject in the middle third. */
export async function centre(page, locator, { duration = 1_200, bias = 0.38 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const y = await locator.evaluate(
    (el, b) =>
      el.getBoundingClientRect().top +
      window.scrollY -
      window.innerHeight * b +
      el.getBoundingClientRect().height / 2,
    bias,
  );
  await scrollTo(page, y, { duration });
}

/**
 * Wait until the page is done reading the chain.
 *
 * `PriceBanner` renders the literal string "Reading the price feed." while the oracle read
 * is in flight, and the vault gate reuses it. It is the app's own honest loading state, so
 * it is also the most reliable signal that a figure on screen is not final yet.
 *
 * A timeout here is not fatal. Mezo's public RPC is genuinely slow sometimes, and a slow
 * read is a true thing about the product; the run continues and the caller's dwell still
 * applies. What we refuse to do is *not wait at all*.
 */
export async function settle(page, { timeout = 12_000, log } = {}) {
  const loading = page.getByText('Reading the price feed.');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await loading.count()) === 0) {
      // One more frame after the text disappears, so the number that replaced it has
      // actually painted before the caller starts its dwell.
      await sleep(400);
      return true;
    }
    await sleep(200);
  }
  log?.(`  ! still reading the price feed after ${timeout}ms — filming it as it is`);
  return false;
}

/**
 * Wait for a value to exist, then hold on it.
 *
 * Returns the text that was found so the run log can record what the camera actually saw.
 * That log is the difference between "the take is fine" and "the take is fine, and here is
 * every figure that was on screen when it was shot".
 */
export async function reveal(page, locator, { hold = BEATS.read, timeout = 15_000, log } = {}) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
  } catch {
    log?.(`  ! never appeared: ${locator}`);
    return null;
  }
  const text = (await locator.first().innerText()).replace(/\s+/g, ' ').trim();
  await sleep(hold);
  return text;
}
