'use client';

import { useId, useState, type ReactNode } from 'react';
import { Tag } from './ugly-ui';
import { Plus, Minus } from './ui/icons';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

/**
 * FAQ — the awkward questions, answered plainly. Sticker-brutalist shell:
 * white bordered cards, a lime toggle chip when open. The answers are Maren’s
 * honest positions carried over intact — the pooled-trove socialised-loss risk,
 * the pre-audit status, and the gasless caveat (which flips on
 * RELAYER_CONFIGURED so the page never claims a relayer that is not deployed).
 */

type Item = { q: string; a: ReactNode };

const items: readonly Item[] = [
  {
    q: 'What happens if the price of Bitcoin falls?',
    a: (
      <>
        <p>
          Your position is measured by its collateral ratio. Mezo liquidates a trove at{' '}
          <span className="num font-bold text-[color:var(--ink)]">110%</span>. Maren’s internal
          liquidation threshold is{' '}
          <span className="num font-bold text-[color:var(--ink)]">140%</span>, seizing the
          collateral of an unhealthy user at a 5% penalty and repaying their share of the pooled
          debt.
        </p>
        <p>
          That 30-point buffer exists so a fast drawdown reaches Maren’s liquidation threshold long
          before it reaches the protocol’s cliff. Portfolio shows your ratio and your distance to
          140% on every read. The keeper that would act on it is not automated yet: the contract
          functions are deployed, but they are run by hand today. If Bitcoin falls far enough and
          fast enough, a position can still be liquidated. That is the nature of a collateralised
          loan and no design removes it.
        </p>
      </>
    ),
  },
  {
    q: 'Does Maren custody my Bitcoin?',
    a: (
      <>
        <p>
          You control the signing keys. Payments move MUSD wallet to wallet via{' '}
          <span className="num text-[color:var(--ink)]">transferFrom</span> under your own permit,
          while deposited Bitcoin is held by the vault’s smart contracts. Claimable links hold MUSD
          in escrow until claimed or reclaimed after expiry. Earn also holds deposited MUSD.
        </p>
        <p>
          The pooled vault is the honest exception and we will not soften it:{' '}
          <strong className="font-bold text-[color:var(--ink)]">
            pooled positions share one trove
          </strong>
          . Maren runs a single large, conservatively managed trove and gives each depositor a
          proportional claim inside it. Your collateral is segregated in accounting, not in custody.
          A catastrophic, faster-than-keeper drawdown could socialise losses across depositors.
        </p>
        <p>
          The mitigations are the 140/110 buffer, the 0.001 BTC deposit floor, and a protocol-owned
          insurance buffer funded from the 5% liquidation penalty, which stands at zero because
          nothing has been liquidated. Automated keeper monitoring is not built yet. They are
          mitigations, not a guarantee. If you hold more than the protocol minimum, Maren steers you
          to a direct trove, which carries no pooling risk at all, and the interface says so at the
          point of decision.
        </p>
      </>
    ),
  },
  {
    q: 'What does “gasless” actually mean?',
    a: (
      <>
        {/* CONDITIONAL, NOT DELETED. `RELAYER_CONFIGURED` is read from
            NEXT_PUBLIC_RELAYER_URL at build time, so it is the same value on the
            server and in the browser and this paragraph cannot flicker. It says
            what is true of THIS deployment; neither branch promises the relayer
            is accepting work right now. The app answers that per action, at the
            point of signing, from a live health probe. */}
        {RELAYER_CONFIGURED ? (
          <p>
            <strong className="font-bold text-[color:var(--ink)]">
              It means Maren pays the Bitcoin fee, not that the fee stopped existing.
            </strong>{' '}
            This deployment has a relayer. Whether it is taking work is a question the app answers
            per action, on the screen, before you sign anything. Trust that line and not this page.
          </p>
        ) : (
          <p>
            <strong className="font-bold text-[color:var(--ink)]">
              Sponsorship is not configured for this web client.
            </strong>{' '}
            The iOS testnet beta has a hosted relayer. Availability and eligibility are checked per
            action, and the confirmation screen shows who pays.
          </p>
        )}
        <p>
          {RELAYER_CONFIGURED ? 'It works like this: y' : 'For eligible sponsored calls, y'}
          ou sign; Maren checks what you signed, tries the call, and pays. Whatever submits for you
          can only ever touch Maren’s own contracts, and can never move your Bitcoin.
        </p>
        <p>
          BTC deposits carry native value and require your own BTC for gas. Link creation and
          approvals can also require gas. Keep a small testnet BTC balance and check the fee shown
          before signing.
        </p>
      </>
    ),
  },
  {
    q: 'Has Maren been audited?',
    a: (
      <>
        <p>
          <strong className="font-bold text-[color:var(--ink)]">
            Not yet. Maren is pre-audit.
          </strong>{' '}
          A third-party audit of <span className="num text-[color:var(--ink)]">MarenVault</span>,{' '}
          <span className="num text-[color:var(--ink)]">MarenEarn</span> and{' '}
          <span className="num text-[color:var(--ink)]">MarenRelayHub</span> (the three contracts in
          the planned audit scope) is required before mainnet.
        </p>
        <p>
          Until that audit is complete and published, treat Maren as unaudited software and do not
          send any real funds. This beta uses testnet funds only. Mainnet launches with the vault
          capped, and the cap is raised only as the position proves out.
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
    <div className="border-b border-[color:var(--border-hairline)] last:border-b-0">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="group flex w-full items-center gap-4 px-6 py-5 text-left"
        >
          <span
            aria-hidden
            className="num w-6 shrink-0 text-[13px] font-semibold text-[color:var(--placeholder)]"
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span
            className="flex-1 text-balance text-[17px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {item.q}
          </span>
          <span
            aria-hidden
            className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-[200ms] ease-out ${
              open
                ? 'bg-[color:var(--accent)] text-white'
                : 'bg-[color:var(--soft-fill)] text-[color:var(--ink)] group-hover:bg-[color:var(--accent-wash)] group-hover:text-[color:var(--accent-text)]'
            }`}
          >
            {open ? <Minus className="size-4" /> : <Plus className="size-4" />}
          </span>
        </button>
      </h3>

      <div className={`u-faq-body ${open ? 'is-open' : ''}`} inert={!open} aria-hidden={!open}>
        <div>
          <div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            className="space-y-4 px-6 pb-6 pl-[3.75rem] text-[15px] font-normal leading-[1.6] text-[color:var(--muted)]"
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
    <section id="faq" className="u-wrap scroll-mt-28 pt-32 sm:pt-48">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Tag>The awkward questions</Tag>
          <h2 className="u-display mt-5 max-w-[12ch] text-[clamp(30px,4.4vw,52px)]">
            Risk, stated plainly.
          </h2>
          <p className="mt-4 max-w-[38ch] text-[15px] font-normal leading-[1.5] text-[color:var(--muted)]">
            We are handling people’s Bitcoin. Risk gets stated plainly, or it is not stated at all.
          </p>
        </div>

        <div className="u-card overflow-hidden">
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
    </section>
  );
}
