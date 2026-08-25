import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocPage } from '@/components/docs/doc-page';
import { getAllSlugs, getFrontmatter, isValidSlug, ROOT_SLUG } from '@/lib/docs/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

type Params = { slug?: string[] };

/** The introduction renders at /docs; every other page at its docs.json path. */
export function generateStaticParams(): Params[] {
  return [{ slug: [] }, ...getAllSlugs().map((slug) => ({ slug: slug.split('/') }))];
}

function resolveSlug(slug: string[] | undefined): string {
  const joined = (slug ?? []).join('/');
  return joined === '' ? ROOT_SLUG : joined;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveSlug(slug);
  if (!isValidSlug(resolved)) return {};
  const fm = getFrontmatter(resolved);
  return { title: fm.title, description: fm.description };
}

export default async function DocsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const resolved = resolveSlug(slug);
  if (!isValidSlug(resolved)) notFound();
  return <DocPage slug={resolved} />;
}
