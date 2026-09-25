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
  Label,
  Loading,
  Note,
  Panel,
  Refreshing,
} from '@/components/app/primitives';
import { ReceivePanel } from '@/components/app/receive-panel';
import { SendFlow } from '@/components/app/send-flow';
import { TxSheet, useTxRunner, type TxIntent, type TxRunner } from '@/components/app/tx';
import { X402Teaser } from '@/components/app/x402-teaser';
import { ArrowUpRight, LinkIcon, Minus, PayIcon, Plus } from '@/components/ui/icons';
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

  if (!source.connected) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <ConnectPrompt icon={<PayIcon className="size-6" />} title="Connect to send MUSD">
          Send MUSD to an @handle or a plain address, with an optional memo written on-chain.
        </ConnectPrompt>
        <GasLine />
        {/* The demo's offer is readable without a wallet, so the door stays open here. */}
        <X402Teaser />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header refreshing={refreshing} />

      <Segmented options={TABS} value={tab} onChange={setTab} label="Payment type" />

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

      {/* Below every flow, quiet on purpose: a protocol demo, not a money surface. */}
      <X402Teaser />

      <TxSheet runner={runner} />
    </div>
  );
}

function Header({ refreshing = false }: { refreshing?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label>Pay</Label>
        <h1 className="t-h3 mt-1.5">Move dollars</h1>
      </div>
      {refreshing ? <Refreshing /> : null}
    </div>
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
  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      {gasLine(actionIsRelayable('payAddress'), relayer)}
    </p>
  );
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
            <span className="num text-text-subtle block text-xs">{resolved.address}</span>
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
    <Panel
      title="Request payment"
      meta={
        <span className="text-text-muted text-xs">
          An ask, not an obligation. Nothing moves until the other side pays it.
        </span>
      }
    >
      <div className="px-5 py-5">
        <div className="mt-8 max-w-xl">
          <AmountField value={amount} onChange={setAmount} unit="MUSD" label="Amount" />
        </div>

        <div className="mt-8 max-w-xl">
          <label htmlFor="request-from" className="t-label text-text-subtle block">
            From (optional)
          </label>
          <input
            id="request-from"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="@handle"
            autoComplete="off"
            spellCheck={false}
            className="num text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg focus:border-[var(--border-strong)]"
          />
          <p className="mt-3 min-h-[1.25rem] text-sm" role="status">
            {isHandle && resolved ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-text-muted">{resolved.handle} resolves to</span>
                <span className="num text-text text-[0.8125rem]">{resolved.address}</span>
              </span>
            ) : isHandle ? (
              <span className="text-danger">No such handle on this network.</span>
            ) : (
              <span className="text-text-subtle">Anyone may fulfil an unaddressed request.</span>
            )}
          </p>
        </div>

        <div className="mt-8 max-w-xl">
          <label htmlFor="request-memo" className="t-label text-text-subtle block">
            Memo (optional)
          </label>
          <input
            id="request-memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="Invoice 0044"
            className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] focus:border-[var(--border-strong)]"
          />
        </div>

        <div className="mt-8">
          <GasLine />
        </div>

        <div className="mt-4">
          <ActionButton
            onClick={() => runner.request(intent())}
            disabled={amountWei === 0n || !writes.ready || (isHandle && !resolved)}
            icon={<ArrowUpRight className="size-4" />}
          >
            Request {amountWei > 0n ? formatMusd(amountWei) : ''}
          </ActionButton>
        </div>

        {/* No "open requests" list. There was one, and it was seeded. Requests this account
          creates appear in Activity, decoded from the contract's own RequestCreated
          events — a real list is better than a plausible one. */}
        <p className="text-text-subtle mt-8 text-xs leading-relaxed">
          Requests you create appear in Activity.
        </p>
      </div>
    </Panel>
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
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.pay}</span>,
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
        value: <span className="num text-text-subtle break-all text-xs">{requester}</span>,
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

  return (
    <Panel
      title="Pay a request"
      meta={<span className="text-text-muted text-xs">Settle a request someone sent you.</span>}
    >
      <div className="px-5 py-5">
        <div className="max-w-xl">
          <label htmlFor="fulfil-id" className="t-label text-text-subtle block">
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
            className="num text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg focus:border-[var(--border-strong)]"
          />
          <p className="text-text-subtle mt-3 text-xs">
            The number the requester shared, or the id shown on their request in Activity.
          </p>
        </div>

        {!writes.ready ? (
          <div className="mt-6">
            <Note>Connect a wallet on {getChain(NETWORK).name} to read and pay a request.</Note>
          </div>
        ) : requestId === null ? null : isFetching && record === undefined ? (
          <div className="mt-2">
            <Loading>Reading request #{trimmed} from Mezo</Loading>
          </div>
        ) : status === 0 ? (
          <div className="mt-6">
            <Note tone="warning" role="alert">
              There is no request #{trimmed} on {getChain(NETWORK).name}. Check the number and try
              again.
            </Note>
          </div>
        ) : (
          <>
            <dl className="card mt-6 overflow-hidden">
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
                last={!(designatedPayer && designatedPayer !== zero)}
              />
              {designatedPayer && designatedPayer !== zero ? (
                <FulfilRow
                  label="Payer"
                  value={<span className="text-text text-sm">{shortAddress(designatedPayer)}</span>}
                  sub={designatedPayer}
                  last
                />
              ) : null}
            </dl>

            {status === 2 ? (
              <div className="mt-6">
                <Note>This request has already been fulfilled. Nothing is owed on it.</Note>
              </div>
            ) : status === 3 ? (
              <div className="mt-6">
                <Note>The requester cancelled this request, so it can no longer be paid.</Note>
              </div>
            ) : isMine ? (
              <div className="mt-6">
                <Note>
                  You created this request, so you cannot pay it yourself. Share the number with
                  whoever owes you.
                </Note>
              </div>
            ) : addressedElsewhere ? (
              <div className="mt-6">
                <Note tone="warning" role="alert">
                  This request names a specific payer, and it is not the connected wallet. Only that
                  address can pay it.
                </Note>
              </div>
            ) : (
              <>
                {funds.rangeDead && funds.blocker ? (
                  <div className="mt-6">
                    <BlockedNote blocker={funds.blocker} id="fulfil-blocked" />
                  </div>
                ) : null}

                {funds.ok && needsApproval && amountWei > 0n ? (
                  <div className="mt-6">
                    <Note>
                      MarenPay needs an allowance for {formatMusd(amountWei)} before it can pull the
                      payment. That is a separate transaction, shown here rather than slipped in
                      behind it.
                    </Note>
                  </div>
                ) : null}

                <div className="mt-6">
                  <p className="text-text-subtle text-xs leading-relaxed">
                    {gasLine(actionIsRelayable('fulfillRequest'), relayer)}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {needsApproval && amountWei > 0n ? (
                    <ActionButton
                      onClick={() => runner.request(approvalIntent())}
                      disabled={!writes.ready || !funds.ok}
                      aria-describedby="fulfil-blocked"
                      icon={<ArrowUpRight className="size-4" />}
                    >
                      Approve {formatMusd(amountWei)}
                    </ActionButton>
                  ) : null}
                  <ActionButton
                    variant={needsApproval && amountWei > 0n ? 'secondary' : 'primary'}
                    onClick={() => runner.request(fulfilIntent())}
                    disabled={
                      !payable || !funds.ok || !writes.ready || (needsApproval && amountWei > 0n)
                    }
                    aria-describedby="fulfil-blocked"
                    icon={<PayIcon className="size-4" />}
                  >
                    Pay {formatMusd(amountWei)}
                  </ActionButton>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function FulfilRow({
  label,
  value,
  sub,
  last = false,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
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
        <span className="block">{value}</span>
        {sub ? (
          <span className="num text-text-subtle mt-0.5 block break-all text-xs">{sub}</span>
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
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.pay}</span>,
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
          value: <span className="num text-text-subtle break-all text-xs">{linkKey}</span>,
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
    <Panel
      title="Payment link"
      meta={
        <span className="text-text-muted text-xs">
          Escrows MUSD against a one-time key. Anyone with the link can claim it.
        </span>
      }
    >
      <div className="px-5 py-5">
        <div className="mt-8 grid max-w-2xl grid-cols-1 gap-8 sm:grid-cols-2">
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
          <div>
            <label htmlFor="link-expiry" className="t-label text-text-subtle block">
              Expires in
            </label>
            <div className="mt-3 flex items-baseline gap-3 border-b border-[var(--border-hairline)] pb-3 focus-within:border-[var(--border-strong)]">
              <input
                id="link-expiry"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                inputMode="numeric"
                className="num text-text min-w-0 flex-1 bg-transparent text-3xl"
              />
              <span className="t-h3 text-text-muted shrink-0">days</span>
            </div>
            <p className="text-text-subtle mt-3 text-xs">Only you can reclaim it after that.</p>
          </div>
        </div>

        <div className="mt-8 max-w-xl">
          <label htmlFor="link-memo" className="t-label text-text-subtle block">
            Memo (optional)
          </label>
          <input
            id="link-memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="Coffee fund"
            className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] focus:border-[var(--border-strong)]"
          />
        </div>

        {funds.rangeDead && funds.blocker ? (
          <div className="mt-6">
            <BlockedNote blocker={funds.blocker} id="link-blocked" />
          </div>
        ) : null}

        {funds.ok && needsApproval && amountWei > 0n ? (
          <div className="mt-6">
            <Note>
              MarenPay needs an allowance for {formatMusd(amountWei)} before it can escrow it.
            </Note>
          </div>
        ) : null}

        <div className="mt-8">
          <GasLine />
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {needsApproval && amountWei > 0n ? (
            <ActionButton
              onClick={() => runner.request(approvalIntent())}
              disabled={!writes.ready || !funds.ok}
              aria-describedby="link-blocked"
              icon={<LinkIcon className="size-4" />}
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
          >
            Create link
          </ActionButton>
        </div>

        {created ? (
          <div className="mt-6">
            <Note tone="warning">
              <p className="text-text">Copy this now. It is shown once.</p>
              <p className="num text-text-muted mt-2 break-all text-xs">
                {typeof window !== 'undefined' ? window.location.origin : ''}/claim#{created.secret}
              </p>
              <p className="mt-2 text-xs">
                The claim key after the <span className="num">#</span> never leaves your browser and
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
                >
                  {copied ? 'Copied' : 'Copy link'}
                </ActionButton>
              </div>
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
          (which Activity does, from the contract’s events), but never the keys needed to claim
          them. That is the cost of the secret being genuinely secret.
        </Info>
      </div>
    </Panel>
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
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.pay}</span>,
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
                <span className="num text-text-subtle mt-0.5 block break-all text-xs">
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
    <Panel
      title="Split a payment"
      meta={
        <span className="text-text-muted text-xs">
          Pay up to {MAX_SPLIT_RECIPIENTS} people in one transaction. Each leg is a direct payment.
        </span>
      }
    >
      <div className="px-5 py-5">
        <div className="mt-4 max-w-xl">
          <Segmented options={SPLIT_MODES} value={mode} onChange={setMode} label="How to divide" />
        </div>

        {mode === 'even' ? (
          <div className="mt-8 max-w-xl">
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
                    Each of {rows.length} gets{' '}
                    <Musd wei={amounts[0] ?? 0n} size="sm" tone="muted" />
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

        <div className="mt-8">
          <span className="t-label text-text-subtle block">Recipients</span>
          <ul className="mt-3 flex flex-col gap-6">
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

          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_SPLIT_RECIPIENTS}
            className="text-text-muted hover:text-text mt-6 inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-4 text-sm transition-[color,border-color,transform] duration-[120ms] ease-out hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 active:scale-[0.97] disabled:opacity-40 disabled:hover:border-[var(--border-hairline)]"
          >
            <Plus aria-hidden className="size-4" />
            Add recipient
          </button>
        </div>

        <div className="mt-8 max-w-xl">
          <label htmlFor="split-memo" className="t-label text-text-subtle block">
            Memo (optional)
          </label>
          <input
            id="split-memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="Dinner, three ways"
            autoComplete="off"
            aria-describedby="split-memo-count"
            className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] focus:border-[var(--border-strong)]"
          />
          <p id="split-memo-count" className="text-text-subtle mt-2 text-xs">
            <span className="num">{memoBytes}</span>/80 bytes · one memo, written on-chain for every
            leg
            {memoBytes > 80 ? <span className="text-danger"> · too long</span> : null}
          </p>
        </div>

        <div className="mt-8 flex items-baseline justify-between border-t border-[var(--border-hairline)] pt-5">
          <span className="t-label text-text-subtle">Total</span>
          <Musd wei={total} size="lg" />
        </div>

        {funds.rangeDead && funds.blocker ? (
          <div className="mt-6">
            <BlockedNote blocker={funds.blocker} id="split-blocked" />
          </div>
        ) : null}

        {funds.ok && needsApproval && total > 0n ? (
          <div className="mt-6">
            <Note>
              MarenPay needs an allowance for {formatMusd(total)} before it can pull the split;
              currently {formatMusd(allowanceWei ?? 0n)}. That is a separate transaction, shown here
              rather than slipped in behind the payment.
            </Note>
          </div>
        ) : null}

        <div className="mt-8">
          <p className="text-text-subtle text-xs leading-relaxed">
            {gasLine(actionIsRelayable('splitPayment'), relayer)}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {needsApproval && total > 0n ? (
            <ActionButton
              onClick={() => runner.request(approvalIntent())}
              disabled={!writes.ready || !funds.ok}
              aria-describedby="split-blocked"
              icon={<ArrowUpRight className="size-4" />}
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
          >
            Review split
          </ActionButton>
        </div>

        <p className="text-text-subtle mt-8 text-xs leading-relaxed">
          Splits you send appear in Activity as one payment per recipient, decoded from MarenPay’s
          own Paid events.
        </p>
      </div>
    </Panel>
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
      <div className="flex items-end gap-3">
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
            className="num text-text placeholder:text-text-subtle/60 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg focus:border-[var(--border-strong)]"
          />
        </div>

        {mode === 'custom' ? (
          <div className="flex shrink-0 items-baseline gap-2 border-b border-[var(--border-hairline)] pb-3 focus-within:border-[var(--border-strong)]">
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
              className="num text-text placeholder:text-text-subtle/60 w-28 bg-transparent text-right text-lg"
            />
            <span className="t-label text-text-muted shrink-0">MUSD</span>
          </div>
        ) : (
          <div className="shrink-0 pb-3 text-right">
            <Musd wei={computedShare} tone="muted" />
          </div>
        )}

        <button
          type="button"
          onClick={() => onRemove(id)}
          disabled={!canRemove}
          aria-label={`Remove recipient ${index + 1}`}
          className="text-text-muted hover:text-text grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] transition-[color,border-color,transform] duration-[120ms] ease-out hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 active:scale-[0.97] disabled:opacity-30 disabled:hover:border-[var(--border-hairline)]"
        >
          <Minus aria-hidden className="size-4" />
        </button>
      </div>

      <p id={statusId} className="mt-2 min-h-[1.25rem] text-sm" role="status">
        {status === 'resolving' ? (
          <span className="text-text-subtle">Resolving handle…</span>
        ) : status === 'handle' && handleResult ? (
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
            <span className="text-text-muted">{handleResult.handle} resolves to</span>
            <span className="num text-text text-[0.8125rem]">{handleResult.address}</span>
          </span>
        ) : status === 'unknown' ? (
          <span className="text-danger">No such handle on this network.</span>
        ) : status === 'address' ? (
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
            <span className="text-text-muted">Valid address.</span>
          </span>
        ) : status === 'invalid' ? (
          <span className="text-text-subtle">Enter a full @handle or a 0x address.</span>
        ) : (
          <span className="text-text-subtle">Enter an @handle or a 0x address.</span>
        )}
      </p>
    </div>
  );
}
