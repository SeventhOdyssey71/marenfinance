'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { Hash } from 'viem';

import { confirmTransaction, describeOutcome, type TxOutcome } from '@/lib/chain/receipt';
import { bumpDemoVersion } from '@/lib/data/demo';
import { useDataSource } from '@/lib/data/source';
import { ActionButton } from './primitives';
import { ArrowRight } from '@/components/ui/icons';

/**
 * The transaction runner and its confirmation sheet.
 *
 * Two rules live here, and they are the reason this is one shared component rather than
 * a pattern each screen repeats:
 *
 *   1. NOTHING IS CONFIRMED WITHOUT A RECEIPT. The live path submits, then hands the
 *      hash to `confirmTransaction`, which is the only code in the app that decides what
 *      "delivered" means. A hash on its own renders as "submitted", never as success.
 *   2. A SIMULATION IS NEVER DRESSED AS A TRANSACTION. While the contracts are
 *      undeployed the app is in mock mode, and this sheet says "Simulated" — it does not
 *      borrow the language of a receipt it never fetched.
 *
 * The confirmation step is not decoration either: it is where a payment's resolved
 * address is shown next to the handle it came from, before anything is signed.
 */

export interface TxDetail {
  label: string;
  value: ReactNode;
}

export interface TxIntent {
  /** Imperative title, e.g. "Send 240.00 MUSD to @nadia". */
  title: string;
  /** What the user is about to agree to, itemised. */
  details: TxDetail[];
  /**
   * Gas truth for THIS action. Never a blanket claim: MarenVault.deposit() is payable,
   * the relay hub refuses any request carrying value, so a deposit costs BTC gas while
   * a payment does not.
   */
  gas: { sponsored: boolean; note: string };
  /** Extra warning shown above the confirm button, e.g. a ratio below the recommendation. */
  caution?: string;
  /** Applies the local mock mutation. Mock mode only. */
  simulate?: () => void;
  /** Submits the real transaction and returns its hash. Live mode only. */
  submit?: () => Promise<Hash>;
  /** Label for the confirm button. */
  confirmLabel: string;
}

type Phase =
  | { name: 'idle' }
  | { name: 'confirm'; intent: TxIntent }
  | { name: 'submitting'; intent: TxIntent }
  | { name: 'pending'; intent: TxIntent; hash: Hash }
  | { name: 'settled'; intent: TxIntent; outcome: TxOutcome }
  | { name: 'simulated'; intent: TxIntent }
  | { name: 'error'; intent: TxIntent; message: string };

export interface TxRunner {
  phase: Phase;
  /** Opens the confirmation sheet. Nothing is signed until the user confirms. */
  request: (intent: TxIntent) => void;
  /** Carries out a confirmed intent. Called by the sheet, not by screens. */
  run: (intent: TxIntent) => Promise<void>;
  close: () => void;
}

