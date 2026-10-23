'use client';

import { useEffect, useState } from 'react';
import type { TocEntry } from '@/lib/docs/toc';

/** How far below the viewport top a heading counts as the one being read. */
const READING_LINE = 120;

/** Right-rail table of contents with a scroll-spy on the window. */
export function Toc({ items }: { items: TocEntry[] }) {
  const [active, setActive] = useState('');

  useEffect(() => {
    if (items.length === 0) return;
    const heads = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (heads.length === 0) return;

    let frame = 0;
    function spy() {
      frame = 0;
      let current = heads[0]?.id ?? '';
      for (const head of heads) {
        if (head.getBoundingClientRect().top > READING_LINE) break;
        current = head.id;
      }
      // At the very bottom the last sections may be too short to reach the line.
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        current = heads[heads.length - 1]?.id ?? current;
      }
      setActive(current);
    }
    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(spy);
    }

    spy();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [items]);

  // The rail renders even when empty so the page grid keeps its right column.
  if (items.length === 0) return <aside className="doc-rail" aria-hidden />;

  return (
    <aside className="doc-rail">
      <nav className="doc-toc" aria-labelledby="doc-toc-title">
        <h2 className="doc-toc-title" id="doc-toc-title">
          On this page
        </h2>
        <ol className="doc-toc-list">
          {items.map((item) => {
            const on = active === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={on ? 'location' : undefined}
                  // Joined, not concatenated: the Tailwind Prettier plugin trims the
                  // leading space of a `' is-on'` literal and silently drops the class.
                  className={['doc-toc-link', `doc-toc-d${item.depth}`, on ? 'is-on' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
