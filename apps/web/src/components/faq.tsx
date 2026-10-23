'use client';

import { useId, useState, type ReactNode } from 'react';
import { Plus } from './ui/icons';
import { LandingSection, SectionHead } from './landing/section-head';
import { PillButton } from './ui/pill-button';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

/**
 * FAQ: the awkward questions, answered plainly. The answers are Maren's positions
 * carried over intact and only tightened: the pooled-trove socialised-loss risk, the
 * hand-run keeper, the pre-audit status, and the gasless caveat (which flips on
 * RELAYER_CONFIGURED so the page never claims a relayer that is not deployed).
 * Keep every risk statement when editing; reword, never delete.
 */

type Item = { q: string; a: ReactNode };

/** Emphasis inside an answer: the ink colour and the leading weight, never bold. */
function Em({ children }: { children: ReactNode }) {
  return <strong className="text-text font-medium">{children}</strong>;
}

const items: readonly Item[] = [
  {
    q: 'What happens if the price of Bitcoin falls?',
    a: (
      <>
        <p>
          Your position is measured by its collateral ratio. Mezo liquidates a trove at{' '}
          <Em>110%</Em>. Maren’s own liquidation threshold is <Em>140%</Em>: below it, Maren seizes
          that user’s collateral at a 5% penalty and repays their share of the pooled debt.
        </p>
        <p>
          The 30-point buffer means a fast drawdown reaches Maren’s threshold long before it reaches
          the protocol’s cliff. The app shows your ratio and your distance to 140% on every read.
          The keeper that acts on it is not automated yet: the contract functions are deployed, but
          they are run by hand today. If Bitcoin falls far enough and fast enough, a position can
          still be liquidated. That is the nature of a collateralised loan, and no design removes
          it.
        </p>
      </>
    ),
  },
  {
    q: 'Does Maren custody my Bitcoin?',
    a: (
      <>
        <p>
          You control the signing keys. Payments move MUSD wallet to wallet via transferFrom under
          your own permit. Deposited Bitcoin is held by the vault’s smart contracts, claimable links
          hold MUSD in escrow until they are claimed or reclaimed after expiry, and Earn holds
          deposited MUSD.
        </p>
        <p>
          The pooled vault is the honest exception, and we will not soften it:{' '}
          <Em>pooled positions share one trove</Em>. Maren runs a single large, conservatively
          managed trove and gives each depositor a proportional claim inside it. Your collateral is
          segregated in accounting, not in custody. A catastrophic, faster-than-keeper drawdown
          could socialise losses across depositors.
        </p>
        <p>
          The mitigations are the 140/110 buffer, the 0.001 BTC deposit floor, and a protocol-owned
          insurance buffer funded from the 5% liquidation penalty, which stands at zero because
          nothing has been liquidated. Automated keeper monitoring is not built yet. These are
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
            <Em>Maren pays the Bitcoin fee; the fee has not stopped existing.</Em> This deployment
            has a relayer. Whether it is taking work is something the app answers per action, on
            screen, before you sign anything. Trust that line, not this page.
          </p>
        ) : (
          <p>
            <Em>Sponsorship is not configured for this web client.</Em> The iOS app has a hosted
            relayer. Availability and eligibility are checked per action, and the confirmation
            screen shows who pays.
          </p>
        )}
        <p>
          {RELAYER_CONFIGURED ? 'It works like this: y' : 'For eligible sponsored calls, y'}
          ou sign, Maren checks what you signed, simulates the call, and pays. Whatever submits for
          you can only ever touch Maren’s own contracts, and can never move your Bitcoin.
        </p>
        <p>
          BTC deposits carry native value and need your own BTC for gas. Payment links and approvals
          can need gas too. Keep a small testnet BTC balance, and check the fee shown before you
          sign.
        </p>
      </>
    ),
  },
  {
    q: 'Has Maren been audited?',
    a: (
      <>
        <p>
          <Em>Not yet. Maren is pre-audit.</Em> A third-party audit of MarenVault, MarenEarn and
          MarenRelayHub, the three contracts in the planned audit scope, is required before mainnet.
        </p>
        <p>
          Until that audit is complete and published, treat Maren as unaudited software and do not
          send it real funds. This beta uses testnet funds only. Mainnet launches with the vault
          capped, and the cap rises only as the position proves out.
        </p>
      </>
    ),
  },
];

function AccordionItem({
  item,
  open,
  onToggle,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  const buttonId = `faq-trigger-${id}`;
  const panelId = `faq-panel-${id}`;

  return (
    <div className="border-b border-[var(--border-hairline)]">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="group flex min-h-11 w-full items-start justify-between gap-6 py-6 text-left"
        >
          <span className="t-h3 text-pretty">{item.q}</span>
          <span
            aria-hidden
            className="text-text-muted group-hover:text-text grid size-6 shrink-0 place-items-center transition-[color] duration-150"
          >
            <Plus
              className={`size-[18px] transition-transform duration-200 ease-[var(--ease-standard)] ${open ? 'rotate-45' : ''}`}
            />
          </span>
        </button>
      </h3>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        className="faq-panel text-text-muted max-w-[64ch] space-y-3 pb-7 text-base leading-[1.6] md:pr-12"
      >
        {item.a}
      </div>
    </div>
  );
}

export function Faq() {
  // Each answer opens on its own, so two can be read side by side. The first, the
  // price-fall risk, starts open: it is the answer people most need to see.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <LandingSection id="faq" labelledBy="faq-title">
      <SectionHead id="faq-title" label="FAQ" title="Risk, stated plainly.">
        We are handling people’s Bitcoin. Risk gets stated plainly, or it is not stated at all.
      </SectionHead>

      <div className="mx-auto mt-14 max-w-[880px] border-t border-[var(--border-hairline)]">
        {items.map((item, i) => (
          <AccordionItem key={item.q} item={item} open={open.has(i)} onToggle={() => toggle(i)} />
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <PillButton href="/docs/security/risk" variant="ghost">
          Read the full risk page
        </PillButton>
      </div>
    </LandingSection>
  );
}
