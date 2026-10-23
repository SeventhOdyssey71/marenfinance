'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMusd, shortAddress } from '@maren/sdk';
import type { Address } from 'viem';

import { BlockedNote } from '@/components/app/blocked';
import { Dash, Musd } from '@/components/app/money';
import { Note } from '@/components/app/primitives';
import { PillAction } from '@/components/ui/pill-button';
import { ArrowRight, ArrowUpRight, Check } from '@/components/ui/icons';
import { parseUnitsSafe, utf8Length } from '@/lib/copy';
import { parsePaymentRequest } from '@/lib/payment-request';
import { preflightMusdSpend } from '@/lib/chain/preflight';
import { actionIsRelayable } from '@/lib/chain/relay';
import {
  gasLine,
  gasNote,
  SPENDERS,
  useMarenWrites,
  useMusdAllowance,
  useRelayerStatus,
} from '@/lib/chain/write';
import {
  useActivity,
  useBalances,
  useDataSource,
  usePrimaryHandle,
  useResolvedHandle,
} from '@/lib/data/source';
import type { TxIntent, TxRunner } from '@/components/app/tx';

/**
 * The Send flow — a paced Amount → Recipient → Review choreography over the existing chain
 * layer, ported from Talise's stepper into Maren's own brand and honesty rules.
 *
 * The submit itself is NOT reimplemented here. Review hands off to the shared `TxRunner`,
 * whose sheet runs the one honest path the whole app uses: simulate, route through the
 * relayer only when it will genuinely pay, and confirm against a real receipt before
 * anything is called delivered (see `lib/chain/tx.tsx` and `lib/chain/receipt.ts`). This
 * screen owns the ENTRY choreography; the money-moving states — Submitting, Delivered,
 * Failed — stay in the code that already gets them right. When a send is delivered the flow
 * resets itself to a fresh Amount step.
 *
 * Two things Talise did that Maren does not, on purpose: there is no slide-to-confirm (the
 * confirmation and its receipt live in the sheet, where a signature actually happens), and
 * "recent" recipients are read from real on-chain Activity, never a seeded contact list.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

type Step = 'amount' | 'recipient' | 'review';

const STEPS: { key: Step; label: string }[] = [
  { key: 'amount', label: 'Amount' },
  { key: 'recipient', label: 'Recipient' },
  { key: 'review', label: 'Review' },
];

/**
 * The text field the Pay surfaces share, drawn exactly like `AmountField`'s box: white,
 * square, a strong hairline that turns violet on focus (the focus indicator, replacing the
 * outline). Exported so the other Pay panels type into the same control rather than a
 * near copy of it.
 */
export const TEXT_FIELD =
  'bg-surface text-text placeholder:text-text-subtle h-12 w-full min-w-0 border border-[var(--border-strong)] px-4 text-[0.9375rem] outline-none transition-[border-color] duration-150 ease-out focus:border-violet-500';

/** The same box for a field with a unit beside the input ("days", "MUSD"). */
export const SUFFIX_FIELD =
  'bg-surface flex h-12 items-center gap-2 border border-[var(--border-strong)] px-4 transition-[border-color] duration-150 ease-out focus-within:border-violet-500';

/** The quiet sentence-case label above a field. */
export const FIELD_LABEL = 't-label block';

/**
 * The bottom band of a composer card: one line of context on the left (the gas payer,
 * the balance), the square submit on the right. On a phone the note sits above a
 * full-width button. `stack` keeps that column layout at every width, for two buttons.
 */
