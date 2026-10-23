'use client';

import { getChain, shortAddress } from '@maren/sdk';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { Fact, FactGroup } from '@/components/app/facts';
import { HandleRegistrationCard } from '@/components/app/handle-registration';
import { PageHeader, Refreshing, Skeleton } from '@/components/app/primitives';
import { ConnectButton } from '@/components/app/wallet';
import { ArrowUpRight, ProfileIcon } from '@/components/ui/icons';
import { NETWORK, useDataSource, usePrimaryHandle } from '@/lib/data/source';

/**
 * Profile: your handle, your account, and where you sign out.
 *
 * Talise puts identity and settings behind one destination; Maren's identity is the
 * on-chain `@handle` (previously buried as a tab inside Pay) plus the connected
 * address. Both live here now. The handle claim is the existing commit-reveal flow
 * verbatim; the account card is a read of the wallet already connected to the shell.
 */
export default function ProfilePage() {
  const source = useDataSource();
  const handleQ = usePrimaryHandle();
  const handle = handleQ.data;
  const chain = getChain(NETWORK);

  if (!source.connected) {
    return (
      <>
        <PageHeader title="Profile" />
        <ConnectPrompt
          icon={<ProfileIcon className="size-5" />}
          title="Connect to set up your profile"
        >
          Claim an <span className="num">@handle</span> so people can pay you by name instead of a
          40-character address. Everything here is tied to the wallet you connect.
        </ConnectPrompt>
      </>
    );
  }

  const account = source.account ?? '';

  // The address and network are known the moment a wallet is connected; only the handle is
  // a chain read. So the card renders at once and just the handle wears a skeleton until
  // the registry answers: nothing shifts, and no value is invented in the meantime.
  const handleLoading = source.ready && handleQ.isLoading;
  const refreshing = source.ready && !handleLoading && handleQ.isFetching;

  return (
    <>
      <PageHeader title="Profile" actions={refreshing ? <Refreshing /> : null} />

      <section aria-labelledby="identity-heading" className="card">
        <div className="flex items-center gap-4 p-5">
          {/* An avatar is the one round thing on a card. Decorative: the name beside it
              says who this is. */}
          <span
            aria-hidden
            className="bg-surface-inset text-text-muted grid size-12 shrink-0 place-items-center rounded-full text-lg"
          >
            {handle ? (
              handle.replace(/^@/, '').charAt(0).toUpperCase()
            ) : (
              <ProfileIcon className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <h2 id="identity-heading" className="t-h3 truncate">
              {handleLoading ? (
                <>
                  <Skeleton className="h-5 w-32" />
                  <span className="sr-only">Reading your handle</span>
                </>
              ) : (
                (handle ?? <span className="text-text-muted">No handle yet</span>)
              )}
            </h2>
            {handleLoading ? null : (
              <p className="text-text-muted mt-0.5 text-pretty text-sm">
                {handle
                  ? 'People can pay you by this name.'
                  : 'Claim one below so people can pay you by name.'}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup layout="rows">
            <Fact
              label="Address"
              value={
                account ? (
                  <a
                    href={`${chain.blockExplorers.default.url}/address/${account}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mono inline-flex items-center gap-1 text-sm text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600"
                  >
                    {shortAddress(account, 10, 8)}
                    <ArrowUpRight aria-hidden className="size-3.5" />
                    <span className="sr-only">, open on {chain.blockExplorers.default.name}</span>
                  </a>
                ) : (
                  <span className="text-text-muted text-sm">—</span>
                )
              }
            />
            <Fact label="Network" value={<span className="text-text text-sm">{chain.name}</span>} />
          </FactGroup>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] px-5 py-3">
          <p className="text-text-muted text-sm">Connected wallet</p>
          <ConnectButton />
        </div>
      </section>

      <div className="mt-10">
        <HandleRegistrationCard />
      </div>
    </>
  );
}
