'use client';

import { useId, useState, type ReactNode } from 'react';
import { Counter, Kicker, Ticks } from './landing/ui';
import { Plus, Minus } from './ui/icons';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

type Item = { q: string; a: ReactNode };

const items: readonly Item[] = [
  {
    q: 'What happens if the price of Bitcoin falls?',
    a: (
      <>
        <p>
          Your position is measured by its collateral ratio. Mezo liquidates a trove at{' '}
          <span className="num text-text">110%</span>. Maren does not let you get near that: we
          liquidate internally at <span className="num text-text">140%</span>, seizing the
          collateral of an unhealthy user at a 5% penalty and repaying their share of the pooled
          debt.
        </p>
        <p>
          That 30-point buffer exists so a fast drawdown hits Maren&rsquo;s keeper long before it
          hits the protocol&rsquo;s cliff. Portfolio shows your ratio, your distance to 140%, and
          alerts you before the keeper has to act. If Bitcoin falls far enough and fast enough, a
          position can still be liquidated. That is the nature of a collateralised loan and no
          design removes it.
        </p>
      </>
    ),
  },
  {
    q: 'Does Maren custody my Bitcoin?',
    a: (
      <>
        <p>
          No. Payments move MUSD wallet to wallet via <span className="num">transferFrom</span>{' '}
          under your own permit. Maren never takes possession.
        </p>
        <p>
          The pooled vault is the honest exception and we will not soften it:{' '}
          <strong className="text-text font-medium">pooled positions share one trove</strong>. Maren
          runs a single large, conservatively managed trove and gives each depositor a proportional
          claim inside it. Your collateral is segregated in{' '}
          <em className="text-text not-italic">accounting</em>, not in custody. A catastrophic,
          faster-than-keeper drawdown could socialise losses across depositors.
        </p>
        <p>
          The mitigations are the 140/110 buffer, the 0.001 BTC deposit floor, per-block keeper
          checks, and a protocol-owned insurance buffer funded from vault fees. They are
          mitigations, not a guarantee. If you hold more than the protocol minimum, Maren steers you
          to a direct trove, which carries no pooling risk at all, and the interface says so at the
          point of decision.
        </p>
      </>
    ),
  },
  {
    q: 'What does "gasless" actually mean?',
    a: (
      <>
        {/* CONDITIONAL, NOT DELETED. `RELAYER_CONFIGURED` is read from
            NEXT_PUBLIC_RELAYER_URL at build time, so it is the same value on the server
            and in the browser and this paragraph cannot flicker between them. It says
            what is true of THIS deployment: with no relayer configured the original
            paragraph stands word for word, and a deployment that has one stops claiming
            otherwise. Neither version promises that the relayer is accepting work right
            now — the app answers that per action, at the point of signing, from a live
            health probe. */}
        {RELAYER_CONFIGURED ? (
          <p>
            <strong className="text-text font-medium">
              It means Maren pays the Bitcoin fee, not that the fee stopped existing.
            </strong>{' '}
            This deployment has a relayer. Whether it is taking work is a question the app answers
            per action, on the screen, before you sign anything. Trust that line and not this page.
          </p>
        ) : (
          <p>
            <strong className="text-text font-medium">
              Today it means nothing: you pay your own gas.
            </strong>{' '}
            Maren is built so that it will not stay that way, but the service that would pay for you
            is not running anywhere, and the app says so on every screen rather than quoting this
            page back at you.
          </p>
        )}
        <p>
          {RELAYER_CONFIGURED
            ? 'It works like this: y'
            : 'When it does run, it means Maren pays the Bitcoin fee rather than that the fee stopped existing. Y'}
          ou sign; Maren checks what you signed, tries the call, and pays. Whatever submits for you
          can only ever touch Maren&rsquo;s own contracts, and can never move your Bitcoin.
        </p>
        <p>
          One thing is exempt permanently, and it is the first thing you will do: depositing Bitcoin{' '}
          <em className="text-text not-italic">sends</em> Bitcoin, and nobody can submit a
          transaction carrying value on your behalf. Your{' '}
          <span className="text-text">first deposit costs gas</span> and always will.
        </p>
      </>
    ),
  },
  {
    q: 'Has Maren been audited?',
    a: (
      <>
        <p>
          <strong className="text-text font-medium">Not yet. Maren is pre-audit.</strong> A
          third-party audit of <span className="num">MarenVault</span> and{' '}
          <span className="num">MarenForwarder</span> (the two contracts that carry real risk) is
          scheduled after the full matsnet deployment and before mainnet.
        </p>
        <p>
          Until that audit is complete and published, treat Maren as unaudited software and do not
          deposit more than you can afford to lose. Mainnet launches with the vault capped, and the
          cap is raised only as the position proves out.
        </p>
      </>
    ),
  },
  {
    q: 'How is this different from just opening a trove on Mezo?',
    a: (
      <>
        <p>
          If you hold more than roughly 0.079 BTC, it partly is not, and Maren will tell you to open
          a direct trove, because that avoids pooling risk entirely. What Maren adds there is
          gasless execution and a payments surface.
        </p>
        <p>
          If you hold less, Mezo has nothing for you today. The 1,800 MUSD minimum net debt is the
          wall, and pooled credit is the way through it at 0.001 BTC.
        </p>
      </>
    ),
  },
  {
    q: 'Where does the yield in Earn come from?',
    a: (
      <>
        <p>
          From MUSD&rsquo;s Stability Pool, through an ERC-4626 vault. When a trove is liquidated,
          the pool absorbs its debt and receives its BTC collateral at a discount. Maren sweeps
          those BTC gains, converts them, and compounds them back into MUSD.
        </p>
        <p>
          There are <strong className="text-text font-medium">no token emissions</strong>. Yield is
          liquidation gains only, which makes it lumpy and impossible to honestly quote as a fixed
          APY. Maren shows trailing realised yield, clearly labelled as backward-looking, and never
          advertises a rate it cannot guarantee.
        </p>
      </>
    ),
  },
  {
    q: 'Can I get my collateral out?',
    a: (
      <>
        <p>
          Yes. Repay your share of the debt and withdraw your collateral, at any time. If the pooled
          trove ever approaches Maren&rsquo;s internal policy limit, borrowing is halted{' '}
          <em className="text-text not-italic">before</em> withdrawal is. Exits stay open when
          entries close.
        </p>
      </>
    ),
  },
  {
    q: 'What if the price feed goes down?',
    a: (
      <>
        <p>
          Mezo&rsquo;s price feed is a native chain precompile fed by the validator set, and it
          reverts if the price is more than 60 seconds stale. That means borrow, adjust and
          liquidate calls can fail for reasons that have nothing to do with you.
        </p>
        <p>
          Maren has an explicit &ldquo;price feed unavailable&rdquo; state in both the web and iOS
          apps. We never render a stale price as though it were live.
        </p>
      </>
    ),
  },
];