export function ComposerFooter({
  note,
  stack = false,
  children,
}: {
  note?: ReactNode;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 border-t border-[var(--border-hairline)] px-5 py-4 ${
        stack ? '' : 'sm:flex-row sm:items-center sm:justify-between sm:gap-6'
      }`}
    >
      {note ? (
        <div className="text-text-muted min-w-0 text-pretty text-[0.8125rem] leading-relaxed">
          {note}
        </div>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      <div className={`flex shrink-0 flex-col gap-2 sm:flex-row ${stack ? 'sm:justify-end' : ''}`}>
        {children}
      </div>
    </div>
  );
}

/** Full width on a phone, sized to its label from `sm`. */
export const FOOTER_BUTTON = 'w-full justify-between sm:w-auto sm:min-w-[10rem]';

export function SendFlow({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
  const { data: myHandle } = usePrimaryHandle();
  const { account } = useDataSource();

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    const request = parsePaymentRequest(new URLSearchParams(window.location.search));
    if (!request) return;
    setTo(request.to);
    if (request.amount !== undefined) setAmount(request.amount);
    // Stay on the amount step. Shared URLs never open signing or submit automatically.
  }, []);

  const trimmed = to.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: resolved, isFetching } = useResolvedHandle(trimmed);

  const amountWei = parseUnitsSafe(amount);
  const balance = balances?.musdWei ?? 0n;
  const recipient: Address | null = isAddress ? (trimmed as Address) : (resolved?.address ?? null);
  const memoBytes = utf8Length(memo);

  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.pay, amountWei);

  // Same precondition the existing page enforced: a payment moves MUSD, so it fails loudly
  // at the button when the wallet cannot cover it — or when the pooled trove is under its
  // floor and nobody can borrow MUSD at all — rather than inside a bare ERC20 revert.
  const funds = preflightMusdSpend(balances, amountWei, { verb: 'send', noun: 'Send' });
  const amountReady = funds.ok && amountWei > 0n;
  const recipientReady = recipient !== null && memoBytes <= 80;

  // After a delivered send, start clean. The sheet owns delivery; this only notices it
  // happened and resets the entry flow so "Send another" is the default next state.
  const sawDelivered = useRef(false);
  useEffect(() => {
    const phase = runner.phase;
    if (phase.name === 'settled' && phase.outcome.kind === 'delivered') {
      sawDelivered.current = true;
    } else if (phase.name === 'idle' && sawDelivered.current) {
      sawDelivered.current = false;
      setStep('amount');
      setAmount('');
      setTo('');
      setMemo('');
      refetchAllowance();
    }
  }, [runner.phase, refetchAllowance]);

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(amountWei)} for MarenPay`,
    successTitle: `Approved ${formatMusd(amountWei)}`,
    changes: [
      {
        label: 'MarenPay allowance',
        before: <Musd wei={allowanceWei ?? 0n} />,
        after: <Musd wei={amountWei} />,
      },
    ],
    details: [
      { label: 'Token', value: <span className="text-text-muted">MUSD</span> },
      { label: 'Amount', value: <Musd wei={amountWei} /> },
      {
        label: 'Spender',
        value: <span className="mono text-text-muted break-all text-xs">{SPENDERS.pay}</span>,
      },
    ],
    gas: {
      sponsored: false,
      note: 'Approves exactly this amount, not an unlimited allowance. You pay the Bitcoin gas.',
    },
    confirmLabel: 'Approve',
    submit: writes.ready
      ? async () => {
          const hash = await writes.approveMusd(SPENDERS.pay, amountWei);
          refetchAllowance();
          return hash;
        }
      : undefined,
  });

  const sendIntent = (): TxIntent => ({
    title: `Send ${formatMusd(amountWei)}`,
    successTitle: `Sent ${formatMusd(amountWei)}`,
    changes: [
      {
        label: 'MUSD in your wallet',
        before: <Musd wei={balance} />,
        after: <Musd wei={balance > amountWei ? balance - amountWei : 0n} />,
      },
    ],
    details: [
      { label: 'Amount', value: <Musd wei={amountWei} /> },
      {
        label: 'To',
        value:
          isHandle && resolved ? (
            <span>
              <span className="text-text block">{resolved.handle}</span>
              <span className="mono text-text-muted mt-0.5 block break-all text-xs">
                {resolved.address}
              </span>
            </span>
          ) : (
            <span className="mono text-text-muted break-all text-xs">{recipient}</span>
          ),
      },
      ...(memo ? [{ label: 'Memo', value: <span className="text-text-muted">{memo}</span> }] : []),
    ],
    gas: gasNote(
      actionIsRelayable(isHandle ? 'payHandle' : 'payAddress'),
      'The memo is written on-chain and is publicly readable by anyone, forever.',
      relayer,
    ),
    confirmLabel: 'Send',
    // A handle is paid through payToHandle, which re-resolves it INSIDE the transaction, so
    // the contract's answer wins if the name changed hands between this read and the signature.
    submit: writes.ready
      ? () =>
          isHandle && resolved
            ? writes.payHandle(resolved.handle, amountWei, memo)
            : writes.payAddress(recipient as Address, amountWei, memo)
      : undefined,
  });

  // Who pays the gas for THIS send, from the same derivation the sheet's intent uses, so
  // the review row and the confirmation sheet cannot disagree.
  const payAction = isHandle ? 'payHandle' : 'payAddress';
  const gasSponsored = gasNote(actionIsRelayable(payAction), '', relayer).sponsored;

  return (
    <section aria-labelledby="send-flow-title" className="card mx-auto w-full max-w-[520px]">
      <FlowHeader step={step} onBack={() => setStep(step === 'review' ? 'recipient' : 'amount')} />

      {step === 'amount' ? (
        <AmountStep
          amount={amount}
          onAmount={setAmount}
          balance={balance}
          balanceKnown={balances != null}
          funds={funds}
          amountWei={amountWei}
          canContinue={amountReady}
          onContinue={() => setStep('recipient')}
        />
      ) : null}

      {step === 'recipient' ? (
        <RecipientStep
          amountWei={amountWei}
          to={to}
          onTo={setTo}
          isAddress={isAddress}
          isHandle={isHandle}
          isFetching={isFetching}
          resolved={resolved ?? null}
          memo={memo}
          onMemo={setMemo}
          memoBytes={memoBytes}
          canContinue={recipientReady}
          onContinue={() => setStep('review')}
        />
      ) : null}

      {step === 'review' ? (
        <ReviewStep
          amountWei={amountWei}
          balance={balance}
          fromHandle={myHandle ?? null}
          fromAddress={account}
          toHandle={isHandle && resolved ? resolved.handle : null}
          toAddress={recipient as Address}
          memo={memo}
          relayerLine={gasLine(actionIsRelayable(payAction), relayer)}
          gasSponsored={gasSponsored}
          needsApproval={needsApproval && amountWei > 0n}
          allowanceWei={allowanceWei}
          ready={writes.ready}
          onApprove={() => runner.request(approvalIntent())}
          onSend={() => runner.request(sendIntent())}
        />
      ) : null}
    </section>
  );
}

