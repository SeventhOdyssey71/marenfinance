import { Reveal } from './ui/reveal';
import { Counter, Kicker, Ticks } from './landing/ui';
import { Check } from './ui/icons';

/**
 * Rows — how Maren works, as two alternating product rows over a three-step
 * rail: connect, deposit BTC and draw MUSD, then spend it. Honest throughout —
 * the gasless line says plainly that a relayer is not running yet, and the
 * borrow panel is flagged illustrative.
 */

const STEPS: readonly [string, string, string][] = [
  ['01', 'Connect', 'Any EVM wallet, injected or WalletConnect. Nothing to install, no BTC balance needed to start.'],
  ['02', 'Deposit BTC, draw MUSD', 'From 0.001 BTC. You see your ratio, your capacity and your distance to liquidation before you sign.'],
  ['03', 'Spend it', 'Pay a handle, send a link, request or split. Idle MUSD can sit in Earn instead of sitting still.'],
];

function CheckList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-7 border-t border-[color:var(--l-line)]">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-3.5 border-b border-[color:var(--l-line)] py-3.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--l-accent-soft)] text-[var(--l-accent-ink)]">
            <Check className="size-3" />
          </span>
          <span className="text-[14px] leading-[1.5] text-[var(--l-muted)]">{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Illustrative borrow panel — a fill against the 140% floor, example figures. */
function BorrowVisual() {
  return (
    <div
      className="w-full max-w-[380px] rounded-[14px] border border-[color:var(--l-line)] bg-[var(--l-white)] p-6"
      style={{ boxShadow: '0 30px 70px -34px rgba(20,18,35,0.32)' }}
    >
      <div className="flex items-center justify-between">
        <span className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-dim)]">Draw MUSD</span>
        <span className="l-mono rounded-full bg-[var(--l-accent-soft)] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-[var(--l-accent-ink)]">
          Illustrative
        </span>
      </div>
      <div className="num mt-2 text-[30px] font-medium leading-none tracking-[-0.02em] text-[var(--l-ink)]">
        1,200 <span className="text-[var(--l-dim)]">MUSD</span>
      </div>
      <div className="mt-6 h-1.5 rounded-full bg-[var(--l-accent-soft)]">
        <div className="h-full w-[62%] rounded-full bg-[var(--l-accent)]" />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="l-mono text-[10px] uppercase tracking-[0.12em] text-[var(--l-dim)]">Collateral</dt>
          <dd className="num mt-1.5 text-[14px] text-[var(--l-ink)]">0.0500 BTC</dd>
        </div>
        <div>
          <dt className="l-mono text-[10px] uppercase tracking-[0.12em] text-[var(--l-dim)]">Ratio</dt>
          <dd className="num mt-1.5 text-[14px] text-[var(--l-ink)]">262%</dd>
        </div>
      </dl>
    </div>
  );
}

