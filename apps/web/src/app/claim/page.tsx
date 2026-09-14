'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { parseAbiItem, type Address, type Hex } from 'viem';
import { formatMusd, getDeploymentBlock, getMarenAddresses, MEZO_MAX_LOG_RANGE } from '@maren/sdk';

import { parseClaimLink, claimRecordMatches, type ParsedClaimLink } from '@/lib/chain/claim-link';
import { marenPayAbi } from '@/lib/chain/abis';
import { actionIsRelayable } from '@/lib/chain/relay';
import { gasLine, gasNote, useMarenWrites, useRelayerStatus } from '@/lib/chain/write';
import { NETWORK, contractsDeployed, useDataSource } from '@/lib/data/source';
import { Musd } from '@/components/app/money';
import { ActionButton, Loading, Note, Panel, Refreshing } from '@/components/app/primitives';
import { SignIn } from '@/components/app/sign-in';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { Check, LinkIcon } from '@/components/ui/icons';
import { TESTFLIGHT_URL } from '@/lib/links';

/**
 * /claim — the receiving half of a payment link.
 *
 * A link is `${origin}/claim?id=N#<secret>` (legacy links omit the ID), where the fragment is a one-time PRIVATE KEY. The
 * fragment is read CLIENT-SIDE ONLY: a URL fragment is never sent to a server in the first
 * place, and nothing here logs, stores or transmits it. It lives in component state for the
 * life of the tab and is used only to sign a claim that binds the payout to the connected
 * wallet.
 *
 * WHAT THIS SCREEN READS. IDs in the URL are verified against the escrow key. Legacy IDs resolve from
 * the chain: the secret fixes the link's public key, and `LinkCreated` carries that key as
 * an indexed topic, so exactly one event names it. From that id the current escrow state is
 * read from `MarenPay.links(id)`. Every state a link can be in — claimable, already claimed,
 * reclaimed by its creator, or expired — is read from the contract and stated plainly; an
 * invalid or unknown link fails closed rather than reaching for a guess.
 *
 * WHO PAYS. `claimLink` is on the relay hub's allowlist, so a claim is sponsorable the day a
 * relayer is live. Until one is configured this self-submits from the claimer's own wallet
 * and the copy says so, exactly like every other relayed action in the app — the routing
 * decision is the shared one in `lib/chain/relay.ts`, never made here.
 */

/**
 * The `LinkCreated` event, for filtering `getLogs` by the link's indexed public key. Written
 * out so its indexed `linkKey` types the `args` filter; it is the same shape as the entry in
 * `marenPayAbi`, and the SDK's `abis.test.ts` is the guard that the two never drift.
 */
const LINK_CREATED = parseAbiItem(
  'event LinkCreated(uint256 indexed linkId, address indexed creator, address indexed linkKey, uint256 amount, uint64 expiry)',
);

type ClaimState = 'claimable' | 'claimed' | 'reclaimed' | 'expired';

interface ResolvedLink {
  linkId: bigint;
  amountWei: bigint;
  expiryUnix: bigint;
  state: ClaimState;
}

/** What the resolver found: the link, or a plain reason it could not be shown. */
type LinkLookup =
  { kind: 'found'; link: ResolvedLink } | { kind: 'not-found' } | { kind: 'undeployed' };

/**
 * Resolve a link from its secret, keyed under `['maren', …]` so the confirmed-write
 * invalidation in the transaction runner refetches it — a successful claim flips the card
 * to "claimed" on its own, without a reload.
 */
