'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { getChain } from '@maren/sdk';
import type { Hash } from 'viem';

import { explainError, type RevertReason } from '@/lib/chain/errors';
import { confirmTransaction, describeOutcome, type TxOutcome } from '@/lib/chain/receipt';
import { NETWORK } from '@/lib/data/source';
import { ActionButton } from './primitives';
import { ArrowRight } from '@/components/ui/icons';

/**
 * The transaction runner and its confirmation sheet.
 *
 * THERE IS NO SIMULATED PATH ANY MORE. This component used to have one: when the app was
 * in mock mode it slept 420ms, mutated a local store, and told the user "Simulated —
 * nothing was broadcast". That was honest as far as it went, but it meant every button in
 * the product had a branch that could satisfy a user without touching the chain. Every
 * action now either produces a real transaction hash or fails with a reason, and an action
 * the app cannot perform is DISABLED AT THE BUTTON with that reason next to it — never
 * offered and then faked.
 *
 * Three rules survive, and they are why this is one shared component rather than a pattern
 * each screen repeats:
 *
 *   1. NOTHING IS CONFIRMED WITHOUT A RECEIPT. `submit` returns a hash; `confirmTransaction`
 *      is the only code in the app that decides what "delivered" means. A hash on its own
 *      renders as "submitted", never as success.
 *   2. THE EXPLORER LINK APPEARS WITH THE HASH, not with the receipt. Someone watching a
 *      pending transaction should be able to go and look at it.
 *   3. A REFUSAL IS EXPLAINED. Every failure runs through `explainError`, which decodes the
 *      contract's own custom errors into language. A user told `0x7d1cc1b3…` has been told
 *      nothing.
 *
 * The confirmation step is not decoration either: it is where a payment's resolved address
 * is shown next to the handle it came from, before anything is signed.
 */

const explorer = getChain(NETWORK).blockExplorers?.default.url ?? '';

/** The explorer URL for a hash. Shown the moment one exists, receipt or no receipt. */
export function explorerTxUrl(hash: Hash): string {
  return `${explorer}/tx/${hash}`;
}

export interface TxDetail {
  label: string;
  value: ReactNode;
}

export interface TxIntent {
  /** Imperative title, e.g. "Send 240.00 MUSD to @a-handle". */
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
  /**
   * Submits the real transaction and returns its hash, or throws.
   *
   * Optional only because a screen may build an intent before a signer exists. Reaching
   * the sheet without it is a bug, and it is reported as one rather than smoothed over —
   * see `run`.
   */
  submit?: () => Promise<Hash>;
  /** Label for the confirm button. */
  confirmLabel: string;
}

