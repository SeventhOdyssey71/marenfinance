'use client';

import dynamic from 'next/dynamic';
import { useShaderGate } from '@/hooks/use-shader-gate';

const RibbonCanvas = dynamic(
  () => import('./canvases').then((m) => ({ default: m.RibbonCanvas })),
  { ssr: false },
);

const GrainCanvas = dynamic(() => import('./canvases').then((m) => ({ default: m.GrainCanvas })), {
  ssr: false,
});

/**
 * Shader usage 1 of 3 (CTA half) + usage 3 of 3 — MeshGradient under the
 * closing CTA band with a single low-opacity GrainGradient pass over it to
 * kill banding and give the gradient a printed quality (BRAND.md §5.1, §5.3).
 *
 * Both are below the fold: lazy-mounted on first intersection, paused when
 * off-screen or when the tab is hidden.
 */
export function CtaBackdrop() {
  const { ref, mounted, visible, reduced } = useShaderGate();

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-card)]"
    >
      <div className="mesh-fallback absolute inset-0" />

      {!reduced && mounted && (
        <>
          <div className="absolute inset-0 animate-[maren-reveal_800ms_ease-out_forwards] opacity-0">
            <RibbonCanvas running={visible} speed={0.6} />
          </div>
          {/* Texture pass — deliberately faint. */}
          <div className="absolute inset-0 opacity-[0.14] mix-blend-soft-light">
            <GrainCanvas running={visible} />
          </div>
        </>
      )}

      {/* Static grain fallback, and the contrast scrim that keeps the CTA copy
          comfortably above 4.5:1 against the violet core. */}
      {reduced && <div className="grain-fallback absolute inset-0 opacity-60" />}
      {/* Warp is far brighter than the MeshGradient this replaced, so the scrim
          carries more here than it used to. Measured, not guessed: at 0.35 in the
          centre the CTA subhead fell to 2.76:1. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_50%,rgba(8,8,10,0.72)_0%,rgba(8,8,10,0.86)_70%,rgba(8,8,10,0.93)_100%)]" />
    </div>
  );
}
