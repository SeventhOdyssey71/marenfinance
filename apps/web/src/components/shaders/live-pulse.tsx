import type { ReactNode } from 'react';

/**
 * The position-health card's frame, now static.
 *
 * This used to mount a WebGL `PulsingBorder` shader around the card, tinted by the health
 * state, plus a coloured hairline on top of the card's own. It was the one moving thing
 * on the app's working surface, and it said the health state with colour and motion
 * alone. The card already carries the state where it can be read: the `HealthChip` in its
 * header is a dot AND a word. So the frame renders the card and nothing else, and the
 * shader canvases it used are gone.
 *
 * The export and its props are kept so the screens that wrap a card in it keep compiling;
 * `colors` is accepted and ignored.
 */
export function LivePulseFrame({
  children,
}: {
  children: ReactNode;
  /** Ignored. Kept so existing call sites compile unchanged. */
  colors?: readonly string[];
}) {
  return <>{children}</>;
}
