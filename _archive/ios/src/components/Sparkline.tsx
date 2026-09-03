import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { brand } from '../design/tokens';

/**
 * A small area+line sparkline.
 *
 * It renders a series that is ALREADY in hand — it neither fetches nor invents one. There
 * is no price-history indexer behind Maren, so the only honest series a Maren screen can
 * hand this component is one it has watched happen: the live oracle observations sampled
 * during the current session (see hooks/usePriceSamples.ts). It is deliberately incapable
 * of drawing a placeholder trend, because a placeholder trend is a fabricated one.
 *
 * The path is smoothed with a Catmull-Rom spline converted to cubic Béziers, which passes
 * through every real sample rather than averaging them away — the shape is the data, not
 * an impression of it. Nothing animates: a sparkline reduces to its final frame under
 * reduce-motion, and here the final frame is the only frame worth drawing, so there is no
 * motion to gate.
 */
export interface SparklineProps {
  /** The real series, oldest → newest. Fewer than two points renders nothing. */
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  /** Draw a filled dot on the most recent sample. */
  emphasizeLast?: boolean;
}

export function Sparkline({
  data,
  color = brand.violet500,
  width = 96,
  height = 28,
  emphasizeLast = true,
}: SparklineProps) {
  // A single point is a dot, not a line, and a line needs two. Below that there is
  // nothing honest to draw, so we draw nothing.
  const gradientId = useId();
  if (data.length < 2) return null;

  const stroke = 1.75;
  // Inset by half the stroke top and bottom so the line never clips at the extremes.
  const pad = stroke;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * innerW,
    // A flat series (span 0) sits on the mid-line rather than dividing by zero.
    y: pad + (span === 0 ? innerH / 2 : innerH - ((v - min) / span) * innerH),
  }));

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  const line = smoothPath(points);
  const area = `${line} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.18} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>

      <Path d={area} fill={`url(#${gradientId})`} />
      <Path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {emphasizeLast ? <Circle cx={last.x} cy={last.y} r={stroke * 1.4} fill={color} /> : null}
    </Svg>
  );
}

/**
 * A Catmull-Rom spline through the points, emitted as cubic Béziers.
 *
 * The 1/6 tension is the standard uniform Catmull-Rom coefficient; endpoints duplicate
 * their neighbour so the curve starts and ends on a real sample rather than overshooting
 * past it.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  const start = pts[0];
  if (!start) return '';
  let d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}
