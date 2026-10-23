import Image from 'next/image';

/** Every screenshot under public/ is a full iPhone capture at this size. */
const SHOT_WIDTH = 1206;
const SHOT_HEIGHT = 2622;

/**
 * One real app screen: the capture as it is, square-cornered, with a hairline drawn
 * inside its edge so its white background separates from a white frame.
 *
 * Images load eagerly. The old showcase marked its phones `loading="lazy"` inside a
 * fade-in wrapper, and anything that captured the page without scrolling (a full-page
 * screenshot, a link preview) saw three empty frames. next/image serves each one as a
 * resized WebP, so loading them up front costs little.
 */
export function Screen({
  src,
  alt,
  sizes,
  priority = false,
  className = '',
}: {
  src: string;
  alt: string;
  /** The rendered width, for the responsive image set. */
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={SHOT_WIDTH}
      height={SHOT_HEIGHT}
      sizes={sizes}
      priority={priority}
      loading={priority ? undefined : 'eager'}
      className={`block h-auto w-full outline outline-1 -outline-offset-1 outline-[var(--border-hairline)] ${className}`}
    />
  );
}
