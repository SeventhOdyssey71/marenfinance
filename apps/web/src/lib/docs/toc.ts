import GithubSlugger from 'github-slugger';

export type TocEntry = { id: string; text: string; depth: 2 | 3 };

/** Strip the inline markdown a heading might carry so the label reads as plain text. */
function stripInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/**
 * Build the on-page table of contents from a page's h2/h3 headings.
 *
 * The ids match `rehype-slug` exactly because both sides run GitHub's slugger over the
 * same heading text in document order. Fenced code is skipped so a bash comment like
 * `# -> 31611` is never mistaken for a heading.
 */
export function extractToc(source: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of source.split('\n')) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence && fence[1]) {
      const marker = fence[1].charAt(0);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading || !heading[1] || !heading[2]) continue;
    const depth = heading[1].length;
    const text = stripInline(heading[2]);
    const id = slugger.slug(text);
    if (depth === 2 || depth === 3) entries.push({ id, text, depth });
  }

  return entries;
}
