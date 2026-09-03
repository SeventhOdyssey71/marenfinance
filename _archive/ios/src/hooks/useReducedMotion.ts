import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * BRAND.md §6: "All motion is disabled under prefers-reduced-motion: reduce."
 *
 * On iOS the equivalent switch is Settings → Accessibility → Motion → Reduce Motion,
 * which React Native exposes as `isReduceMotionEnabled`. Every animated component in
 * this app reads this hook and renders the final state directly when it is true — it
 * does not merely shorten the duration.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
