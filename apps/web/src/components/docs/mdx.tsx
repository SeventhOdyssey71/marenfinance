import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { compileMDX } from 'next-mdx-remote/rsc';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import {
  Accordion,
  AccordionGroup,
  Card,
  CardGroup,
  Frame,
  Info,
  Note,
  ParamField,
  ResponseField,
  Step,
  Steps,
  Tip,
  Warning,
} from './primitives';
import { CodeGroup, Pre, Tab, Tabs } from './interactive';
import { rewriteDocsHref } from './link';

/**
 * Tag each fenced code node with its language and the fence meta string (the text after
 * the language, used as a CodeGroup tab title). The meta only exists on the mdast `code`
 * node, so it has to be captured before the tree becomes HTML.
 */
function remarkCodeMeta() {
  return (tree: unknown) => {
    const visit = (node: {
      type?: string;
      lang?: string;
      meta?: string;
      data?: Record<string, unknown>;
      children?: unknown[];
    }) => {
      if (node.type === 'code') {
        node.data = node.data ?? {};
        node.data.hProperties = {
          ...((node.data.hProperties as Record<string, unknown>) ?? {}),
          'data-lang': node.lang ?? '',
          'data-meta': node.meta ?? '',
        };
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child as typeof node);
      }
    };
    visit(tree as { children?: unknown[] });
  };
}

function Anchor({ href, children, ...rest }: ComponentProps<'a'>) {
  const rewritten = rewriteDocsHref(href);
  if (rewritten && /^https?:/.test(rewritten)) {
    return (
      <a href={rewritten} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  }
  if (rewritten && rewritten.startsWith('/')) {
    return (
      <Link href={rewritten} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={rewritten} {...rest}>
      {children}
    </a>
  );
}

function Code({ className, children, ...rest }: ComponentProps<'code'>) {
  if (className && className.includes('language-')) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  return <code className="doc-inline">{children}</code>;
}

function Table(props: ComponentProps<'table'>) {
  return (
    <div className="doc-table-wrap">
      <table {...props} />
    </div>
  );
}

/** A component named in the MDX but not implemented renders visibly rather than crashing. */
function makeFallback(name: string) {
  return function Fallback({ children }: { children?: ReactNode }) {
    return (
      <div className="doc-unknown">
        <span className="doc-unknown-tag">{name}</span>
        {children}
      </div>
    );
  };
}

const components = {
  a: Anchor,
  code: Code,
  pre: Pre,
  table: Table,
  Card,
  CardGroup,
  Note,
  Info,
  Tip,
  Warning,
  Steps,
  Step,
  ResponseField,
  ParamField,
  Frame,
  Accordion,
  AccordionGroup,
  Tabs,
  Tab,
  CodeGroup,
  // Named in the Mintlify vocabulary but unused by the current content; kept visible.
  Check: makeFallback('Check'),
  Update: makeFallback('Update'),
  Snippet: makeFallback('Snippet'),
} as const;

export async function Mdx({ source }: { source: string }) {
  const { content } = await compileMDX({
    source,
    components,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm, remarkCodeMeta],
        rehypePlugins: [rehypeSlug],
      },
    },
  });
  return content;
}
