/**
 * Marquee ribbon — a loud black band of honest one-liners scrolling under the
 * hero. Every phrase is a protocol fact, no invented traction. The track is
 * duplicated so the -50% loop is seamless; the second copy is aria-hidden.
 * Motion is paused under prefers-reduced-motion (see landing.css).
 */

const PHRASES = [
  'Spend Bitcoin — never sell it',
  '0.001 BTC floor',
  '1.00% fixed APR',
  'Gasless by design',
  'Pay by @handle',
  'Pre-audit — start small',
  'Built on Mezo',
] as const;

function Row({ hidden = false }: { hidden?: boolean }) {
  return (
    <span className="u-marquee-track" aria-hidden={hidden || undefined}>
      {PHRASES.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-7">
          <span className="text-[15px] font-extrabold uppercase tracking-[0.02em] text-[color:var(--lime)]">
            {p}
          </span>
          <span aria-hidden className="text-[color:var(--card)]">
            ✳
          </span>
        </span>
      ))}
    </span>
  );
}

export function Ribbon() {
  return (
    <div className="u-marquee bg-[color:var(--ink)]">
      <Row />
      <Row hidden />
    </div>
  );
}
