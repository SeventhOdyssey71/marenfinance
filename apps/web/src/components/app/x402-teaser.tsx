'use client';

import Link from 'next/link';

import { ArrowUpRight, BoltIcon } from '@/components/ui/icons';
import { NETWORK } from '@/lib/data/source';

/**
 * The one line that leads to the x402 demo, at the foot of Pay. A quiet bordered row,
 * not a card: the demo must be findable without competing with the money flows above
 * it. Renders nothing off testnet, mirroring the demo's own gate.
 */
export function X402Teaser() {
  if (NETWORK !== 'testnet') return null;
  return (
    <Link
      href="/app/x402"
      className="group flex items-center gap-3 rounded-[14px] border border-[var(--border-hairline)] px-4 py-3 transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
    >
      <BoltIcon aria-hidden className="size-4 shrink-0 text-violet-500" />
      <span className="min-w-0 flex-1">
        <span className="text-text block text-sm font-medium">Try the x402 testnet demo</span>
        <span className="text-text-subtle block text-xs leading-relaxed">
          Buy a paid API response with a gasless signature.
        </span>
      </span>
      <ArrowUpRight
        aria-hidden
        className="text-text-muted size-4 shrink-0 transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5"
      />
    </Link>
  );
}
