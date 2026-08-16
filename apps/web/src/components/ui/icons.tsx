import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Add01Icon,
  Analytics01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  BitcoinSafeIcon,
  ChartIncreaseIcon,
  FlashIcon,
  GithubIcon,
  InformationCircleIcon,
  Link01Icon,
  MinusSignIcon,
  MoneySend01Icon,
  NewTwitterIcon,
  Shield01Icon,
} from '@hugeicons/core-free-icons';
import type { SVGProps } from 'react';

/**
 * Every icon in the web app, from one place.
 *
 * The set is HugeIcons (`@hugeicons/core-free-icons`), drawn through this module so that
 * stroke weight, colour and sizing are decided once rather than at seventeen call sites.
 * The previous set was hand-rolled SVG: fine at three icons, inconsistent at fourteen, and
 * with no vocabulary left for the denser dApp.
 *
 * TWO THINGS ARE FIXED HERE ON PURPOSE.
 *
 * STROKE. HugeIcons ships on a 24-unit grid at `stroke-width: 1.5`, which renders at 1.5
 * device pixels only when the icon is drawn at 24px. Every icon in this app is drawn
 * smaller — 12, 16, 18, 20 — where the same declaration thins to 0.75–1.25px and the page
 * loses the texture the hand-rolled set had. `vector-effect: non-scaling-stroke` takes the
 * stroke out of the viewBox transform, so 1.5 means 1.5 device pixels at every size, which
 * is the weight BRAND.md's line work has always been.
 *
 * SIZE. Call sites size icons with a Tailwind `size-*` class, as they always did. CSS beats
 * the width/height attributes, so nothing about alignment or line box changes with the swap.
 */

/**
 * `strokeWidth` is omitted deliberately: SVG's own attribute type allows a string, this
 * module fixes the value at 1.5 for the whole app, and letting a call site override it is
 * exactly how a set of icons stops looking like one set.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'strokeWidth' | 'ref'>;

/** Constant optical stroke, independent of the size the icon is drawn at. */
const HAIRLINE = '[&_*]:[vector-effect:non-scaling-stroke]';

function icon(glyph: IconSvgElement, displayName: string) {
  const Component = ({ className = '', ...props }: IconProps) => (
    <HugeiconsIcon
      icon={glyph}
      strokeWidth={1.5}
      className={`${HAIRLINE} ${className}`}
      aria-hidden
      focusable={false}
      {...props}
    />
  );
  Component.displayName = displayName;
  return Component;
}

// ── Direction ────────────────────────────────────────────────────────────────

export const ArrowUpRight = icon(ArrowUpRight01Icon, 'ArrowUpRight');
export const ArrowRight = icon(ArrowRight01Icon, 'ArrowRight');
export const ArrowDown = icon(ArrowDown01Icon, 'ArrowDown');
export const Plus = icon(Add01Icon, 'Plus');
export const Minus = icon(MinusSignIcon, 'Minus');

// ── Product surfaces ─────────────────────────────────────────────────────────

/** Vault — a safe holding Bitcoin, which is literally what MarenVault is. */
export const VaultIcon = icon(BitcoinSafeIcon, 'VaultIcon');

/** Pay — money leaving, the one direction this surface moves it. */
export const PayIcon = icon(MoneySend01Icon, 'PayIcon');

/**
 * Earn — a rising line, matching the hand-rolled step line it replaces.
 * Deliberately not a piggy bank or a savings jar: the screen's own disclosure says this
 * is not a savings account, and the icon should not argue with the copy.
 */
export const EarnIcon = icon(ChartIncreaseIcon, 'EarnIcon');

/** Portfolio — the position overview, not a wallet and not a generic square. */
export const PortfolioIcon = icon(Analytics01Icon, 'PortfolioIcon');

// ── Supporting ───────────────────────────────────────────────────────────────

export const ShieldIcon = icon(Shield01Icon, 'ShieldIcon');
export const BoltIcon = icon(FlashIcon, 'BoltIcon');
export const LinkIcon = icon(Link01Icon, 'LinkIcon');
export const InfoIcon = icon(InformationCircleIcon, 'InfoIcon');

// ── Wordmarks ────────────────────────────────────────────────────────────────
//
// Brand marks, not iconography. They are filled glyphs owned by X and GitHub, they must
// not be restyled, and HugeIcons carries both — so they come from the same module as
// everything else rather than staying hand-copied.

export const XLogo = icon(NewTwitterIcon, 'XLogo');
export const GitHubLogo = icon(GithubIcon, 'GitHubLogo');
