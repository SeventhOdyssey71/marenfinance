'use client';

import { useState } from 'react';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { formatMusd } from '@maren/sdk';
import type { Address } from 'viem';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { AmountField, Segmented } from '@/components/app/controls';
import { HandleRegistration } from '@/components/app/handle-registration';
import { Musd } from '@/components/app/money';
import { ActionButton, Info, Label, Note, Panel } from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent, type TxRunner } from '@/components/app/tx';
import { ArrowUpRight, LinkIcon, PayIcon } from '@/components/ui/icons';
import { parseUnitsSafe, utf8Length } from '@/lib/copy';
import { gasNote, SPENDERS, useMarenWrites, useMusdAllowance } from '@/lib/chain/write';
import { useBalances, useDataSource, useResolvedHandle } from '@/lib/data/source';

type Tab = 'send' | 'request' | 'link' | 'handle';

const TABS = [
  { key: 'send' as const, label: 'Send' },
  { key: 'request' as const, label: 'Request' },
  { key: 'link' as const, label: 'Link' },
  { key: 'handle' as const, label: 'Handle' },
];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

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

  if (!source.connected) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <ConnectPrompt icon={<PayIcon className="size-6" />} title="Connect to send MUSD">
          Send MUSD to an @handle or a plain address, with an optional memo written on-chain.
        </ConnectPrompt>
        <GasLine />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header />

      <Segmented options={TABS} value={tab} onChange={setTab} label="Payment type" />

      {tab === 'send' ? <SendPanel runner={runner} /> : null}
      {tab === 'request' ? <RequestPanel runner={runner} /> : null}
      {tab === 'link' ? <LinkPanel runner={runner} /> : null}
      {tab === 'handle' ? <HandleRegistration runner={runner} /> : null}

      <TxSheet runner={runner} />
    </div>
  );
}