// ── stepper header ───────────────────────────────────────────────────────────

function FlowHeader({ step, onBack }: { step: Step; onBack: () => void }) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      {/* The label holds still between steps; Back appears on the right once there is
          somewhere to go back to, so nothing shifts under the reader's eye. */}
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-5">
        <h2 id="send-flow-title" className="t-bracket">
          [ Send MUSD ]
        </h2>
        {step !== 'amount' ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back a step"
            className="-mr-2 inline-flex h-11 items-center gap-1.5 px-2 text-sm text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600"
          >
            <ArrowRight aria-hidden className="size-4 rotate-180" />
            Back
          </button>
        ) : null}
      </div>

      {/* A real, labelled progress bar rather than decoration: three cells, one per step,
          the current one underlined in ink and the finished ones ticked. */}
      <div
        className="grid grid-cols-3 divide-x divide-[var(--border-hairline)] border-b border-[var(--border-hairline)]"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={activeIndex + 1}
        aria-label={`Step ${activeIndex + 1} of ${STEPS.length}: ${STEPS[activeIndex]!.label}`}
      >
        {STEPS.map((s, i) => {
          const state = i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'todo';
          return (
            <span
              key={s.key}
              aria-hidden
              className={`relative flex h-10 min-w-0 items-center gap-2 px-3 text-xs sm:px-5 ${
                state === 'current' ? 'text-text font-medium' : 'text-text-muted'
              }`}
            >
              {state === 'done' ? (
                <Check className="text-success size-3.5 shrink-0" />
              ) : (
                <span className="mono shrink-0 text-[0.6875rem] font-normal">0{i + 1}</span>
              )}
              <span className="truncate">{s.label}</span>
              {state === 'current' ? (
                <span className="bg-text absolute inset-x-0 -bottom-px h-0.5" />
              ) : null}
            </span>
          );
        })}
      </div>
    </>
  );
}

// ── step 1: amount ─────────────────────────────────────────────────────────────

/** Group the integer part of a typed decimal with thousands separators, for display only. */
function groupInt(intPart: string): string {
  return /^\d+$/.test(intPart) ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
}

const BIG_NUMBER =
  'num text-center text-[3rem] sm:text-[3.5rem] font-medium leading-none tracking-[-0.045em]';

