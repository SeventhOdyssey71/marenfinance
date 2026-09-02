import { Reveal } from './ui/reveal';
import { Tag } from './ugly-ui';
import { VaultIcon, PayIcon, EarnIcon } from './ui/icons';

/**
 * Three-up sticker feature cards — Vault (pink), Pay (cyan), Earn (khaki).
 * Saturated full-bleed fills, 1px black border, 16px radius, a tilted
 * illustrative mock inside, and a two-line Inter caption below each. Copy is
 * the honest product description: pooled + direct troves from 0.001 BTC; pay by
 * handle / link / request / split; lumpy liquidation-only yield, never an APY.
 *
 * Figures on the mocks are flagged "Illustrative" and internally consistent —
 * no live data is implied.
 */

const MOCK_TAG = (
  <span className="rounded-[8px] border border-[color:var(--ink)] bg-[color:var(--card)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-[color:var(--ink)]">
    Illustrative
  </span>
);

function VaultCard() {
  return (
    <article className="flex flex-col rounded-[16px] border border-[color:var(--ink)] bg-[color:var(--pink)] p-6">
      <div className="flex items-center gap-3">
        <span className="u-chip size-10">
          <VaultIcon className="size-5" />
        </span>
        <h3 className="text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">Vault</h3>
      </div>

      <div
        className="u-card mt-6 p-4"
        style={{ transform: 'rotate(-2deg)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--muted)]">
            Borrowed
          </span>
          {MOCK_TAG}
        </div>
        <div className="num mt-1 text-[26px] font-extrabold leading-none tracking-[-0.03em] text-[color:var(--ink)]">
          1,200 <span className="text-[color:var(--muted)]">MUSD</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[color:var(--ink)]/12 pt-3">
          {[
            ['Floor', '0.001 BTC'],
            ['Maren CR', '140%'],
            ['Mezo CR', '110%'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[9px] font-bold uppercase tracking-[0.04em] text-[color:var(--muted)]">
                {k}
              </dt>
              <dd className="num mt-1 text-[13px] font-bold text-[color:var(--ink)]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-6 text-[18px] font-medium leading-[1.35] text-[color:var(--ink)]">
        Deposit BTC, draw MUSD. A direct trove above the protocol minimum; a pooled trove, from
        0.001 BTC, for everyone the minimum shuts out.
      </p>
    </article>
  );
}

function PayCard() {
  const rows: readonly [string, string, string][] = [
    ['@amara', 'handle', '$100'],
    ['claim link', 'no BTC to receive', '$40'],
  ];
  return (
    <article className="flex flex-col rounded-[16px] border border-[color:var(--ink)] bg-[color:var(--cyan)] p-6">
      <div className="flex items-center gap-3">
        <span className="u-chip size-10">
          <PayIcon className="size-5" />
        </span>
        <h3 className="text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">Pay</h3>
      </div>

      <div
        className="u-card mt-6 p-4"
        style={{ transform: 'rotate(2deg)' }}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--muted)]">
            Send
          </span>
          {MOCK_TAG}
        </div>
        <ul className="flex flex-col gap-2">
          {rows.map(([to, meta, amt]) => (
            <li
              key={to}
              className="flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--ink)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold text-[color:var(--ink)]">{to}</div>
                <div className="num text-[10px] text-[color:var(--muted)]">{meta}</div>
              </div>
              <div className="num text-[13px] font-bold text-[color:var(--ink)]">{amt}</div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 text-[18px] font-medium leading-[1.35] text-[color:var(--ink)]">
        Send MUSD to an @handle, a link, a request or a split — the resolved address shown before you
        sign, the memo written on-chain.
      </p>
    </article>
  );
}

function EarnCard() {
  return (
    <article className="flex flex-col rounded-[16px] border border-[color:var(--ink)] bg-[color:var(--khaki)] p-6">
      <div className="flex items-center gap-3">
        <span className="u-chip size-10">
          <EarnIcon className="size-5" />
        </span>
        <h3 className="text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">Earn</h3>
      </div>

      <div
        className="u-card mt-6 p-4"
        style={{ transform: 'rotate(-1.5deg)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--muted)]">
            Stability Pool
          </span>
          {MOCK_TAG}
        </div>
        <div className="mt-2 text-[15px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">
          Paid in seized BTC
        </div>
        <div className="mt-3 inline-flex items-center rounded-[8px] border border-[color:var(--ink)] bg-[color:var(--paper)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] text-[color:var(--ink)]">
          No APY quoted
        </div>
      </div>

      <p className="mt-6 text-[18px] font-medium leading-[1.35] text-[color:var(--ink)]">
        Put idle MUSD in the Stability Pool. You are paid in the Bitcoin seized at liquidation —
        lumpy, sometimes zero for months. Maren shows what was realised, never a rate.
      </p>
    </article>
  );
}

export function Surfaces() {
  return (
    <section id="product" className="u-wrap scroll-mt-28 pt-24 sm:pt-28">
      <Reveal className="flex flex-col items-center text-center">
        <Tag>What you can do</Tag>
        <h2 className="u-display mt-6 max-w-[16ch] text-[clamp(38px,6.5vw,84px)]">
          Three surfaces.
          <br />
          One account.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[16px] font-medium leading-[1.5] text-[color:var(--muted)] sm:text-[18px]">
          Borrow against Bitcoin, spend the dollars you draw, and earn on what sits idle — the tools
          usually scattered across five apps, in one place.
        </p>
      </Reveal>

      <Reveal className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        <VaultCard />
        <PayCard />
        <EarnCard />
      </Reveal>
    </section>
  );
}
