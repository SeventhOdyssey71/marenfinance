'use client';

import { useEffect, useState } from 'react';

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
    <section aria-labelledby="receive-heading" className="card p-5 md:p-6">
      <h2 id="receive-heading" className="t-h3">
        Receive
      </h2>
      <p className="text-text-muted mt-1.5 max-w-[52ch] text-pretty text-sm leading-relaxed">
        Scan or share to be paid in MUSD.
      </p>

      <div className="mt-6 flex flex-col items-center gap-6">
        {/* The QR keeps a white field and its own quiet zone whatever the page does; a
            hairline square frames it, the same edge as every other object here. */}
        <div className="bg-white p-3 outline outline-1 -outline-offset-1 outline-[var(--border-hairline)]">
          <QrCode
            value={account}
            title={handle ? `Payment QR for ${handle} (${account})` : `Payment QR for ${account}`}
            className="size-44 sm:size-52"
          />
        </div>

        <div className="w-full max-w-sm text-center">
          {handle ? (
            <p className="text-text text-xl tracking-[-0.016em]">{handle}</p>
          ) : isPending ? (
            <p className="text-text-muted text-sm">Checking for a registered handle…</p>
          ) : (
            <p className="text-text-muted text-pretty text-sm">
              No handle registered yet, but you can still be paid at the address below.
            </p>
          )}
          <p className="mono text-text-muted mt-2 break-all text-xs leading-relaxed">{account}</p>
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          <CopyButton label="Copy address" value={account} primary />
          {handle ? <CopyButton label="Copy handle" value={handle} /> : null}
          <ShareButton account={account} handle={handle ?? null} />
        </div>
      </div>

      <p className="text-text-muted mt-6 text-pretty border-t border-[var(--border-hairline)] pt-4 text-center text-xs leading-relaxed">
        This is your address on Mezo. Anyone can send MUSD to it, on-chain, without an account here.
      </p>
    </section>
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
