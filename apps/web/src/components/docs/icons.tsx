import type { ReactNode, SVGProps } from 'react';

/**
 * Inline SVG icons for the docs, matching the stroke style of the approved reference.
 *
 * Mintlify names icons the FontAwesome way (`icon="rocket"`); this maps that vocabulary
 * to a small hand-drawn stroke set so the docs need no icon dependency. An unknown name
 * renders the neutral `circle-dot` glyph rather than nothing, so a new icon is visible
 * instead of crashing.
 */

const P = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const ICONS: Record<string, ReactNode> = {
  rocket: <path d="M4.5 16.5 3 21l4.5-1.5M9 15l6-6M14 4l6 6-9 3-3-3 3-6z" />,
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="12" r="2.4" />
      <path d="M14 9h4M14 15h4" />
    </>
  ),
  gears: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  'file-contract': (
    <path d="M14 3v5h5M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5H8zM9 13h6M9 17h6" />
  ),
  'shield-halved': <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3zM12 8v8" />,
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  'circle-check': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  link: <path d="M9 15 15 9M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1" />,
  'circle-half-stroke': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" opacity=".28" />
    </>
  ),
  'chart-line': <path d="M3 3v18h18M7 14l4-4 3 3 5-6" />,
  'gas-pump': (
    <path d="M13 5H8a1 1 0 0 0-1 1v14h7V6a1 1 0 0 0-1-1zM7 11h6M15 9l2 2v6a2 2 0 0 0 4 0v-8l-3-3" />
  ),
  'piggy-bank': (
    <>
      <path d="M19 9c0-3-3-5-7-5S5 6 5 9c0 1.5.8 2.6 2 3.5V17l2-1 2 1 2-1 2 1v-4.5c1.2-.9 2-2 2-3.5z" />
      <path d="M8.5 9h.01" />
    </>
  ),
  'triangle-exclamation': (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  filter: <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 4l-2 16" />,
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0 5.4 5.4L21 13l-8 8a2.1 2.1 0 0 1-3-3l8-8 .9-1z" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.5 15.5M14 14l6 6M8.5 8.5 11 11" />
    </>
  ),
  'scale-unbalanced': (
    <path d="M12 4v16M6 20h12M6 7 3 13a3 3 0 0 0 6 0L6 7zM18 5l3 6a3 3 0 0 1-6 0l3-6zM6 7l12-2" />
  ),
  ruler: <path d="m3 8 5-5 13 13-5 5L3 8zM7 7l2 2M10 4l2 2M13 7l2 2M16 10l2 2" />,
  robot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4M9 13h.01M15 13h.01M9 17h6" />
      <circle cx="12" cy="3.5" r="1" />
    </>
  ),
  receipt: (
    <path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1zM8 8h8M8 12h8M8 16h5" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  'node-js': (
    <>
      <path d="M12 2 21 7v10l-9 5-9-5V7l9-5z" />
      <path d="M9 14.5c0 1 .8 1.6 1.9 1.6 1.2 0 2.1-.6 2.1-2V9" />
    </>
  ),
  'network-wired': (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v3M6 16v-3h12v3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  'location-dot': (
    <>
      <path d="M12 21c5-5 7-8 7-11a7 7 0 1 0-14 0c0 3 2 6 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  'list-check': (
    <path d="M10 6h10M10 12h10M10 18h10M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" />
  ),
  'layer-group': <path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  key: (
    <>
      <circle cx="8" cy="8" r="4" />
      <path d="m11 11 9 9M17 17l2-2M14 14l2-2" />
    </>
  ),
  inbox: <path d="M3 12h5l2 3h4l2-3h5M3 12l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" />,
  hashtag: <path d="M9 3 7 21M17 3l-2 18M4 9h16M3 15h16" />,
  hammer: (
    <>
      <path d="M15 5l4 4-2 2-4-4 2-2z" />
      <path d="M13 7 4 16a2 2 0 0 0 0 3l1 1a2 2 0 0 0 3 0l9-9" />
    </>
  ),
  'file-shield': (
    <path d="M14 3v5h5M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M14 3l5 5M17 12l3 1v2.5c0 2-1.5 3-3 3.5-1.5-.5-3-1.5-3-3.5V13l3-1z" />
  ),
  'file-code': (
    <path d="M14 3v5h5M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5H8zM10 12l-2 2 2 2M14 12l2 2-2 2" />
  ),
  'clipboard-check': (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9V5zM8 13l2.5 2.5L16 10" />
    </>
  ),
  'circle-dot': (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'building-columns': <path d="m3 9 9-5 9 5M4 9h16M6 9v8M10 9v8M14 9v8M18 9v8M3 21h18" />,
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
    </>
  ),
  box: <path d="m12 3 9 5v8l-9 5-9-5V8l9-5zM3 8l9 5 9-5M12 13v8" />,
  // Callout + tip glyphs
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  note: <path d="M4 4h16v12l-4 4H4V4zM16 20v-4h4M8 9h8M8 13h5" />,
  tip: (
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.4 1 2.5h6c0-1.1.2-1.7 1-2.5A6 6 0 0 0 12 3z" />
  ),
};

export function DocIcon({ name, ...props }: { name: string } & SVGProps<SVGSVGElement>) {
  const glyph = ICONS[name] ?? ICONS['circle-dot'];
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden {...P} {...props}>
      {glyph}
    </svg>
  );
}

/* Chrome icons used by the shell. */
export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden {...P} {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </svg>
  );
}

export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden {...P} {...props}>
      <path d="M21 13A8.5 8.5 0 0 1 11 3a7 7 0 1 0 10 10z" />
    </svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden {...P} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconGithub(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor" {...props}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    </svg>
  );
}

export function IconChevron(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden {...P} {...props}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden {...P} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden {...P} {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden {...P} {...props}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}
