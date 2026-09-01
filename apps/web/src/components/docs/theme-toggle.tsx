'use client';

import { useEffect, useState } from 'react';
import { IconSun, IconMoon } from './icons';

type Theme = 'light' | 'dark';

/**
 * The docs are their own themed world: this toggle drives `data-theme` on the document
 * element, which the scoped docs stylesheet reads. It is independent of the app's forced
 * light scope, and falls back to the OS preference until the reader chooses.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme') as Theme | null;
    const initial =
      attr ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
  }, []);

  function toggle() {
    const next: Theme = (theme ?? 'light') === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('maren-docs-theme', next);
    } catch {
      /* private mode: the OS preference still applies */
    }
  }

  return (
    <button
      type="button"
      className="doc-tbtn"
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title="Toggle light or dark"
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}
