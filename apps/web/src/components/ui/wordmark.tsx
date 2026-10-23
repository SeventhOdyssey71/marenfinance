/**
 * Maren wordmark: the brand mark (a violet gradient swoosh, from
 * `public/brand/maren-mark.png`) beside the name.
 *
 * The image carries its own gradient, so unlike the old drawn "M" it does not
 * inherit `currentColor` — only the text does. Sized by the container's height
 * (`h-[18px]` at the call sites) with the mark matched to the cap height, and
 * `alt=""` on the img because the accessible name lives on the whole mark.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Maren Finance"
      className={`inline-flex items-center gap-2 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset,
          fixed intrinsic size, never optimised or resized by the framework */}
      <img src="/brand/maren-mark.png" alt="" aria-hidden className="h-full w-auto" />
      <span
        aria-hidden
        className="font-medium tracking-[-0.035em]"
        style={{ fontSize: '1.1em', lineHeight: 1 }}
      >
        Maren
      </span>
    </span>
  );
}