function AmountStep({
  amount,
  onAmount,
  balance,
  balanceKnown,
  funds,
  amountWei,
  canContinue,
  onContinue,
}: {
  amount: string;
  onAmount: (v: string) => void;
  balance: bigint;
  balanceKnown: boolean;
  funds: ReturnType<typeof preflightMusdSpend>;
  amountWei: bigint;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const over = funds.blocker && funds.blocker.scope === 'wallet' && amountWei > 0n;

  // The greyed-decimal treatment: the whole part reads at full ink, the fraction sits back.
  // The real input is layered transparently over this display so entry stays a native,
  // labelled, keyboard-and-touch field while the figure keeps its typographic treatment.
  const shown = amount === '' ? '0' : amount;
  const dot = shown.indexOf('.');
  const whole = groupInt(dot >= 0 ? shown.slice(0, dot) : shown);
  const frac = dot >= 0 ? shown.slice(dot) : '';

  const sanitize = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, '');
    const first = v.indexOf('.');
    if (first >= 0) v = v.slice(0, first + 1) + v.slice(first + 1).replace(/\./g, '');
    const d = v.indexOf('.');
    if (d >= 0 && v.length - d > 3) v = v.slice(0, d + 3); // 2 decimals
    onAmount(v);
  };

  return (
    <>
      <div className="px-5 pb-8 pt-12 sm:pt-14">
        {/* Clicking the number area focuses the real input; the input itself stays the
            accessible, keyboard-reachable control (never hidden behind aria-hidden). The
            display span is a decorative duplicate that carries the greyed-decimal treatment. */}
        <div
          /* The real input is text-transparent — a decorative span draws the styled digits —
             and it used to suppress its outline with nothing in its place, so tabbing into
             the first field on the Pay tab showed nothing at all. The input, which sits
             inset-0 over the digits, now draws its own focus rule (see its className); a
             second indicator on this wrapper would draw a different rect. */
          className="flex w-full cursor-text flex-col items-center"
          onMouseDown={(e) => {
            if (e.target !== inputRef.current) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <div className="flex max-w-full items-baseline justify-center gap-2.5">
            <div className="relative min-w-0">
              <span
                aria-hidden
                className={`${BIG_NUMBER} block ${over ? 'text-danger' : 'text-text'}`}
              >
                {whole}
                {frac ? (
                  <span className={over ? 'text-danger/60' : 'text-text-subtle'}>{frac}</span>
                ) : null}
              </span>
              <input
                ref={inputRef}
                value={amount}
                onChange={(e) => sanitize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canContinue) onContinue();
                }}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                aria-label="Amount to send, in MUSD"
                aria-invalid={over ? true : undefined}
                /* Focus is a 2px violet rule under the figure rather than the global ring:
                   the ring drew a rounded box around three digits, the one round thing on a
                   square screen. The rule is the replacement indicator, not its absence. */
                className={`${BIG_NUMBER} absolute inset-0 w-full rounded-none bg-transparent text-transparent caret-violet-500 outline-none focus-visible:shadow-[inset_0_-2px_0_var(--color-violet-500)]`}
              />
            </div>
            <span className="text-text-muted shrink-0 text-xl font-medium tracking-[-0.02em]">
              MUSD
            </span>
          </div>
          <p className="text-text-muted mt-4 hidden text-xs sm:block">Press Enter to continue</p>
        </div>

        {funds.rangeDead && funds.blocker ? (
          <div className="mt-8">
            <BlockedNote blocker={funds.blocker} id="send-amount-blocked" />
          </div>
        ) : over ? (
          <p role="alert" className="text-danger mt-6 text-center text-sm">
            {funds.blocker?.title}
          </p>
        ) : null}
      </div>

      <ComposerFooter
        note={
          // The honest available balance, and Max beside it as an inline action.
          <span className="flex flex-wrap items-center gap-x-2">
            <span>Available</span>
            {balanceKnown ? <Musd wei={balance} size="sm" /> : <Dash size="sm" />}
            <button
              type="button"
              onClick={() => onAmount(formatMusd(balance, { unit: false }).replace(/,/g, ''))}
              disabled={balance <= 0n}
              className="disabled:text-text-subtle -my-3 inline-flex min-h-11 items-center px-1.5 text-[0.8125rem] text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600 disabled:cursor-not-allowed"
            >
              Max
            </button>
          </span>
        }
      >
        <PillAction
          onClick={onContinue}
          disabled={!canContinue}
          icon={<ArrowRight className="size-4" />}
          className={FOOTER_BUTTON}
          aria-describedby="send-amount-blocked"
        >
          Continue
        </PillAction>
      </ComposerFooter>
    </>
  );
}

// ── step 2: recipient ────────────────────────────────────────────────────────

