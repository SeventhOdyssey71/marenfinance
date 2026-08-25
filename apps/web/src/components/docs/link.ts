/**
 * Rewrite the base of an internal docs link.
 *
 * The MDX is authored for Mintlify, where a link reads `/product/social-vault`. In this
 * app the docs live under `/docs`, so an internal absolute path is prefixed. The
 * introduction is the `/docs` landing page, so its Mintlify path collapses onto it.
 * External, mail and in-page anchors are left untouched.
 */
export function rewriteDocsHref(href: string | undefined): string | undefined {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return href;
  if (href === '/get-started/introduction') return '/docs';
  if (href.startsWith('/docs')) return href;
  if (href.startsWith('/')) return `/docs${href}`;
  return href;
}
