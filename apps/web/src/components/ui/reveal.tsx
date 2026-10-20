'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

type RevealProps = {
  children: ReactNode;
  /** Stagger in ms. Kept small — this is a fade, not a performance. */
  delay?: number;
  as?: ElementType;
  className?: string;
};

/**
 * One-shot entrance. Fires the first time an element enters the viewport and
 * then disconnects, so nothing re-animates on scroll-back (BRAND.md §6).
 * Under prefers-reduced-motion the CSS keeps the element visible and static.
 */
export function Reveal({ children, delay = 0, as, className = '' }: RevealProps) {
  const Tag = (as ?? 'div') as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof IntersectionObserver === 'undefined'
    ) {
      setShown(true);
      return;
    }
    // ALREADY ON SCREEN? DO NOT HIDE IT. The server renders this content visible — `.reveal`
    // alone has no opacity rule — and arming adds `.reveal-ready` (opacity 0) to wait for the
    // observer. For anything above the fold that means painted text is taken away after
    // hydration and handed back a frame or two later, which reads as a blank hero on a cold
    // load: measured against production, TTFB was 0.5s with the headline present in the HTML,
    // and the hero still showed empty while the nav did not. An entrance animation is not
    // worth un-painting the first thing anyone sees, so already-visible elements skip
    // straight to shown and never animate.
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      setShown(true);
      return;
    }

    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${armed ? 'reveal-ready' : ''} ${shown ? 'reveal-in' : ''} ${className}`}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
