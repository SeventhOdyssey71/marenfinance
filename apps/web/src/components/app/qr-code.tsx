'use client';

import { QRCodeSVG } from 'qrcode.react';

/** Error-correction level, mirroring the `qrcode.react` prop. */
export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * A QR code for a payment target.
 *
 * The encoder is `qrcode.react`, not a hand-rolled one: a payments QR that is subtly wrong
 * scans to the wrong address, which is the same class of failure as a read that returns a
 * plausible-but-false value — so it goes through a maintained, tested codec rather than
 * bespoke bit-placement. The string it encodes is passed in from live handle/address reads,
 * never synthesised here.
 *
 * A scanner needs dark modules on a light field with a quiet border regardless of the app's
 * theme, so this always paints near-black on white inside its own light card. `size` is a
 * base for the intrinsic SVG; the `w-full` class scales it responsively while the viewBox
 * keeps it crisp.
 */
export function QrCode({
  value,
  level = 'M',
  className = '',
  title,
}: {
  value: string;
  level?: EccLevel;
  /** Describes what scanning this does, e.g. "Payment QR for @sele". */
  title: string;
  className?: string;
}) {
  return (
    <QRCodeSVG
      value={value}
      level={level}
      size={256}
      marginSize={4}
      bgColor="#ffffff"
      fgColor="#0a0a0c"
      role="img"
      aria-label={title}
      className={`h-auto w-full max-w-full ${className}`}
    />
  );
}
