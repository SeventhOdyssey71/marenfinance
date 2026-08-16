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

/**
 * One dial for the whole video.
 *
 * The beats below are in proportion to each other, and that proportion is the editorial
 * decision: a dwell is three times a glance because the shots it marks are worth three
 * times the attention. Total length is a separate question, and it moves for reasons that
 * have nothing to do with editing — a slower RPC day adds seconds to every screen. So the
 * ratios live in BEATS and the length lives here, and a take that comes in long is fixed by
 * changing one number rather than by re-balancing nine scenes against each other.
 *
 * The default is tuned against measured takes rather than chosen by feel: at 1.0 the
 * walkthrough ran 152 seconds against the 90-120 the narration is written to. Re-tune by
 * running and reading the duration off the take, never by arithmetic here — every scene also
 * waits on real RPC, and matsnet is not a metronome.
 *
 * Set DEMO_PACE=1.0 for a slower read, 0.5 for a tighter one.
 */
const PACE = Number(process.env.DEMO_PACE ?? 0.6);

const beat = (ms) => Math.round(ms * PACE);

export const BEATS = {
  /** After a click, before anything else is asserted. Lets a transition finish. */
  react: beat(700),
  /** Reading a label, a chip, a single number. */
  glance: beat(1_400),
  /** Reading a card: a heading plus two or three figures. */
  read: beat(2_600),
  /** The shots the whole demo exists for. Hold longer than feels comfortable. */
  dwell: beat(4_200),
  /** Between one screen and the next. */
  transition: beat(1_100),
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
export async function settle(page, { timeout = 20_000, log } = {}) {
  const deadline = Date.now() + timeout;
  let last = 'nothing';

  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const body = document.querySelector('main')?.innerText ?? '';
      return {
        reading: /Reading the price feed\./.test(body),
        // A failed oracle read, not a pending one. Every figure downstream of it renders as
        // an em dash, so a screen in this state looks like a broken dashboard on camera. It
        // usually clears on a retry, and it is emphatically not something to film.
        deadOracle: /No usable oracle observation\./.test(body),
        // wagmi mid-handshake. Filmed, this is the take where the whole app appears signed
        // out; it is also what kills the reads above, so it has to gate the camera too.
        connecting: /Connecting…|Connecting\.\.\./.test(
          document.querySelector('header')?.innerText ?? '',
        ),
      };
    });

    if (!state.reading && !state.deadOracle && !state.connecting) {
      // One more frame, so the number that replaced the placeholder has actually painted
      // before the caller starts its dwell.
      await sleep(400);
      return true;
    }
    last = state.connecting
      ? 'the header still says Connecting'
      : state.deadOracle
        ? 'the oracle read came back empty'
        : 'the price feed is still loading';
    await sleep(250);
  }

  log?.(`  ! ${last} after ${timeout}ms — filming it as it is`);
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
