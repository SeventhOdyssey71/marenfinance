'use client';

import { getChain, shortAddress } from '@maren/sdk';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { HandleRegistrationCard } from '@/components/app/handle-registration';
import { Label, Panel, PanelBody, StatRow } from '@/components/app/primitives';
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
  const { data: handle } = usePrimaryHandle();
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

  return (
    <div className="flex flex-col gap-4">
      <Header />

      <HandleRegistrationCard />

      <Panel title="Account">
        <PanelBody>
          <StatRow
            label="Handle"
            value={handle ?? <span className="text-text-subtle text-sm">none yet</span>}
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

function Header() {
  return (
    <div>
      <Label>Profile</Label>
      <h1 className="t-h3 mt-1.5">You on Maren</h1>
    </div>
  );
}
