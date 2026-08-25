'use client';

import { useEffect, useState } from 'react';
import type { TocEntry } from '@/lib/docs/toc';

/** Right-rail table of contents with scroll-spy, as in the reference. */
export function Toc({ items }: { items: TocEntry[] }) {
  const [active, setActive] = useState('');

  useEffect(() => {
    if (items.length === 0) return;
    const heads = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    function spy() {
      const y = window.scrollY + 120;
      let current = heads[0]?.id ?? '';
      for (const head of heads) {
        if (head.offsetTop <= y) current = head.id;
      }
      setActive(current);
    }

    spy();
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    return () => {
      window.removeEventListener('scroll', spy);
      window.removeEventListener('resize', spy);
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <aside className="doc-toc">
      <h5 className="doc-toc-title">On this page</h5>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`doc-toc-link doc-toc-d${item.depth}${active === item.id ? ' is-on' : ''}`}
        >
          {item.text}
        </a>
      ))}
    </aside>
  );
}