/** Illustrative pay thread — two example sends. */
function PayVisual() {
  const rows: readonly [string, string, string][] = [
    ['@amara', 'handle · resolved before you sign', '$100.00'],
    ['claim link', 'no BTC needed to receive', '$40.00'],
  ];
  return (
    <div
      className="w-full max-w-[380px] rounded-[14px] border border-[color:var(--l-line)] bg-[var(--l-white)] p-5"
      style={{ boxShadow: '0 30px 70px -34px rgba(20,18,35,0.32)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-dim)]">Pay</span>
        <span className="l-mono rounded-full bg-[var(--l-accent-soft)] px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-[var(--l-accent-ink)]">
          Illustrative
        </span>
      </div>
      <ul className="space-y-2.5">
        {rows.map(([to, meta, amt]) => (
          <li
            key={to}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--l-line)] px-3.5 py-3"
          >
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-[var(--l-ink)]">{to}</div>
              <div className="num text-[11px] text-[var(--l-dim)]">{meta}</div>
            </div>
            <div className="num text-[14px] font-medium text-[var(--l-ink)]">{amt}</div>
          </li>
        ))}
      </ul>
      <div className="l-mono mt-3 flex items-center gap-1.5 text-[10.5px] text-[var(--l-muted)]">
        <span className="text-[var(--l-accent-ink)]">✓</span> Memo written on-chain
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="l-frame relative scroll-mt-24 border-t border-[color:var(--l-line)] px-5 pt-20 sm:px-8"
    >
      <Ticks />

      <Reveal className="flex flex-col items-center text-center">
        <Kicker>How it works</Kicker>
        <h2 className="mt-7 max-w-[18ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--l-ink)]">
          Deposit, draw, spend
        </h2>
        <p className="mt-5 max-w-[52ch] text-[16px] leading-[1.55] text-[var(--l-muted)]">
          Three steps, one signature each. Borrow against Bitcoin without selling it, then move the
          dollars you draw the way you already move money.
        </p>
      </Reveal>

      {/* Three-step rail */}
      <Reveal className="relative mt-16 grid grid-cols-1 border-y border-[color:var(--l-line)] md:grid-cols-3">
        <Ticks />
        {[33.333, 66.666].map((p) => (
          <span key={`t${p}`} aria-hidden className="l-tick hidden md:block" style={{ left: `${p}%`, top: 0, transform: 'translate(-50%,-50%)' }} />
        ))}
        {[33.333, 66.666].map((p) => (
          <span key={`b${p}`} aria-hidden className="l-tick hidden md:block" style={{ left: `${p}%`, bottom: 0, transform: 'translate(-50%,50%)' }} />
        ))}
        {STEPS.map(([k, title, body], i) => (
          <div
            key={k}
            className={`p-6 sm:p-8 ${i > 0 ? 'border-t border-[color:var(--l-line)] md:border-l md:border-t-0' : ''}`}
          >
            <span className="l-mono text-[13px] text-[var(--l-accent-ink)]">{k}</span>
            <h3 className="mt-6 text-[18px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">{title}</h3>
            <p className="mt-3 text-[14px] leading-[1.55] text-[var(--l-muted)]">{body}</p>
          </div>
        ))}
      </Reveal>

      {/* Row A — Borrow */}
      <Reveal className="relative grid grid-cols-1 items-center gap-10 border-b border-[color:var(--l-line)] py-14 lg:grid-cols-2 lg:gap-16">
        <span aria-hidden className="l-tick l-tick-bl" />
        <span aria-hidden className="l-tick l-tick-br" />
        <div className="mx-auto w-full max-w-[380px]">
          <BorrowVisual />
        </div>
        <div>
          <h3 className="text-[clamp(20px,2.3vw,28px)] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--l-ink)]">
            Borrow against your Bitcoin
          </h3>
          <p className="mt-4 max-w-[46ch] text-[15.5px] leading-[1.55] text-[var(--l-muted)]">
            Deposit from 0.001 BTC and draw MUSD against it. Your share of the pooled trove is
            ledgered to you, so you see your own position — never the pool&rsquo;s.
          </p>
          <CheckList
            items={[
              'You see your own collateral, debt and ratio, not the pool’s',
              'Maren liquidates at 140%, thirty points above the protocol’s 110%',
              'Repay and withdraw at any time. Exits stay open when entries close',
              'Above the protocol minimum, you get a direct trove with no pooling risk',
            ]}
          />
        </div>
      </Reveal>

      {/* Row B — Pay (reversed) */}
      <Reveal className="relative grid grid-cols-1 items-center gap-10 border-b border-[color:var(--l-line)] py-14 lg:grid-cols-2 lg:gap-16">
        <span aria-hidden className="l-tick l-tick-bl" />
        <span aria-hidden className="l-tick l-tick-br" />
        <div className="mx-auto w-full max-w-[380px] lg:order-2 lg:ml-auto">
          <PayVisual />
        </div>
        <div className="lg:order-1">
          <h3 className="text-[clamp(20px,2.3vw,28px)] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--l-ink)]">
            Pay like it&rsquo;s a message
          </h3>
          <p className="mt-4 max-w-[46ch] text-[15.5px] leading-[1.55] text-[var(--l-muted)]">
            MUSD exists; a consumer surface for it did not. Maren adds the shapes people already use
            to move money — handles, links, requests and splits.
          </p>
          <CheckList
            items={[
              'Send to an @handle — the resolved address is shown before you sign',
              'Send a claimable link; the recipient needs no BTC and no prior setup',
              'Request an amount, or split one payment across many recipients',
              'Attach a memo — written on-chain and publicly readable, forever',
            ]}
          />
          <p className="mt-6 max-w-[46ch] text-[13px] leading-[1.5] text-[var(--l-dim)]">
            Gasless is by design, not a claim about today: no relayer is running yet, so for now your
            own wallet submits — and every screen says so before you sign.
          </p>
        </div>
      </Reveal>

      <div className="l-hatch mt-14 h-16" />
      <div className="pb-8">
        <Counter n="03" label="How it works" />
      </div>
    </section>
  );
}
