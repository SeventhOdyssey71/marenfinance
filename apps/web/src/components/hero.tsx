import { Reveal } from './ui/reveal';
import { BracketButton, Kicker, Ticks } from './landing/ui';
import { VaultIcon, PayIcon } from './ui/icons';

/**
 * Hero — a centred blueprint composition on the light canvas: mono kicker, the
 * Satoshi headline, two bracket buttons, then a dotted-violet product band
 * carrying a stylised, clearly-illustrative app mock that overlaps into the
 * section below.
 *
 * TODO(design): drop a real Vault screenshot in place of <VaultMock /> once the
 * app has a captured frame. The mock below is CSS only and every figure on it
 * is flagged "Illustrative" — no live data is implied.
 */

/** Illustrative Vault surface. Figures are internally consistent at a reference
 *  BTC price of $63,000 (0.05 BTC ≈ $3,150; 3,150 / 1,200 ≈ 262%) and labelled
 *  as an example, not live data. */
function VaultMock() {
  return (
    <div
      className="relative w-full max-w-[560px] rounded-[14px] border border-[color:var(--l-line)] bg-[var(--l-white)] p-6 sm:p-7"
      style={{ boxShadow: '0 40px 80px -36px rgba(20,18,35,0.35)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[var(--radius-pill)] border border-[color:var(--l-line)] text-[var(--l-accent-ink)]">
            <VaultIcon className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">Vault</span>
        </div>
        <span className="l-mono rounded-full bg-[var(--l-accent-soft)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--l-accent-ink)]">
          Illustrative
        </span>
      </div>

      <div className="mt-6">
        <div className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-dim)]">Borrowed</div>
        <div className="num mt-1.5 text-[34px] font-medium leading-none tracking-[-0.02em] text-[var(--l-ink)]">
          1,200.00 <span className="text-[var(--l-dim)]">MUSD</span>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <dt className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-dim)]">Collateral</dt>
          <dd className="num mt-1.5 text-[15px] text-[var(--l-ink)]">0.0500 BTC</dd>
          <dd className="num mt-0.5 text-[12px] text-[var(--l-dim)]">≈ $3,150.00</dd>
        </div>
        <div>
          <dt className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-dim)]">Collateral ratio</dt>
          <dd className="num mt-1.5 text-[15px] text-[var(--l-ink)]">262%</dd>
          <dd className="num mt-0.5 text-[12px] text-[var(--l-dim)]">liquidates at 140%</dd>
        </div>
      </dl>

      {/* Ratio rail: fill is headroom above the 140% liquidation marker. */}
      <div className="mt-5">
        <div className="relative h-1.5 rounded-full bg-[var(--l-accent-soft)]">
          <div className="absolute inset-y-0 left-0 w-[72%] rounded-full bg-[var(--l-accent)]" />
          <span
            aria-hidden
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--l-ink)]"
            style={{ left: '38%' }}
          />
        </div>
        <div className="l-mono mt-2 flex justify-between text-[10px] uppercase tracking-[0.1em] text-[var(--l-dim)]">
          <span>140% floor</span>
          <span>your position</span>
        </div>
      </div>
    </div>
  );
}

/** Illustrative Pay confirmation, floated over the Vault mock. */
function PayMock() {
  return (
    <div
      className="w-[248px] rounded-[12px] border border-[color:var(--l-line)] bg-[var(--l-white)] p-4"
      style={{ boxShadow: '0 30px 60px -30px rgba(20,18,35,0.4)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-[var(--radius-pill)] bg-[var(--l-accent-soft)] text-[var(--l-accent-ink)]">
          <PayIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--l-ink)]">Paid @amara</div>
          <div className="num text-[11px] text-[var(--l-dim)]">amara.maren</div>
        </div>
        <div className="num ml-auto text-[14px] font-medium text-[var(--l-ink)]">$100.00</div>
      </div>
      <div className="l-mono mt-3 flex items-center gap-1.5 text-[10.5px] text-[var(--l-muted)]">
        <span className="text-[var(--l-accent-ink)]">✓</span> No gas balance needed
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative">
      <div className="l-frame relative px-5 pb-14 pt-24 text-center sm:px-8 sm:pt-28">
        <Ticks />

        <Reveal className="flex justify-center">
          <Kicker>Bitcoin-backed dollars on Mezo</Kicker>
        </Reveal>

        <Reveal
          as="h1"
          delay={60}
          className="mx-auto mt-7 max-w-[15ch] text-[clamp(30px,5.4vw,64px)] font-bold leading-[1.02] tracking-[-0.03em] text-[var(--l-ink)] sm:mt-8"
        >
          Spend Bitcoin. <span className="text-[var(--l-muted)]">Never sell it.</span>
        </Reveal>

        <Reveal
          as="p"
          delay={140}
          className="mx-auto mt-6 max-w-[52ch] text-[15.5px] leading-[1.6] text-[var(--l-muted)] md:text-[17px] md:leading-[1.55]"
        >
          Deposit from <span className="num text-[var(--l-ink)]">0.001 BTC</span>, draw MUSD against
          it, and pay anyone by name — without selling a satoshi, and built so you never keep a gas
          balance.
        </Reveal>

        <Reveal
          as="div"
          delay={220}
          className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-9 sm:gap-4"
        >
          <BracketButton href="/app">Launch app</BracketButton>
          <BracketButton href="#how-it-works" variant="ghost">
            How it works
          </BracketButton>
        </Reveal>
      </div>

      {/* Product band — dotted violet field, mock overlapping down into Stats. */}
      <div className="l-frame relative border-t border-[color:var(--l-line)]">
        <Ticks />
        <div className="l-dotfield relative px-5 pb-0 pt-16 sm:px-10">
          <Reveal className="relative mx-auto -mb-14 w-full max-w-[720px]">
            <div className="relative flex justify-center">
              <VaultMock />
              <div className="absolute -bottom-8 right-2 hidden sm:block">
                <PayMock />
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <div className="l-frame h-24 border-t border-transparent" />
    </section>
  );
}