function AccordionItem({
  item,
  index,
  open,
  onToggle,
}: {
  item: Item;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const buttonId = `faq-trigger-${id}`;
  const panelId = `faq-panel-${id}`;

  return (
    <div className="border-b border-[color:var(--l-line)]">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center gap-4 py-5 text-left"
        >
          <span aria-hidden className="l-mono shrink-0 text-[12px] text-[var(--l-dim)]">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="flex-1 text-balance text-[1.0625rem] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">
            {item.q}
          </span>
          <span
            aria-hidden
            className={`grid size-8 shrink-0 place-items-center transition-colors duration-[240ms] ease-out ${
              open
                ? 'bg-[var(--l-accent)] text-white'
                : 'border border-[color:var(--l-line)] bg-[var(--l-white)] text-[var(--l-ink)]'
            }`}
          >
            {open ? <Minus className="size-4" /> : <Plus className="size-4" />}
          </span>
        </button>
      </h3>

      <div className={`l-faq-body ${open ? 'is-open' : ''}`}>
        <div>
          <div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            className="prose-measure text-text-muted space-y-4 pb-6 pl-9 text-[14.5px] leading-relaxed"
          >
            {item.a}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="l-frame relative scroll-mt-24 border-t border-[color:var(--l-line)] px-5 pt-20 sm:px-8"
    >
      <Ticks />
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Kicker>The awkward questions</Kicker>
          <h2 className="mt-7 max-w-[12ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--l-ink)]">
            Risk, stated plainly.
          </h2>
          <p className="mt-5 max-w-[38ch] text-[15px] leading-[1.55] text-[var(--l-muted)]">
            We are handling people&rsquo;s Bitcoin. Risk gets stated plainly, or it is not stated at
            all.
          </p>
        </div>

        <div className="border-t border-[color:var(--l-line)]">
          {items.map((item, i) => (
            <AccordionItem
              key={item.q}
              item={item}
              index={i}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
            />
          ))}
        </div>
      </div>

      <div className="l-hatch mt-16 h-16" />
      <div className="pb-8">
        <Counter n="05" label="FAQ" />
      </div>
    </section>
  );
}