function Header() {
  return (
    <div>
      <Label>Pay</Label>
      <h1 className="t-h3 mt-1.5">Move dollars</h1>
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
  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      You pay the Bitcoin gas. No relayer is running yet.
    </p>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function SendPanel({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const writes = useMarenWrites();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const trimmed = to.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: resolved, isFetching } = useResolvedHandle(trimmed);

  const amountWei = parseUnitsSafe(amount);
  const balance = balances?.musdWei ?? 0n;
  const overBalance = amountWei > balance;
  const recipient = isAddress ? (trimmed as Address) : (resolved?.address ?? null);
  const memoBytes = utf8Length(memo);

  const { needed: needsApproval, refetch: refetchAllowance } = useMusdAllowance(
    SPENDERS.pay,
    amountWei,
  );

  const canSend =
    recipient !== null && amountWei > 0n && !overBalance && memoBytes <= 80 && writes.ready;

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(amountWei)} for MarenPay`,
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

  const intent = (): TxIntent => ({
    title: `Send ${formatMusd(amountWei)}`,
    details: [
      { label: 'Amount', value: <Musd wei={amountWei} /> },
      {
        label: 'To',
        value: (
          <span>
            {isHandle && resolved ? (
              <>
                <span className="text-text block">{resolved.handle}</span>
                <span className="num text-text-subtle block text-xs">{resolved.address}</span>
              </>
            ) : (
              <span className="num text-text-subtle break-all text-xs">{recipient}</span>
            )}
          </span>
        ),
      },
      ...(memo ? [{ label: 'Memo', value: <span className="text-text-muted">{memo}</span> }] : []),
    ],
    gas: gasNote(true, 'The memo is written on-chain and is publicly readable by anyone, forever.'),
    confirmLabel: 'Send',
    /**
     * A handle is paid through `payToHandle`, which re-resolves it INSIDE the transaction,
     * rather than through the address this browser resolved a moment ago. If the handle
     * changed hands between the read and the signature, the contract's answer is the one
     * that should win — and if it no longer exists, the payment reverts with
     * `HandleNotRegistered` instead of going to whoever holds it now.
     */
    submit: writes.ready
      ? () =>
          isHandle && resolved
            ? writes.payHandle(resolved.handle, amountWei, memo)
            : writes.payAddress(recipient as Address, amountWei, memo)
      : undefined,
  });

  return (
    <Panel title="Send">
      <div className="px-5 py-5">

      <div className="mt-6 max-w-xl">
        <label htmlFor="pay-to" className="t-label text-text-subtle block">
          To
        </label>
        <input
          id="pay-to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="@handle or 0x address"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="pay-to-status"
          className="num text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg outline-none focus:border-[var(--border-strong)]"
        />

        {/* The resolved address, always, before anything is signed. */}
        <div id="pay-to-status" className="mt-3 min-h-[1.25rem] text-sm" role="status">
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
            <span className="text-text-muted">Valid address.</span>
          ) : trimmed.length > 0 ? (
            <span className="text-text-subtle">Enter an @handle or a 0x address.</span>
          ) : (
            <span className="text-text-subtle">Enter an @handle or a 0x address.</span>
          )}
        </div>
      </div>

      <div className="mt-8 max-w-xl">
        <AmountField
          value={amount}
          onChange={setAmount}
          unit="MUSD"
          label="Amount"
          max={<Musd wei={balance} size="sm" />}
          maxLabel="Available"
          onMax={() => setAmount(formatMusd(balance, { unit: false }).replace(/,/g, ''))}
          error={overBalance ? 'More than your MUSD balance.' : null}
        />
      </div>

      <div className="mt-8 max-w-xl">
        <label htmlFor="pay-memo" className="t-label text-text-subtle block">
          Memo (optional)
        </label>
        <input
          id="pay-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="What is this for?"
          aria-describedby="pay-memo-count"
          className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] outline-none focus:border-[var(--border-strong)]"
        />
        <p id="pay-memo-count" className="text-text-subtle mt-2 text-xs">
          <span className="num">{memoBytes}</span>/80 bytes · public on-chain
          {memoBytes > 80 ? <span className="text-danger"> · too long</span> : null}
        </p>
      </div>

      {balance === 0n ? (
        <div className="mt-8">
          <Note>
            You hold no MUSD, so there is nothing to send yet. Deposit Bitcoin in the Vault and
            borrow against it, or receive a payment from someone else.
          </Note>
        </div>
      ) : null}

      {needsApproval && amountWei > 0n ? (
        <div className="mt-6">
          <Note>
            MarenPay needs an allowance for {formatMusd(amountWei)} first. That is a separate
            transaction, shown here rather than slipped in behind the payment.
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
            disabled={!writes.ready || overBalance || amountWei === 0n}
            icon={<ArrowUpRight className="size-4" />}
          >
            Approve {formatMusd(amountWei)}
          </ActionButton>
        ) : null}
        <ActionButton
          variant={needsApproval && amountWei > 0n ? 'secondary' : 'primary'}
          onClick={() => runner.request(intent())}
          disabled={!canSend || (needsApproval && amountWei > 0n)}
          icon={<ArrowUpRight className="size-4" />}
        >
          {amountWei > 0n ? `Send ${formatMusd(amountWei)}` : 'Send'}
        </ActionButton>
      </div>
      </div>
    </Panel>
  );
}

function RequestPanel({ runner }: { runner: TxRunner }) {
  const writes = useMarenWrites();
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
      true,
      'A request creates no obligation and moves no funds — it is an ask the other side fulfils in one action.',
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
          className="num text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-lg outline-none focus:border-[var(--border-strong)]"
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
          className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] outline-none focus:border-[var(--border-strong)]"
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
 * Payment links.
 *
 * The construction matters and the interface should not hide it: the link carries a
 * one-time PRIVATE KEY, and the claimer signs their own address with it. A copied
 * signature is therefore only valid for the recipient it already names, which is what
 * stops a link from being front-run in the mempool. The secret never touches the chain.
 */
function LinkPanel({ runner }: { runner: TxRunner }) {
  const { data: balances } = useBalances();
  const writes = useMarenWrites();
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [memo, setMemo] = useState('');
  const [created, setCreated] = useState<{ secret: string; linkKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const amountWei = parseUnitsSafe(amount);
  const expiryDays = Number.parseInt(days, 10) || 0;
  const balance = balances?.musdWei ?? 0n;
  const overBalance = amountWei > balance;

  const { needed: needsApproval, refetch: refetchAllowance } = useMusdAllowance(
    SPENDERS.pay,
    amountWei,
  );

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(amountWei)} for MarenPay`,
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
      details: [
        { label: 'Amount escrowed', value: <Musd wei={amountWei} /> },
        { label: 'Expires', value: <span className="text-text-muted">in {expiryDays} days</span> },
        {
          label: 'Locked to key',
          value: <span className="num text-text-subtle break-all text-xs">{linkKey}</span>,
        },
      ],
      gas: gasNote(true, 'Escrows the MUSD against a one-time key until someone claims it.'),
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
          error={overBalance ? 'More than your MUSD balance.' : null}
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
              className="num text-text min-w-0 flex-1 bg-transparent text-3xl outline-none"
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
          className="text-text placeholder:text-text-subtle/60 mt-3 w-full border-b border-[var(--border-hairline)] bg-transparent pb-3 text-[0.9375rem] outline-none focus:border-[var(--border-strong)]"
        />
      </div>

      {needsApproval && amountWei > 0n ? (
        <div className="mt-6">
          <Note>MarenPay needs an allowance for {formatMusd(amountWei)} before it can escrow it.</Note>
        </div>
      ) : null}

      <div className="mt-8">
        <GasLine />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {needsApproval && amountWei > 0n ? (
          <ActionButton
            onClick={() => runner.request(approvalIntent())}
            disabled={!writes.ready || overBalance || amountWei === 0n}
            icon={<LinkIcon className="size-4" />}
          >
            Approve {formatMusd(amountWei)}
          </ActionButton>
        ) : null}
        <ActionButton
          variant={needsApproval && amountWei > 0n ? 'secondary' : 'primary'}
          onClick={() => runner.request(intent())}
          disabled={
            amountWei === 0n ||
            overBalance ||
            expiryDays <= 0 ||
            !writes.ready ||
            (needsApproval && amountWei > 0n)
          }
          icon={<LinkIcon className="size-4" />}
        >
          Create link
        </ActionButton>
      </div>

      {created ? (
        <div className="mt-6">
          <Note tone="warning">
            <p className="text-text">Copy this now — it is shown once.</p>
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
        writes it down, so a list of your old links could show that they exist and their amounts —
        which Activity does, from the contract’s events — but never the keys needed to claim them.
        That is the cost of the secret being genuinely secret.
      </Info>
      </div>
    </Panel>
  );
}
