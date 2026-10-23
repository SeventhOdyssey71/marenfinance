import type { ReactNode } from 'react';

/**
 * The head of every landing section: a bracketed mono label, a centred headline and an
 * optional line under it. The label's brackets are part of the text; `.t-bracket`
 * sets the face and the case.
 */
export function SectionHead({
  id,
  label,
  title,
  children,
}: {
  /** Put on the heading, for the section's aria-labelledby. */
  id: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[640px] text-center">
      <p className="t-bracket">[ {label} ]</p>
      <h2 id={id} className="t-h2 mt-4">
        {title}
      </h2>
      {children ? (
        <p className="text-text-muted mx-auto mt-4 max-w-[48ch] text-balance text-base leading-[1.55]">
          {children}
        </p>
      ) : null}
    </div>
  );
}

/** A landing section: full container width, divided from the one above by a hairline. */
export function LandingSection({
  id,
  labelledBy,
  children,
}: {
  id?: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="container-maren">
      <div className="border-t border-[var(--border-hairline)] py-20 md:py-32">{children}</div>
    </section>
  );
}
