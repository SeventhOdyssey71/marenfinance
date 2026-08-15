'use client';

import { useId, useState, type ReactNode } from 'react';
import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';
import { Plus, Minus } from './ui/icons';

type Item = { q: string; a: ReactNode };

const items: readonly Item[] = [
  {
    q: 'What happens if the price of Bitcoin falls?',
    a: (
      <>
        <p>
          Your position is measured by its collateral ratio. Mezo liquidates a trove at{' '}
          <span className="num text-text">110%</span>. Maren does not let you get near
          that: we liquidate internally at{' '}
          <span className="num text-text">140%</span>, seizing the collateral of an
          unhealthy user at a 5% penalty and repaying their share of the pooled debt.
        </p>
        <p>
          That 30-point buffer exists so a fast drawdown hits Maren&rsquo;s keeper long
          before it hits the protocol&rsquo;s cliff. Portfolio shows your ratio, your
          distance to 140%, and alerts you before the keeper has to act. If Bitcoin falls
          far enough and fast enough, a position can still be liquidated. That is the
          nature of a collateralised loan and no design removes it.
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
          under your own permit — Maren never takes possession.
        </p>
        <p>
          The pooled vault is the honest exception and we will not soften it:{' '}
          <strong className="font-medium text-text">
            pooled positions share one trove
          </strong>
          . Maren runs a single large, conservatively managed trove and gives each
          depositor a proportional claim inside it. Your collateral is segregated in{' '}
          <em className="not-italic text-text">accounting</em>, not in custody. A
          catastrophic, faster-than-keeper drawdown could socialise losses across
          depositors.
        </p>
        <p>
          The mitigations are the 140/110 buffer, the 0.001 BTC deposit floor, per-block
          keeper checks, and a protocol-owned insurance buffer funded from vault fees.
          They are mitigations, not a guarantee. If you hold more than the protocol
          minimum, Maren steers you to a direct trove, which carries no pooling risk at
          all — and the interface says so at the point of decision.
        </p>
      </>
    ),
  },
  {
    q: 'What does "gasless" actually mean?',
    a: (
      <>
        <p>
          It means Maren pays the BTC gas, not that gas stopped existing. You sign an
          EIP-712 request; our relayer verifies it, simulates it, submits it, and settles
          the BTC out of its own hot key.
        </p>
        <p>
          The first <span className="num text-text">25</span> actions per address are
          free. After that a small fee is taken in MUSD inside the same transaction, so
          you still never need a BTC balance. New users are never blocked at the door.
          The relayer is allowlisted to Maren contracts and known function selectors
          only, is rate limited per address and per IP, and never holds user funds —
          compromising its key costs us gas, not your Bitcoin.
        </p>
      </>
    ),
  },
  {
    q: 'Has Maren been audited?',
    a: (
      <>
        <p>
          <strong className="font-medium text-text">Not yet. Maren is pre-audit.</strong>{' '}
          A third-party audit of <span className="num">MarenVault</span> and{' '}
          <span className="num">MarenForwarder</span> — the two contracts that carry real
          risk — is scheduled after the full matsnet deployment and before mainnet.
        </p>
        <p>
          Until that audit is complete and published, treat Maren as unaudited software
          and do not deposit more than you can afford to lose. Mainnet launches with the
          vault capped, and the cap is raised only as the position proves out.
        </p>
      </>
    ),
  },
  {
    q: 'How is this different from just opening a trove on Mezo?',
    a: (
      <>
        <p>
          If you hold more than roughly 0.079 BTC, it partly is not — and Maren will tell
          you to open a direct trove, because that avoids pooling risk entirely. What
          Maren adds there is gasless execution and a payments surface.
        </p>
        <p>
          If you hold less, Mezo has nothing for you today. The 1,800 MUSD minimum net
          debt is the wall, and pooled credit is the way through it at 0.001 BTC.
        </p>
      </>
    ),
  },
  {
    q: 'Where does the yield in Earn come from?',
    a: (
      <>
        <p>
          From MUSD&rsquo;s Stability Pool, through an ERC-4626 vault. When a trove is
          liquidated, the pool absorbs its debt and receives its BTC collateral at a
          discount. Maren sweeps those BTC gains, converts them, and compounds them back
          into MUSD.
        </p>
        <p>
          There are <strong className="font-medium text-text">no token emissions</strong>
          . Yield is liquidation gains only, which makes it lumpy and impossible to
          honestly quote as a fixed APY. Maren shows trailing realised yield, clearly
          labelled as backward-looking, and never advertises a rate it cannot guarantee.
        </p>
      </>
    ),
  },
  {
    q: 'Can I get my collateral out?',
    a: (
      <>
        <p>
          Yes. Repay your share of the debt and withdraw your collateral, at any time. If
          the pooled trove ever approaches Maren&rsquo;s internal policy limit, borrowing
          is halted <em className="not-italic text-text">before</em> withdrawal is — exits
          stay open when entries close.
        </p>
      </>
    ),
  },
  {
    q: 'What if the price feed goes down?',
    a: (
      <>
        <p>
          Mezo&rsquo;s price feed is a native chain precompile fed by the validator set,
          and it reverts if the price is more than 60 seconds stale. That means borrow,
          adjust and liquidate calls can fail for reasons that have nothing to do with
          you.
        </p>
        <p>
          Maren has an explicit &ldquo;price feed unavailable&rdquo; state in both the web
          and iOS apps. We never render a stale price as though it were live.
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
    <li className="hairline-t">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-start justify-between gap-6 py-6 text-left transition-colors duration-[120ms] ease-out hover:text-violet-400 md:py-7"
        >
          <span className="flex min-w-0 items-start gap-5 md:gap-8">
            <span
              aria-hidden
              className="num mt-1 hidden shrink-0 text-xs text-text-subtle sm:block"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-[1.0625rem] font-medium tracking-[-0.01em] text-balance md:text-lg">
              {item.q}
            </span>
          </span>
          <span
            aria-hidden
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--radius-pill)] border transition-colors duration-[240ms] ease-out ${
              open
                ? 'border-violet-500/40 bg-violet-500/12 text-violet-400'
                : 'border-[var(--border-hairline)] bg-surface-raised text-text-muted'
            }`}
          >
            {open ? <Minus className="size-4" /> : <Plus className="size-4" />}
          </span>
        </button>
      </h3>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="pb-8 sm:pl-[3.25rem] md:pl-16"
      >
        <div className="prose-measure space-y-4 text-[0.9375rem] leading-relaxed text-text-muted">
          {item.a}
        </div>
      </div>
    </li>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq" labelledBy="faq-title" className="hairline-t">
      <div className="container-maren">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <Reveal className="lg:col-span-4">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq-title" className="t-h1 mt-6 text-balance">
              The awkward
              <br className="hidden sm:block" />{' '}
              <span className="text-text-muted">questions.</span>
            </h2>
            <p className="mt-6 max-w-sm text-base leading-relaxed text-text-muted">
              We are handling people&rsquo;s Bitcoin. Risk gets stated plainly or it is
              not stated at all.
            </p>
          </Reveal>

          <div className="lg:col-span-7 lg:col-start-6">
            <ul>
              {items.map((item, i) => (
                <AccordionItem
                  key={item.q}
                  item={item}
                  index={i}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
