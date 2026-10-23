'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReadContract } from 'wagmi';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { formatMusd, getChain, shortAddress } from '@maren/sdk';
import type { Address } from 'viem';

import { BlockedNote } from '@/components/app/blocked';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { AmountField, Segmented } from '@/components/app/controls';
import { HandleRegistration } from '@/components/app/handle-registration';
import { Musd } from '@/components/app/money';
import {
  ActionButton,
  Info,
  Loading,
  Note,
  PageHeader,
  Panel,
  Refreshing,
} from '@/components/app/primitives';
import { ReceivePanel } from '@/components/app/receive-panel';
import {
  ComposerFooter,
  FIELD_LABEL,
  FieldStatus,
  FOOTER_BUTTON,
  SendFlow,
  SUFFIX_FIELD,
  TEXT_FIELD,
} from '@/components/app/send-flow';
import { TxSheet, useTxRunner, type TxIntent, type TxRunner } from '@/components/app/tx';
import { X402Teaser } from '@/components/app/x402-teaser';
import {
  ArrowUpRight,
  Check,
  CopyIcon,
  LinkIcon,
  Minus,
  PayIcon,
  Plus,
} from '@/components/ui/icons';
import { parseUnitsSafe, utf8Length } from '@/lib/copy';
import { marenPayAbi } from '@/lib/chain/abis';
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
import { NETWORK, useBalances, useDataSource, useResolvedHandle } from '@/lib/data/source';

const TARGET_CHAIN_ID = getChain(NETWORK).id;

type Tab = 'send' | 'split' | 'request' | 'link' | 'receive' | 'handle';

// Send, Split, Request and Link are the four ways money leaves this screen, so they lead
// the row and read as one surface; Receive and Handle are the two that do not move funds.
const TABS = [
  { key: 'send' as const, label: 'Send' },
  { key: 'split' as const, label: 'Split' },
  { key: 'request' as const, label: 'Request' },
  { key: 'link' as const, label: 'Link' },
  { key: 'receive' as const, label: 'Receive' },
  { key: 'handle' as const, label: 'Handle' },
];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_SPLIT_RECIPIENTS = 64;

/**
 * Pay — send MUSD to a handle or an address.
 *
 * The rule this screen is built around is unchanged: a user always sees where money is
 * actually going. A `@handle` is a convenience over an address, never a replacement for
 * it, so the resolved address is displayed beside the handle as it resolves AND again in
 * the confirmation sheet, and an unregistered handle fails loudly rather than falling back
 * to anything.
 *
 * TWO THINGS CHANGED HERE.
 *
 * The recipient and payer fields used to be pre-filled with `@nadia` and `@okonkwo` —
 * handles nobody has ever registered, resolving against a mock registry. They are empty
 * now. A placeholder that looks like a real counterparty is a small fiction that teaches
 * the user to trust the larger ones.
 *
 * And the "No gas — Maren pays the Bitcoin network fee" banner, with its 25 free actions a
 * month, is gone. It described a relayer that is not deployed. Every transaction on this
 * screen is submitted by the user's own wallet and costs them BTC, and that is now what it
 * says.
 */
export default function PayPage() {
  const source = useDataSource();
  const [tab, setTab] = useState<Tab>('send');
  const runner = useTxRunner();

  // Pay is a form surface, so there is nothing to skeleton — the inputs are usable at
  // once and the action buttons are already gated on `writes.ready` and the preflight.
  // The one figure behind them is the MUSD balance, so its read (on first load and on the
  // refetch a confirmed send/split/link triggers) is what the quiet header mark reflects.
  const balancesQ = useBalances();
  const refreshing = source.ready && balancesQ.isFetching;

  // Home's action pills deep-link a tab through the URL hash (e.g. `/app/pay#receive`).
  // Read it once on mount so "Receive" lands on Receive; unknown hashes are ignored and
  // the default Send stands. No new state, and the segmented control still owns `tab`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromHash = window.location.hash.replace(/^#/, '');
    if (TABS.some((t) => t.key === fromHash)) setTab(fromHash as Tab);
  }, []);

  // Pay is the payment composer (the rail's "New payment" lands here), so the whole of it
  // is one narrow centred column (DESIGN.md: flows are ~520px on purpose). The header sits
  // in the same column as the form it titles.
  if (!source.connected) {
    return (
      <div className="mx-auto w-full max-w-[520px]">
        <Header />
        <div className="flex flex-col gap-4">
          <ConnectPrompt icon={<PayIcon className="size-6" />} title="Connect to send MUSD">
            Send MUSD to an @handle or a plain address, with an optional memo written on-chain.
          </ConnectPrompt>
          <p className="text-text-muted text-[0.8125rem] leading-relaxed">
            <GasLine />
          </p>
        </div>
        {/* The demo's offer is readable without a wallet, so the door stays open here. */}
        <div className="mt-10">
          <X402Teaser />
        </div>
      </div>
    );
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;

  return (
    <div className="mx-auto w-full max-w-[520px]">
      <Header
        refreshing={refreshing}
        description="Send MUSD to a handle or an address, split a bill, ask for a payment or share a claimable link."
      />

      {/* Six tabs do not fit a 390px phone at a readable size, so below `sm` the row
          scrolls sideways (bleeding to the screen edge, the half-visible tab saying there
          is more) instead of crushing its labels. From `sm` it is the full control. */}
      <div className="-mx-5 -my-1 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div className="min-w-[29rem] sm:min-w-0">
          <Segmented options={TABS} value={tab} onChange={setTab} label="Payment type" />
        </div>
      </div>

      <div role="tabpanel" aria-label={current.label} className="mt-5 flex flex-col gap-4">
        {tab === 'send' ? <SendFlow runner={runner} /> : null}
        {tab === 'split' ? <SplitPanel runner={runner} /> : null}
        {tab === 'request' ? (
          <>
            <RequestPanel runner={runner} />
            <FulfilPanel runner={runner} />
          </>
        ) : null}
        {tab === 'link' ? <LinkPanel runner={runner} /> : null}
        {tab === 'receive' ? <ReceivePanel /> : null}
        {tab === 'handle' ? <HandleRegistration runner={runner} /> : null}
      </div>

      {/* Below every flow, quiet on purpose: a protocol demo, not a money surface. */}
      <div className="mt-10">
        <X402Teaser />
      </div>

      <TxSheet runner={runner} />
    </div>
  );
}