/** A status line under a field: a dot that carries the tone, and words that carry the meaning. */
export function FieldStatus({ tone, children }: { tone: 'ok' | 'error'; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${tone === 'ok' ? 'bg-success' : 'bg-danger'}`}
      />
      {children}
    </span>
  );
}

function RecipientStep({
  amountWei,
  to,
  onTo,
  isAddress,
  isHandle,
  isFetching,
  resolved,
  memo,
  onMemo,
  memoBytes,
  canContinue,
  onContinue,
}: {
  amountWei: bigint;
  to: string;
  onTo: (v: string) => void;
  isAddress: boolean;
  isHandle: boolean;
  isFetching: boolean;
  resolved: { handle: string; address: Address } | null;
  memo: string;
  onMemo: (v: string) => void;
  memoBytes: number;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const trimmed = to.trim();

  return (
    <>
      <div className="px-5 pb-7 pt-6">
        <label htmlFor="send-to" className={FIELD_LABEL}>
          To
        </label>
        <input
          id="send-to"
          ref={inputRef}
          value={to}
          onChange={(e) => onTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canContinue) onContinue();
          }}
          placeholder="@handle or 0x address"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="send-to-status"
          className={`${TEXT_FIELD} mt-2`}
        />

        {/* The resolved address, always, before anything is signed. */}
        <div id="send-to-status" className="mt-2.5 min-h-[1.25rem] text-[0.8125rem]" role="status">
          {isHandle && isFetching ? (
            <span className="text-text-muted">Resolving handle…</span>
          ) : isHandle && resolved ? (
            <FieldStatus tone="ok">
              <span className="text-text-muted">{resolved.handle} resolves to</span>
              <span className="mono text-text break-all text-xs">{resolved.address}</span>
            </FieldStatus>
          ) : isHandle ? (
            <FieldStatus tone="error">
              <span className="text-danger">No such handle on this network.</span>
            </FieldStatus>
          ) : isAddress ? (
            <FieldStatus tone="ok">
              <span className="text-text-muted">Valid address.</span>
            </FieldStatus>
          ) : trimmed.length > 0 ? (
            <span className="text-text-muted">Enter a full @handle or a 0x address.</span>
          ) : (
            <span className="text-text-muted">Enter an @handle or a 0x address.</span>
          )}
        </div>

        <RecentRecipients
          onPick={onTo}
          activeAddress={isAddress ? (trimmed as Address) : resolved?.address}
        />

        <div className="mt-6">
          <label htmlFor="send-memo" className={FIELD_LABEL}>
            Memo (optional)
          </label>
          <input
            id="send-memo"
            value={memo}
            onChange={(e) => onMemo(e.target.value)}
            placeholder="What is this for?"
            aria-describedby="send-memo-count"
            aria-invalid={memoBytes > 80 ? true : undefined}
            className={`${TEXT_FIELD} mt-2`}
          />
          <p id="send-memo-count" className="text-text-muted mt-2.5 text-xs">
            <span className="num">{memoBytes}</span>/80 bytes · public on-chain
            {memoBytes > 80 ? <span className="text-danger"> · too long</span> : null}
          </p>
        </div>
      </div>

      <ComposerFooter
        note={
          <span className="flex flex-wrap items-center gap-x-1.5">
            Sending <Musd wei={amountWei} size="sm" />
          </span>
        }
      >
        <PillAction
          onClick={onContinue}
          disabled={!canContinue}
          icon={<ArrowRight className="size-4" />}
          className={FOOTER_BUTTON}
        >
          Continue
        </PillAction>
      </ComposerFooter>
    </>
  );
}

/**
 * Recent recipients, decoded from the account's own on-chain Activity — the addresses this
 * wallet has actually sent MUSD to. Never a seeded contact list: if there is no history,
 * there are no chips, and the row says so plainly.
 */
function RecentRecipients({
  onPick,
  activeAddress,
}: {
  onPick: (value: string) => void;
  activeAddress?: Address;
}) {
  const { data, isPending } = useActivity();

  const recents = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: { address: Address; label: string }[] = [];
    for (const item of data.items) {
      if (item.kind !== 'send' || !item.counterpartyAddress) continue;
      const key = item.counterpartyAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        address: item.counterpartyAddress,
        label: item.counterparty ?? shortAddress(item.counterpartyAddress),
      });
      if (out.length >= 5) break;
    }
    return out;
  }, [data]);

  if (isPending || recents.length === 0) return null;

  return (
    <div className="mt-5">
      <span className={FIELD_LABEL}>Recent</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {recents.map((r) => {
          const active = activeAddress && r.address.toLowerCase() === activeAddress.toLowerCase();
          const isName = r.label.startsWith('@');
          return (
            <button
              key={r.address}
              type="button"
              aria-pressed={active ? true : false}
              onClick={() => onPick(isName ? r.label : r.address)}
              title={r.address}
              className={`inline-flex h-11 items-center border px-4 text-sm transition-[color,background-color,border-color] duration-150 ease-out ${
                active
                  ? 'bg-surface-inset text-text border-text'
                  : 'bg-surface text-text-muted hover:text-text border-[var(--border-hairline)] hover:border-[var(--border-strong)]'
              }`}
            >
              <span className={`max-w-[16ch] truncate ${isName ? '' : 'mono text-[0.8125rem]'}`}>
                {r.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── step 3: review ───────────────────────────────────────────────────────────

function ReviewStep({
  amountWei,
  balance,
  fromHandle,
  fromAddress,
  toHandle,
  toAddress,
  memo,
  relayerLine,
  gasSponsored,
  needsApproval,
  allowanceWei,
  ready,
  onApprove,
  onSend,
}: {
  amountWei: bigint;
  balance: bigint;
  fromHandle: string | null;
  fromAddress: Address | null;
  toHandle: string | null;
  toAddress: Address;
  memo: string;
  relayerLine: string;
  gasSponsored: boolean;
  needsApproval: boolean;
  allowanceWei: bigint | null;
  ready: boolean;
  onApprove: () => void;
  onSend: () => void;
}) {
  // Greyed-decimal treatment on the summary figure, matching the amount step.
  const formatted = formatMusd(amountWei, { unit: false });
  const [whole, frac] = formatted.split('.');

  return (
    <>
      <div className="px-5 pb-7 pt-12 sm:pt-14">
        <div className="text-center">
          <span className="num inline-flex items-baseline justify-center gap-2.5 text-[3rem] font-medium leading-none tracking-[-0.045em] sm:text-[3.5rem]">
            <span>
              <span className="text-text">{whole}</span>
              {frac ? <span className="text-text-subtle">.{frac}</span> : null}
            </span>
            <span className="text-text-muted text-xl tracking-[-0.02em]">MUSD</span>
          </span>
        </div>

        <dl className="mt-10 divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)]">
          <ReviewRow
            label="From"
            value={fromHandle ?? 'Your wallet'}
            sub={fromAddress ?? 'Signed by your connected wallet'}
            subMono={fromAddress !== null}
          />
          <ReviewRow
            label="To"
            value={toHandle ?? shortAddress(toAddress)}
            sub={toAddress}
            subMono
          />
          {memo ? (
            <ReviewRow label="Memo" value={memo} sub="Written on-chain, public forever" />
          ) : null}
          <ReviewRow label="Network fee" value={gasSponsored ? 'Maren pays' : 'You pay, in BTC'} />
        </dl>

        {needsApproval ? (
          <div className="mt-5">
            <Note>
              MarenPay needs an allowance for {formatMusd(amountWei)} first; currently{' '}
              {formatMusd(allowanceWei ?? 0n)}. That is a separate transaction, shown here rather
              than slipped in behind the payment.
            </Note>
          </div>
        ) : null}

        {balance < amountWei ? (
          <p role="alert" className="text-danger mt-4 text-sm">
            This is more than your wallet holds now. Go back and lower the amount.
          </p>
        ) : null}
      </div>

      <ComposerFooter note={relayerLine} stack={needsApproval}>
        {needsApproval ? (
          <PillAction
            onClick={onApprove}
            disabled={!ready}
            icon={<ArrowUpRight className="size-4" />}
            className={FOOTER_BUTTON}
          >
            Approve {formatMusd(amountWei)}
          </PillAction>
        ) : null}
        <PillAction
          variant={needsApproval ? 'secondary' : 'primary'}
          onClick={onSend}
          disabled={!ready || needsApproval || balance < amountWei}
          icon={<ArrowUpRight className="size-4" />}
          className={FOOTER_BUTTON}
        >
          Send {formatMusd(amountWei)}
        </PillAction>
      </ComposerFooter>
    </>
  );
}

function ReviewRow({
  label,
  value,
  sub,
  subMono = false,
}: {
  label: string;
  value: string;
  sub?: string;
  subMono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3.5">
      <dt className="text-text-muted shrink-0 text-sm">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="text-text block break-words text-sm">{value}</span>
        {sub ? (
          <span
            className={`text-text-muted mt-1 block break-all ${subMono ? 'mono text-[0.75rem]' : 'text-xs'}`}
          >
            {sub}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
