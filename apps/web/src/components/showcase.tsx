import { Reveal } from './ui/reveal';
import { Tag } from './ugly-ui';

/**
 * Showcase — real screens from the iOS app in mini iPhone frames. A quiet strip
 * that proves the product is real: draw MUSD, pay a handle, and an honest receipt.
 */
const SHOTS: readonly { src: string; label: string }[] = [
  { src: '/shots/borrow.png', label: 'Draw MUSD against your Bitcoin' },
  { src: '/shots/send.png', label: 'Pay any @handle, resolved before you sign' },
  { src: '/shots/confirmed.png', label: 'A receipt that only says done when the chain does' },
];

export function Showcase() {
  return (
    <section id="product" className="u-wrap scroll-mt-28 pt-32 sm:pt-48">
      <Reveal className="flex flex-col items-center text-center">
        <Tag>A closer look</Tag>
        <h2 className="u-display mt-5 max-w-[16ch] text-[clamp(30px,4.6vw,54px)]">
          Every screen, considered.
        </h2>
        <p className="mt-4 max-w-[48ch] text-[15px] font-normal leading-[1.5] text-[color:var(--muted)] sm:text-[17px]">
          Real screens from the app: amount-first flows, handles resolved to an address before you
          sign, and honest on-chain receipts.
        </p>
      </Reveal>

      <Reveal className="showcase-row">
        {SHOTS.map((s) => (
          <figure key={s.src} className="shot-fig">
            <div className="shot">
              <span className="pbtn pbtn-action" aria-hidden />
              <span className="pbtn pbtn-vol" aria-hidden />
              <span className="pbtn pbtn-power" aria-hidden />
              <div className="bezel">
                <div className="screen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt={s.label} />
                </div>
              </div>
            </div>
            <figcaption className="shot-cap">{s.label}</figcaption>
          </figure>
        ))}
      </Reveal>
    </section>
  );
}
