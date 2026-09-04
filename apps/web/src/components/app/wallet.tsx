'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { getChain, shortAddress } from '@maren/sdk';
import type { Address } from 'viem';

import { NETWORK } from '@/lib/data/source';
import { privyConfigured } from '@/lib/privy';
import { ActionButton, Note } from './primitives';

/**
 * Wallet connection and the wrong-network state.
 *
 * Mezo is a standard EVM chain, so the wallet-only path is an ordinary wagmi connect flow —
 * no special SDK, which is worth saying because it is the reason connecting works with
 * whatever wallet a Bitcoin holder already has. When Privy is configured, the same control
 * fronts Google sign-in and an embedded Mezo EOA instead, and `useAccount` still reports the
 * result so everything downstream is unchanged.
 *
 * The wrong-network case gets a real state rather than a silent failure: reads against the
 * wrong chain return nothing that means anything, and a "connected" badge over a screen of
 * empty figures is worse than no connection at all.
 */

const targetChain = getChain(NETWORK);

/** Close a popover on Escape or an outside click. Shared by both connect flows. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, close]);
  return ref;
}

/**
 * The connect control in the nav.
 *
 * One export, two implementations, chosen by the build-time `privyConfigured` gate so a
 * Privy hook is only ever mounted under a `PrivyProvider`. Both render the same connected
 * badge — a green dot and the short address — so the header does not change shape depending
 * on how a user got in.
 */
export function ConnectButton() {
  return privyConfigured ? <PrivyConnectButton /> : <WagmiConnectButton />;
}

/** The signed-in badge and its menu. `signOut` differs between the two flows. */
function AccountMenu({
  address,
  signOut,
  identity,
}: {
  address: Address;
  signOut: () => void;
  identity?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="bg-surface-inset hover:bg-text/[0.08] inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-pill)] px-4 text-sm transition-colors duration-[120ms] ease-out"
      >
        <span aria-hidden className="bg-success size-1.5 rounded-[var(--radius-pill)]" />
        <span className="num text-text">{shortAddress(address)}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="bg-surface-raised absolute right-0 z-50 mt-2 w-64 rounded-[18px] p-2 shadow-[0_1px_2px_rgba(16,16,19,0.05),0_18px_44px_-16px_rgba(16,16,19,0.28)]"
        >
          {identity ? (
            <div className="border-b border-[var(--border-hairline)] px-4 pb-2.5 pt-1.5">
              {identity}
              <p className="num text-text-subtle mt-1 text-xs">{shortAddress(address, 10, 8)}</p>
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              signOut();
              setOpen(false);
            }}
            className="text-text-muted hover:text-text hover:bg-text/[0.05] mt-1 flex h-11 w-full items-center rounded-[var(--radius-pill)] px-4 text-sm transition-colors duration-[120ms] ease-out"
          >
            {identity ? 'Sign out' : 'Disconnect'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The wallet-only flow: pick a wagmi connector from a menu. Unchanged behaviour. */
function WagmiConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  if (isConnected && address) {
    return <AccountMenu address={address} signOut={() => disconnect()} />;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="bg-text text-bg hover:bg-text/90 active:bg-text/80 group inline-flex h-11 items-center gap-3 rounded-[var(--radius-pill)] pl-5 pr-2 text-sm font-medium transition-[color,background-color,transform] duration-[120ms] ease-out active:scale-[0.97]"
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
          className="bg-surface-raised absolute right-0 z-50 mt-2 w-64 rounded-[18px] p-2 shadow-[0_1px_2px_rgba(16,16,19,0.05),0_18px_44px_-16px_rgba(16,16,19,0.28)]"
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
 * The Privy flow. A single trigger opens Privy's modal (Google first, wallet second); once
 * signed in the embedded EOA is bridged into wagmi, so `useAccount` reports it and the badge
 * shows the address like any other connection. Signing out clears the Privy session and the
 * wagmi connector together, so a returning visitor lands back on the sign-in surface.
 */
function PrivyConnectButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  if (authenticated && isConnected && address) {
    const email = user?.google?.email ?? user?.email?.address ?? null;
    return (
      <AccountMenu
        address={address}
        signOut={() => {
          void logout();
          disconnect();
        }}
        identity={
          email ? (
            <p className="text-text truncate text-sm">{email}</p>
          ) : (
            <p className="text-text-muted text-sm">Signed in</p>
          )
        }
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => login()}
      className="bg-text text-bg hover:bg-text/90 active:bg-text/80 group inline-flex h-11 items-center gap-3 rounded-[var(--radius-pill)] pl-5 pr-2 text-sm font-medium transition-[color,background-color,transform] duration-[120ms] ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {ready ? 'Sign in' : 'Loading…'}
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
