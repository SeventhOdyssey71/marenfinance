'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMusd, shortAddress } from '@maren/sdk';
import type { Address } from 'viem';

import { BlockedNote } from '@/components/app/blocked';
import { Musd } from '@/components/app/money';
import { Note } from '@/components/app/primitives';
import { PillAction } from '@/components/ui/pill-button';
import { ArrowRight, ArrowUpRight, Check } from '@/components/ui/icons';
import { parseUnitsSafe, utf8Length } from '@/lib/copy';
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
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.pay}</span>,
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
              <span className="num text-text-subtle block text-xs">{resolved.address}</span>
            </span>
          ) : (
            <span className="num text-text-subtle break-all text-xs">{recipient}</span>
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

  return (
    <div className="mx-auto w-full max-w-xl">
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
          relayerLine={gasLine(actionIsRelayable(isHandle ? 'payHandle' : 'payAddress'), relayer)}
          needsApproval={needsApproval && amountWei > 0n}
          allowanceWei={allowanceWei}
          ready={writes.ready}
          onApprove={() => runner.request(approvalIntent())}
          onSend={() => runner.request(sendIntent())}
        />
      ) : null}
    </div>
  );
}

// ── stepper header ───────────────────────────────────────────────────────────

function FlowHeader({ step, onBack }: { step: Step; onBack: () => void }) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  const progress = (activeIndex / (STEPS.length - 1)) * 100;

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        {step !== 'amount' ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back a step"
            className="text-text-muted hover:text-text grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] transition-[color,border-color,transform] duration-[120ms] ease-out hover:border-[var(--border-strong)] active:scale-[0.97]"
          >
            <ArrowRight aria-hidden className="size-4 rotate-180" />
          </button>
        ) : (
          <span className="size-11 shrink-0" />
        )}
        <span className="t-h3">Send MUSD</span>
      </div>

      {/* A real, labelled progress bar rather than decoration. */}
      <div
        className="bg-surface-inset relative h-0.5 w-full overflow-hidden rounded-[var(--radius-pill)]"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={activeIndex + 1}
        aria-label={`Step ${activeIndex + 1} of ${STEPS.length}: ${STEPS[activeIndex]!.label}`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[var(--radius-pill)] bg-violet-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`t-label ${
              i === activeIndex
                ? 'text-text'
                : i < activeIndex
                  ? 'text-violet-400'
                  : 'text-text-subtle'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── step 1: amount ─────────────────────────────────────────────────────────────

/** Group the integer part of a typed decimal with thousands separators, for display only. */
function groupInt(intPart: string): string {
  return /^\d+$/.test(intPart) ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
}

const BIG_NUMBER = 'num text-center text-[2.75rem] sm:text-[3.25rem] leading-none tracking-tight';

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
    <div>
      {/* Clicking the number area focuses the real input; the input itself stays the
          accessible, keyboard-reachable control (never hidden behind aria-hidden). The
          display span is a decorative duplicate that carries the greyed-decimal treatment. */}
      <div
        className="flex w-full cursor-text flex-col items-center py-6"
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div className="flex items-baseline justify-center gap-3">
          <div className="relative">
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
              className={`${BIG_NUMBER} absolute inset-0 w-full bg-transparent text-transparent caret-violet-500 outline-none`}
            />
          </div>
          <span className="t-h3 text-text-muted shrink-0">MUSD</span>
        </div>
      </div>

      {/* Wallet pill + Max, honest available balance. */}
      <div className="mb-2 flex items-center justify-center gap-2">
        <span className="bg-surface-inset inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-3.5">
          <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
          <span className="t-label text-text-muted">Your wallet</span>
          <span className="text-text-subtle text-xs">·</span>
          {balanceKnown ? (
            <Musd wei={balance} size="sm" tone="muted" />
          ) : (
            <span className="text-text-subtle text-xs">—</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onAmount(formatMusd(balance, { unit: false }).replace(/,/g, ''))}
          disabled={balance <= 0n}
          className="bg-surface-inset text-text-muted hover:text-text inline-flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-4 text-xs font-medium transition-[color,border-color,transform] duration-[120ms] ease-out hover:border-[var(--border-strong)] active:scale-[0.97] disabled:opacity-40"
        >
          Max
        </button>
      </div>

      <p className="text-text-subtle mb-6 text-center text-xs">
        Type an amount, then continue. On desktop, press Enter.
      </p>

      {funds.rangeDead && funds.blocker ? (
        <div className="mb-6">
          <BlockedNote blocker={funds.blocker} id="send-amount-blocked" />
        </div>
      ) : over ? (
        <p role="alert" className="text-danger mb-6 text-center text-sm">
          {funds.blocker?.title}
        </p>
      ) : null}

      <PillAction
        onClick={onContinue}
        disabled={!canContinue}
        icon={<ArrowRight className="size-4" />}
        className="w-full justify-between"
        aria-describedby="send-amount-blocked"
      >
        Continue
      </PillAction>
    </div>
  );
}

// ── step 2: recipient ────────────────────────────────────────────────────────

function RecipientStep({
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
    <div>
      <label htmlFor="send-to" className="t-label text-text-subtle block">
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
        className="num text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg outline-none focus:border-[var(--border-strong)]"
      />

      {/* The resolved address, always, before anything is signed. */}
      <div id="send-to-status" className="mt-3 min-h-[1.25rem] text-sm" role="status">
        {isHandle && isFetching ? (
          <span className="text-text-subtle">Resolving handle…</span>
        ) : isHandle && resolved ? (
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
            <span className="text-text-muted">{resolved.handle} resolves to</span>
            <span className="num text-text text-[0.8125rem]">{resolved.address}</span>
          </span>
        ) : isHandle ? (
          <span className="text-danger">No such handle on this network.</span>
        ) : isAddress ? (
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
            <span className="text-text-muted">Valid address.</span>
          </span>
        ) : trimmed.length > 0 ? (
          <span className="text-text-subtle">Enter a full @handle or a 0x address.</span>
        ) : (
          <span className="text-text-subtle">Enter an @handle or a 0x address.</span>
        )}
      </div>

      <RecentRecipients
        onPick={onTo}
        activeAddress={isAddress ? (trimmed as Address) : resolved?.address}
      />

      <div className="mt-8">
        <label htmlFor="send-memo" className="t-label text-text-subtle block">
          Memo (optional)
        </label>
        <input
          id="send-memo"
          value={memo}
          onChange={(e) => onMemo(e.target.value)}
          placeholder="What is this for?"
          aria-describedby="send-memo-count"
          className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] outline-none focus:border-[var(--border-strong)]"
        />
        <p id="send-memo-count" className="text-text-subtle mt-2 text-xs">
          <span className="num">{memoBytes}</span>/80 bytes · public on-chain
          {memoBytes > 80 ? <span className="text-danger"> · too long</span> : null}
        </p>
      </div>

      <PillAction
        onClick={onContinue}
        disabled={!canContinue}
        icon={<ArrowRight className="size-4" />}
        className="mt-8 w-full justify-between"
      >
        Continue
      </PillAction>
    </div>
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
    <div className="mt-6">
      <span className="t-label text-text-subtle block">Recent</span>
      <div className="mt-3 flex flex-wrap gap-2">
        {recents.map((r) => {
          const active = activeAddress && r.address.toLowerCase() === activeAddress.toLowerCase();
          return (
            <button
              key={r.address}
              type="button"
              onClick={() => onPick(r.label.startsWith('@') ? r.label : r.address)}
              className={`inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm transition-[color,border-color,transform] duration-[120ms] ease-out active:scale-[0.97] ${
                active
                  ? 'text-text border-violet-500'
                  : 'bg-surface-inset text-text-muted hover:text-text border-[var(--border-hairline)] hover:border-[var(--border-strong)]'
              }`}
            >
              <span className="num max-w-[16ch] truncate">{r.label}</span>
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
    <div>
      <div className="py-4 text-center">
        <span className="num inline-flex items-baseline justify-center gap-2 text-[2.5rem] leading-none tracking-tight">
          <span className="text-text">{whole}</span>
          {frac ? <span className="text-text-subtle">.{frac}</span> : null}
          <span className="t-h3 text-text-muted">MUSD</span>
        </span>
      </div>

      <dl className="card overflow-hidden">
        <ReviewRow
          label="From"
          value={fromHandle ?? 'Your wallet'}
          sub={fromAddress ?? 'Signed by your connected wallet'}
          subMono={fromAddress !== null}
        />
        <ReviewRow label="To" value={toHandle ?? shortAddress(toAddress)} sub={toAddress} subMono />
        {memo ? (
          <ReviewRow label="Memo" value={memo} sub="Written on-chain, public forever" />
        ) : null}
        <ReviewRow label="Network fee" value="You pay gas" sub={relayerLine} last />
      </dl>

      {needsApproval ? (
        <div className="mt-6">
          <Note>
            MarenPay needs an allowance for {formatMusd(amountWei)} first; currently{' '}
            {formatMusd(allowanceWei ?? 0n)}. That is a separate transaction, shown here rather than
            slipped in behind the payment.
          </Note>
        </div>
      ) : null}

      <p className="text-text-subtle mt-6 text-xs leading-relaxed">{relayerLine}</p>

      {balance < amountWei ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          This is more than your wallet holds now. Go back and lower the amount.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {needsApproval ? (
          <PillAction
            onClick={onApprove}
            disabled={!ready}
            icon={<ArrowUpRight className="size-4" />}
          >
            Approve {formatMusd(amountWei)}
          </PillAction>
        ) : null}
        <PillAction
          variant={needsApproval ? 'secondary' : 'primary'}
          onClick={onSend}
          disabled={!ready || needsApproval || balance < amountWei}
          icon={<Check className="size-4" />}
        >
          Send {formatMusd(amountWei)}
        </PillAction>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  sub,
  subMono = false,
  last = false,
}: {
  label: string;
  value: string;
  sub?: string;
  subMono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-6 px-5 py-3.5 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <dt className="t-label text-text-subtle pt-0.5">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="text-text block break-words text-sm">{value}</span>
        {sub ? (
          <span
            className={`text-text-subtle mt-0.5 block break-all text-xs ${subMono ? 'num' : ''}`}
          >
            {sub}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
