'use client';

import { getChain, getMarenAddresses, shortAddress } from '@maren/sdk';

import { NETWORK, useDataSource } from '@/lib/data/source';

/**
 * What this app is reading, and from where.
 *
 * Replaces the "Demo data" banner and its demo controls. That banner existed to disclose
 * that the figures on screen were invented; there are no invented figures left to
 * disclose, so what remains is provenance — the network, and the vault address anyone can
 * paste into the explorer to check every number on the page against the chain itself.
 *
 * Deliberately NOT a warning. A permanent amber strip on a working product trains people
 * to ignore amber strips, and the two states that genuinely need one — a wrong network
 * and a stale oracle — already have their own, in `NetworkGuard` and `PriceBanner`.
 */
export function ChainStatus() {
  const source = useDataSource();
  const chain = getChain(NETWORK);
  const vault = getMarenAddresses(NETWORK).marenVault;

  if (!source.deployed) {
    return (
      <p className="text-text-subtle text-xs leading-relaxed">
        Maren is not deployed on Mezo {NETWORK}. Those addresses are still zero, so there is
        nothing to read. Point <span className="num">NEXT_PUBLIC_MEZO_NETWORK</span> at{' '}
        <span className="num">testnet</span>, where it is live.
      </p>
    );
  }

  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      Reading {chain.name} ({chain.id}), vault{' '}
      <a
        href={`${chain.blockExplorers.default.url}/address/${vault}`}
        target="_blank"
        rel="noreferrer noopener"
        className="num text-text-muted hover:text-text underline decoration-[var(--border-strong)] underline-offset-4 transition-colors duration-[120ms] ease-out"
      >
        {shortAddress(vault)}
      </a>
      {source.connected
        ? '. Every figure below is a contract read.'
        : '. Connect a wallet to read your own position.'}
    </p>
  );
}
