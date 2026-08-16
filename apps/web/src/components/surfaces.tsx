import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';
import { VaultIcon, PayIcon, EarnIcon, PortfolioIcon } from './ui/icons';

export function Surfaces() {
  return (
    <Section id="product" labelledBy="product-title" className="hairline-t">
      <div className="container-maren">
        <Reveal className="max-w-3xl">
          <Eyebrow>Product</Eyebrow>
          <h2 id="product-title" className="t-h1 mt-6 text-balance">
            Four surfaces, <span className="text-text-muted">one account.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-6 md:gap-5">
          {/* Vault — the differentiator, so it gets the wide tile */}
          <Reveal className="md:col-span-4">
            {/* The violet blur that used to sit behind this tile is gone. It made the
                differentiator card read a shade lighter than the three beside it, which
                is the filled-panel look this pass exists to remove — at a larger scale
                than the fill itself. */}
            <article className="card relative h-full overflow-hidden p-6 md:p-8">
              <div className="relative flex h-full flex-col">
                <div className="flex items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
                    <VaultIcon className="size-5" />
                  </span>
                  <h3 className="t-h3">Vault</h3>
                </div>
                <p className="text-text-muted mt-6 max-w-lg text-[0.9375rem] leading-relaxed">
                  Deposit BTC, draw MUSD. A direct trove for positions above the protocol minimum; a
                  pooled trove (from 0.001 BTC) for everyone the minimum currently excludes.
                </p>
                <dl className="mt-auto grid grid-cols-2 gap-4 pt-10 sm:grid-cols-3">
                  <div>
                    <dt className="t-label text-text-subtle">Floor</dt>
                    <dd className="num text-text mt-2 text-lg">0.001 BTC</dd>
                  </div>
                  <div>
                    <dt className="t-label text-text-subtle">Internal CR</dt>
                    <dd className="num text-text mt-2 text-lg">140%</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="t-label text-text-subtle">Protocol CR</dt>
                    <dd className="num text-text-muted mt-2 text-lg">110%</dd>
                  </div>
                </dl>
              </div>
            </article>
          </Reveal>

          <Reveal delay={80} className="md:col-span-2">
            <article className="card flex h-full flex-col p-6 md:p-8">
              <div className="flex items-center gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
                  <PayIcon className="size-5" />
                </span>
                <h3 className="t-h3">Pay</h3>
              </div>
              <p className="text-text-muted mt-6 text-[0.9375rem] leading-relaxed">
                Send MUSD to an @handle, a link, a request or a split, with a memo written
                on-chain.
              </p>
              <ul className="mt-auto space-y-2.5 pt-8">
                {[
                  // A shape, not an account. `@sele` is a real registration on matsnet
                  // and does not belong in a feature list as decoration.
                  ['Handle', '@handle'],
                  ['Link', 'claimable'],
                  ['Request', 'invoice'],
                  ['Split', 'one signature'],
                ].map(([shape, detail]) => (
                  <li
                    key={shape}
                    className="text-text-muted flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] pb-2.5 text-sm last:border-b-0 last:pb-0"
                  >
                    {shape}
                    <span className="num text-text-subtle truncate text-xs">{detail}</span>
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>

          <Reveal delay={80} className="md:col-span-3">
            <article className="card flex h-full flex-col p-6 md:p-8">
              <div className="flex items-center gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
                  <EarnIcon className="size-5" />
                </span>
                <h3 className="t-h3">Earn</h3>
              </div>
              <p className="text-text-muted mt-6 text-[0.9375rem] leading-relaxed">
                Put idle MUSD into the Stability Pool. You are paid in the Bitcoin seized when
                somebody else is liquidated.
              </p>
              <p className="text-text-subtle mt-auto pt-10 text-xs leading-relaxed">
                So the return is lumpy and can be zero for months. Maren shows what was actually
                realised and never quotes an APY.
              </p>
            </article>
          </Reveal>

          <Reveal delay={160} className="md:col-span-3">
            <article className="card flex h-full flex-col p-6 md:p-8">
              <div className="flex items-center gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
                  <PortfolioIcon className="size-5" />
                </span>
                <h3 className="t-h3">Portfolio</h3>
              </div>
              <p className="text-text-muted mt-6 text-[0.9375rem] leading-relaxed">
                Your ratio, your borrowing capacity, and how far Bitcoin can fall before you are
                liquidated. History read from the contracts, not from us.
              </p>
              <p className="text-text-subtle mt-auto pt-10 text-xs leading-relaxed">
                When the price feed goes stale, Maren stops and says so. It never shows a stale
                price as though it were live.
              </p>
            </article>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
