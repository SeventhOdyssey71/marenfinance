import { Reveal } from './ui/reveal';
import { StickerButton } from './ugly-ui';
import { ArrowUpRight } from './ui/icons';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

/**
 * The facts — a graphite listing panel with white interior rows, one honest
 * protocol fact each. Every figure is a Maren / Mezo fact, not invented
 * traction. The gas row flips on RELAYER_CONFIGURED (read from
 * NEXT_PUBLIC_RELAYER_URL at build time) so this panel never claims a relayer
 * that is not deployed. The risk strip states the pre-audit status and the
 * pooled-trove socialised-loss risk plainly.
 */

const FACTS: readonly { label: string; value: string; note: string }[] = [
  {
    label: 'Deposit floor',
    value: '0.001 BTC',
    note: 'The pooled trove’s entry — well below Mezo’s 1,800 MUSD minimum net debt.',
  },
  {
    label: 'Maren collateral ratio',
    value: '140%',
    note: 'Where Maren’s keeper liquidates, thirty points of buffer above the protocol.',
  },
  {
    label: 'Mezo collateral ratio',
    value: '110%',
    note: 'The protocol’s own liquidation threshold, one cliff below Maren’s.',
  },
  {
    label: 'Borrow rate',
    value: '1.00% APR',
    note: 'Fixed interest on the MUSD you draw. No variable-rate surprises.',
  },
  {
    label: 'Stablecoin',
    value: 'MUSD',
    note: 'Mezo’s own dollar, borrowed against Bitcoin. Maren does not fork it or wrap it.',
  },
  {
    label: 'Gas token',
    value: 'Native BTC',
    note: RELAYER_CONFIGURED
      ? 'Mezo charges gas in Bitcoin. This deployment has a relayer; each screen says whether it is taking work before you sign.'
      : 'Mezo charges gas in Bitcoin. Maren is built so you will not have to hold a gas balance, though today you still do.',
  },
  {
    label: 'Networks',
    value: '31612 / 31611',
    note: 'Mezo mainnet and matsnet. Any EVM wallet works; nothing here needs a bespoke SDK.',
  },
];

export function BuiltOnMezo() {
  return (
    <section id="facts" className="u-wrap scroll-mt-28 pt-24 sm:pt-28">
      <Reveal>
        <div className="rounded-[42px] bg-[color:var(--graphite)] p-6 sm:p-10">
          <div className="max-w-[52ch]">
            <span className="u-tag">
              <span aria-hidden className="u-tag-dot" />
              Built on Mezo
            </span>
            <h2
              className="u-display mt-6 text-[clamp(34px,5.5vw,68px)]"
              style={{ color: 'var(--card)' }}
            >
              Loud page. Honest facts.
            </h2>
            <p className="mt-4 text-[16px] font-medium leading-[1.5] text-[color:var(--card)]/75">
              Maren sits on what Mezo already ships and widens the door. Every number below is a
              protocol fact read off the chain — no invented users, volume or traction.
            </p>
          </div>

          {/* White interior rows */}
          <dl className="mt-8 grid grid-cols-1 gap-2.5">
            {FACTS.map((f) => (
              <div
                key={f.label}
                className="u-card grid grid-cols-1 gap-2 p-4 sm:grid-cols-[13rem_1fr] sm:items-baseline sm:gap-6 sm:p-5"
              >
                <dt className="flex items-baseline justify-between gap-3 sm:block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[color:var(--muted)]">
                    {f.label}
                  </span>
                  <span className="num mt-0 text-[20px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)] sm:mt-1 sm:block">
                    {f.value}
                  </span>
                </dt>
                <dd className="text-[14px] font-medium leading-[1.5] text-[color:var(--muted)]">
                  {f.note}
                </dd>
              </div>
            ))}
          </dl>

          {/* Risk strip — stated plainly, in the loud style. */}
          <div className="mt-2.5 rounded-[16px] bg-[color:var(--lime)] p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--ink)]">
              Read this first
            </div>
            <p className="mt-2 max-w-[70ch] text-[14.5px] font-semibold leading-[1.5] text-[color:var(--ink)]">
              Maren is pre-audit — treat it as unaudited and start small. Pooled positions share one
              trove, so a faster-than-keeper drawdown could socialise losses across depositors. Above
              the protocol minimum, Maren steers you to a direct trove with no pooling risk, and the
              app says so at the point of decision.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <StickerButton href="https://explorer.mezo.org" external variant="ghost">
              Mezo Explorer
              <ArrowUpRight className="size-3.5" />
            </StickerButton>
            <StickerButton href="https://mezo.org" external variant="dark">
              mezo.org
              <ArrowUpRight className="size-3.5" />
            </StickerButton>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
