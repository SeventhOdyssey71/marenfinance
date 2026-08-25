'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type SidebarGroup = {
  group: string;
  pages: { slug: string; href: string; title: string }[];
};

export function Sidebar({ nav, onNavigate }: { nav: SidebarGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="doc-nav" aria-label="Docs">
      {nav.map((group) => (
        <div className="doc-navgroup" key={group.group}>
          <h4 className="doc-navgroup-title">{group.group}</h4>
          {group.pages.map((page) => {
            const active = pathname === page.href;
            return (
              <Link
                key={page.slug}
                href={page.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`doc-navlink${active ? ' is-active' : ''}`}
              >
                {page.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