function useClaimableLink(linkKey: Address, hintedId: bigint | null) {
  const client = usePublicClient();
  const deployed = contractsDeployed(NETWORK);
  const resolvedId = useRef<bigint | null>(hintedId);

  return useQuery<LinkLookup>({
    queryKey: ['maren', NETWORK, 'claim-link', linkKey, hintedId?.toString() ?? 'legacy'],
    enabled: Boolean(client) && Boolean(linkKey) && deployed,
    queryFn: async ({ signal }) => {
      if (!client || !linkKey) throw new Error('No RPC transport for Mezo is available.');
      const deployedAt = getDeploymentBlock(NETWORK);
      if (deployedAt === null) return { kind: 'undeployed' };

      const maren = getMarenAddresses(NETWORK);
      const head = await client.getBlockNumber();

      // The public key sits at an indexed topic, so the node filters server-side; the scan
      // only exists to keep each request under Mezo's 10,000-block getLogs ceiling.
      let foundId: bigint | null = resolvedId.current;
      for (let to = head; to >= deployedAt && foundId === null; to -= MEZO_MAX_LOG_RANGE) {
        signal.throwIfAborted();
        const from = to - MEZO_MAX_LOG_RANGE + 1n;
        const logs = await client.getLogs({
          address: maren.marenPay,
          event: LINK_CREATED,
          args: { linkKey },
          fromBlock: from < deployedAt ? deployedAt : from,
          toBlock: to,
        });
        const hit = logs.find((log) => log.args.linkId !== undefined);
        if (hit && hit.args.linkId !== undefined) foundId = hit.args.linkId;
      }

      if (foundId === null) return { kind: 'not-found' };

      // The event's amount is what was escrowed; the live `links` record is the source of
      // truth for whether it is still there. Read both — the record's amount is the one shown.
      const record = (await client.readContract({
        address: maren.marenPay,
        abi: marenPayAbi,
        functionName: 'links',
        args: [foundId],
      })) as readonly [Address, Address, bigint, bigint, boolean, boolean];

      const [creator, recordKey, amountWei, expiryUnix, claimed, reclaimed] = record;
      // A zero creator means the record was never written — the event named a link this
      // deployment does not hold, which is not something this screen can honour.
      if (!claimRecordMatches(creator, recordKey, linkKey)) return { kind: 'not-found' };
      resolvedId.current = foundId;

      const latest = await client.getBlock();
      const expired = latest.timestamp > expiryUnix;
      const state: ClaimState = claimed
        ? 'claimed'
        : reclaimed
          ? 'reclaimed'
          : expired
            ? 'expired'
            : 'claimable';

      return { kind: 'found', link: { linkId: foundId, amountWei, expiryUnix, state } };
    },
    // A recipient can leave the page open across expiry or another recipient's claim.
    // Poll only active links; reuse their verified ID instead of rescanning history.
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.kind === 'found' && query.state.data.link.state === 'claimable'
        ? 30_000
        : false,
    retry: 1,
  });
}

