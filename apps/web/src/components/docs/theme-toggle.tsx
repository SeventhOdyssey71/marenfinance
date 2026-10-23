'use client';

import { useEffect, useRef, useState } from 'react';
import { IconSun, IconMoon } from './icons';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'maren-docs-theme';

function docsRoot(from: HTMLElement | null): HTMLElement | null {
  return from?.closest<HTMLElement>('.maren-docs') ?? null;
}

function currentTheme(root: HTMLElement | null): Theme {
  const attr = root?.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The docs carry their own light/dark pair. This toggle drives `data-theme` on the
 * `.maren-docs` wrapper, which the scoped stylesheet reads; until the reader chooses,
 * the OS preference decides. Both glyphs are rendered and CSS shows the right one, so
 * the icon is correct on first paint, before this component has hydrated.
 */
export function ThemeToggle() {
  const button = useRef<HTMLButtonElement>(null);
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = docsRoot(button.current);
    // The inline init script only runs on a full page load. Arriving here by client
    // navigation from the rest of the site, the saved choice is applied now.
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (root && (saved === 'light' || saved === 'dark')) root.setAttribute('data-theme', saved);
    } catch {
      /* storage blocked: the OS preference applies */
    }
    setDark(currentTheme(root) === 'dark');

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setDark(currentTheme(root) === 'dark');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  function toggle() {
    const root = docsRoot(button.current);
    if (!root) return;
    const next: Theme = currentTheme(root) === 'dark' ? 'light' : 'dark';
    // Repaint in one step: no colour transitions while the palette swaps.
    root.setAttribute('data-theme-switching', '');
    root.setAttribute('data-theme', next);
    setDark(next === 'dark');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.removeAttribute('data-theme-switching')),
    );
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  return (
    <button
      ref={button}
      type="button"
      className="doc-iconbtn"
      onClick={toggle}
      aria-label="Dark theme"
      aria-pressed={dark ?? undefined}
      title="Dark theme"
    >
      <IconMoon className="doc-theme-icon doc-theme-moon" />
      <IconSun className="doc-theme-icon doc-theme-sun" />
    </button>
  );
}
