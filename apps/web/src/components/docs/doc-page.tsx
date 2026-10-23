import Link from 'next/link';
import { getFrontmatter, getGroupLabel, getNav, readPageBody } from '@/lib/docs/source';
import { extractToc, type TocEntry } from '@/lib/docs/toc';
import { IconChevron } from './icons';
import { Mdx } from './mdx';
import { Toc } from './toc';

/** The on-page contents folded under the lede, for widths without the right rail. */
function TocFold({ items }: { items: TocEntry[] }) {
  if (items.length === 0) return null;
  return (
    <details className="doc-toc-mobile">
      <summary>
        <span className="doc-toc-fold-label">On this page</span>
        <IconChevron aria-hidden />
      </summary>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className={`doc-toc-d${item.depth}`}>
              {item.text}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Previous and next page in sidebar order, so a reader can go straight through. */
function Pager({ slug }: { slug: string }) {
  const pages = getNav().flatMap((group) => group.pages);
  const index = pages.findIndex((page) => page.slug === slug);
  if (index === -1) return null;
  const prev = pages[index - 1];
  const next = pages[index + 1];
  if (!prev && !next) return null;
  return (
    <nav className="doc-pager" aria-label="Previous and next page">
      {prev ? (
        <Link href={prev.href} className="doc-pager-link doc-pager-prev" rel="prev">
          <span className="doc-pager-label">Previous</span>
          <span className="doc-pager-title">{prev.title}</span>
        </Link>
      ) : null}
      {next ? (
        <Link href={next.href} className="doc-pager-link doc-pager-next" rel="next">
          <span className="doc-pager-label">Next</span>
          <span className="doc-pager-title">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/** One rendered docs page: eyebrow, title, lede, MDX body, pager, and the right rail. */
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
        <TocFold items={toc} />
        <div className="doc-body">{content}</div>
        <Pager slug={slug} />
      </article>
      <Toc items={toc} />
    </>
  );
}
