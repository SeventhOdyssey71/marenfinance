/**
 * Single source of truth for the docs section.
 *
 * The content is NOT copied into this app. It is read at build time straight from the
 * monorepo's `docs-site/` tree: the same MDX files and the same `docs.json` navigation
 * that Mintlify renders. Nav groups and page order come from `docs.json`; each page's
 * title and description come from its own MDX frontmatter. Nothing here is hand-mirrored,
 * so the two renderings cannot drift.
 *
 * Every read happens on the server during prerender (see `force-static` on the routes),
 * so the published pages carry no filesystem dependency at runtime.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walk up from the build cwd until we find the monorepo's docs-site tree. */
function findDocsRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'docs-site');
    if (existsSync(join(candidate, 'docs.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate docs-site/docs.json starting from ${process.cwd()}`);
}

/**
 * Located lazily and memoised. Importing this module must NOT run the walk: the
 * /docs route's serverless function imports it on cold start, where `docs-site/`
 * is not on disk, and a module-load throw there is what 500s the page even though
 * every page is `force-static`. The walk only runs when a reader is actually
 * called — which, for these static routes, is during build-time prerender.
 */
let _docsRoot: string | null = null;
function docsRoot(): string {
  if (_docsRoot === null) _docsRoot = findDocsRoot();
  return _docsRoot;
}

/** The introduction is the docs landing page and lives at /docs rather than a sub-path. */
export const ROOT_SLUG = 'get-started/introduction';

type DocsJson = {
  navigation: {
    tabs: { groups: { group: string; pages: string[] }[] }[];
    global?: { anchors?: { anchor: string; href: string }[] };
  };
  navbar?: { primary?: { href?: string } };
};

/** The GitHub link shown in the docs top bar, read from docs.json rather than hard-coded. */
export function getGithubHref(): string {
  const docs = readDocsJson();
  return (
    docs.navbar?.primary?.href ??
    docs.navigation.global?.anchors?.find((a) => a.anchor.toLowerCase() === 'github')?.href ??
    'https://github.com'
  );
}

function readDocsJson(): DocsJson {
  return JSON.parse(readFileSync(join(docsRoot(), 'docs.json'), 'utf8')) as DocsJson;
}

export type PageFrontmatter = { title: string; description: string };

function mdxPath(slug: string): string {
  return join(docsRoot(), `${slug}.mdx`);
}

/** Minimal frontmatter reader: the docs only use quoted `title` and `description`. */
function readFrontmatter(slug: string): PageFrontmatter {
  const raw = readFileSync(mdxPath(slug), 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (match && match[1]) {
    for (const line of match[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv && kv[1]) fm[kv[1]] = (kv[2] ?? '').trim().replace(/^["']|["']$/g, '');
    }
  }
  return { title: fm.title ?? slug, description: fm.description ?? '' };
}

/** The raw MDX body for a slug, with its frontmatter block stripped. */
export function readPageBody(slug: string): string {
  const raw = readFileSync(mdxPath(slug), 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export type NavPage = {
  slug: string;
  href: string;
  title: string;
  description: string;
};

export type NavGroup = { group: string; pages: NavPage[] };

/** Map a docs.json page path to its route in this app. */
export function hrefForSlug(slug: string): string {
  return slug === ROOT_SLUG ? '/docs' : `/docs/${slug}`;
}

/** The full sidebar, built from docs.json order and each page's frontmatter. */
export function getNav(): NavGroup[] {
  const { navigation } = readDocsJson();
  const groups = navigation.tabs.flatMap((tab) => tab.groups);
  return groups.map((group) => ({
    group: group.group,
    pages: group.pages.map((slug) => {
      const fm = readFrontmatter(slug);
      return { slug, href: hrefForSlug(slug), title: fm.title, description: fm.description };
    }),
  }));
}

/** Every page slug in docs.json order, for static generation. */
export function getAllSlugs(): string[] {
  const { navigation } = readDocsJson();
  return navigation.tabs.flatMap((tab) => tab.groups).flatMap((group) => group.pages);
}

export function getFrontmatter(slug: string): PageFrontmatter {
  return readFrontmatter(slug);
}

/** The eyebrow shown above a page title is the name of the group it belongs to. */
export function getGroupLabel(slug: string): string | null {
  for (const group of getNav()) {
    if (group.pages.some((page) => page.slug === slug)) return group.group;
  }
  return null;
}

export function isValidSlug(slug: string): boolean {
  return getAllSlugs().includes(slug);
}
