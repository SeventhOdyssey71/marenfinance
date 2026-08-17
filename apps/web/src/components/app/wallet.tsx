'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { getChain, shortAddress } from '@maren/sdk';

import { NETWORK } from '@/lib/data/source';
import { ActionButton, Note } from './primitives';

/**
 * Wallet connection and the wrong-network state.
 *
 * Mezo is a standard EVM chain, so this is an ordinary wagmi connect flow — no special
 * SDK, which is worth saying because it is the reason connecting works with whatever
 * wallet a Bitcoin holder already has.
 *
 * The wrong-network case gets a real state rather than a silent failure: reads against
 * the wrong chain return nothing that means anything, and a "connected" badge over a
 * screen of empty figures is worse than no connection at all.
 */

const targetChain = getChain(NETWORK);

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (isConnected && address) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="bg-surface-raised inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-4 text-sm transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)]"
        >
          <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
          <span className="num text-text">{shortAddress(address)}</span>
        </button>
        {open ? (
          <div
            role="menu"
            className="bg-surface-raised absolute right-0 z-50 mt-2 w-56 rounded-[var(--radius-card)] border border-[var(--border-hairline)] p-2"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="text-text-muted hover:text-text hover:bg-text/[0.05] flex h-11 w-full items-center rounded-[var(--radius-pill)] px-4 text-sm transition-colors duration-[120ms] ease-out"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="bg-text text-bg hover:bg-text/90 group inline-flex h-11 items-center gap-3 rounded-[var(--radius-pill)] pl-5 pr-2 text-sm font-medium transition-colors duration-[120ms] ease-out"
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-violet-500 text-white transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="size-4"
          >
            <path d="M3 8h10" strokeLinecap="round" />
            <path d="M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="bg-surface-raised absolute right-0 z-50 mt-2 w-64 rounded-[var(--radius-card)] border border-[var(--border-hairline)] p-2"
        >
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              role="menuitem"
              onClick={() => {
                connect({ connector, chainId: targetChain.id });
                setOpen(false);
              }}
              className="text-text-muted hover:text-text hover:bg-text/[0.05] flex h-11 w-full items-center rounded-[var(--radius-pill)] px-4 text-sm transition-colors duration-[120ms] ease-out"
            >
              {connector.name}
            </button>
          ))}
          <p className="text-text-subtle px-4 py-2 text-xs leading-relaxed">
            Mezo is a standard EVM chain. Any wallet that can add a network works.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The wrong-network state.
 *
 * Rendered above the page content rather than inside it, because everything below it is
 * meaningless until it is resolved. `switchChain` asks the wallet to add Mezo if it does
 * not know it — the chain definition carries the RPC list and the explorer.
 */
export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending, error } = useSwitchChain();

  if (!isConnected || chainId === targetChain.id) return null;

  return (
    <Note tone="warning" role="alert">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[60ch]">
          <p className="text-warning">Wrong network</p>
          <p className="mt-1">
            Your wallet is on chain <span className="num">{chainId}</span>. Maren runs on{' '}
            {targetChain.name} (<span className="num">{targetChain.id}</span>). Nothing on this
            screen reads your position until you switch.
          </p>
          {error ? <p className="text-danger mt-2">{error.message}</p> : null}
        </div>
        <ActionButton
          variant="secondary"
          onClick={() => switchChain({ chainId: targetChain.id })}
          disabled={isPending}
        >
          {isPending ? 'Switching…' : `Switch to ${targetChain.name}`}
        </ActionButton>
      </div>
    </Note>
  );
}