export function useTxRunner(): TxRunner {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const source = useDataSource();
  const client = usePublicClient();
  const queryClient = useQueryClient();

  const request = useCallback((intent: TxIntent) => setPhase({ name: 'confirm', intent }), []);

  const close = useCallback(() => {
    setPhase({ name: 'idle' });
  }, []);

  const run = useCallback(
    async (intent: TxIntent) => {
      if (source.mode === 'mock' || !intent.submit) {
        setPhase({ name: 'submitting', intent });
        // A deliberate beat, so the simulated flow has the same shape as the real one
        // and the button cannot be double-fired.
        await new Promise((resolve) => setTimeout(resolve, 420));
        intent.simulate?.();
        bumpDemoVersion();
        await queryClient.invalidateQueries({ queryKey: ['maren'] });
        setPhase({ name: 'simulated', intent });
        return;
      }

      setPhase({ name: 'submitting', intent });
      let hash: Hash;
      try {
        hash = await intent.submit();
      } catch (error) {
        setPhase({
          name: 'error',
          intent,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      setPhase({ name: 'pending', intent, hash });

      if (!client) {
        setPhase({
          name: 'settled',
          intent,
          outcome: { kind: 'unreachable', hash, error: 'No RPC client available.' },
        });
        return;
      }

      const outcome = await confirmTransaction(client, hash, { sponsored: intent.gas.sponsored });
      await queryClient.invalidateQueries({ queryKey: ['maren'] });
      setPhase({ name: 'settled', intent, outcome });
    },
    [client, queryClient, source.mode],
  );

  return { phase, request, run, close };
}

export function TxSheet({ runner }: { runner: TxRunner }) {
  const { phase, run } = runner;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const open = phase.name !== 'idle';
  const busy = phase.name === 'submitting' || phase.name === 'pending';

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the dialog itself, so a screen reader announces the title before the
    // buttons and Tab lands inside rather than behind.
    dialogRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) runner.close();
      if (event.key !== 'Tab') return;
      // Keep focus inside the dialog: a modal that leaks focus to the page behind it is
      // unusable with a keyboard and invisible to a screen reader.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, runner]);

  if (phase.name === 'idle') return null;
  const intent = phase.intent;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => !busy && runner.close()}
        className="absolute inset-0 cursor-default bg-[#08080A]/80 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-sheet-title"
        tabIndex={-1}
        className="card relative m-4 w-full max-w-lg p-6"
      >
        <h2 id="tx-sheet-title" className="t-h3 pr-8">
          {intent.title}
        </h2>

        {phase.name === 'confirm' || phase.name === 'submitting' ? (
          <>
            <dl className="mt-5">
              {intent.details.map((detail) => (
                <div
                  key={detail.label}
                  className="flex items-start justify-between gap-6 border-b border-[var(--border-hairline)] py-3 last:border-b-0"
                >
                  <dt className="text-sm text-text-muted">{detail.label}</dt>
                  <dd className="text-right text-sm">{detail.value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-text-subtle">{intent.gas.note}</p>

            {intent.caution ? (
              <p className="mt-4 text-sm leading-relaxed text-warning" role="alert">
                {intent.caution}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ActionButton
                onClick={() => void run(intent)}
                disabled={phase.name === 'submitting'}
                icon={<ArrowRight className="size-4" />}
              >
                {phase.name === 'submitting' ? 'Working…' : intent.confirmLabel}
              </ActionButton>
              <ActionButton variant="quiet" onClick={runner.close} disabled={busy}>
                Cancel
              </ActionButton>
            </div>
          </>
        ) : null}

        {phase.name === 'pending' ? (
          <div className="mt-5" role="status">
            <p className="text-sm leading-relaxed text-text-muted">
              Submitted. Waiting for a receipt — a transaction hash is not a result, so
              nothing is marked delivered until the chain returns one with
              <span className="num"> status success</span>.
            </p>
            <p className="num mt-3 text-xs break-all text-text-subtle">{phase.hash}</p>
          </div>
        ) : null}

        {phase.name === 'settled' ? <Settled outcome={phase.outcome} /> : null}

        {phase.name === 'simulated' ? (
          <div className="mt-5" role="status">
            <p className="text-sm text-warning">Simulated — nothing was broadcast</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Maren’s contracts are not deployed yet, so this action updated the demo
              figures only. No transaction was signed, no receipt was fetched, and no
              funds moved.
            </p>
          </div>
        ) : null}

        {phase.name === 'error' ? (
          <div className="mt-5" role="alert">
            <p className="text-sm text-danger">Not submitted</p>
            <p className="mt-2 text-sm leading-relaxed break-words text-text-muted">
              {phase.message}
            </p>
          </div>
        ) : null}

        {phase.name === 'settled' || phase.name === 'simulated' || phase.name === 'error' ? (
          <div className="mt-6">
            <ActionButton variant="secondary" onClick={runner.close}>
              Close
            </ActionButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Settled({ outcome }: { outcome: TxOutcome }) {
  const described = describeOutcome(outcome);
  const good = outcome.kind === 'delivered';
  return (
    <div className="mt-5" role="status">
      <p className={`text-sm ${good ? 'text-success' : 'text-danger'}`}>{described.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{described.detail}</p>
      {'hash' in outcome ? (
        <p className="num mt-3 text-xs break-all text-text-subtle">{outcome.hash}</p>
      ) : (
        <p className="num mt-3 text-xs break-all text-text-subtle">{outcome.receipt.hash}</p>
      )}
    </div>
  );
}
