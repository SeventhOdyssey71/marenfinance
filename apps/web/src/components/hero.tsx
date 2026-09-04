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
        <span className="hero-eyebrow">Bitcoin-backed dollars · on Mezo</span>
      </Reveal>

      <Reveal as="h1" delay={60} className="hero-title">
        Spend Bitcoin.
        <br />
        <span className="accent">Never sell it.</span>
      </Reveal>

      <Reveal as="p" delay={100} className="hero-sub">
        Borrow MUSD against your Bitcoin and pay anyone by @handle. Gasless, in one clean app.
      </Reveal>

      <Reveal delay={140} className="hero-actions">
        <a href="/app" className="hero-btn hero-btn-primary">
          Open the app
        </a>
        <a href="#how" className="hero-btn hero-btn-ghost">
          See how it works
        </a>
      </Reveal>

      <Reveal as="p" delay={180} className="hero-trust">
        Non-custodial · your keys, your Bitcoin
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
