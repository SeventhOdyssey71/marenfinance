'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { getChain, shortHash } from '@maren/sdk';
import type { Hash } from 'viem';

import { explainError, type RevertReason } from '@/lib/chain/errors';
import { confirmTransaction, describeOutcome, type TxOutcome } from '@/lib/chain/receipt';
import { NETWORK } from '@/lib/data/source';
import { PillAction } from '@/components/ui/pill-button';
import { ArrowRight, ArrowUpRight, Check, CopyIcon } from '@/components/ui/icons';

/**
 * The transaction runner and its sheet.
 *
 * THERE IS NO SIMULATED PATH ANY MORE. This component used to have one: when the app was
 * in mock mode it slept 420ms, mutated a local store, and told the user "Simulated —
 * nothing was broadcast". Every action now either produces a real transaction hash or
 * fails with a reason, and an action the app cannot perform is DISABLED AT THE BUTTON with
 * that reason next to it — see `lib/chain/preflight.ts` — never offered and then faked.
 *
 * FOUR RULES, and they are why this is one shared component rather than a pattern each
 * screen repeats:
 *
 *   1. NOTHING IS CONFIRMED WITHOUT A RECEIPT. `submit` returns a hash; `confirmTransaction`
 *      is the only code in the app that decides what "delivered" means. A hash on its own
 *      renders as "submitted", never as success.
 *   2. THE EXPLORER LINK APPEARS WITH THE HASH, not with the receipt. Someone watching a
 *      pending transaction should be able to go and look at it.
 *   3. A REFUSAL IS EXPLAINED. Every failure runs through `explainError`, which decodes the
 *      contract's own custom errors into language. A user told `0x7d1cc1b3…` has been told
 *      nothing. The decoded sentence leads; the Solidity name is secondary.
 *   4. THE SHEET LEADS WITH THE OUTCOME, NOT THE HASH. A live screenshot of a successful
 *      deposit showed a 66-character hash wrapping across two lines of low-contrast mono,
 *      dominating a sheet that never once said what had changed. The hash is now truncated
 *      behind a copy button and the headline is "Deposited 0.001 BTC" with the collateral
 *      before and after it. The full value belongs behind Copy; nobody reads 66 characters.
 *
 * THE PHASES ARE THE POINT OF THE MIDDLE OF THIS FILE. `checking` and `signing` are
 * separate states because they are separate facts: during `checking` nothing has been
 * asked of the user and an `eth_call` is deciding whether this can succeed at all; during
 * `signing` their wallet is open. A failure that arrives without `signing` ever being
 * reached is a failure that cost nothing, and the sheet says so in those words.
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

/**
 * One figure this transaction moves, before and after.
 *
 * The sheet's whole job on success is to answer "what changed", and a deposit that
 * confirms without naming the resulting collateral has answered nothing. Computed by the
 * screen, which is the only place that knows what the figure means.
 */
