'use client';

import { useEffect, useState } from 'react';

import { Panel } from '@/components/app/primitives';
import { QrCode } from '@/components/app/qr-code';
import { PillAction } from '@/components/ui/pill-button';
import { Check, CopyIcon } from '@/components/ui/icons';
import { useDataSource, usePrimaryHandle } from '@/lib/data/source';

/**
 * Receive — a QR and the two ways to be paid, both read from the chain, neither invented.
 *
 * The QR encodes the connected account's own address: any wallet that scans an address can
 * prefill a payment to it, so this is the most portable honest target there is. The @handle
 * shown above it comes from MarenRegistry's reverse resolution — it is present only if this
 * account has actually registered one, and its absence is stated rather than papered over
 * with a placeholder.
 */
export function ReceivePanel() {
  const { account } = useDataSource();
  const { data: handle, isPending } = usePrimaryHandle();

  if (!account) return null;

  return (
    <Panel
      title="Receive"
      meta={
        <span className="text-text-muted text-xs">Scan or share to be paid in MUSD.</span>
      }
    >
      <div className="flex flex-col items-center gap-6 px-5 py-6">
        {/* Image outline per the interface rules: a 1px hairline offset by -1px. */}
        <div className="rounded-[var(--radius-card)] bg-white p-3 shadow-[0_0_0_1px_rgba(20,18,35,0.08)]">
          <QrCode
            value={account}
            title={
              handle ? `Payment QR for ${handle} (${account})` : `Payment QR for ${account}`
            }
            className="size-44 sm:size-52"
          />
        </div>

        <div className="w-full max-w-sm text-center">
          {handle ? (
            <p className="num text-text text-lg">{handle}</p>
          ) : isPending ? (
            <p className="text-text-subtle text-sm">Checking for a registered handle…</p>
          ) : (
            <p className="text-text-muted text-sm">
              No handle registered yet, but you can still be paid at the address below.
            </p>
          )}
          <p className="num text-text-subtle mt-2 break-all text-xs">{account}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {handle ? <CopyButton label="Copy handle" value={handle} /> : null}
          <CopyButton label="Copy address" value={account} primary />
          <ShareButton account={account} handle={handle ?? null} />
        </div>

        <p className="text-text-subtle max-w-sm text-center text-xs leading-relaxed">
          This is your address on Mezo. Anyone can send MUSD to it, on-chain, without an
          account here.
        </p>
      </div>
    </Panel>
  );
}

function CopyButton({
  label,
  value,
  primary = false,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_800);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <PillAction
      variant={primary ? 'primary' : 'secondary'}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
      icon={
        <span className="relative grid size-4 place-items-center">
          <CopyIcon
            aria-hidden
            className={`absolute transition-[opacity,transform,filter] duration-150 ease-out ${
              copied ? 'scale-50 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0'
            }`}
          />
          <Check
            aria-hidden
            className={`absolute transition-[opacity,transform,filter] duration-150 ease-out ${
              copied ? 'scale-100 opacity-100 blur-0' : 'scale-50 opacity-0 blur-[2px]'
            }`}
          />
        </span>
      }
    >
      {copied ? 'Copied' : label}
    </PillAction>
  );
}

/**
 * Share, when the platform offers it. Web Share is not everywhere, so this only renders when
 * `navigator.share` exists rather than showing a control that would do nothing.
 */
function ShareButton({ account, handle }: { account: string; handle: string | null }) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  if (!canShare) return null;

  return (
    <PillAction
      variant="secondary"
      onClick={() => {
        void navigator
          .share({
            title: 'Pay me on Maren',
            text: handle
              ? `Pay me on Maren: ${handle} (${account})`
              : `Pay me on Maren at ${account}`,
          })
          .catch(() => {
            /* the user dismissed the share sheet */
          });
      }}
    >
      Share
    </PillAction>
  );
}
