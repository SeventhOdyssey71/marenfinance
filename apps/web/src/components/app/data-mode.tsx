'use client';

import { useState } from 'react';

import { setDemoAccount, setForcedStaleSeconds, useDemoState } from '@/lib/data/demo';
import { useDataSource } from '@/lib/data/source';

/**
 * The disclosure that keeps the rest of the app honest.
 *
 * Every figure in mock mode is demo data, and the user is told so on every screen rather
 * than in a footnote. The controls beside it exist because the two states this product
 * most needs to be judged on — a pooled position, and an oracle that has stopped — are
 * otherwise unreachable without a deployment.
 *
 * When `isDeployed()` flips, this collapses to a single live line and the controls
 * disappear with it.
 */
export function DataModeBanner() {
  const source = useDataSource();
  const demo = useDemoState();
  const [open, setOpen] = useState(false);

  if (source.mode === 'live') {
    return (
      <p className="text-xs text-text-subtle">
        Live from Mezo {source.network}. Figures are read from the contracts at the
        addresses in <span className="num">@maren/sdk</span>.
      </p>
    );
  }

  const stale = demo.forcedStaleSeconds > 0;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-surface-inset p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[68ch]">
          <p className="t-label text-warning">Demo data</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Maren’s contracts are not deployed yet, so every figure below is mock data on
            the Mezo {source.network} configuration. Nothing here is a real balance and
            no action broadcasts a transaction. The live reads are written and gated on{' '}
            <span className="num">isDeployed()</span> — see{' '}
            <span className="num">apps/web/README.md</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="demo-controls"
          className="inline-flex h-11 shrink-0 items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-surface-raised px-4 text-sm text-text-muted transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)] hover:text-text"
        >
          {open ? 'Hide demo controls' : 'Demo controls'}
        </button>
      </div>

      <div id="demo-controls" hidden={!open} className="mt-4 border-t border-[var(--border-hairline)] pt-4">
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <fieldset>
            <legend className="t-label text-text-subtle">Account</legend>
            <div className="mt-2.5 flex gap-2">
              {(
                [
                  { key: 'direct', label: 'Direct trove', hint: '0.5 BTC' },
                  { key: 'pooled', label: 'Pooled', hint: '0.012 BTC' },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setDemoAccount(option.key)}
                  aria-pressed={demo.account === option.key}
                  className={`inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm transition-colors duration-[120ms] ease-out ${
                    demo.account === option.key
                      ? 'border-[var(--border-strong)] bg-surface-raised text-text'
                      : 'border-[var(--border-hairline)] text-text-muted hover:text-text'
                  }`}
                >
                  {option.label}
                  <span className="num text-xs text-text-subtle">{option.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="t-label text-text-subtle">Oracle</legend>
            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => setForcedStaleSeconds(stale ? 0 : 240)}
                aria-pressed={stale}
                className={`inline-flex h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm transition-colors duration-[120ms] ease-out ${
                  stale
                    ? 'border-warning/40 bg-surface-raised text-warning'
                    : 'border-[var(--border-hairline)] text-text-muted hover:text-text'
                }`}
              >
                {stale ? 'Oracle stalled — restore it' : 'Stall the oracle (240s)'}
              </button>
            </div>
          </fieldset>
        </div>

        <p className="mt-4 max-w-[68ch] text-xs leading-relaxed text-text-subtle">
          Stalling the oracle drives the app into the state Mezo produces above 60 seconds
          of staleness: borrowing is refused, repay stays open, and no figure is computed
          from the last known price.
        </p>
      </div>
    </div>
  );
}
