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

import { MeshGradient, GrainGradient, PulsingBorder } from '@paper-design/shaders-react';

/** BRAND.md §5.1 — violet core -> violet-900 mid -> near-black falloff. */
const MESH_COLORS = ['#08080A', '#1B1140', '#5B3DF5', '#0B0B14'] as const;

export function MeshCanvas({
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
    <MeshGradient
      className={className}
      colors={[...MESH_COLORS]}
      distortion={0.85}
      swirl={0.55}
      speed={running ? Math.min(speed, 0.2) : 0}
      // `frame` is fixed so a paused shader holds a stable, composed image
      // instead of snapping back to t=0 when it resumes.
      offsetX={-0.12}
      offsetY={-0.2}
      scale={1.15}
      fit="cover"
      // Keeps the fragment cost sane on 4K and retina displays.
      maxPixelCount={2_400_000}
      minPixelRatio={1}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

export function GrainCanvas({
  running,
  className = '',
}: {
  running: boolean;
  className?: string;
}) {
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
      roundness={0.16}
      thickness={0.012}
      softness={0.85}
      intensity={0.28}
      bloom={0.55}
      spots={2}
      spotSize={0.2}
      pulse={0.12}
      smoke={0.32}
      smokeSize={0.5}
      speed={running ? 0.6 : 0}
      fit="cover"
      maxPixelCount={600_000}
      minPixelRatio={1}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
