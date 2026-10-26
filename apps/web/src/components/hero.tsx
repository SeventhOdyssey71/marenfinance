import { Screen } from './landing/screen';
import { PillButton } from './ui/pill-button';
import { WEB_APP_CTA, WEB_APP_URL } from '@/lib/links';

/**
 * The hero: a bracketed testnet note, the brand line, one sentence, two destinations,
 * then three real app screens in one framed plate. No entrance animation: it is the
 * first thing anyone sees, and un-painting it to fade it back in reads as a blank page
 * on a cold load.
 */

const SHOTS: readonly { src: string; alt: string; caption: string; lead?: boolean }[] = [
  {
    src: '/shots/borrow.png',
    alt: 'The Borrow MUSD screen: an amount of 100 MUSD, the MUSD left to borrow, and a number pad.',
    caption: 'Borrow against BTC',
  },
  {
    src: '/app-home.png',
    alt: 'The Maren home screen: an MUSD balance, Send and Receive, a Bitcoin vault showing how far Bitcoin can fall before liquidation, and recent transactions.',
    caption: 'Your balance and vault',
    lead: true,
  },
  {
    src: '/shots/send.png',
    alt: 'The Send screen: paying the handle @sele, resolved to an address, with a Send 1.00 MUSD button.',
    caption: 'Pay by @handle',
  },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-maren pb-20 pt-14 md:pb-32 md:pt-24">
      <div className="mx-auto max-w-[880px] text-center">
        <p className="t-bracket">[ Mezo testnet · Pre-audit ]</p>
        <h1 id="hero-title" className="t-display mt-6">
          Spend Bitcoin.
          <br />
          Never sell it.
        </h1>
        <p className="text-text-muted mx-auto mt-6 max-w-[36ch] text-pretty text-[1.0625rem] leading-[1.5] md:text-lg">
          Borrow MUSD, Mezo’s Bitcoin-backed dollar, against your BTC and pay anyone by @handle.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <PillButton href={WEB_APP_URL} size="lg">
            {WEB_APP_CTA}
          </PillButton>
          <PillButton href="/docs" size="lg" variant="secondary">
            Read the docs
          </PillButton>
        </div>
      </div>

      <div className="card mx-auto mt-16 max-w-[880px] px-6 pb-6 pt-8 md:mt-20 md:px-10 md:pb-8 md:pt-10">
        <ul role="list" className="grid gap-8 sm:grid-cols-3">
          {SHOTS.map((s) => (
            <li key={s.src} className={s.lead ? '' : 'hidden sm:block'}>
              <figure className="mx-auto max-w-[240px] sm:max-w-none">
                <Screen
                  src={s.src}
                  alt={s.alt}
                  sizes="(min-width: 920px) 240px, (min-width: 640px) 28vw, 240px"
                  priority={s.lead}
                />
                <figcaption className="t-label mt-4 text-center">{s.caption}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
