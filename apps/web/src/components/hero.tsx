import { Reveal } from './ui/reveal';
import { StickerButton, Tag } from './ugly-ui';
import { PayIcon, Check } from './ui/icons';

/**
 * Hero — centred stack on the paper canvas: eyebrow tag, the giant Anton
 * headline "SPEND BITCOIN. / NEVER SELL IT.", two sticker buttons, then a
 * tilted, clearly-illustrative phone mockup directly below.
 *
 * TODO(design): swap <PhoneMock /> for a real captured Vault frame once the app
 * has one. The mock is pure CSS; every figure on it is flagged "Illustrative"
 * and internally consistent at a reference BTC price of $63,000
 * (0.05 BTC ≈ $3,150; 3,150 / 1,200 ≈ 262%). No live data is implied.
 */

function PhoneMock() {
  return (
    <div
      className="u-peel u-peel-lime relative w-[300px] shrink-0 rounded-[46px] border border-[color:var(--ink)] bg-[color:var(--hardware)] p-2.5 sm:w-[320px]"
      style={{ transform: 'rotate(-3deg)' }}
    >
      {/* Screen */}
      <div className="overflow-hidden rounded-[38px] border border-[color:var(--ink)] bg-[color:var(--card)]">
        {/* Status strip */}
        <div className="flex items-center justify-between border-b border-[color:var(--ink)] bg-[color:var(--khaki)] px-5 py-3">
          <span className="text-[13px] font-bold uppercase tracking-[-0.01em] text-[color:var(--ink)]">
            Vault
          </span>
          <span className="rounded-[9px] border border-[color:var(--ink)] bg-[color:var(--card)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[color:var(--ink)]">
            Illustrative
          </span>
        </div>

        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--muted)]">
            Borrowed
          </div>
          <div className="num mt-1 text-[38px] font-extrabold leading-none tracking-[-0.03em] text-[color:var(--ink)]">
            1,200<span className="text-[color:var(--muted)]"> MUSD</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <div className="u-card !rounded-[12px] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--muted)]">
                Collateral
              </div>
              <div className="num mt-1 text-[15px] font-bold text-[color:var(--ink)]">0.0500 BTC</div>
              <div className="num mt-0.5 text-[11px] text-[color:var(--placeholder)]">≈ $3,150</div>
            </div>
            <div className="u-card !rounded-[12px] bg-[color:var(--cyan)] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--ink)]">
                Ratio
              </div>
              <div className="num mt-1 text-[15px] font-bold text-[color:var(--ink)]">262%</div>
              <div className="num mt-0.5 text-[11px] text-[color:var(--ink)]">floor 140%</div>
            </div>
          </div>

          {/* Ratio rail — fill is headroom above the 140% liquidation marker. */}
          <div className="mt-4">
            <div className="relative h-3 overflow-hidden rounded-[8px] border border-[color:var(--ink)] bg-[color:var(--card)]">
              <div className="h-full w-[72%] bg-[color:var(--lime)]" />
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-[color:var(--ink)]"
                style={{ left: '38%' }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] font-bold uppercase tracking-[0.04em] text-[color:var(--muted)]">
              <span>140% floor</span>
              <span>you</span>
            </div>
          </div>

          <div className="u-btn u-btn-cta mt-5 w-full !min-h-[42px] text-[13px]">Draw MUSD</div>
        </div>
      </div>
    </div>
  );
}

/** Illustrative Pay confirmation, floated off the phone. */
function PayChip() {
  return (
    <div
      className="u-card w-[230px] p-3.5"
      style={{ transform: 'rotate(4deg)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="u-chip size-9 !rounded-[10px] bg-[color:var(--pink)]">
          <PayIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-[color:var(--ink)]">Paid @amara</div>
          <div className="num text-[11px] text-[color:var(--muted)]">amara.maren</div>
        </div>
        <div className="num ml-auto text-[14px] font-bold text-[color:var(--ink)]">$100</div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--muted)]">
        <Check className="size-3.5 text-[color:var(--ink)]" /> No gas balance needed
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="u-wrap pt-16 sm:pt-24">
      <Reveal className="flex justify-center">
        <Tag>Bitcoin-backed dollars · Mezo</Tag>
      </Reveal>

      <Reveal
        as="h1"
        delay={60}
        className="u-display mx-auto mt-6 max-w-[13ch] text-center text-[clamp(56px,12.5vw,150px)]"
      >
        Spend Bitcoin.
        <br />
        Never sell it.
      </Reveal>

      <Reveal
        as="p"
        delay={140}
        className="mx-auto mt-6 max-w-[52ch] text-center text-[16px] font-medium leading-[1.5] text-[color:var(--muted)] sm:text-[18px]"
      >
        Deposit from <span className="num font-bold text-[color:var(--ink)]">0.001 BTC</span>, draw
        MUSD against it, and pay anyone by name — without selling a satoshi, and built so you never
        keep a gas balance.
      </Reveal>

      <Reveal
        as="div"
        delay={220}
        className="mt-8 flex flex-wrap items-center justify-center gap-3"
      >
        <StickerButton href="/app" variant="cta">
          Launch app
        </StickerButton>
        <StickerButton href="#how" variant="ghost">
          See how it works
        </StickerButton>
      </Reveal>

      {/* Tilted phone mockup, directly below the headline. */}
      <Reveal className="relative mt-14 flex justify-center pb-4 sm:mt-16">
        <PhoneMock />
        <div className="absolute bottom-6 right-[calc(50%-220px)] hidden md:block">
          <PayChip />
        </div>
      </Reveal>
    </section>
  );
}
