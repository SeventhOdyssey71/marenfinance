'use client';

import Link from 'next/link';

import { ArrowUpRight, BoltIcon } from '@/components/ui/icons';
import { NETWORK } from '@/lib/data/source';

/**
 * The one line that leads to the x402 demo, at the foot of Pay. A quiet hairline row,
 * not a card: the demo must be findable without competing with the money flows above
 * it, so nothing in it is violet. Renders nothing off testnet, mirroring the demo's own
 * gate.
 */
export function X402Teaser() {
  if (NETWORK !== 'testnet') return null;
  return (
    <Link
      href="/app/x402"
      className="bg-surface hover:bg-surface-inset group flex min-h-16 items-center gap-4 border border-[var(--border-hairline)] px-4 py-3 transition-colors duration-150 ease-out"
    >
      <span
        aria-hidden
        className="text-text-muted grid size-9 shrink-0 place-items-center border border-[var(--border-hairline)]"
      >
        <BoltIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text block text-sm">Try the x402 testnet demo</span>
        <span className="text-text-muted mt-0.5 block text-xs leading-relaxed">
          Buy a paid API response with a gasless signature.
        </span>
      </span>
      <ArrowUpRight
        aria-hidden
        className="text-text-muted size-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
      />
    </Link>
  );
}
