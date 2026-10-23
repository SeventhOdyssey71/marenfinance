'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { IconCopy, IconCheck } from './icons';

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */

type TabProps = { title?: string; children?: ReactNode };

export function Tab({ children }: TabProps) {
  // Rendered directly only when used outside <Tabs>; inside, Tabs reads its props.
  return <div className="doc-tabpanel">{children}</div>;
}

export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).filter(isValidElement) as ReactElement<TabProps>[];
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;

  return (
    <div className="doc-tabs">
      <div className="doc-tabbar">
        <div className="doc-tabstrip" role="tablist">
          {tabs.map((tab, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={i === active ? 'doc-tabbtn is-active' : 'doc-tabbtn'}
              onClick={() => setActive(i)}
            >
              {tab.props.title ?? `Tab ${i + 1}`}
            </button>
          ))}
        </div>
      </div>
      <div className="doc-tabpanel" role="tabpanel">
        {tabs[active]?.props.children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Code blocks                                                                 */
/* -------------------------------------------------------------------------- */

type CodeElementProps = {
  className?: string;
  'data-lang'?: string;
  'data-meta'?: string;
  children?: ReactNode;
};

function codeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (isValidElement(node)) return codeText((node.props as { children?: ReactNode }).children);
  return '';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        className="doc-copy"
        data-copied={copied ? '' : undefined}
        aria-label="Copy code"
        title="Copy code"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            },
            () => undefined,
          );
        }}
      >
        <IconCopy className="doc-copy-icon doc-copy-idle" />
        <IconCheck className="doc-copy-icon doc-copy-done" />
      </button>
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}

/**
 * A fenced code block. Our remark step tags the inner <code> with `data-lang` and the
 * fence's meta string, so a standalone block can show a language chip and a group can
 * read the tab titles.
 */
export function Pre({ children, inGroup }: { children?: ReactNode; inGroup?: boolean }) {
  const codeEl = isValidElement(children) ? (children as ReactElement<CodeElementProps>) : null;
  const lang = codeEl?.props['data-lang'] ?? '';
  const text = codeText(children);
  if (inGroup) {
    return (
      <div className="doc-code">
        <pre className="doc-pre">{children}</pre>
      </div>
    );
  }
  return (
    <div className="doc-code">
      {lang ? (
        <div className="doc-code-head">
          <span className="doc-code-lang">{lang}</span>
          <CopyButton text={text} />
        </div>
      ) : (
        <div className="doc-code-float">
          <CopyButton text={text} />
        </div>
      )}
      <pre className="doc-pre">{children}</pre>
    </div>
  );
}

type PreElement = ReactElement<{ children?: ReactElement<CodeElementProps> }>;

function tabLabel(pre: PreElement, index: number): string {
  const codeEl = pre.props.children;
  const meta = isValidElement(codeEl) ? codeEl.props['data-meta'] : undefined;
  const lang = isValidElement(codeEl) ? codeEl.props['data-lang'] : undefined;
  return (meta && meta.trim()) || lang || `Snippet ${index + 1}`;
}

export function CodeGroup({ children }: { children?: ReactNode }) {
  const blocks = Children.toArray(children).filter(isValidElement) as PreElement[];
  const [active, setActive] = useState(0);
  if (blocks.length === 0) return null;
  const current = blocks[active];
  return (
    <div className="doc-codegroup">
      <div className="doc-tabbar">
        <div className="doc-tabstrip" role="tablist">
          {blocks.map((block, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={i === active ? 'doc-tabbtn is-active' : 'doc-tabbtn'}
              onClick={() => setActive(i)}
            >
              {tabLabel(block, i)}
            </button>
          ))}
        </div>
        {current ? <CopyButton text={codeText(current.props.children)} /> : null}
      </div>
      {current ? cloneElement(current, { inGroup: true } as Partial<PreElement['props']>) : null}
    </div>
  );
}