type Phase =
  | { name: 'idle' }
  | { name: 'confirm'; intent: TxIntent }
  | { name: 'submitting'; intent: TxIntent }
  | { name: 'pending'; intent: TxIntent; hash: Hash }
  | { name: 'settled'; intent: TxIntent; outcome: TxOutcome; reason: RevertReason | null }
  | { name: 'error'; intent: TxIntent; reason: RevertReason };

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
  const client = usePublicClient();
  const queryClient = useQueryClient();

  const request = useCallback((intent: TxIntent) => setPhase({ name: 'confirm', intent }), []);

  const close = useCallback(() => {
    setPhase({ name: 'idle' });
  }, []);

  const run = useCallback(
    async (intent: TxIntent) => {
      /**
       * No signer, no transaction, no pretending.
       *
       * Every screen disables its button before this can happen, so reaching it means a
       * guard is wrong. It surfaces as a plain refusal rather than a fabricated success,
       * because the failure mode this whole module exists to prevent is a user being told
       * their money moved when nothing was ever broadcast.
       */
      if (!intent.submit) {
        setPhase({
          name: 'error',
          intent,
          reason: {
            name: null,
            title: 'Nothing to sign with',
            detail:
              'This action has no connected signer on Mezo, so there is no transaction to send. ' +
              'Connect a wallet on the right network and try again.',
          },
        });
        return;
      }

      setPhase({ name: 'submitting', intent });
      let hash: Hash;
      try {
        hash = await intent.submit();
      } catch (error) {
        // Includes the pre-flight simulation, so a doomed borrow lands here with its
        // decoded reason and the user has neither signed nor spent gas.
        setPhase({ name: 'error', intent, reason: explainError(error) });
        return;
      }

      setPhase({ name: 'pending', intent, hash });

      if (!client) {
        setPhase({
          name: 'settled',
          intent,
          outcome: { kind: 'unreachable', hash, error: 'No RPC client available.' },
          reason: null,
        });
        return;
      }

      const outcome = await confirmTransaction(client, hash, { sponsored: intent.gas.sponsored });
      await queryClient.invalidateQueries({ queryKey: ['maren'] });

      /**
       * A transaction that passed simulation and then reverted anyway means state moved
       * underneath it — a price tick, someone else's borrow. Replaying the call at the
       * block it failed in recovers the actual revert data, so even this path names its
       * reason instead of shrugging.
       */
      let reason: RevertReason | null = null;
      if (outcome.kind === 'reverted') {
        reason = await replayRevert(client, outcome.hash).catch(() => null);
      }

      setPhase({ name: 'settled', intent, outcome, reason });
    },
    [client, queryClient],
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
                  <dt className="text-text-muted text-sm">{detail.label}</dt>
                  <dd className="text-right text-sm">{detail.value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-text-subtle mt-4 text-xs leading-relaxed">{intent.gas.note}</p>

            {intent.caution ? (
              <p className="text-warning mt-4 text-sm leading-relaxed" role="alert">
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
            <p className="text-text-muted text-sm leading-relaxed">
              Submitted. Waiting for a receipt. A transaction hash is not a result, so nothing is
              marked delivered until the chain returns one with
              <span className="num"> status success</span>.
            </p>
            {/* The explorer link appears WITH THE HASH, not with the receipt. A user
                watching a pending transaction should be able to go and look at it. */}
            <HashLine hash={phase.hash} />
          </div>
        ) : null}

        {phase.name === 'settled' ? (
          <Settled outcome={phase.outcome} reason={phase.reason} />
        ) : null}

        {phase.name === 'error' ? (
          <div className="mt-5" role="alert">
            <p className="text-danger text-sm">{phase.reason.title}</p>
            <p className="text-text-muted mt-2 break-words text-sm leading-relaxed">
              {phase.reason.detail}
            </p>
            {phase.reason.name ? (
              <p className="num text-text-subtle mt-3 text-xs">
                Contract error: {phase.reason.name}
              </p>
            ) : null}
          </div>
        ) : null}

        {phase.name === 'settled' || phase.name === 'error' ? (
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

function Settled({ outcome, reason }: { outcome: TxOutcome; reason: RevertReason | null }) {
  const described = describeOutcome(outcome);
  const good = outcome.kind === 'delivered';
  const hash = 'hash' in outcome ? outcome.hash : outcome.receipt.hash;
  return (
    <div className="mt-5" role="status">
      <p className={`text-sm ${good ? 'text-success' : 'text-danger'}`}>{described.title}</p>
      <p className="text-text-muted mt-2 text-sm leading-relaxed">{described.detail}</p>
      {/* When a mined transaction reverted, the decoded reason is the useful part —
          "it reverted" alone tells a user nothing they can act on. */}
      {reason ? (
        <p className="text-text-muted mt-3 break-words text-sm leading-relaxed">
          <span className="text-text">{reason.title}.</span> {reason.detail}
        </p>
      ) : null}
      <HashLine hash={hash} />
    </div>
  );
}

/** A transaction hash and its explorer link. One component, so they never drift apart. */
function HashLine({ hash }: { hash: Hash }) {
  return (
    <div className="mt-3">
      <p className="num text-text-subtle break-all text-xs">{hash}</p>
      <a
        href={explorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer noopener"
        className="text-text-muted hover:text-text mt-2 inline-flex items-center gap-1.5 text-xs underline decoration-[var(--border-strong)] underline-offset-4 transition-colors duration-[120ms] ease-out"
      >
        View on the Mezo explorer
        <span aria-hidden>↗</span>
      </a>
    </div>
  );
}

/**
 * Recover the revert reason for a transaction that already failed on-chain.
 *
 * Re-executes the exact call against the state of the block it was mined in — the same
 * thing an explorer does. It cannot change the outcome; it only asks the node to fail the
 * same way again, this time somewhere we can read the error data.
 */
async function replayRevert(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  hash: Hash,
): Promise<RevertReason | null> {
  const tx = await client.getTransaction({ hash });
  try {
    await client.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: tx.blockNumber,
    });
    // It did not revert on replay, so state has moved on and there is nothing honest to
    // report beyond the receipt itself.
    return null;
  } catch (error) {
    return explainError(error);
  }
}