export default function ClaimPage() {
  const [parsed, setParsed] = useState<ParsedClaimLink | null>(null);

  useEffect(() => {
    const readLink = () => setParsed(parseClaimLink(window.location.hash, window.location.search));
    readLink();
    window.addEventListener('hashchange', readLink);
    window.addEventListener('popstate', readLink);
    return () => {
      window.removeEventListener('hashchange', readLink);
      window.removeEventListener('popstate', readLink);
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-5">
      <header className="flex items-center justify-between pb-2 pt-5">
        <Link
          href="/"
          aria-label="Maren Finance home"
          className="-m-2 inline-flex w-fit rounded-[var(--radius-pill)] p-2"
        >
          <span
            className="text-[22px] leading-none tracking-[-0.02em] text-[color:var(--color-text)]"
            style={{
              fontFamily: 'var(--font-sf-rounded), ui-rounded, system-ui, sans-serif',
              fontWeight: 600,
            }}
          >
            Maren
          </span>
        </Link>
        <ConnectButton />
      </header>

      <main id="main" className="flex-1 pb-16 pt-6">
        <div className="mb-6">
          <span className="t-label text-text-subtle">Payment link</span>
          <h1 className="t-h2 mt-1.5">Claim your MUSD</h1>
          <p className="text-text-muted mt-2 text-sm">
            Mezo {NETWORK} · Pre-audit · Testnet funds only
          </p>
        </div>

        <NetworkGuard />

        <div className="mt-4">
          {parsed === null ? (
            <Loading>Opening your link</Loading>
          ) : parsed.kind === 'invalid' ? (
            <InvalidLink />
          ) : parsed.kind === 'missing' ? (
            <NoLink />
          ) : (
            <ClaimFlow
              key={`${parsed.linkKey}:${parsed.linkId}`}
              secret={parsed.secret}
              linkKey={parsed.linkKey}
              hintedId={parsed.linkId}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ClaimFlow({
  secret,
  linkKey,
  hintedId,
}: {
  secret: Hex;
  linkKey: Address;
  hintedId: bigint | null;
}) {
  const source = useDataSource();
  const runner = useTxRunner();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
  const lookup = useClaimableLink(linkKey, hintedId);

  if (!source.deployed) {
    return (
      <Panel title="Claimable link">
        <div className="px-5 py-6">
          <Note>Maren is not deployed on Mezo {source.network}, so there is no link to read.</Note>
        </div>
      </Panel>
    );
  }

  if (lookup.isPending) {
    return (
      <Panel title="Claimable link">
        <div className="px-5">
          <Loading>Reading this link from Mezo</Loading>
        </div>
      </Panel>
    );
  }

  if (lookup.isError) {
    return (
      <Panel title="Claimable link">
        <div className="px-5 py-6">
          <Note tone="warning" role="alert">
            Mezo did not answer when this link was read, so its state is unknown right now. Nothing
            has been claimed. Try reading the link again.
          </Note>
          <div className="mt-4">
            <ActionButton onClick={() => void lookup.refetch()} disabled={lookup.isFetching}>
              {lookup.isFetching ? 'Reading link…' : 'Try again'}
            </ActionButton>
          </div>
        </div>
      </Panel>
    );
  }

  const result = lookup.data;
  if (result.kind === 'undeployed') {
    return (
      <Panel title="Claimable link">
        <div className="px-5 py-6">
          <Note>Maren is not deployed on Mezo {source.network}, so there is no link to read.</Note>
        </div>
      </Panel>
    );
  }
  if (result.kind === 'not-found') {
    return <InvalidLink />;
  }

  const link = result.link;
  const refreshing = lookup.isFetching;

  // The confirmed-claim path resets the sheet to idle; the link query has been invalidated by
  // then, so `state` re-reads as "claimed" on its own. Nothing to reset here.
  const claimIntent = (): TxIntent => ({
    title: `Claim ${formatMusd(link.amountWei)}`,
    successTitle: `Claimed ${formatMusd(link.amountWei)}`,
    changes: [
      {
        label: 'Into your wallet',
        before: <Musd wei={0n} />,
        after: <Musd wei={link.amountWei} />,
      },
    ],
    details: [
      { label: 'Amount', value: <Musd wei={link.amountWei} /> },
      {
        label: 'Link',
        value: <span className="num text-text-muted">#{link.linkId.toString()}</span>,
      },
      {
        label: 'Claimed to',
        value: <span className="num text-text-subtle break-all text-xs">{source.account}</span>,
      },
    ],
    gas: gasNote(
      actionIsRelayable('claimLink'),
      'The claim signs your own address, so the funds can only reach the wallet you claim from.',
      relayer,
    ),
    confirmLabel: `Claim ${formatMusd(link.amountWei)}`,
    submit: writes.ready ? () => writes.claimLink(link.linkId, secret) : undefined,
  });

  return (
    <>
      <Panel
        title="Claimable link"
        meta={
          <span className="flex items-center gap-3">
            {refreshing ? <Refreshing /> : null}
            <span className="text-text-muted num text-xs">#{link.linkId.toString()}</span>
          </span>
        }
      >
        <div className="px-5 py-5">
          <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border-hairline)] pb-4">
            <span className="t-label text-text-subtle">Amount</span>
            <Musd wei={link.amountWei} size="lg" />
          </div>

          {link.state === 'claimable' ? (
            <>
              {link.linkId > 0n && link.linkId <= 18_446_744_073_709_551_615n ? (
                <div className="mt-5 border-b border-[var(--border-hairline)] pb-5">
                  <a
                    href={`maren://claim?id=${link.linkId}#${secret}`}
                    className="bg-text text-bg inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-5 text-sm font-medium"
                  >
                    Open in Maren on iPhone
                  </a>
                  <p className="text-text-muted mt-3 text-xs leading-relaxed">
                    Requires the latest iOS beta. Opens a review before you sign.{' '}
                    <a
                      href={TESTFLIGHT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Get the beta
                    </a>{' '}
                    or claim with a wallet below.
                  </p>
                </div>
              ) : null}
              <Claimable
                account={source.account}
                ready={writes.ready}
                relayerLine={gasLine(actionIsRelayable('claimLink'), relayer)}
                onClaim={() => runner.request(claimIntent())}
              />
            </>
          ) : (
            <SettledLink state={link.state} expiryUnix={link.expiryUnix} />
          )}
        </div>
      </Panel>

      <TxSheet runner={runner} />
    </>
  );
}

function Claimable({
  account,
  ready,
  relayerLine,
  onClaim,
}: {
  account: Address | null;
  ready: boolean;
  relayerLine: string;
  onClaim: () => void;
}) {
  return (
    <div className="mt-5">
      <p className="text-text-muted text-sm leading-relaxed">
        Whoever opens this link can claim it, so treat it like cash. The claim signs your own
        address, so observers of the submitted transaction cannot redirect that claim. Anyone with
        the original link can claim first; only share it with the intended recipient.
      </p>

      {account === null ? (
        <div className="mt-6">
          <Note>
            Connect a wallet to claim this into it. The funds go to the address you connect.
          </Note>
          <div className="mt-4">
            <SignIn />
          </div>
        </div>
      ) : (
        <>
          <p className="text-text-subtle mt-6 text-xs leading-relaxed">{relayerLine}</p>
          <div className="mt-4">
            <ActionButton onClick={onClaim} disabled={!ready} icon={<Check className="size-4" />}>
              Claim into my wallet
            </ActionButton>
          </div>
        </>
      )}
    </div>
  );
}

function SettledLink({ state, expiryUnix }: { state: ClaimState; expiryUnix: bigint }) {
  const expiryText = new Date(Number(expiryUnix) * 1000).toLocaleString();

  if (state === 'claimed') {
    return (
      <div className="mt-5">
        <Note>
          This link has already been claimed. Its MUSD has been paid out and it cannot be claimed
          again.
        </Note>
      </div>
    );
  }
  if (state === 'reclaimed') {
    return (
      <div className="mt-5">
        <Note>
          The creator has already reclaimed this link, so the escrow has been returned to them and
          there is nothing left to claim.
        </Note>
      </div>
    );
  }
  // expired
  return (
    <div className="mt-5">
      <Note tone="warning">
        This link expired on <span className="num">{expiryText}</span> before it was claimed. Only
        its creator can reclaim it now, back into their own wallet.
      </Note>
    </div>
  );
}

function NoLink() {
  return (
    <Panel title="Claimable link">
      <div className="px-5 py-6">
        <Note>
          Open the complete payment link sent to you to see its amount and claim it. This address
          has no claim key. Ask the sender to share the original link again.
        </Note>
      </div>
    </Panel>
  );
}

function InvalidLink() {
  return (
    <Panel
      title="Claimable link"
      meta={
        <span className="bg-surface-inset text-text-muted grid size-8 place-items-center rounded-[var(--radius-pill)]">
          <LinkIcon className="size-4" />
        </span>
      }
    >
      <div className="px-5 py-6">
        <Note tone="warning" role="alert">
          This is not a link Maren can claim. Its claim key is missing, malformed, or names a link
          this deployment does not hold. Nothing has been submitted. Check you copied the whole
          link, including everything after the <span className="num">#</span>.
        </Note>
      </div>
    </Panel>
  );
}
