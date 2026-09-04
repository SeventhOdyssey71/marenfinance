'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';

/**
 * The desktop app rail — adapted from rare-ui's `hook-sidebar`.
 *
 * WHY THIS ONE. Of the three rare-ui rails, `hook-sidebar` was the only routed nav: it
 * already reads `usePathname`, takes `href` items, lights the current route, and springs
 * its indicator on `motion/react` alone with a reduced-motion branch. `proximity-sidebar`
 * is a scroll-spy minimap of on-page headings, and `bounce-sidebar` is an index-controlled
 * list that pulls `arc` from the top-level `motion` package — neither is a four-destination
 * app nav, and neither runs on `motion/react` by itself.
 *
 * WHAT WAS ADAPTED. rare-ui's `cn`/`@/lib/utils` is replaced by the local `cx` below (no
 * new dependency). The dashed "hook" line and its corner SVG — a documentation-sidebar
 * flourish — are dropped for the soft-UGLYCASH read: the spring-driven rail is kept as a
 * quiet inset pill that tracks the active row, with a single Riot-Pink accent bar on its
 * inline-start edge. Rows carry the app's own icon + label, and the active test matches the
 * shell's (`/app` exact, every other item its own subtree).
 */

/** Minimal class join — replaces rare-ui's `cn`, no clsx/tailwind-merge dependency. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type NavSidebarItem = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

/** Home matches exactly; every other item matches its own subtree. Mirrors the shell. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(href + '/');
}

type Box = { top: number; height: number };

export function NavSidebar({
  items,
  className = '',
  label = 'App sections',
}: {
  items: readonly NavSidebarItem[];
  className?: string;
  label?: string;
}) {
  const pathname = usePathname() ?? '/app';
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);

  const activeIndex = items.findIndex((item) => isActive(pathname, item.href));

  // Measure each row's box so the indicator can spring to the active one. A
  // ResizeObserver re-measures on font load and layout change — the same mechanic
  // hook-sidebar used, kept because offsetTop is only right once the row has laid out.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () =>
      setBoxes(
        itemRefs.current.map((el) =>
          el ? { top: el.offsetTop, height: el.offsetHeight } : { top: 0, height: 0 },
        ),
      );

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length]);

  const active = activeIndex >= 0 ? (boxes[activeIndex] ?? null) : null;

  // Reduced motion snaps the indicator; otherwise it springs, exactly as the source did.
  const travel = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <nav aria-label={label} className={cx('flex flex-col', className)}>
      <div ref={listRef} className="relative flex flex-col gap-1">
        {/* The active row's soft inset pill — the rail, tracking the current route. */}
        <motion.span
          aria-hidden
          initial={false}
          animate={{ top: active?.top ?? 0, height: active?.height ?? 0, opacity: active ? 1 : 0 }}
          transition={travel}
          className="bg-surface-inset pointer-events-none absolute inset-x-0 rounded-[var(--radius-input)]"
        />
        {/* A single Riot-Pink accent bar on the inline-start edge of the active row. */}
        <motion.span
          aria-hidden
          initial={false}
          animate={{
            top: (active?.top ?? 0) + 9,
            height: Math.max(0, (active?.height ?? 0) - 18),
            opacity: active ? 1 : 0,
          }}
          transition={travel}
          className="pointer-events-none absolute start-0 w-[3px] rounded-[var(--radius-pill)] bg-violet-500"
        />

        {items.map((item, index) => {
          const { href, label: text, Icon } = item;
          const current = index === activeIndex;
          return (
            <Link
              key={href}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cx(
                'nav-row relative z-10 flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-sm',
                current ? 'text-text font-medium' : 'text-text-muted',
              )}
            >
              <Icon className={cx('size-[18px] shrink-0', current && 'text-violet-500')} />
              {text}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default NavSidebar;
