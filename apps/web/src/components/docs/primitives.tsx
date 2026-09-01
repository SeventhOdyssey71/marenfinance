import type { ReactNode } from 'react';
import Link from 'next/link';
import { DocIcon } from './icons';
import { rewriteDocsHref } from './link';

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

export function Card({
  title,
  icon,
  href,
  children,
}: {
  title?: string;
  icon?: string;
  href?: string;
  children?: ReactNode;
}) {
  const inner = (
    <>
      {icon ? <DocIcon name={icon} className="doc-card-icon" /> : null}
      {title ? <div className="doc-card-title">{title}</div> : null}
      {children ? <div className="doc-card-body">{children}</div> : null}
    </>
  );
  const rewritten = rewriteDocsHref(href);
  if (rewritten) {
    const external = /^https?:/.test(rewritten);
    if (external) {
      return (
        <a
          className="doc-card doc-card-link"
          href={rewritten}
          target="_blank"
          rel="noreferrer noopener"
        >
          {inner}
        </a>
      );
    }
    return (
      <Link className="doc-card doc-card-link" href={rewritten}>
        {inner}
      </Link>
    );
  }
  return <div className="doc-card">{inner}</div>;
}

export function CardGroup({ cols, children }: { cols?: number; children?: ReactNode }) {
  const n = cols === 3 ? 3 : cols === 2 ? 2 : 1;
  return <div className={`doc-cardgroup doc-cols-${n}`}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Callouts                                                                    */
/* -------------------------------------------------------------------------- */

function Callout({ tone, icon, children }: { tone: string; icon: string; children?: ReactNode }) {
  return (
    <div className={`doc-callout doc-callout-${tone}`} role="note">
      <DocIcon name={icon} className="doc-callout-icon" />
      <div className="doc-callout-body">{children}</div>
    </div>
  );
}

export function Note({ children }: { children?: ReactNode }) {
  return (
    <Callout tone="note" icon="note">
      {children}
    </Callout>
  );
}

export function Info({ children }: { children?: ReactNode }) {
  return (
    <Callout tone="info" icon="info">
      {children}
    </Callout>
  );
}

export function Tip({ children }: { children?: ReactNode }) {
  return (
    <Callout tone="tip" icon="tip">
      {children}
    </Callout>
  );
}

export function Warning({ children }: { children?: ReactNode }) {
  return (
    <Callout tone="warn" icon="triangle-exclamation">
      {children}
    </Callout>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

export function Steps({ children }: { children?: ReactNode }) {
  return <div className="doc-steps">{children}</div>;
}

export function Step({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="doc-step">
      <div className="doc-step-marker" aria-hidden />
      <div className="doc-step-content">
        {title ? <div className="doc-step-title">{title}</div> : null}
        <div className="doc-step-body">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* API fields                                                                  */
/* -------------------------------------------------------------------------- */

function Field({
  name,
  type,
  required,
  defaultValue,
  children,
}: {
  name?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  children?: ReactNode;
}) {
  return (
    <div className="doc-field">
      <div className="doc-field-head">
        {name ? <code className="doc-field-name">{name}</code> : null}
        {type ? <span className="doc-field-type">{type}</span> : null}
        {required ? <span className="doc-field-required">required</span> : null}
        {defaultValue ? <span className="doc-field-default">default: {defaultValue}</span> : null}
      </div>
      {children ? <div className="doc-field-body">{children}</div> : null}
    </div>
  );
}

export function ResponseField(props: {
  name?: string;
  type?: string;
  required?: boolean;
  default?: string;
  children?: ReactNode;
}) {
  return <Field {...props} defaultValue={props.default} />;
}

export function ParamField(props: {
  name?: string;
  query?: string;
  path?: string;
  body?: string;
  type?: string;
  required?: boolean;
  default?: string;
  children?: ReactNode;
}) {
  const name = props.name ?? props.query ?? props.path ?? props.body;
  return (
    <Field name={name} type={props.type} required={props.required} defaultValue={props.default}>
      {props.children}
    </Field>
  );
}

/* -------------------------------------------------------------------------- */
/* Frame                                                                       */
/* -------------------------------------------------------------------------- */

export function Frame({ caption, children }: { caption?: string; children?: ReactNode }) {
  return (
    <figure className="doc-frame">
      <div className="doc-frame-inner">{children}</div>
      {caption ? <figcaption className="doc-frame-caption">{caption}</figcaption> : null}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Accordion (native details, keyboard accessible with no JS)                  */
/* -------------------------------------------------------------------------- */

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div className="doc-accgroup">{children}</div>;
}

export function Accordion({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title?: string;
  icon?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}) {
  return (
    <details className="doc-acc" open={defaultOpen}>
      <summary className="doc-acc-summary">
        {icon ? <DocIcon name={icon} className="doc-acc-icon" /> : null}
        <span className="doc-acc-title">{title}</span>
        <svg
          className="doc-acc-chev"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </summary>
      <div className="doc-acc-body">{children}</div>
    </details>
  );
}
