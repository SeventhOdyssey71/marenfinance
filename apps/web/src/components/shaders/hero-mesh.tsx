'use client';

import dynamic from 'next/dynamic';
import { useShaderGate } from '@/hooks/use-shader-gate';

const RibbonCanvas = dynamic(
  () => import('./canvases').then((m) => ({ default: m.RibbonCanvas })),
  { ssr: false },
);

/**
 * Shader usage 1 of 3 (hero half) — MeshGradient behind the hero.
 * The static `.mesh-fallback` gradient is always painted underneath, so the
 * hero is fully composed on first paint, under reduced motion, and on any
 * device without WebGL. The canvas fades in over it.
 */
export function HeroMesh() {
  const { ref, mounted, visible, reduced } = useShaderGate(true);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
    >
      <div className="mesh-fallback absolute inset-0" />
      {!reduced && mounted && (
        <div className="absolute inset-0 animate-[maren-reveal_800ms_ease-out_forwards] opacity-0">
          <RibbonCanvas running={visible} />
        </div>
      )}
      {/* Feather the bottom edge into the page background. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,#08080A)]" />
    </div>
  );
}
