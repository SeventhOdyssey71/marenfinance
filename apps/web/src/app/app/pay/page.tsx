'use client';

import { useState } from 'react';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { formatMusd, shortAddress } from '@maren/sdk';

import { AmountField, Segmented } from '@/components/app/controls';
import { Musd, Num } from '@/components/app/money';
import {
  ActionButton,
  AppCard,
  CardTitle,
  Label,
  Note,
  StatRow,
} from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { ArrowUpRight, LinkIcon } from '@/components/ui/icons';
import { parseUnitsSafe, timeAgo, timeUntil, utf8Length } from '@/lib/copy';
import { mutate } from '@/lib/data/mock';
import {
  useBalances,
  useLinks,
  useRequests,
  useResolvedHandle,
  useSponsorship,
} from '@/lib/data/source';

type Tab = 'send' | 'request' | 'link';

const TABS = [
  { key: 'send' as const, label: 'Send' },
  { key: 'request' as const, label: 'Request' },
  { key: 'link' as const, label: 'Link' },
];

/**
 * Pay — the habit-forming surface. Everything here is gasless.
 *
 * The rule this screen is built around: a user always sees where money is actually
 * going. A `@handle` is a convenience over an address, never a replacement for it, so the
 * resolved address is displayed beside the handle as it resolves AND again in the
 * confirmation sheet. An unregistered handle fails loudly rather than falling back to
 * anything.
 */
export default function PayPage() {
  const [tab, setTab] = useState<Tab>('send');
  const runner = useTxRunner();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Pay</Label>
        <h1 className="t-h2 mt-2">Move dollars</h1>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          Send MUSD to a handle or an address. The recipient needs no Bitcoin.
        </p>
      </div>

      <GaslessBanner />

      <Segmented options={TABS} value={tab} onChange={setTab} label="Payment type" />

      {tab === 'send' ? <SendPanel runner={runner} /> : null}
      {tab === 'request' ? <RequestPanel runner={runner} /> : null}
      {tab === 'link' ? <LinkPanel runner={runner} /> : null}

      <TxSheet runner={runner} />
    </div>
  );
}

/**
 * The gasless claim, made specific enough to check.
 *
 * "No gas" without a number is marketing. The relayer's policy is 25 sponsored actions
 * per address per month, then a fee taken in MUSD inside the same transaction — so both
 * halves are stated, and the fee is shown before signing rather than discovered after.
 */
function GaslessBanner() {
  const { data: sponsorship } = useSponsorship();

  return (
    <div className="border-success/25 bg-surface-inset rounded-[var(--radius-card)] border p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-success max-w-[68ch] text-sm">
          No gas — Maren pays the Bitcoin network fee.
        </p>
        {sponsorship ? (
          <div className="text-right">
            <Num size="lg">
              {sponsorship.freeActionsRemaining}/{sponsorship.freeActionsPerMonth}
            </Num>
            <p className="text-text-subtle mt-1 text-xs">free actions left this month</p>
          </div>
        ) : null}
      </div>
      {sponsorship ? (
        <p className="text-text-subtle mt-3 text-xs leading-relaxed">
          {/* `formatMusd` already carries the unit — BRAND.md §8. Saying "in MUSD"
              after it produced "0.02 MUSD in MUSD". */}
          After that, {formatMusd(sponsorship.feeAfterFreeTierWei)} inside the same transaction,
          shown before you sign.
        </p>
      ) : null}
    </div>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function SendPanel({ runner }: { runner: ReturnType<typeof useTxRunner> }) {
  const { data: balances } = useBalances();
  const [to, setTo] = useState('@nadia');
  const [amount, setAmount] = useState('240');
  const [memo, setMemo] = useState('');

  const trimmed = to.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: resolved, isFetching } = useResolvedHandle(trimmed);

  const amountWei = parseUnitsSafe(amount);
  const balance = balances?.musdWei ?? 0n;
  const overBalance = amountWei > balance;
  const recipient = isAddress ? trimmed : (resolved?.address ?? null);
  const memoBytes = utf8Length(memo);
  const canSend = recipient !== null && amountWei > 0n && !overBalance && memoBytes <= 80;

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
      ...(memo
        ? [
            {
              label: 'Memo',
              value: <span className="text-text-muted">{memo}</span>,
            },
          ]
        : []),
    ],
    gas: {
      sponsored: true,
      note: 'No gas. Maren pays the Bitcoin network fee for this transaction. The memo is written on-chain as an event and is publicly readable.',
    },
    confirmLabel: 'Send',
    simulate: () => mutate.send(amountWei, resolved?.handle ?? shortAddress(recipient ?? ''), memo),
  });

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Send</CardTitle>

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
              <Num size="sm" tone="default">
                {resolved.address}
              </Num>
            </span>
          ) : isHandle ? (
            <span className="text-danger">No such handle on this network.</span>
          ) : isAddress ? (
            <span className="text-text-muted">Valid address, no handle registered.</span>
          ) : trimmed.length > 0 ? (
            <span className="text-text-subtle">Enter an @handle or a 0x address.</span>
          ) : null}
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

      <div className="mt-8">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!canSend}
          icon={<ArrowUpRight className="size-4" />}
        >
          {amountWei > 0n ? `Send ${formatMusd(amountWei)}` : 'Send'}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function RequestPanel({ runner }: { runner: ReturnType<typeof useTxRunner> }) {
  const { data: requests } = useRequests();
  const [amount, setAmount] = useState('65');
  const [from, setFrom] = useState('@okonkwo');
  const [memo, setMemo] = useState('');

  const amountWei = parseUnitsSafe(amount);
  const trimmed = from.trim();
  const isHandle = trimmed.startsWith('@') && trimmed.length > 1;
  const { data: resolved } = useResolvedHandle(trimmed);

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
    gas: {
      sponsored: true,
      note: 'No gas. A request creates no obligation and moves no funds — it is an ask the other side fulfils in one action.',
    },
    confirmLabel: 'Create request',
    simulate: () => mutate.createRequest(amountWei, resolved?.handle ?? null, memo),
  });

  return (
    <>
      <AppCard className="p-6 md:p-8">
        <CardTitle>Request payment</CardTitle>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          An ask, not an obligation. Nothing moves until the other side pays it.
        </p>

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
                <Num size="sm">{resolved.address}</Num>
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
          <ActionButton
            onClick={() => runner.request(intent())}
            disabled={amountWei === 0n}
            icon={<ArrowUpRight className="size-4" />}
          >
            Request {amountWei > 0n ? formatMusd(amountWei) : ''}
          </ActionButton>
        </div>
      </AppCard>

      <AppCard>
        <CardTitle>Open requests</CardTitle>
        <div className="mt-2">
          {(requests ?? []).map((request, index, list) => (
            <StatRow
              key={request.id}
              label={
                request.direction === 'outgoing'
                  ? `You asked ${request.payerHandle ?? 'anyone'}`
                  : `${request.payerHandle ?? 'Someone'} asked you`
              }
              hint={`${request.memo || 'No memo'} · ${timeAgo(request.createdAt)} · ${
                request.status === 'open'
                  ? 'Open'
                  : request.status === 'fulfilled'
                    ? 'Fulfilled'
                    : 'Cancelled'
              }`}
              value={<Musd wei={request.amountWei} />}
              last={index === list.length - 1}
            />
          ))}
          {requests && requests.length === 0 ? (
            <p className="text-text-subtle py-3 text-sm">No open requests.</p>
          ) : null}
        </div>
      </AppCard>
    </>
  );
}

