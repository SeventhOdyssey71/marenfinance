import type { ReactNode } from 'react';
import { DocsShell } from '@/components/docs/shell';
import { getGithubHref, getNav } from '@/lib/docs/source';
import './docs.css';

// The docs are read from static in-repo MDX at build time, so the whole subtree
// prerenders even though the root layout opts the marketing app into dynamic rendering.
export const dynamic = 'force-static';

// Set the saved docs theme before first paint so light/dark does not flash.
const themeInit = `(function(){try{var t=localStorage.getItem('maren-docs-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function DocsLayout({ children }: { children: ReactNode }) {
  const nav = getNav();
  const githubHref = getGithubHref();
  return (
    <div className="maren-docs">
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      <DocsShell nav={nav} githubHref={githubHref}>
        {children}
      </DocsShell>
    </div>
  );
}
