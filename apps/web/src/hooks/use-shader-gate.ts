'use client';

import { useEffect, useRef, useState } from 'react';

/** True when the user has asked for reduced motion. Reacts to live changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true); // fail safe: assume reduced until known

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export type ShaderGate = {
  /** Attach to the element whose visibility gates the shader. */
  ref: (node: HTMLElement | null) => void;
  /** Has entered the viewport at least once — controls mounting. */
  mounted: boolean;
  /** Currently on screen — controls whether the shader is allowed to animate. */
  visible: boolean;
  /** Reduced motion is on: render the static CSS fallback, never the canvas. */
  reduced: boolean;
};

/**
 * Gates a shader on three things: reduced-motion preference, whether it has
 * ever been on screen (lazy mount), and whether it is on screen right now
 * (pause). BRAND.md §5.
 *
 * @param eager mount immediately without waiting for intersection — used for
 *              the hero, which is above the fold by definition.
 */
export function useShaderGate(eager = false): ShaderGate {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const ref = (node: HTMLElement | null) => {
    if (nodeRef.current === node) return;
    ioRef.current?.disconnect();
    nodeRef.current = node;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisible(entry.isIntersecting);
          if (entry.isIntersecting) setMounted(true);
        }
      },
      // Start warming up just before the band scrolls in.
      { rootMargin: '200px 0px', threshold: 0 },
    );
    io.observe(node);
    ioRef.current = io;
  };

  useEffect(() => {
    if (eager) {
      setMounted(true);
      setVisible(true);
    }
  }, [eager]);

  // Never burn GPU while the tab is in the background.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setVisible(false);
      else if (nodeRef.current || eager) setVisible(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [eager]);

  useEffect(() => () => ioRef.current?.disconnect(), []);

  return { ref, mounted, visible, reduced };
}
