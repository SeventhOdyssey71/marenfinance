'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { useShaderGate } from '@/hooks/use-shader-gate';

const PulseCanvas = dynamic(
  () => import('./canvases').then((m) => ({ default: m.PulseCanvas })),
  { ssr: false },
);

/**
 * Shader usage 2 of 3 — PulsingBorder, on the single live element on the page:
 * the position-health card. It is a status indicator, so its colour tracks the
 * health state (BRAND.md §5.2). Here the example position is healthy, so it
 * pulses in `success`.
 *
 * Below the fold, so it is lazy-mounted on first intersection and paused the
 * moment it leaves the viewport.
 */
export function LivePulseFrame({
  children,
  colors = ['#34D399', '#3ECF8E'],
}: {
  children: ReactNode;
  colors?: readonly string[];
}) {
  const { ref, mounted, visible, reduced } = useShaderGate();

  return (
    <div ref={ref} className="relative">
      {/* Static hairline is always present; the shader only adds the pulse. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-[var(--radius-card)] border border-success/20"
      />
      {!reduced && mounted && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 overflow-hidden opacity-70"
        >
          <PulseCanvas running={visible} colors={colors} />
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
