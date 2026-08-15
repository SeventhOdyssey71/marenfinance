'use client';

/**
 * The only three places the shader library is touched. Prop names and types
 * below were read off the installed package's typings
 * (`@paper-design/shaders-react/dist/shaders/*.d.ts` and the
 * `MeshGradientParams` / `PulsingBorderParams` / `GrainGradientParams`
 * interfaces in `@paper-design/shaders`), not guessed.
 *
 * These modules are only ever reached through `next/dynamic({ ssr: false })`,
 * so WebGL never runs during SSR and the bundle is code-split away from the
 * initial payload.
 */

import { Warp, GrainGradient, PulsingBorder } from '@paper-design/shaders-react';

/**
 * BRAND.md §5.1 — violet ribbons falling off to near-black.
 *
 * This is `Warp`, not `MeshGradient`, and the swap was made against the reference
 * look rather than by preference. MeshGradient blends colour blobs: on a dark
 * palette it averages into a soft haze with no structure, which read as a flat
 * dark rectangle no matter how the palette was tuned. Warp lays a striped base
 * pattern down first and then folds it with noise and swirl, which is what
 * produces the sharp diagonal silk folds and the bright specular edges the
 * reference has.
 *
 * The palette carries a real luminance range — near-black through mid violet to a
 * light violet highlight. Text contrast is protected by the scrims in hero.tsx,
 * not by keeping the palette dim.
 */
const RIBBON_COLORS = ['#08080A', '#241268', '#6C4BFF', '#B9A6FF'] as const;

export function RibbonCanvas({
  running,
  className = '',
  speed = 0.14,
}: {
  running: boolean;
  className?: string;
  /** BRAND.md §5: speed must stay at or below 0.2. */
  speed?: number;
}) {
  return (
    <Warp
      className={className}
      colors={[...RIBBON_COLORS]}
      // Striped base, folded hard: this is the silk.
      shape="stripes"
      shapeScale={0.32}
      // Softness low enough to keep an edge on each fold; too high and it
      // collapses back into the haze this replaced.
      softness={0.45}
      proportion={0.42}
      distortion={0.28}
      swirl={0.72}
      swirlIterations={9}
      // Diagonal, matching the reference's bottom-left to top-right run.
      rotation={38}
      speed={running ? Math.min(speed, 0.2) : 0}
      scale={1.1}
      offsetX={0.1}
      offsetY={-0.05}
      fit="cover"
      // Keeps the fragment cost sane on 4K and retina displays.
      maxPixelCount={2_400_000}
      minPixelRatio={1}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

export function GrainCanvas({ running, className = '' }: { running: boolean; className?: string }) {
  return (
    <GrainGradient
      className={className}
      colorBack="#00000000"
      colors={['#5B3DF5', '#8B77FF']}
      softness={0.9}
      intensity={0.15}
      noise={0.55}
      shape="ripple"
      speed={running ? 0.12 : 0}
      fit="cover"
      scale={1.4}
      maxPixelCount={1_600_000}
      minPixelRatio={1}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

/**
 * Status indicator, not decoration. Colour tracks the health state, so a
 * healthy example position pulses in `success` green (BRAND.md §5.2).
 */
export function PulseCanvas({
  running,
  colors,
  className = '',
}: {
  running: boolean;
  colors: readonly string[];
  className?: string;
}) {
  return (
    <PulsingBorder
      className={className}
      colorBack="#00000000"
      colors={[...colors]}
      roundness={0.2}
      thickness={0.035}
      softness={0.7}
      intensity={0.45}
      bloom={0.7}
      spots={2}
      spotSize={0.28}
      pulse={0.2}
      smoke={0.25}
      smokeSize={0.5}
      speed={running ? 0.6 : 0}
      fit="cover"
      maxPixelCount={600_000}
      minPixelRatio={1}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
