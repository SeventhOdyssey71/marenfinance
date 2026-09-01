/**
 * A dashed rounded-rect that floats just inside a card's edge — the "trace
 * outline" accent, used sparingly to mark one element as the differentiator.
 * A CSS border (not an SVG rect) so the corners follow the radius cleanly at any
 * aspect ratio. Motion, and its removal under reduced motion, live in `.trace`
 * in globals.css. Decorative only, so aria-hidden.
 *
 * Drop inside a `position: relative` element.
 */
export function TraceOutline() {
  return <span className="trace" aria-hidden />;
}
