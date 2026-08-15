import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function ArrowUpRight(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M5 11 11 5" />
      <path d="M6 5h5v5" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowDown(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M8 3v10" />
      <path d="M4 9l4 4 4-4" />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function Minus(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" {...base} {...props}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

/** Vault — a shield holding a coin edge. */
export function VaultIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3 4.5 6v5.4c0 4.4 3 8 7.5 9.6 4.5-1.6 7.5-5.2 7.5-9.6V6L12 3Z" />
      <circle cx="12" cy="11.5" r="3" />
      <path d="M12 8.5v6" />
    </svg>
  );
}

/** Pay — a message bubble with an arrow leaving it. */
export function PayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M20.5 12.2c0 3.8-3.8 6.9-8.5 6.9-1 0-2-.15-2.9-.4L4 20.5l1.5-3.6C4.2 15.6 3.5 14 3.5 12.2c0-3.8 3.8-6.9 8.5-6.9s8.5 3.1 8.5 6.9Z" />
      <path d="M9 12.2h6" />
      <path d="M12.8 10l2.2 2.2-2.2 2.2" />
    </svg>
  );
}

/** Earn — a rising step line. */
export function EarnIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M3.5 19.5h17" />
      <path d="M4 15.5l4.6-4.6 3.2 3.2 6.4-6.4" />
      <path d="M14.6 7.7h3.6v3.6" />
    </svg>
  );
}

/** Portfolio — stacked ledger rows. */
export function PortfolioIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 14h4.5" />
      <path d="M8 17h8" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3 4.5 6v5.4c0 4.4 3 8 7.5 9.6 4.5-1.6 7.5-5.2 7.5-9.6V6L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M13.2 3 5.5 13.4h5.1L10.2 21l7.7-10.4h-5.1L13.2 3Z" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 1 0-5.1-5.1l-1.4 1.4" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 1 0 5.1 5.1l1.4-1.4" />
    </svg>
  );
}

export function XLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d="M17.53 3h3.02l-6.6 7.54L21.75 21h-5.9l-4.62-6.04L5.94 21H2.92l7.06-8.07L2.4 3h6.05l4.18 5.52L17.53 3Zm-1.06 16.2h1.67L7.6 4.71H5.81l10.66 14.49Z" />
    </svg>
  );
}

export function GitHubLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5.01 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}