/**
 * Payment links.
 *
 * The construction matters and the interface should not hide it: the link carries a
 * one-time PRIVATE KEY, and the claimer signs their own address with it. A copied
 * signature is therefore only valid for the recipient it already names, which is what
 * stops a link from being front-run in the mempool. The secret never touches the chain.
 *
 * This is also the sharpest demonstration of the gasless architecture — the person
 * claiming needs no prior relationship with Maren and no Bitcoin.
 */
function LinkPanel({ runner }: { runner: ReturnType<typeof useTxRunner> }) {
  const { data: links } = useLinks();
  const { data: balances } = useBalances();
  const [amount, setAmount] = useState('50');
  const [days, setDays] = useState('7');
  const [memo, setMemo] = useState('');
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const amountWei = parseUnitsSafe(amount);
  const expiryDays = Number.parseInt(days, 10) || 0;
  const balance = balances?.musdWei ?? 0n;
  const overBalance = amountWei > balance;

  const intent = (): TxIntent => {
    // A real one-time keypair, generated in the browser. Only the public address is ever
    // sent to the contract; the private key lives in the URL fragment, which browsers do
    // not transmit to servers.
    const secret = generatePrivateKey();
    const linkKey = privateKeyToAccount(secret).address;

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
      gas: {
        sponsored: true,
        note: 'No gas for you, and none for whoever claims it. The claim secret travels in the link’s fragment and is never sent to a server or written on-chain.',
      },
      caution:
        'Anyone holding the full link can claim it. Send it the way you would send cash, and reclaim it if it goes astray.',
      confirmLabel: 'Create link',
      simulate: () => {
        mutate.createLink(amountWei, expiryDays, memo, secret, linkKey);
        setCreated({ url: `https://maren.finance/claim/${Date.now() % 100000}#${secret}` });
      },
    };
  };

  return (
    <>
      <AppCard className="p-6 md:p-8">
        <CardTitle>Payment link</CardTitle>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          Escrows MUSD against a one-time key. Anyone can claim it — no wallet history, no Bitcoin.
        </p>

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
            <p className="text-text-subtle mt-3 text-xs">
              Only you can reclaim it after that.
            </p>
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

        <div className="mt-8">
          <ActionButton
            onClick={() => runner.request(intent())}
            disabled={amountWei === 0n || overBalance || expiryDays <= 0}
            icon={<LinkIcon className="size-4" />}
          >
            Create link
          </ActionButton>
        </div>

        {created ? (
          <div className="mt-6">
            <Note tone="warning">
              <p className="text-text">Copy this now — it is shown once.</p>
              <p className="num text-text-muted mt-2 break-all text-xs">{created.url}</p>
              <div className="mt-4">
                <ActionButton
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(created.url);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </ActionButton>
              </div>
            </Note>
          </div>
        ) : null}
      </AppCard>

      <AppCard>
        <CardTitle>Your links</CardTitle>
        <div className="mt-2">
          {(links ?? []).map((link, index, list) => (
            <StatRow
              key={link.id}
              label={link.memo || `Link ${link.id}`}
              hint={`${
                link.status === 'unclaimed'
                  ? `Unclaimed · expires ${timeUntil(link.expiry)}`
                  : link.status === 'claimed'
                    ? 'Claimed'
                    : 'Reclaimed'
              } · locked to ${shortAddress(link.linkKey)}`}
              value={<Musd wei={link.amountWei} />}
              last={index === list.length - 1}
            />
          ))}
          {links && links.length === 0 ? (
            <p className="text-text-subtle py-3 text-sm">No links yet.</p>
          ) : (
            <p className="text-text-subtle pt-4 text-xs leading-relaxed">
              Secrets are never stored, so a link can only be shown once. Reclaim it if it goes
              astray.
            </p>
          )}
        </div>
      </AppCard>
    </>
  );
}
