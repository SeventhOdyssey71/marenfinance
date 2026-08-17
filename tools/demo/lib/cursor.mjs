/**
 * A cursor the camera can see.
 *
 * Playwright's mouse is real — it dispatches genuine mouse events and the page responds to
 * hover exactly as it would for a person — but it is not part of the rendered page, so it
 * does not appear in a recording. A walkthrough where controls activate with no visible
 * cause is disorienting: the viewer cannot tell what was clicked, or that anything was.
 *
 * So we draw one. The overlay below is a passive listener: it renders wherever the real
 * pointer already is. It never moves the pointer and never synthesises an event, which
 * means the video shows the actual input the app received rather than a decorative sprite
 * animating alongside it. If Playwright clicks at (900, 512), the arrow is at (900, 512).
 *
 * The ripple on mousedown exists for the same reason — a click on an already-hovered
 * control is otherwise a zero-frame event, invisible at any frame rate.
 */

/** Installed via addInitScript so it survives every navigation in the walkthrough. */
function overlay() {
  const install = () => {
    if (document.getElementById('__maren_cursor')) return;

    const root = document.createElement('div');
    root.id = '__maren_cursor';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
      // Above every dialog, sheet and sticky header the app can produce.
      'z-index:2147483647',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 220ms ease',
      'will-change:transform',
    ].join(';');

    // A pointer arrow with a dark outline, so it stays legible over the violet shader,
    // over white cards and over the near-black app background alike.
    root.innerHTML = `
      <svg width="26" height="30" viewBox="0 0 26 30" fill="none"
           style="position:absolute;top:-2px;left:-2px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))">
        <path d="M5 3.2 L5 22.4 L9.9 17.9 L12.9 24.7 L16.4 23.2 L13.4 16.5 L20 16.2 Z"
              fill="#ffffff" stroke="#0b0b0f" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div id="__maren_cursor_ring" style="
        position:absolute;top:0;left:0;width:14px;height:14px;margin:-7px 0 0 -7px;
        border-radius:999px;border:2px solid rgba(139,109,255,.95);
        transform:scale(0);opacity:0;"></div>`;

    (document.body || document.documentElement).appendChild(root);

    const ring = root.querySelector('#__maren_cursor_ring');
    let shown = false;

    const place = (x, y) => {
      root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!shown) {
        shown = true;
        root.style.opacity = '1';
      }
    };

    window.addEventListener('mousemove', (e) => place(e.clientX, e.clientY), {
      capture: true,
      passive: true,
    });

    window.addEventListener(
      'mousedown',
      (e) => {
        place(e.clientX, e.clientY);
        ring.animate(
          [
            { transform: 'scale(0.4)', opacity: 0.9 },
            { transform: 'scale(3.2)', opacity: 0 },
          ],
          { duration: 460, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
      },
      { capture: true, passive: true },
    );

    // The overlay is appended to <body>; a client-side route change in Next replaces the
    // subtree under it but not body itself, so one install survives the whole walkthrough.
    // This guard only matters if something nukes body wholesale.
    const keepAlive = new MutationObserver(() => {
      if (!document.getElementById('__maren_cursor')) {
        keepAlive.disconnect();
        install();
      }
    });
    keepAlive.observe(document.documentElement, { childList: true, subtree: false });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
}

/** @param {import('playwright-core').BrowserContext} context */
export async function installCursor(context) {
  await context.addInitScript(overlay);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ease-in-out. Fast in the middle, gentle at both ends — how a hand actually moves. */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * A pointer that moves like a hand rather than a teleport.
 *
 * Playwright's own `mouse.move(x, y, { steps })` interpolates linearly at whatever rate the
 * driver can manage, which on a fast machine is close to instantaneous — the arrow would
 * simply appear at the destination. This paces the same real events over a wall-clock
 * duration with an eased curve, so the viewer's eye can follow the travel and knows where
 * to look before the click lands.
 */
export class Pointer {
  /** @param {import('playwright-core').Page} page */
  constructor(page) {
    this.page = page;
    this.x = 960;
    this.y = 300;
  }

  /** Keep the arrow where it is after a scroll or a navigation repaints the page. */
  async nudge() {
    await this.page.mouse.move(this.x, this.y);
  }

  async moveTo(x, y, { duration = 620 } = {}) {
    const fromX = this.x;
    const fromY = this.y;
    const frames = Math.max(2, Math.round(duration / 16));
    for (let i = 1; i <= frames; i += 1) {
      const t = easeInOut(i / frames);
      await this.page.mouse.move(fromX + (x - fromX) * t, fromY + (y - fromY) * t);
      await sleep(duration / frames);
    }
    this.x = x;
    this.y = y;
  }

  /**
   * Travel to an element, settle, then click.
   *
   * The pause between arriving and pressing is not decoration: it is the beat that lets a
   * viewer read the control before it activates, and it gives hover styling a chance to
   * appear on camera.
   */
  async moveToElement(locator, { duration = 620, settle = 420, offset } = {}) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('cannot point at an element with no box on screen');
    const target = offset ?? { x: box.width / 2, y: box.height / 2 };
    await this.moveTo(box.x + target.x, box.y + target.y, { duration });
    await sleep(settle);
    return box;
  }

  async click(locator, opts = {}) {
    await this.moveToElement(locator, opts);
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
    await sleep(opts.after ?? 260);
  }
}
