import type { ReactNode } from 'react';
import { DocsShell } from '@/components/docs/shell';
import { getNav } from '@/lib/docs/source';
import './docs.css';

// The docs are read from static in-repo MDX at build time, so the whole subtree
// prerenders even though the root layout opts the marketing app into dynamic rendering.
export const dynamic = 'force-static';

// Apply the saved docs theme to the docs wrapper before first paint so light/dark does
// not flash. It runs inline as the wrapper's first child, so `parentElement` is the
// wrapper. The attribute lives here rather than on <html> because <html> belongs to the
// root layout, and setting it there before hydration is a hydration mismatch.
const themeInit = `(function(){try{var t=localStorage.getItem('maren-docs-theme');var el=document.currentScript&&document.currentScript.parentElement;if(el&&(t==='light'||t==='dark')){el.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function DocsLayout({ children }: { children: ReactNode }) {
  const nav = getNav();
  return (
    // suppressHydrationWarning: the inline script may add `data-theme` before React
    // hydrates; React must keep it rather than warn about it.
    <div className="maren-docs" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      <DocsShell nav={nav}>{children}</DocsShell>
    </div>
  );
}
