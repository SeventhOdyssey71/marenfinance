import { Reveal } from './ui/reveal';
import { Counter, Kicker, Ticks } from './landing/ui';
import { VaultIcon, PayIcon, EarnIcon, PortfolioIcon } from './ui/icons';

/**
 * Bento — the four Maren surfaces, one account. Copy is the honest product
 * description carried over from the original Surfaces section: pooled + direct
 * troves, on-chain payment shapes, lumpy liquidation-only yield, and a Portfolio
 * that stops on a stale price rather than faking one.
 */

function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center border border-[color:var(--l-line)] bg-[var(--l-white)] text-[var(--l-accent-ink)]">
      {children}
    </span>
  );
}

export function Surfaces() {
  return (
    <section
      id="product"
      className="l-frame relative scroll-mt-24 border-t border-[color:var(--l-line)] px-5 pt-20 sm:px-8"
    >
      <Ticks />

      <Reveal className="flex flex-col items-center text-center">
        <Kicker>What you can do</Kicker>
        <h2 className="mt-7 max-w-[16ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--l-ink)]">
          Four surfaces, one account
        </h2>
        <p className="mt-5 max-w-[52ch] text-[16px] leading-[1.55] text-[var(--l-muted)]">
          Borrow against Bitcoin, spend the dollars you draw, earn on what sits idle, and watch your
          own ratio — the tools usually scattered across five apps, in one place.
        </p>
      </Reveal>

      <Reveal className="relative mt-16 grid grid-cols-1 border-y border-[color:var(--l-line)] md:grid-cols-2">
        <Ticks />
        <span aria-hidden className="l-tick hidden md:block" style={{ left: '50%', top: 0, transform: 'translate(-50%,-50%)' }} />
        <span aria-hidden className="l-tick hidden md:block" style={{ left: '50%', bottom: 0, transform: 'translate(-50%,50%)' }} />
        <span aria-hidden className="l-tick" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }} />

        {/* Vault */}
        <div className="flex flex-col p-6 sm:p-8">
          <div className="flex items-center gap-3.5">
            <IconChip>
              <VaultIcon className="size-5" />
            </IconChip>
            <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">Vault</h3>
          </div>
          <p className="mt-5 max-w-[46ch] text-[14.5px] leading-[1.55] text-[var(--l-muted)]">
            Deposit BTC, draw MUSD. A direct trove for positions above the protocol minimum; a pooled
            trove, from 0.001 BTC, for everyone the minimum currently excludes.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-[color:var(--l-line)] pt-6">
            {[
              ['Floor', '0.001 BTC'],
              ['Internal CR', '140%'],
              ['Protocol CR', '110%'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="l-mono text-[10px] uppercase tracking-[0.12em] text-[var(--l-dim)]">{k}</dt>
                <dd className="num mt-2 text-[15px] text-[var(--l-ink)]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Pay */}
        <div className="flex flex-col border-t border-[color:var(--l-line)] p-6 sm:p-8 md:border-l md:border-t-0">
          <div className="flex items-center gap-3.5">
            <IconChip>
              <PayIcon className="size-5" />
            </IconChip>
            <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">Pay</h3>
          </div>
          <p className="mt-5 text-[14.5px] leading-[1.55] text-[var(--l-muted)]">
            Send MUSD to an @handle, a link, a request or a split, with a memo written on-chain and
            the resolved address shown before you sign.
          </p>
          <ul className="mt-8 border-t border-[color:var(--l-line)] pt-2">
            {[
              ['Handle', '@handle'],
              ['Link', 'claimable'],
              ['Request', 'invoice'],
              ['Split', 'one signature'],
            ].map(([shape, detail]) => (
              <li
                key={shape}
                className="flex items-center justify-between gap-3 border-b border-[color:var(--l-line)] py-2.5 text-[14px] text-[var(--l-muted)] last:border-b-0"
              >
                {shape}
                <span className="num text-[12px] text-[var(--l-dim)]">{detail}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Earn */}
        <div className="flex flex-col border-t border-[color:var(--l-line)] p-6 sm:p-8">
          <div className="flex items-center gap-3.5">
            <IconChip>
              <EarnIcon className="size-5" />
            </IconChip>
            <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">Earn</h3>
          </div>
          <p className="mt-5 text-[14.5px] leading-[1.55] text-[var(--l-muted)]">
            Put idle MUSD into the Stability Pool. You are paid in the Bitcoin seized when somebody
            else is liquidated.
          </p>
          <p className="mt-auto pt-8 text-[13px] leading-[1.5] text-[var(--l-dim)]">
            So the return is lumpy and can be zero for months. Maren shows what was actually realised
            and never quotes an APY.
          </p>
        </div>

        {/* Portfolio */}
        <div className="flex flex-col border-t border-[color:var(--l-line)] p-6 sm:p-8 md:border-l">
          <div className="flex items-center gap-3.5">
            <IconChip>
              <PortfolioIcon className="size-5" />
            </IconChip>
            <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">Portfolio</h3>
          </div>
          <p className="mt-5 text-[14.5px] leading-[1.55] text-[var(--l-muted)]">
            Your ratio, your borrowing capacity, and how far Bitcoin can fall before you are
            liquidated. History read from the contracts, not from us.
          </p>
          <p className="mt-auto pt-8 text-[13px] leading-[1.5] text-[var(--l-dim)]">
            When the price feed goes stale, Maren stops and says so. It never shows a stale price as
            though it were live.
          </p>
        </div>
      </Reveal>

      <div className="l-hatch h-16" />
      <div className="pb-8">
        <Counter n="02" label="Product" />
      </div>
    </section>
  );
}
