'use client';

import { getChain, shortAddress } from '@maren/sdk';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { HandleRegistrationCard } from '@/components/app/handle-registration';
import {
  Label,
  Panel,
  PanelBody,
  Refreshing,
  Skeleton,
  StatRow,
} from '@/components/app/primitives';
import { ConnectButton } from '@/components/app/wallet';
import { ProfileIcon } from '@/components/ui/icons';
import { NETWORK, useDataSource, usePrimaryHandle } from '@/lib/data/source';

/**
 * Profile — your handle, your account, and where you sign out.
 *
 * Talise puts identity and settings behind one destination; Maren's identity is the
 * on-chain `@handle` (previously buried as a tab inside Pay) plus the connected
 * address. Both live here now. The handle claim is the existing commit-reveal flow
 * verbatim; the account panel is a read of the wallet already connected to the shell.
 */
export default function ProfilePage() {
  const source = useDataSource();
  const handleQ = usePrimaryHandle();
  const handle = handleQ.data;
  const chain = getChain(NETWORK);

  if (!source.connected) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <ConnectPrompt
          icon={<ProfileIcon className="size-6" />}
          title="Connect to set up your profile"
        >
          Claim an <span className="num">@handle</span> so people can pay you by name instead of a
          40-character address. Everything here is tied to the wallet you connect.
        </ConnectPrompt>
      </div>
    );
  }

  const account = source.account ?? '';

  // The address and network are known the moment a wallet is connected; only the handle is
  // a chain read. So the panel renders at once and just the handle row wears a skeleton
  // until the registry answers — nothing shifts, and no value is invented in the meantime.
  const handleLoading = source.ready && handleQ.isLoading;
  const refreshing = source.ready && !handleLoading && handleQ.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <Header refreshing={refreshing} />

      <HandleRegistrationCard />

      <Panel title="Account">
        <PanelBody>
          <StatRow
            label="Handle"
            value={
              handleLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                (handle ?? <span className="text-text-subtle text-sm">none yet</span>)
              )
            }
          />
          <StatRow
            label="Address"
            value={
              account ? (
                <a
                  href={`${chain.blockExplorers.default.url}/address/${account}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="num text-text text-sm transition-colors duration-[120ms] ease-out hover:text-violet-500"
                >
                  {shortAddress(account, 10, 8)}
                </a>
              ) : (
                <span className="text-text-subtle text-sm">—</span>
              )
            }
          />
          <StatRow
            label="Network"
            value={<span className="text-text text-sm">{chain.name}</span>}
            last
          />
        </PanelBody>

        <div className="border-t border-[var(--border-hairline)] px-5 py-4">
          <ConnectButton />
        </div>
      </Panel>
    </div>
  );
}

function Header({ refreshing = false }: { refreshing?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label>Profile</Label>
        <h1 className="t-h3 mt-1.5">You on Maren</h1>
      </div>
      {refreshing ? <Refreshing /> : null}
    </div>
  );
}
