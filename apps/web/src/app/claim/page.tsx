'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { parseAbiItem, type Address, type Hex } from 'viem';
import {
  formatMusd,
  getChain,
  getDeploymentBlock,
  getMarenAddresses,
  MEZO_MAX_LOG_RANGE,
} from '@maren/sdk';

import { parseClaimLink, claimRecordMatches, type ParsedClaimLink } from '@/lib/chain/claim-link';
import { marenPayAbi } from '@/lib/chain/abis';
import { actionIsRelayable } from '@/lib/chain/relay';
import { gasLine, gasNote, useMarenWrites, useRelayerStatus } from '@/lib/chain/write';
import { NETWORK, contractsDeployed, useDataSource } from '@/lib/data/source';
import { Musd } from '@/components/app/money';
import { ActionButton, Loading, Note, Refreshing } from '@/components/app/primitives';
import { SignIn } from '@/components/app/sign-in';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { ArrowUpRight, Check } from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';

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
  const client = usePublicClient({ chainId: getChain(NETWORK).id });
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

  // One centred column: the wordmark and the connect control above a single card, the
  // pre-audit line under it. The same arrival as an incomplete /pay link, on the canvas.
  return (
    <div className="flex min-h-screen flex-col px-5">
      <header className="mx-auto flex w-full max-w-[440px] items-center justify-between gap-4 pt-6">
        <Link href="/" aria-label="Maren Finance home" className="-m-1.5 inline-flex w-fit p-1.5">
          <Wordmark className="h-[20px] text-[19px]" />
        </Link>
        <ConnectButton />
      </header>

      <main id="main" className="mx-auto w-full max-w-[440px] flex-1 pb-16 pt-10 sm:pt-[9vh]">
        <div className="mb-4 empty:hidden">
          <NetworkGuard />
        </div>

        {parsed === null ? (
          <ClaimCard>
            <Body>
              <Loading>Opening your link</Loading>
            </Body>
          </ClaimCard>
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

        <p className="text-text-muted mt-5 text-center text-xs">
          Mezo {NETWORK} · Pre-audit · Testnet funds only
        </p>
      </main>
    </div>
  );
}

/**
 * The one card every state renders into: the bracket label, the page's single h1, and the
 * state's own body. `meta` is the right side of the label row (the link number, the
 * refetch mark) and only exists once the link has been read.
 */
function ClaimCard({ meta, children }: { meta?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="claim-title" className="card p-5 md:p-7">
      <div className="flex min-h-5 items-center justify-between gap-4">
        <span className="t-bracket">[ Payment link ]</span>
        {meta ? <span className="flex items-center gap-3">{meta}</span> : null}
      </div>
      <h1
        id="claim-title"
        className="text-text mt-4 text-balance text-[1.5rem] font-medium leading-[1.15] tracking-[-0.026em]"
      >
        Claim your MUSD
      </h1>
      {children}
    </section>
  );
}

/** The state's content, under the title. */
function Body({ children }: { children: ReactNode }) {
  return <div className="mt-6">{children}</div>;
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
      <ClaimCard>
        <Body>
          <Note>Maren is not deployed on Mezo {source.network}, so there is no link to read.</Note>
        </Body>
      </ClaimCard>
    );
  }

  if (lookup.isPending) {
    return (
      <ClaimCard>
        <Body>
          <Loading>Reading this link from Mezo</Loading>
        </Body>
      </ClaimCard>
    );
  }

  if (lookup.isError) {
    return (
      <ClaimCard>
        <Body>
          <Note tone="warning" role="alert">
            Mezo did not answer when this link was read, so its state is unknown right now. Nothing
            has been claimed. Try reading the link again.
          </Note>
          <div className="mt-5">
            <ActionButton
              onClick={() => void lookup.refetch()}
              disabled={lookup.isFetching}
              className="w-full"
            >
              {lookup.isFetching ? 'Reading link…' : 'Try again'}
            </ActionButton>
          </div>
        </Body>
      </ClaimCard>
    );
  }

  const result = lookup.data;
  if (result.kind === 'undeployed') {
    return (
      <ClaimCard>
        <Body>
          <Note>Maren is not deployed on Mezo {source.network}, so there is no link to read.</Note>
        </Body>
      </ClaimCard>
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
        value: <span className="mono text-text-muted text-xs">#{link.linkId.toString()}</span>,
      },
      {
        label: 'Claimed to',
        value: <span className="mono text-text-muted break-all text-xs">{source.account}</span>,
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

  const openInApp = link.linkId > 0n && link.linkId <= 18_446_744_073_709_551_615n;

  return (
    <>
      <ClaimCard
        meta={
          <>
            {refreshing ? <Refreshing /> : null}
            <span className="mono text-text-muted text-xs">#{link.linkId.toString()}</span>
          </>
        }
      >
        {/* The amount is the record's own, read from `MarenPay.links(id)`. */}
        <div className="mt-2">
          <span className="sr-only">Amount: </span>
          <Musd wei={link.amountWei} size="xl" />
        </div>

        {link.state === 'claimable' ? (
          <>
            <Claimable
              account={source.account}
              ready={writes.ready}
              relayerLine={gasLine(actionIsRelayable('claimLink'), relayer)}
              onClaim={() => runner.request(claimIntent())}
            />
            {openInApp ? (
              <div className="mt-6 border-t border-[var(--border-hairline)] pt-6">
                <a
                  href={`maren://claim?id=${link.linkId}#${secret}`}
                  className="bg-surface text-text hover:bg-surface-inset group inline-flex h-11 w-full items-center justify-between border border-[var(--border-strong)] px-4 text-[0.9375rem] transition-[background-color] duration-150 ease-out active:brightness-95"
                >
                  Open in Maren on iPhone
                  <ArrowUpRight
                    aria-hidden
                    className="size-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                  />
                </a>
                {/* No beta sign-up link: the public TestFlight is closed to new testers, so
                    this is only for people who already have the app. */}
                <p className="text-text-muted mt-3 text-xs leading-relaxed">
                  Requires the latest iOS beta. Opens a review before you sign. Without the app,
                  claim with a wallet above.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <SettledLink state={link.state} expiryUnix={link.expiryUnix} />
        )}
      </ClaimCard>

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
    <div className="mt-6 border-t border-[var(--border-hairline)] pt-6">
      <p className="text-text-muted text-pretty text-sm leading-relaxed">
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
        <div className="mt-6">
          <p className="text-text-muted text-[0.8125rem] leading-relaxed">{relayerLine}</p>
          <ActionButton
            onClick={onClaim}
            disabled={!ready}
            icon={<Check className="size-4" />}
            className="mt-4 w-full justify-between"
          >
            Claim into my wallet
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function SettledLink({ state, expiryUnix }: { state: ClaimState; expiryUnix: bigint }) {
  const expiryText = new Date(Number(expiryUnix) * 1000).toLocaleString();

  if (state === 'claimed') {
    return (
      <Body>
        <Note>
          This link has already been claimed. Its MUSD has been paid out and it cannot be claimed
          again.
        </Note>
      </Body>
    );
  }
  if (state === 'reclaimed') {
    return (
      <Body>
        <Note>
          The creator has already reclaimed this link, so the escrow has been returned to them and
          there is nothing left to claim.
        </Note>
      </Body>
    );
  }
  // expired
  return (
    <Body>
      <Note tone="warning">
        This link expired on <span className="num">{expiryText}</span> before it was claimed. Only
        its creator can reclaim it now, back into their own wallet.
      </Note>
    </Body>
  );
}

function NoLink() {
  return (
    <ClaimCard>
      <Body>
        <Note>
          Open the complete payment link sent to you to see its amount and claim it. This address
          has no claim key. Ask the sender to share the original link again.
        </Note>
      </Body>
    </ClaimCard>
  );
}

function InvalidLink() {
  return (
    <ClaimCard>
      <Body>
        <Note tone="warning" role="alert">
          This is not a link Maren can claim. Its claim key is missing, malformed, or names a link
          this deployment does not hold. Nothing has been submitted. Check you copied the whole
          link, including everything after the <span className="mono">#</span>.
        </Note>
      </Body>
    </ClaimCard>
  );
}
