/**
 * Maren wordmark. The mark is a geometric "M" whose right leg carries the
 * single violet accent — the only saturated colour allowed at rest.
 * Drawn as SVG so it is crisp before Satoshi loads and never shifts layout.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 112 20"
      className={className}
      role="img"
      aria-label="Maren Finance"
      fill="none"
    >
      {/* Mark */}
      <path
        d="M2 18V4.6c0-.5.62-.74.95-.36L9.1 11.2a1 1 0 0 0 1.5 0l6.15-6.96c.33-.38.95-.14.95.36V18"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path d="M17.7 18V9.8" stroke="#5B3DF5" strokeWidth="2.6" strokeLinecap="round" />
      {/* Wordmark */}
      <text
        x="30"
        y="15.4"
        fill="currentColor"
        fontFamily="var(--font-satoshi), system-ui, sans-serif"
        fontSize="16.5"
        fontWeight="700"
        letterSpacing="-0.55"
      >
        Maren
      </text>
    </svg>
  );
}