function Header({
  refreshing = false,
  description,
}: {
  refreshing?: boolean;
  description?: string;
}) {
  // The refetch mark is pinned to the title line rather than passed as a header action:
  // on a phone, actions stack under the copy, and a mark that comes and goes there would
  // push the whole form down and back up on every background read.
  return (
    <div className="relative">
      <PageHeader title="Pay" description={description} />
      {refreshing ? (
        <div className="absolute right-0 top-6 md:top-9">
          <Refreshing />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The composer card every Pay form sits in, the same shape as Send: a bracket label over
 * a hairline, the form, and a footer band with the gas payer on the left and the submit
 * on the right. `description` is the one line of what this form does.
 */
function FlowCard({
  id,
  title,
  description,
  footer,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel title={title} labelledBy={id}>
      <div className="px-5 pb-7 pt-5">
        {description ? (
          <p className="text-text-muted mb-6 max-w-[52ch] text-pretty text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {footer}
    </Panel>
  );
}

/**
 * The gas disclosure, compressed to one line at the point of action.
 *
 * It used to be a four-line block at the top of the screen explaining that MarenPay is an
 * `ERC2771Context`, that it trusts `MarenRelayHub` under ERC-2771, and that no relayer is
 * deployed to submit through it. All true, and all a description of the architecture rather
 * than of what is about to happen to the user's money. The fact a payer needs is that they
 * are paying, and that is the whole line now. The mechanism lives in the FAQ.
 */
function GasLine() {
  // Conditional, not deleted. With no relayer configured this is the same sentence it has
  // always been; with one accepting work it says Maren pays, which is by then true.
  const relayer = useRelayerStatus();
  return <>{gasLine(actionIsRelayable('payAddress'), relayer)}</>;
}

/**
 * A request is the one thing on this screen that works with an empty wallet, and that is
 * worth keeping true: it moves no funds, so it has no balance precondition to preflight.
 * Its only requirement is that a named payer, if given, actually resolves.
 */
function RequestPanel({ runner }: { runner: TxRunner }) {
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [memo, setMemo] = useState('');

  const amountWei = parseUnitsSafe(amount);
  const trimmed = from.trim();
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: resolved } = useResolvedHandle(trimmed);

  // An unaddressed request is payable by anyone, which the contract expresses as the zero
  // address rather than as a separate flag.
  const payer = resolved?.address ?? ZERO_ADDRESS;

  const intent = (): TxIntent => ({
    title: `Request ${formatMusd(amountWei)}`,
    successTitle: `Requested ${formatMusd(amountWei)}`,
    details: [
      { label: 'Amount', value: <Musd wei={amountWei} /> },
      {
        label: 'From',
        value: resolved ? (
          <span>
            <span className="text-text block">{resolved.handle}</span>
            <span className="mono text-text-muted mt-0.5 block break-all text-xs">
              {resolved.address}
            </span>
          </span>
        ) : (
          <span className="text-text-muted">anyone with the request</span>
        ),
      },
      ...(memo ? [{ label: 'Memo', value: <span className="text-text-muted">{memo}</span> }] : []),
    ],
    gas: gasNote(
      actionIsRelayable('createRequest'),
      'A request creates no obligation and moves no funds. It is an ask the other side fulfils in one action.',
      relayer,
    ),
    confirmLabel: 'Create request',
    submit: writes.ready ? () => writes.createRequest(payer, amountWei, memo) : undefined,
  });

  return (
    <FlowCard
      id="request-title"
      title="Request payment"
      description="An ask, not an obligation. Nothing moves until the other side pays it."
      footer={
        <ComposerFooter note={<GasLine />}>
          <ActionButton
            onClick={() => runner.request(intent())}
            disabled={amountWei === 0n || !writes.ready || (isHandle && !resolved)}
            icon={<ArrowUpRight className="size-4" />}
            className={FOOTER_BUTTON}
          >
            Request {amountWei > 0n ? formatMusd(amountWei) : ''}
          </ActionButton>
        </ComposerFooter>
      }
    >
      <AmountField value={amount} onChange={setAmount} unit="MUSD" label="Amount" />

      <div className="mt-6">
        <label htmlFor="request-from" className={FIELD_LABEL}>
          From (optional)
        </label>
        <input
          id="request-from"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="@handle"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="request-from-status"
          className={`${TEXT_FIELD} mt-2`}
        />
        <p
          id="request-from-status"
          className="mt-2.5 min-h-[1.25rem] text-[0.8125rem]"
          role="status"
        >
          {isHandle && resolved ? (
            <FieldStatus tone="ok">
              <span className="text-text-muted">{resolved.handle} resolves to</span>
              <span className="mono text-text break-all text-xs">{resolved.address}</span>
            </FieldStatus>
          ) : isHandle ? (
            <FieldStatus tone="error">
              <span className="text-danger">No such handle on this network.</span>
            </FieldStatus>
          ) : (
            <span className="text-text-muted">Anyone may fulfil an unaddressed request.</span>
          )}
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="request-memo" className={FIELD_LABEL}>
          Memo (optional)
        </label>
        <input
          id="request-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Invoice 0044"
          className={`${TEXT_FIELD} mt-2`}
        />
      </div>

      {/* No "open requests" list. There was one, and it was seeded. Requests this account
        creates appear in Activity, decoded from the contract's own RequestCreated
        events — a real list is better than a plausible one. */}
      <p className="text-text-muted mt-5 text-xs leading-relaxed">
        Requests you create appear in Activity.
      </p>
    </FlowCard>
  );
}

/**
 * Fulfil a request somebody sent you.
 *
 * The settling half of the Request tab: a payer pastes the request id they were given,
 * sees exactly who gets paid and how much read from the contract's own record, and pays it
 * in one action. Nothing about the payment is entered here — the amount and the requester
 * live in the request, so the payer agrees to a figure the contract will enforce rather
 * than one this screen re-types.
 *
 * The honesty rules are the send flow's rules, because it moves the same MUSD: it pulls
 * with `transferFrom`, so a first fulfilment needs a MarenPay approval shown as its own
 * step; it preflights the wallet balance; and every state the request can be in — open,
 * already fulfilled, cancelled, addressed to a different payer, or your own — is read and
 * stated plainly rather than discovered inside a revert.
 */
const REQUEST_STATUS = ['None', 'Open', 'Fulfilled', 'Cancelled'] as const;

function FulfilPanel({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const { account } = useDataSource();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
  const [idText, setIdText] = useState('');

  const trimmed = idText.trim();
  const idValid = /^\d+$/.test(trimmed) && BigInt(trimmed || '0') > 0n;
  const requestId = idValid ? BigInt(trimmed) : null;

  const { data: record, isFetching } = useReadContract({
    address: SPENDERS.pay,
    abi: marenPayAbi,
    functionName: 'requests',
    args: requestId !== null ? [requestId] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: requestId !== null && writes.ready },
  });

  // requests(id) → (requester, payer, amount, createdAt, status).
  const requester = record?.[0] as Address | undefined;
  const designatedPayer = record?.[1] as Address | undefined;
  const amountWei = (record?.[2] as bigint | undefined) ?? 0n;
  const status = (record?.[4] as number | undefined) ?? 0;

  const funds = preflightMusdSpend(balances, amountWei, { verb: 'pay', noun: 'Payment' });
  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.pay, amountWei);

  // After a delivered fulfilment, clear the id so the panel is ready for the next one; the
  // sheet owns delivery and the balances refetch on their own from the confirmed receipt.
  const sawDelivered = useRef(false);
  useEffect(() => {
    const phase = runner.phase;
    if (phase.name === 'settled' && phase.outcome.kind === 'delivered') {
      sawDelivered.current = true;
    } else if (phase.name === 'idle' && sawDelivered.current) {
      sawDelivered.current = false;
      setIdText('');
      refetchAllowance();
    }
  }, [runner.phase, refetchAllowance]);

  const zero = '0x0000000000000000000000000000000000000000';
  const isOpen = status === 1;
  const addressedElsewhere =
    designatedPayer !== undefined &&
    designatedPayer !== zero &&
    account !== null &&
    designatedPayer.toLowerCase() !== account.toLowerCase();
  const isMine =
    requester !== undefined &&
    account !== null &&
    requester.toLowerCase() === account.toLowerCase();
  // A request the contract can be paid by this account, right now.
  const payable = isOpen && amountWei > 0n && !addressedElsewhere && !isMine;

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
      note: 'The request cannot be paid without this. You pay the Bitcoin gas.',
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

  const fulfilIntent = (): TxIntent => ({
    title: `Pay ${formatMusd(amountWei)}`,
    successTitle: `Paid ${formatMusd(amountWei)}`,
    changes: [
      {
        label: 'MUSD in your wallet',
        before: <Musd wei={balances?.musdWei ?? 0n} />,
        after: (
          <Musd
            wei={(balances?.musdWei ?? 0n) > amountWei ? (balances?.musdWei ?? 0n) - amountWei : 0n}
          />
        ),
      },
    ],
    details: [
      { label: 'Amount', value: <Musd wei={amountWei} /> },
      { label: 'Request', value: <span className="num text-text-muted">#{trimmed}</span> },
      {
        label: 'To',
        value: <span className="mono text-text-muted break-all text-xs">{requester}</span>,
      },
    ],
    gas: gasNote(
      actionIsRelayable('fulfillRequest'),
      'The amount and recipient are fixed by the request; paying it releases exactly that MUSD to the requester.',
      relayer,
    ),
    confirmLabel: `Pay ${formatMusd(amountWei)}`,
    submit: writes.ready && requestId !== null ? () => writes.fulfillRequest(requestId) : undefined,
  });

  // Which body this panel shows, named once so the footer can follow the same decision.
  const view = !writes.ready
    ? 'disconnected'
    : requestId === null
      ? 'empty'
      : isFetching && record === undefined
        ? 'loading'
        : status === 0
          ? 'missing'
          : 'found';
  // The record is readable and nothing on it stops this wallet paying: the gas line and
  // the actions show. Every refusal is a Note in the body instead.
  const offerPay =
    view === 'found' && status !== 2 && status !== 3 && !isMine && !addressedElsewhere;
  const twoSteps = needsApproval && amountWei > 0n;

  return (
    <FlowCard
      id="fulfil-title"
      title="Pay a request"
      description="Settle a request someone sent you."
      footer={
        offerPay ? (
          <ComposerFooter
            note={gasLine(actionIsRelayable('fulfillRequest'), relayer)}
            stack={twoSteps}
          >
            {twoSteps ? (
              <ActionButton
                onClick={() => runner.request(approvalIntent())}
                disabled={!writes.ready || !funds.ok}
                aria-describedby="fulfil-blocked"
                icon={<ArrowUpRight className="size-4" />}
                className={FOOTER_BUTTON}
              >
                Approve {formatMusd(amountWei)}
              </ActionButton>
            ) : null}
            <ActionButton
              variant={twoSteps ? 'secondary' : 'primary'}
              onClick={() => runner.request(fulfilIntent())}
              disabled={!payable || !funds.ok || !writes.ready || twoSteps}
              aria-describedby="fulfil-blocked"
              icon={<PayIcon className="size-4" />}
              className={FOOTER_BUTTON}
            >
              Pay {formatMusd(amountWei)}
            </ActionButton>
          </ComposerFooter>
        ) : null
      }
    >
      <label htmlFor="fulfil-id" className={FIELD_LABEL}>
        Request number
      </label>
      <input
        id="fulfil-id"
        value={idText}
        onChange={(event) => setIdText(event.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        placeholder="e.g. 42"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="fulfil-id-hint"
        className={`${TEXT_FIELD} num mt-2`}
      />
      <p id="fulfil-id-hint" className="text-text-muted mt-2.5 text-xs leading-relaxed">
        The number the requester shared, or the id shown on their request in Activity.
      </p>

      {view === 'disconnected' ? (
        <div className="mt-5">
          <Note>Connect a wallet on {getChain(NETWORK).name} to read and pay a request.</Note>
        </div>
      ) : view === 'empty' ? null : view === 'loading' ? (
        <div className="mt-1">
          <Loading>Reading request #{trimmed} from Mezo</Loading>
        </div>
      ) : view === 'missing' ? (
        <div className="mt-5">
          <Note tone="warning" role="alert">
            There is no request #{trimmed} on {getChain(NETWORK).name}. Check the number and try
            again.
          </Note>
        </div>
      ) : (
        <>
          <dl className="mt-5 divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)]">
            <FulfilRow label="Amount" value={<Musd wei={amountWei} />} />
            <FulfilRow
              label="Requester"
              value={<span className="text-text text-sm">{shortAddress(requester ?? zero)}</span>}
              sub={requester}
            />
            <FulfilRow
              label="Status"
              value={
                <span className={`text-sm ${isOpen ? 'text-text' : 'text-text-muted'}`}>
                  {REQUEST_STATUS[status] ?? 'Unknown'}
                </span>
              }
            />
            {designatedPayer && designatedPayer !== zero ? (
              <FulfilRow
                label="Payer"
                value={<span className="text-text text-sm">{shortAddress(designatedPayer)}</span>}
                sub={designatedPayer}
              />
            ) : null}
          </dl>

          {status === 2 ? (
            <div className="mt-5">
              <Note>This request has already been fulfilled. Nothing is owed on it.</Note>
            </div>
          ) : status === 3 ? (
            <div className="mt-5">
              <Note>The requester cancelled this request, so it can no longer be paid.</Note>
            </div>
          ) : isMine ? (
            <div className="mt-5">
              <Note>
                You created this request, so you cannot pay it yourself. Share the number with
                whoever owes you.
              </Note>
            </div>
          ) : addressedElsewhere ? (
            <div className="mt-5">
              <Note tone="warning" role="alert">
                This request names a specific payer, and it is not the connected wallet. Only that
                address can pay it.
              </Note>
            </div>
          ) : (
            <>
              {funds.rangeDead && funds.blocker ? (
                <div className="mt-5">
                  <BlockedNote blocker={funds.blocker} id="fulfil-blocked" />
                </div>
              ) : null}

              {funds.ok && needsApproval && amountWei > 0n ? (
                <div className="mt-5">
                  <Note>
                    MarenPay needs an allowance for {formatMusd(amountWei)} before it can pull the
                    payment. That is a separate transaction, shown here rather than slipped in
                    behind it.
                  </Note>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </FlowCard>
  );
}

function FulfilRow({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      <dt className="text-text-muted shrink-0 pt-px text-sm">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block">{value}</span>
        {sub ? (
          <span className="mono text-text-muted mt-1 block break-all text-[0.75rem]">{sub}</span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Payment links.
 *
 * The construction matters and the interface should not hide it: the link carries a
 * one-time PRIVATE KEY, and the claimer signs their own address with it. A copied
 * signature is therefore only valid for the recipient it already names, which is what
 * stops a link from being front-run in the mempool. The secret never touches the chain.
 */
function LinkPanel({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [memo, setMemo] = useState('');
  const [created, setCreated] = useState<{ secret: string; linkKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const amountWei = parseUnitsSafe(amount);
  const expiryDays = Number.parseInt(days, 10) || 0;
  const balance = balances?.musdWei ?? 0n;

  // A link escrows real MUSD, so it has the same precondition Send does.
  const funds = preflightMusdSpend(balances, amountWei, { verb: 'escrow', noun: 'Escrow' });

  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.pay, amountWei);

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
      note: 'The escrow cannot be funded without this. You pay the Bitcoin gas.',
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

  const intent = (): TxIntent => {
    // A real one-time keypair, generated in the browser. Only the public address is ever
    // sent to the contract; the private key goes in the URL fragment, which browsers do
    // not transmit to servers.
    const secret = generatePrivateKey();
    const linkKey = privateKeyToAccount(secret).address;
    const expiryUnix = BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86_400);

    return {
      title: `Create a link for ${formatMusd(amountWei)}`,
      successTitle: `Escrowed ${formatMusd(amountWei)}`,
      changes: [
        {
          label: 'MUSD in your wallet',
          before: <Musd wei={balance} />,
          after: <Musd wei={balance > amountWei ? balance - amountWei : 0n} />,
        },
      ],
      details: [
        { label: 'Amount escrowed', value: <Musd wei={amountWei} /> },
        { label: 'Expires', value: <span className="text-text-muted">in {expiryDays} days</span> },
        {
          label: 'Locked to key',
          value: <span className="mono text-text-muted break-all text-xs">{linkKey}</span>,
        },
      ],
      gas: gasNote(
        actionIsRelayable('createLink'),
        'Escrows the MUSD against a one-time key until someone claims it.',
        relayer,
      ),
      caution:
        'Anyone holding the full link can claim it. Send it the way you would send cash, and reclaim it if it goes astray.',
      confirmLabel: 'Create link',
      submit: writes.ready
        ? async () => {
            const hash = await writes.createLink(linkKey, amountWei, expiryUnix, memo);
            // Shown only after the chain has accepted it, so a user never walks away with
            // a link to an escrow that does not exist.
            setCreated({ secret, linkKey });
            return hash;
          }
        : undefined,
    };
  };

  return (
    <FlowCard
      id="link-title"
      title="Payment link"
      description="Escrows MUSD against a one-time key. Anyone with the link can claim it."
      footer={
        <ComposerFooter note={<GasLine />} stack={needsApproval && amountWei > 0n}>
          {needsApproval && amountWei > 0n ? (
            <ActionButton
              onClick={() => runner.request(approvalIntent())}
              disabled={!writes.ready || !funds.ok}
              aria-describedby="link-blocked"
              icon={<LinkIcon className="size-4" />}
              className={FOOTER_BUTTON}
            >
              Approve {formatMusd(amountWei)}
            </ActionButton>
          ) : null}
          <ActionButton
            variant={needsApproval && amountWei > 0n ? 'secondary' : 'primary'}
            onClick={() => runner.request(intent())}
            disabled={
              !funds.ok || expiryDays <= 0 || !writes.ready || (needsApproval && amountWei > 0n)
            }
            aria-describedby="link-blocked"
            icon={<LinkIcon className="size-4" />}
            className={FOOTER_BUTTON}
          >
            Create link
          </ActionButton>
        </ComposerFooter>
      }
    >
      {/* The new link leads the card the moment the chain has accepted the escrow: it is
          the one thing on this screen that cannot be recovered later. */}
      {created ? (
        <div className="mb-7">
          <Note tone="warning" role="status">
            <p className="text-text font-medium">Copy this now. It is shown once.</p>
            <p className="mono text-text bg-surface mt-3 break-all border border-[var(--border-hairline)] px-3 py-2.5 text-xs leading-relaxed">
              {typeof window !== 'undefined' ? window.location.origin : ''}/claim#{created.secret}
            </p>
            <p className="mt-3 text-xs leading-relaxed">
              The claim key after the <span className="mono">#</span> never leaves your browser and
              is not stored anywhere. Once you navigate away it is gone.
            </p>
            <div className="mt-4">
              <ActionButton
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `${window.location.origin}/claim#${created.secret}`,
                  );
                  setCopied(true);
                }}
                icon={
                  copied ? (
                    <Check className="text-success size-4" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )
                }
              >
                {copied ? 'Copied' : 'Copy link'}
              </ActionButton>
            </div>
          </Note>
        </div>
      ) : null}

      <AmountField
        value={amount}
        onChange={setAmount}
        unit="MUSD"
        label="Amount"
        max={<Musd wei={balance} size="sm" />}
        maxLabel="Available"
        error={
          funds.blocker && funds.blocker.scope === 'wallet' && amountWei > 0n
            ? funds.blocker.title
            : null
        }
      />

      <div className="mt-6">
        <label htmlFor="link-expiry" className={FIELD_LABEL}>
          Expires in
        </label>
        <div className={`${SUFFIX_FIELD} mt-2`}>
          <input
            id="link-expiry"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            inputMode="numeric"
            aria-describedby="link-expiry-hint"
            className="num text-text min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none"
          />
          <span className="text-text-muted shrink-0 text-sm">days</span>
        </div>
        <p id="link-expiry-hint" className="text-text-muted mt-2.5 text-xs">
          Only you can reclaim it after that.
        </p>
      </div>

      <div className="mt-5">
        <label htmlFor="link-memo" className={FIELD_LABEL}>
          Memo (optional)
        </label>
        <input
          id="link-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Coffee fund"
          className={`${TEXT_FIELD} mt-2`}
        />
      </div>

      {funds.rangeDead && funds.blocker ? (
        <div className="mt-5">
          <BlockedNote blocker={funds.blocker} id="link-blocked" />
        </div>
      ) : null}

      {funds.ok && needsApproval && amountWei > 0n ? (
        <div className="mt-5">
          <Note>
            MarenPay needs an allowance for {formatMusd(amountWei)} before it can escrow it.
          </Note>
        </div>
      ) : null}

      {/* There is no "your links" list, and there cannot honestly be one that shows the
        secrets: a bearer key that could be re-displayed later is a bearer key that was
        stored, which is the opposite of what the design promises. The escrows themselves
        are visible in Activity, from MarenPay's LinkCreated events. */}
      <Info summary="Why past links cannot be shown again">
        The claim key exists only in the URL fragment you copy. Maren never receives it and never
        writes it down, so a list of your old links could show that they exist and their amounts
        (which Activity does, from the contract’s events), but never the keys needed to claim them.
        That is the cost of the secret being genuinely secret.
      </Info>
    </FlowCard>
  );
}

/**
 * Split — pay N recipients in one `MarenPay.split(recipients[], amounts[], memo)` call.
 *
 * Nothing is pooled: the contract runs one `payer -> recipient` transfer per leg, so a split
 * of five is five payments the payer makes and pays gas for as a single transaction. Two ways
 * to set the numbers — an even division of one total, or a per-recipient amount — but both
 * resolve to the SAME `amounts[]` that is displayed, reviewed and signed, down to the wei. The
 * even split hands any indivisible remainder to the earliest recipients so the legs sum to the
 * total exactly; a split that quietly loses a wei is a split that lied about the total.
 *
 * `split` IS on the relay hub's allowlist (Deploy.s.sol payCalls[8]), so the gas copy is
 * derived from that fact and reads as sponsored when a relayer is live — never hardcoded.
 */
type SplitMode = 'even' | 'custom';

const SPLIT_MODES: readonly { key: SplitMode; label: string }[] = [
  { key: 'even', label: 'Split evenly' },
  { key: 'custom', label: 'Custom amounts' },
];

type RowStatus = 'empty' | 'invalid' | 'resolving' | 'address' | 'handle' | 'unknown';

interface Resolution {
  address: Address | null;
  handle: string | null;
  status: RowStatus;
}

interface SplitRow {
  id: string;
  value: string;
  amount: string;
}

function SplitPanel({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();

  const nextId = useRef(0);
  const freshRow = useCallback(
    (): SplitRow => ({ id: `row-${nextId.current++}`, value: '', amount: '' }),
    [],
  );

  const [mode, setMode] = useState<SplitMode>('even');
  const [rows, setRows] = useState<SplitRow[]>(() => [freshRow(), freshRow()]);
  const [evenTotal, setEvenTotal] = useState('');
  const [memo, setMemo] = useState('');
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});

  // A stable callback so a row reporting its resolution cannot rebuild every row underneath it.
  const onResolved = useCallback((id: string, info: Resolution) => {
    setResolved((prev) => {
      const current = prev[id];
      if (
        current &&
        current.address === info.address &&
        current.handle === info.handle &&
        current.status === info.status
      ) {
        return prev;
      }
      return { ...prev, [id]: info };
    });
  }, []);

  // ONE amounts[] array, aligned to `rows`, used for display, review and the signed call
  // alike. In even mode the remainder rides on the earliest recipients so the legs sum to
  // the typed total to the wei.
  const amounts = useMemo<bigint[]>(() => {
    if (mode === 'even') {
      const total = parseUnitsSafe(evenTotal);
      const n = BigInt(rows.length);
      if (n === 0n || total === 0n) return rows.map(() => 0n);
      const per = total / n;
      const remainder = total % n;
      return rows.map((_, i) => per + (BigInt(i) < remainder ? 1n : 0n));
    }
    return rows.map((row) => parseUnitsSafe(row.amount));
  }, [mode, evenTotal, rows]);

  const total = amounts.reduce((sum, value) => sum + value, 0n);
  const balance = balances?.musdWei ?? 0n;
  const memoBytes = utf8Length(memo);

  const funds = preflightMusdSpend(balances, total, { verb: 'split', noun: 'Split' });
  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.pay, total);

  const rowResolutions = rows.map((row) => resolved[row.id]);
  const everyResolved = rowResolutions.every(
    (info) => info?.status === 'address' || info?.status === 'handle',
  );
  const everyPositive = amounts.every((value) => value > 0n);
  const countOk = rows.length >= 2 && rows.length <= MAX_SPLIT_RECIPIENTS;
  const reviewReady =
    countOk && everyResolved && everyPositive && funds.ok && memoBytes <= 80 && writes.ready;

  // After a delivered split, start clean — the sheet owns delivery; this only notices it and
  // resets the entry surface (mirrors SendFlow).
  const sawDelivered = useRef(false);
  useEffect(() => {
    const phase = runner.phase;
    if (phase.name === 'settled' && phase.outcome.kind === 'delivered') {
      sawDelivered.current = true;
    } else if (phase.name === 'idle' && sawDelivered.current) {
      sawDelivered.current = false;
      nextId.current = 0;
      setRows([
        { id: 'row-0', value: '', amount: '' },
        { id: 'row-1', value: '', amount: '' },
      ]);
      nextId.current = 2;
      setEvenTotal('');
      setMemo('');
      setResolved({});
      refetchAllowance();
    }
  }, [runner.phase, refetchAllowance]);

  const addRow = () =>
    setRows((prev) => (prev.length >= MAX_SPLIT_RECIPIENTS ? prev : [...prev, freshRow()]));
  const removeRow = (id: string) =>
    setRows((prev) => (prev.length <= 2 ? prev : prev.filter((row) => row.id !== id)));
  const setRowValue = (id: string, value: string) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  const setRowAmount = (id: string, amount: string) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, amount } : row)));

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(total)} for MarenPay`,
    successTitle: `Approved ${formatMusd(total)}`,
    changes: [
      {
        label: 'MarenPay allowance',
        before: <Musd wei={allowanceWei ?? 0n} />,
        after: <Musd wei={total} />,
      },
    ],
    details: [
      { label: 'Token', value: <span className="text-text-muted">MUSD</span> },
      { label: 'Amount', value: <Musd wei={total} /> },
      {
        label: 'Spender',
        value: <span className="mono text-text-muted break-all text-xs">{SPENDERS.pay}</span>,
      },
    ],
    gas: {
      sponsored: false,
      note: 'The split cannot pull MUSD without this. You pay the Bitcoin gas.',
    },
    confirmLabel: 'Approve',
    submit: writes.ready
      ? async () => {
          const hash = await writes.approveMusd(SPENDERS.pay, total);
          refetchAllowance();
          return hash;
        }
      : undefined,
  });

  const splitIntent = (): TxIntent => {
    const recipients = rows.map((row) => resolved[row.id]?.address as Address);
    return {
      title: `Split ${formatMusd(total)} across ${rows.length}`,
      successTitle: `Split ${formatMusd(total)}`,
      changes: [
        {
          label: 'MUSD in your wallet',
          before: <Musd wei={balance} />,
          after: <Musd wei={balance > total ? balance - total : 0n} />,
        },
      ],
      details: [
        ...rows.map((row, i) => {
          const info = resolved[row.id];
          return {
            label: info?.handle ?? `Recipient ${i + 1}`,
            value: (
              <span className="block text-right">
                <Musd wei={amounts[i] ?? 0n} />
                <span className="mono text-text-muted mt-0.5 block break-all text-xs">
                  {info?.address}
                </span>
              </span>
            ),
          };
        }),
        { label: 'Total', value: <Musd wei={total} /> },
        ...(memo
          ? [{ label: 'Memo', value: <span className="text-text-muted">{memo}</span> }]
          : []),
      ],
      gas: gasNote(
        actionIsRelayable('splitPayment'),
        'One transaction pays every recipient directly; nothing is pooled and the memo is public on-chain.',
        relayer,
      ),
      confirmLabel: `Split ${formatMusd(total)}`,
      // Index-aligned arrays: recipients[i] receives amounts[i]. The contract reverts
      // ArrayLengthMismatch if they ever diverge, and the simulation catches it before signing.
      submit: writes.ready ? () => writes.splitPayment(recipients, amounts, memo) : undefined,
    };
  };

  return (
    <FlowCard
      id="split-title"
      title="Split a payment"
      description={`Pay up to ${MAX_SPLIT_RECIPIENTS} people in one transaction. Each leg is a direct payment.`}
      footer={
        <ComposerFooter
          note={gasLine(actionIsRelayable('splitPayment'), relayer)}
          stack={needsApproval && total > 0n}
        >
          {needsApproval && total > 0n ? (
            <ActionButton
              onClick={() => runner.request(approvalIntent())}
              disabled={!writes.ready || !funds.ok}
              aria-describedby="split-blocked"
              icon={<ArrowUpRight className="size-4" />}
              className={FOOTER_BUTTON}
            >
              Approve {formatMusd(total)}
            </ActionButton>
          ) : null}
          <ActionButton
            variant={needsApproval && total > 0n ? 'secondary' : 'primary'}
            onClick={() => runner.request(splitIntent())}
            disabled={!reviewReady || (needsApproval && total > 0n)}
            aria-describedby="split-blocked"
            icon={<PayIcon className="size-4" />}
            className={FOOTER_BUTTON}
          >
            Review split
          </ActionButton>
        </ComposerFooter>
      }
    >
      <Segmented options={SPLIT_MODES} value={mode} onChange={setMode} label="How to divide" />

      {mode === 'even' ? (
        <div className="mt-6">
          <AmountField
            value={evenTotal}
            onChange={setEvenTotal}
            unit="MUSD"
            label="Total to split evenly"
            max={<Musd wei={balance} size="sm" />}
            maxLabel="Available"
            error={
              funds.blocker && funds.blocker.scope === 'wallet' && total > 0n
                ? funds.blocker.title
                : null
            }
            hint={
              rows.length > 0 && parseUnitsSafe(evenTotal) > 0n ? (
                <span>
                  Each of {rows.length} gets <Musd wei={amounts[0] ?? 0n} size="sm" tone="muted" />
                  {(amounts[0] ?? 0n) !== (amounts[amounts.length - 1] ?? 0n)
                    ? ' (the odd wei goes to the first few)'
                    : ''}
                  .
                </span>
              ) : null
            }
          />
        </div>
      ) : null}

      <div className="mt-6">
        <span className={FIELD_LABEL}>Recipients</span>
        <ul className="mt-2 flex flex-col gap-1">
          {rows.map((row, index) => (
            <li key={row.id}>
              <SplitRecipientRow
                id={row.id}
                index={index}
                value={row.value}
                amount={row.amount}
                mode={mode}
                computedShare={amounts[index] ?? 0n}
                canRemove={rows.length > 2}
                onValue={setRowValue}
                onAmount={setRowAmount}
                onRemove={removeRow}
                onResolved={onResolved}
              />
            </li>
          ))}
        </ul>

        <ActionButton
          variant="secondary"
          onClick={addRow}
          disabled={rows.length >= MAX_SPLIT_RECIPIENTS}
          icon={<Plus aria-hidden className="size-4" />}
          className="mt-2"
        >
          Add recipient
        </ActionButton>
      </div>

      <div className="mt-6">
        <label htmlFor="split-memo" className={FIELD_LABEL}>
          Memo (optional)
        </label>
        <input
          id="split-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Dinner, three ways"
          autoComplete="off"
          aria-describedby="split-memo-count"
          aria-invalid={memoBytes > 80 ? true : undefined}
          className={`${TEXT_FIELD} mt-2`}
        />
        <p id="split-memo-count" className="text-text-muted mt-2.5 text-xs">
          <span className="num">{memoBytes}</span>/80 bytes · one memo, written on-chain for every
          leg
          {memoBytes > 80 ? <span className="text-danger"> · too long</span> : null}
        </p>
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-4 border-t border-[var(--border-hairline)] pt-4">
        <span className="text-text-muted text-sm">Total</span>
        <Musd wei={total} size="lg" />
      </div>

      {funds.rangeDead && funds.blocker ? (
        <div className="mt-5">
          <BlockedNote blocker={funds.blocker} id="split-blocked" />
        </div>
      ) : null}

      {funds.ok && needsApproval && total > 0n ? (
        <div className="mt-5">
          <Note>
            MarenPay needs an allowance for {formatMusd(total)} before it can pull the split;
            currently {formatMusd(allowanceWei ?? 0n)}. That is a separate transaction, shown here
            rather than slipped in behind the payment.
          </Note>
        </div>
      ) : null}

      <p className="text-text-muted mt-5 text-xs leading-relaxed">
        Splits you send appear in Activity as one payment per recipient, decoded from MarenPay’s own
        Paid events.
      </p>
    </FlowCard>
  );
}

/**
 * One recipient row. It resolves its OWN @handle so the parent never calls a hook in a loop
 * over a list whose length changes, and reports the resolved address up through a stable
 * callback. The resolved address is shown before anything is signed, exactly as Send does.
 */
function SplitRecipientRow({
  id,
  index,
  value,
  amount,
  mode,
  computedShare,
  canRemove,
  onValue,
  onAmount,
  onRemove,
  onResolved,
}: {
  id: string;
  index: number;
  value: string;
  amount: string;
  mode: SplitMode;
  computedShare: bigint;
  canRemove: boolean;
  onValue: (id: string, value: string) => void;
  onAmount: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onResolved: (id: string, info: Resolution) => void;
}) {
  const trimmed = value.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: handleResult, isFetching } = useResolvedHandle(trimmed);

  const status: RowStatus =
    trimmed === ''
      ? 'empty'
      : isAddress
        ? 'address'
        : isHandle
          ? isFetching
            ? 'resolving'
            : handleResult
              ? 'handle'
              : 'unknown'
          : 'invalid';

  const address: Address | null =
    status === 'address'
      ? (trimmed as Address)
      : status === 'handle' && handleResult
        ? handleResult.address
        : null;
  const handle = status === 'handle' && handleResult ? handleResult.handle : null;

  useEffect(() => {
    onResolved(id, { address, handle, status });
  }, [id, address, handle, status, onResolved]);

  const inputId = `split-recipient-${id}`;
  const amountId = `split-amount-${id}`;
  const statusId = `${inputId}-status`;

  return (
    <div>
      {/* One line from `sm`: recipient, amount, remove. On a phone the amount drops to its
          own line under the recipient (CSS order only; the tab order stays recipient,
          amount, remove), so a 42-character address is not squeezed into 150px. */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            Recipient {index + 1}
          </label>
          <input
            id={inputId}
            value={value}
            onChange={(event) => onValue(id, event.target.value)}
            placeholder="@handle or 0x address"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby={statusId}
            className={TEXT_FIELD}
          />
        </div>

        {mode === 'custom' ? (
          <div className="bg-surface order-3 flex h-12 w-full shrink-0 items-center gap-1.5 border border-[var(--border-strong)] px-3 transition-[border-color] duration-150 ease-out focus-within:border-violet-500 sm:order-none sm:w-[8.5rem]">
            <label htmlFor={amountId} className="sr-only">
              Amount for recipient {index + 1}
            </label>
            <input
              id={amountId}
              value={amount}
              onChange={(event) => onAmount(id, event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              className="num text-text placeholder:text-text-subtle w-full min-w-0 bg-transparent text-right text-[0.9375rem] outline-none"
            />
            <span className="text-text-muted shrink-0 text-xs">MUSD</span>
          </div>
        ) : (
          // The even share is already stated once under the total ("Each of N gets"), so
          // on a phone the row gives that width back to the address.
          <div className="hidden min-w-[5.5rem] shrink-0 text-right sm:block">
            <Musd wei={computedShare} size="sm" tone="muted" />
          </div>
        )}

        <button
          type="button"
          onClick={() => onRemove(id)}
          disabled={!canRemove}
          aria-label={`Remove recipient ${index + 1}`}
          className="text-text-muted hover:text-text hover:bg-text/[0.05] disabled:text-text-subtle grid size-11 shrink-0 place-items-center transition-[color,background-color] duration-150 ease-out disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Minus aria-hidden className="size-4" />
        </button>
      </div>

      <p id={statusId} className="mt-2 min-h-[1.25rem] text-[0.8125rem]" role="status">
        {status === 'resolving' ? (
          <span className="text-text-muted">Resolving handle…</span>
        ) : status === 'handle' && handleResult ? (
          <FieldStatus tone="ok">
            <span className="text-text-muted">{handleResult.handle} resolves to</span>
            <span className="mono text-text break-all text-xs">{handleResult.address}</span>
          </FieldStatus>
        ) : status === 'unknown' ? (
          <FieldStatus tone="error">
            <span className="text-danger">No such handle on this network.</span>
          </FieldStatus>
        ) : status === 'address' ? (
          <FieldStatus tone="ok">
            <span className="text-text-muted">Valid address.</span>
          </FieldStatus>
        ) : status === 'invalid' ? (
          <span className="text-text-muted">Enter a full @handle or a 0x address.</span>
        ) : (
          <span className="text-text-muted">Enter an @handle or a 0x address.</span>
        )}
      </p>
    </div>
  );
}
