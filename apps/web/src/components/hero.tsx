import { TESTFLIGHT_URL } from '@/lib/links';
import { Reveal } from './ui/reveal';

/**
 * Hero — clean, centred: a soft eyebrow, a large SF Pro Rounded headline over a
 * Neue Montreal subline, two pills, then the REAL Maren app home screen inside an
 * iPhone 16 frame, with two decorative receipt chips floating beside it on wide
 * screens. The screenshot (`/app-home.png`) is a genuine capture — no CSS mock.
 */
export function Hero() {
  return (
    <section id="top" className="u-wrap hero">
      <Reveal className="flex justify-center">
        <span className="hero-eyebrow">iOS beta · Mezo testnet</span>
      </Reveal>

      <Reveal as="h1" delay={60} className="hero-title">
        Spend Bitcoin.
        <br />
        <span className="accent">Never sell it.</span>
      </Reveal>

      <Reveal as="p" delay={100} className="hero-sub">
        Borrow MUSD against your Bitcoin and pay anyone by @handle. Try the full loop with testnet
        funds.
      </Reveal>

      <Reveal delay={140} className="hero-actions">
        {/* Mobile is the headline product, so TestFlight is the primary CTA. This was a
            deliberately dead placeholder until build 1.0.0 (5) went live on TestFlight;
            it is now a real link. Opens in a new tab because the invite hands off to the
            TestFlight app, and losing the landing page behind that is disorienting. */}
        <a
          href={TESTFLIGHT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hero-btn hero-btn-primary"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-[17px]">
            <path d="M17.05 12.04c-.03-2.6 2.12-3.84 2.22-3.9-1.21-1.78-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.23 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.28 3.13-2.53.98-1.44 1.39-2.83 1.41-2.9-.03-.02-2.71-1.04-2.74-4.13zM14.53 4.6c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45z" />
          </svg>
          Join the iOS beta
        </a>
        {/* Secondary CTA. The web app is off in production while the launch is
            mobile-first, so this points at the docs rather than a route that 404s. */}
        <a href="/docs" className="hero-btn hero-btn-ghost">
          Read docs
        </a>
      </Reveal>

      <Reveal as="p" delay={180} className="hero-trust">
        Testnet only · pre-audit · no real funds
      </Reveal>

      <Reveal delay={220} className="hero-stage">
        <div className="phone-16">
          <span className="pbtn pbtn-action" aria-hidden />
          <span className="pbtn pbtn-vol" aria-hidden />
          <span className="pbtn pbtn-power" aria-hidden />
          <div className="bezel">
            <div className="screen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/app-home.png"
                alt="The Maren app home screen: a Bitcoin-backed MUSD balance, Send and Receive, a Bitcoin vault with its liquidation buffer, and recent transactions."
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