export interface TxChange {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

export interface TxIntent {
  /** Imperative title, e.g. "Send 240.00 MUSD to @a-handle". */
  title: string;
  /**
   * Past-tense headline for the delivered state, e.g. "Deposited 0.001 BTC".
   *
   * Falls back to `title`, which is imperative and reads oddly under a green tick, so
   * every screen should set it.
   */
  successTitle?: string;
  /** What the user is about to agree to, itemised. Shown while confirming. */
  details: TxDetail[];
  /** What this transaction moved. Shown once it has been delivered. */
  changes?: TxChange[];
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
   * Simulates first — see `simulateThenSign` in `lib/chain/write.ts`. A throw from the
   * simulation lands in the `error` phase with the contract's decoded reason and nothing
   * signed.
   *
   * Optional only because a screen may build an intent before a signer exists. Reaching
   * the sheet without it is a bug, and it is reported as one rather than smoothed over.
   */
  submit?: () => Promise<Hash>;
  /** Label for the confirm button. */
  confirmLabel: string;
}

type Phase =
  | { name: 'idle' }
  | { name: 'confirm'; intent: TxIntent }
  /** An `eth_call` is running. Nothing has been asked of the user. */
  | { name: 'checking'; intent: TxIntent }
  /** Simulation passed; the wallet is open. */
  | { name: 'signing'; intent: TxIntent }
  | { name: 'pending'; intent: TxIntent; hash: Hash }
  | { name: 'settled'; intent: TxIntent; outcome: TxOutcome; reason: RevertReason | null }
  /**
   * Never reached the chain. `signed` records whether the wallet was ever opened, which
   * is the difference between "we refused this for you, at no cost" and "your wallet
   * returned an error".
   */
  | { name: 'error'; intent: TxIntent; reason: RevertReason; signed: boolean };

export interface TxRunner {
  phase: Phase;
  /** Opens the confirmation sheet. Nothing is signed until the user confirms. */
  request: (intent: TxIntent) => void;
  /** Carries out a confirmed intent. Called by the sheet, not by screens. */
  run: (intent: TxIntent) => Promise<void>;
  /**
   * Pass to `useMarenWrites({ onSimulated })`. Moves the sheet from "checking" to
   * "waiting for your wallet" at the exact moment the simulation passes.
   */
  onSimulated: () => void;
  close: () => void;
}

export function useTxRunner(): TxRunner {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const client = usePublicClient();
  const queryClient = useQueryClient();

  /**
   * Whether the wallet has been opened for the transaction currently in flight.
   *
   * A ref rather than state because the value is read inside `run`'s catch, and a state
   * update queued from `onSimulated` would not be visible there in the same tick.
   */
  const signedRef = useRef(false);

  const request = useCallback((intent: TxIntent) => setPhase({ name: 'confirm', intent }), []);

  const close = useCallback(() => {
    setPhase({ name: 'idle' });
  }, []);

  const onSimulated = useCallback(() => {
    signedRef.current = true;
    setPhase((current) =>
      current.name === 'checking' ? { name: 'signing', intent: current.intent } : current,
    );
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
          signed: false,
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

      signedRef.current = false;
      setPhase({ name: 'checking', intent });

      let hash: Hash;
      try {
        hash = await intent.submit();
      } catch (error) {
        // Includes the pre-flight simulation, so a doomed borrow lands here with its
        // decoded reason and the user has neither signed nor spent gas. `signed` is what
        // lets the sheet make that promise out loud rather than leaving it implied.
        setPhase({ name: 'error', intent, reason: explainError(error), signed: signedRef.current });
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

  return { phase, request, run, onSimulated, close };
}

// ── the sheet ────────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'success' | 'danger' | 'warning';

const toneText: Record<Tone, string> = {
  neutral: 'text-text-muted',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
};

const toneDot: Record<Tone, string> = {
  neutral: 'bg-text-subtle',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
};

export function TxSheet({ runner }: { runner: TxRunner }) {
  const { phase, run } = runner;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const open = phase.name !== 'idle';
  const busy = phase.name === 'checking' || phase.name === 'signing' || phase.name === 'pending';

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the dialog itself, so a screen reader announces the title before the
    // buttons and Tab lands inside rather than behind.
    dialogRef.current?.focus();
    // Returning focus to the control that opened the sheet is not a nicety here: with the
    // preflight work, the trigger is often a button that is about to become disabled, and
    // a keyboard user left focused on `<body>` has lost their place on the page entirely.
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
      {/* A proper scrim: the app's own background at 78% with a real blur behind it, so
          the surface underneath reads as depth rather than as a hole cut in the page.
          The old backdrop was near-black at 80% with a 4px blur, which on a dark app is
          indistinguishable from switching the lights off. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => !busy && runner.close()}
        className="bg-[#08080A]/78 absolute inset-0 cursor-default backdrop-blur-lg"
      />
      {/* `card-modal`, not `card`: cards are border-only now, and a transparent dialog
          would show the screen it is interrupting straight through itself. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-sheet-title"
        tabIndex={-1}
        data-tx-phase={phase.name}
        className="card-modal relative m-0 w-full max-w-[30rem] rounded-b-none p-6 sm:m-4 sm:rounded-[var(--radius-card)] sm:p-7"
      >
        {phase.name === 'confirm' || phase.name === 'checking' || phase.name === 'signing' ? (
          <Confirming
            phase={phase}
            intent={intent}
            onConfirm={() => void run(intent)}
            runner={runner}
          />
        ) : null}

        {phase.name === 'pending' ? <Pending intent={intent} hash={phase.hash} /> : null}

        {phase.name === 'settled' ? (
          <Settled
            intent={intent}
            outcome={phase.outcome}
            reason={phase.reason}
            onClose={runner.close}
          />
        ) : null}

        {phase.name === 'error' ? (
          <Failed
            intent={intent}
            reason={phase.reason}
            signed={phase.signed}
            onClose={runner.close}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The eyebrow: one word for where this is, with a dot carrying the tone. */
function StatusLine({
  tone,
  children,
  spinning = false,
}: {
  tone: Tone;
  children: ReactNode;
  spinning?: boolean;
}) {
  return (
    <p className={`t-label flex items-center gap-2 ${toneText[tone]}`}>
      {spinning ? (
        <Spinner />
      ) : (
        <span aria-hidden className={`size-1.5 rounded-[var(--radius-pill)] ${toneDot[tone]}`} />
      )}
      {children}
    </p>
  );
}

/**
 * A spinner that obeys `prefers-reduced-motion`.
 *
 * BRAND.md §6: all motion is disabled under reduce. The global stylesheet already clamps
 * animation duration, which would leave a rotating ring frozen at whatever angle it
 * happened to reach — a broken-looking artefact rather than an absence of motion. So the
 * ring is hidden outright under reduce and a static dot takes its place.
 */
function Spinner() {
  return (
    <>
      <span
        aria-hidden
        className="size-3 shrink-0 animate-spin rounded-[var(--radius-pill)] border-2 border-current border-t-transparent motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="hidden size-1.5 shrink-0 rounded-[var(--radius-pill)] bg-current motion-reduce:block"
      />
    </>
  );
}

function Confirming({
  phase,
  intent,
  onConfirm,
  runner,
}: {
  phase: Phase;
  intent: TxIntent;
  onConfirm: () => void;
  runner: TxRunner;
}) {
  const checking = phase.name === 'checking';
  const signing = phase.name === 'signing';

  return (
    <>
      <StatusLine tone="neutral" spinning={checking || signing}>
        {checking ? 'Checking' : signing ? 'Waiting for your wallet' : 'Confirm'}
      </StatusLine>
      <h2 id="tx-sheet-title" className="t-h3 mt-3 pr-6">
        {intent.title}
      </h2>

      {checking ? (
        <p className="text-text-muted mt-3 max-w-[52ch] text-sm leading-relaxed">
          Running this against Mezo as a read-only call first. If it would revert, you will see why
          here and your wallet will never open.
        </p>
      ) : null}
      {signing ? (
        <p className="text-text-muted mt-3 max-w-[52ch] text-sm leading-relaxed">
          It would succeed against the chain as it is right now. Approve it in your wallet. This is
          the only signature this action needs.
        </p>
      ) : null}

      {phase.name === 'confirm' ? (
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
        </>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <PillAction
          onClick={onConfirm}
          disabled={checking || signing}
          icon={<ArrowRight className="size-4" />}
        >
          {checking ? 'Checking…' : signing ? 'In your wallet…' : intent.confirmLabel}
        </PillAction>
        <PillAction variant="ghost" onClick={runner.close} disabled={checking || signing}>
          Cancel
        </PillAction>
      </div>
    </>
  );
}

function Pending({ intent, hash }: { intent: TxIntent; hash: Hash }) {
  return (
    <div role="status">
      <StatusLine tone="neutral" spinning>
        Submitted
      </StatusLine>
      <h2 id="tx-sheet-title" className="t-h3 mt-3 pr-6">
        {intent.title}
      </h2>
      <p className="text-text-muted mt-3 max-w-[52ch] text-sm leading-relaxed">
        Waiting for a receipt. A transaction hash is not a result, so nothing is marked delivered
        until the chain returns one with <span className="num">status success</span>.
      </p>
      {/* The explorer link appears WITH THE HASH, not with the receipt. A user watching a
          pending transaction should be able to go and look at it. */}
      <HashLine hash={hash} />
    </div>
  );
}

function Settled({
  intent,
  outcome,
  reason,
  onClose,
}: {
  intent: TxIntent;
  outcome: TxOutcome;
  reason: RevertReason | null;
  onClose: () => void;
}) {
  const described = describeOutcome(outcome);
  const delivered = outcome.kind === 'delivered';
  const hash = 'hash' in outcome ? outcome.hash : outcome.receipt.hash;
  const tone: Tone = delivered ? 'success' : outcome.kind === 'reverted' ? 'danger' : 'warning';

  /**
   * THE DECODED REASON IS THE HEADLINE, not "Failed on-chain".
   *
   * A transaction that mined and reverted has two things to say and only one of them is
   * useful. "Failed on-chain" belongs in the eyebrow, where the state is; the headline
   * belongs to "Not enough collateral behind this loan", which is what the user can act
   * on. When the replay could not recover a reason we fall back to the outcome's own
   * title — better a duplicated line than a headline that says nothing.
   */
  const headline = delivered
    ? (intent.successTitle ?? intent.title)
    : (reason?.title ?? described.title);

  return (
    <div role="status">
      <StatusLine tone={tone}>{delivered ? 'Confirmed on Mezo' : described.title}</StatusLine>

      {/* THE OUTCOME LEADS. Not the hash, not the word "Delivered" — what happened, in
          past tense, at headline size. */}
      <h2 id="tx-sheet-title" className="t-h2 mt-3 pr-6">
        {headline}
      </h2>

      {delivered ? null : (
        <p className="text-text-muted mt-3 max-w-[52ch] text-sm leading-relaxed">
          {reason?.detail ?? described.detail}
        </p>
      )}

      {/* The mechanical facts, secondary: what the receipt said, and the Solidity name for
          anyone who wants to grep the source. */}
      {delivered ? null : (
        <div className="bg-surface-inset mt-5 rounded-[var(--radius-input)] border border-[var(--border-hairline)] p-4">
          <p className="text-text-muted text-sm leading-relaxed">{described.detail}</p>
          {reason?.name ? (
            <p className="num text-text-subtle mt-2.5 text-xs">Contract error: {reason.name}</p>
          ) : null}
          <p className="text-text-subtle mt-2.5 text-xs">
            Attempted: <span className="text-text-muted">{intent.title}</span>
          </p>
        </div>
      )}

      {delivered && intent.changes && intent.changes.length > 0 ? (
        <Changes changes={intent.changes} />
      ) : null}

      <HashLine hash={hash} />

      <div className="mt-6">
        <PillAction
          onClick={onClose}
          icon={delivered ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
        >
          {delivered ? 'Done' : 'Close'}
        </PillAction>
      </div>
    </div>
  );
}

function Failed({
  intent,
  reason,
  signed,
  onClose,
}: {
  intent: TxIntent;
  reason: RevertReason;
  signed: boolean;
  onClose: () => void;
}) {
  return (
    <div role="alert">
      <StatusLine tone="danger">Not submitted</StatusLine>

      {/* The decoded human reason IS the headline. The raw contract error is secondary and
          sits at the bottom in mono, for anyone who wants to grep the Solidity. */}
      <h2 id="tx-sheet-title" className="t-h2 mt-3 pr-6">
        {reason.title}
      </h2>
      <p className="text-text-muted mt-3 max-w-[52ch] text-sm leading-relaxed">{reason.detail}</p>

      <div className="bg-surface-inset mt-5 rounded-[var(--radius-input)] border border-[var(--border-hairline)] p-4">
        <p className="text-text-muted text-sm leading-relaxed">
          {signed
            ? 'Your wallet was asked to sign this and it did not go through. Nothing reached the chain.'
            : 'Maren checked this against Mezo before opening your wallet, so no signature was ' +
              'requested and no gas was spent.'}
        </p>
        {reason.name ? (
          <p className="num text-text-subtle mt-2.5 text-xs">Contract error: {reason.name}</p>
        ) : null}
        <p className="text-text-subtle mt-2.5 text-xs">
          Attempted: <span className="text-text-muted">{intent.title}</span>
        </p>
      </div>

      <div className="mt-6">
        <PillAction onClick={onClose} icon={<ArrowRight className="size-4" />}>
          Close
        </PillAction>
      </div>
    </div>
  );
}

/** What moved: each figure before, and after. */
function Changes({ changes }: { changes: TxChange[] }) {
  return (
    <dl className="bg-surface-inset mt-5 rounded-[var(--radius-input)] border border-[var(--border-hairline)] px-4">
      {changes.map((change) => (
        <div
          key={change.label}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--border-hairline)] py-3.5 last:border-b-0"
        >
          <dt className="text-text-muted text-sm">{change.label}</dt>
          <dd className="flex items-center gap-2.5 text-sm">
            {/* Subtle, not struck through. A strike-through across tabular numerals is
                hard to read and says "cancelled" rather than "was". The arrow already
                carries the direction. */}
            <span className="text-text-subtle">{change.before}</span>
            {/* Spoken, not just drawn: a screen reader reading "0.001 BTC 0.002 BTC" with
                a decorative arrow between them has been told two numbers and no relation. */}
            <span className="sr-only">changed to</span>
            <ArrowRight aria-hidden className="text-text-subtle size-3.5 shrink-0" />
            <span className="text-text">{change.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A transaction hash, truncated, with a copy affordance and the explorer link.
 *
 * The full 66 characters used to be printed in low-contrast mono and wrapped onto two
 * lines, which is the single largest thing on a sheet that ought to be about the money.
 * Nobody reads a hash; they copy it or they click through to it. `shortHash` comes from
 * `@maren/sdk` so web and iOS truncate identically, and the untruncated value stays
 * reachable through Copy and through the `title`.
 */
function HashLine({ hash }: { hash: Hash }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_800);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-hairline)] pt-4">
      <span className="t-label text-text-subtle">Transaction</span>
      <button
        type="button"
        title={hash}
        onClick={() => {
          void navigator.clipboard?.writeText(hash);
          setCopied(true);
        }}
        className="num text-text-muted hover:text-text inline-flex items-center gap-2 rounded-[var(--radius-pill)] text-xs transition-colors duration-[120ms] ease-out"
      >
        <span data-tx-hash>{shortHash(hash)}</span>
        {/* Cross-fade on swap, not a snap: the copy glyph fades, shrinks and blurs
            out while the check enters the same way, so the state change reads as
            motion rather than a replacement. Both glyphs stay mounted and stacked;
            the transition names opacity, transform and filter — nothing else. */}
        <span className="relative grid size-3.5 place-items-center">
          <CopyIcon
            aria-hidden
            className={`absolute transition-[opacity,transform,filter] duration-150 ease-out ${
              copied ? 'scale-50 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0'
            }`}
          />
          <Check
            aria-hidden
            className={`text-success absolute transition-[opacity,transform,filter] duration-150 ease-out ${
              copied ? 'scale-100 opacity-100 blur-0' : 'scale-50 opacity-0 blur-[2px]'
            }`}
          />
        </span>
        <span className="sr-only">{copied ? 'Copied' : 'Copy the full transaction hash'}</span>
      </button>
      <a
        href={explorerTxUrl(hash)}
        target="_blank"
        rel="noreferrer noopener"
        className="text-text-muted hover:text-text ml-auto inline-flex items-center gap-1.5 text-xs transition-colors duration-[120ms] ease-out"
      >
        Explorer
        <ArrowUpRight aria-hidden className="size-3.5" />
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
