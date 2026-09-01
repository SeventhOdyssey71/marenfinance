'use client';

import dynamic from 'next/dynamic';
import { useShaderGate } from '@/hooks/use-shader-gate';

// Client-only, like every other canvas on the page. three never reaches the server bundle.
const VaultCanvas = dynamic(() => import('./vault-canvas').then((m) => ({ default: m.VaultCanvas })), {
  ssr: false,
});

/**
 * The 3D hero, drop-in for the old `<HeroMesh />`. Same gate: the static
 * `.mesh-fallback` gradient is painted underneath so the hero is fully composed
 * on first paint, under reduced motion, and with no WebGL; the canvas fades in
 * over it and pauses whenever the hero scrolls out of view.
 */
export function HeroScene() {
  const { ref, mounted, visible, reduced } = useShaderGate(true);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-20 overflow-hidden">
      <div className="mesh-fallback absolute inset-0" />
      {!reduced && mounted && (
        <div className="absolute inset-0 animate-[maren-reveal_1200ms_ease-out_forwards] opacity-0">
          <VaultCanvas running={visible} />
        </div>
      )}
      {/* Feather the bottom edge into the page background. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,#08080A)]" />
    </div>
  );
}
