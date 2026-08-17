'use client';

import { getChain, getMarenAddresses, shortAddress } from '@maren/sdk';

import { NETWORK, useDataSource } from '@/lib/data/source';

/**
 * WHAT THIS USED TO BE. A line above every screen reading "Reading Mezo Matsnet (31611) —
 * vault 0x4625…645b. Every figure below is a contract read." It is deleted. Which chain
 * the app reads is not a banner: it is the same on every page, it never changes, and a
 * permanent strip of provenance above the content trains people to skip the strip.
 *
 * WHAT SURVIVES. Two things, both because they are states rather than descriptions.
 *
 * `ChainStatus` now renders NOTHING on the working path, and speaks only when Maren is not
 * deployed on the configured network — a broken build that would otherwise show a screen of
 * zeroes with no explanation.
 *
 * `VaultProvenance` keeps the vault address reachable, but as a link in the app footer
 * rather than a banner over the content. The address is what makes every figure in the app
 * checkable against the explorer, so it should exist somewhere; it does not need to be the
 * first thing on the page.
 */
export function ChainStatus() {
  const source = useDataSource();

  if (source.deployed) return null;

  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      Maren is not deployed on Mezo {NETWORK}. Those addresses are still zero, so there is nothing
      to read. Point <span className="num">NEXT_PUBLIC_MEZO_NETWORK</span> at{' '}
      <span className="num">testnet</span>, where it is live.
    </p>
  );
}

/** The vault address, as a footer link. Provenance without a banner. */
export function VaultProvenance() {
  const source = useDataSource();
  const chain = getChain(NETWORK);
  const vault = getMarenAddresses(NETWORK).marenVault;

  if (!source.deployed) return null;

  return (
    <a
      href={`${chain.blockExplorers.default.url}/address/${vault}`}
      target="_blank"
      rel="noreferrer noopener"
      className="num text-text-muted hover:text-text transition-colors duration-[120ms] ease-out"
    >
      Vault {shortAddress(vault)}
    </a>
  );
}
