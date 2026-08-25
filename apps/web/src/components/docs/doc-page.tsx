import { getFrontmatter, getGroupLabel, readPageBody } from '@/lib/docs/source';
import { extractToc } from '@/lib/docs/toc';
import { Mdx } from './mdx';
import { Toc } from './toc';

/** One rendered docs page: eyebrow, title, lede, MDX body, and the right-rail contents. */
export async function DocPage({ slug }: { slug: string }) {
  const fm = getFrontmatter(slug);
  const group = getGroupLabel(slug);
  const body = readPageBody(slug);
  const toc = extractToc(body);
  const content = await Mdx({ source: body });

  return (
    <>
      <article className="doc">
        {group ? <div className="doc-eyebrow">{group}</div> : null}
        <h1>{fm.title}</h1>
        {fm.description ? <p className="doc-lede">{fm.description}</p> : null}
        <div className="doc-body">{content}</div>
      </article>
      <Toc items={toc} />
    </>
  );
}
