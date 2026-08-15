/**
 * Maren design tokens — a literal transcription of docs/BRAND.md §2, §4 and §6.
 *
 * Nothing in this file is invented. If a value is not in BRAND.md it does not belong
 * here. The one adaptation for iOS is §5: BRAND.md forbids mounting a shader above the
 * fold on the iOS app, so `gradients` below are static colour ramps fed to
 * expo-linear-gradient rather than @paper-design/shaders-react.
 */

/** §2 Base */
export const base = {
  bg: '#08080A',
  surface: '#101013',
  surfaceRaised: '#17171B',
  surfaceInset: '#0C0C0F',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
} as const;

/** §2 Brand. Violet is the ONLY saturated colour on a default screen. */
export const brand = {
  violet400: '#8B77FF',
  violet500: '#5B3DF5',
  violet600: '#4A2BE0',
  violet900: '#1B1140',
} as const;

/**
 * §2 Semantic.
 *
 * `btc` is reserved exclusively for BTC-denominated values and the BTC asset mark.
 * `musd` is for MUSD-denominated values and the MUSD asset mark.
 * Neither is ever decorative. Health colours appear only when they carry meaning.
 */
export const semantic = {
  btc: '#F7931A',
  musd: '#3ECF8E',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
} as const;

/** §2 Text */
export const text = {
  primary: '#FAFAFA',
  muted: '#A1A1AA',
  subtle: '#6B6B75',
} as const;

export const colors = {
  ...base,
  ...brand,
  ...semantic,
  text: text.primary,
  textMuted: text.muted,
  textSubtle: text.subtle,
} as const;

/** §4 Spacing scale. Nothing off-scale — there is no `space[5]`. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
  section: 96,
} as const;

/** §4 Radius. Exactly three values exist. */
export const radius = {
  input: 8,
  card: 16,
  pill: 999,
} as const;

/** §4 — 44px minimum height for touch, on every interactive element. */
export const hit = {
  min: 44,
} as const;

/**
 * §4 Cards: elevation comes from the hairline and a barely-there inner top highlight,
 * never from a heavy drop shadow. React Native has no `inset` box-shadow, so the
 * highlight is drawn as an absolutely positioned 1px view — see components/Card.tsx.
 */
export const cardHighlight = 'rgba(255,255,255,0.04)';

/** §6 Motion. All of it is disabled under reduce-motion; see hooks/useReducedMotion.ts */
export const motion = {
  micro: 120,
  standard: 240,
  entrance: 480,
  /** cubic-bezier(0.22, 1, 0.36, 1) */
  entranceEasing: [0.22, 1, 0.36, 1] as const,
} as const;

/**
 * §5, adapted for iOS: static CSS-equivalent gradients. No shaders on mobile.
 *
 * The violet core falls off into the page background through the violet-900 mid,
 * which is exactly the MeshGradient ramp the web app renders.
 *
 * On the alphas: these started at 0.28–0.34 and read, on a real device, as a saturated
 * purple slab occupying the top quarter of the screen — closer to a crypto dashboard
 * than to §5's stated reference, "95% black with a few gradient bleeds". They are now
 * a bleed: present enough to lift the header off the page, faint enough that the
 * screen still reads as near-black.
 */
export const gradients = {
  /** Hero wash behind the portfolio header. Violet core → violet-900 mid → bg. */
  hero: ['rgba(91,61,245,0.15)', 'rgba(27,17,64,0.16)', 'rgba(8,8,10,0)'] as const,
  /** The closing CTA band on onboarding. */
  ctaBand: ['rgba(91,61,245,0.18)', 'rgba(27,17,64,0.12)', 'rgba(8,8,10,0)'] as const,
  /** Neutral card sheen used on the balance hero card only. */
  cardSheen: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)'] as const,
} as const;

export type HealthTone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * Map the SDK's HealthStatus onto BRAND.md §2 semantic colours.
 *
 * `caution` deliberately renders neutral, not yellow. A position between 180% and 250%
 * is doing exactly what it is supposed to do, and colouring it would break the §2 rule
 * that health colours appear only when they carry meaning.
 */
export const healthTone: Record<string, HealthTone> = {
  none: 'neutral',
  healthy: 'success',
  caution: 'neutral',
  warning: 'warning',
  danger: 'danger',
  liquidatable: 'danger',
};

export const toneColor: Record<HealthTone, string> = {
  neutral: text.muted,
  success: semantic.success,
  warning: semantic.warning,
  danger: semantic.danger,
};

/**
 * The colour for a LARGE health figure — the hero collateral ratio and the scale fill.
 *
 * This is deliberately not `toneColor`. BRAND.md §2: "the only saturated colour on a
 * default screen is the violet CTA… A screen where everything is coloured is a screen
 * where nothing is important."
 *
 * A healthy position is the default state. Rendering it as a 44px green numeral above a
 * full green bar spends the screen's entire colour budget saying "nothing is wrong",
 * which leaves nothing louder available for when something is. So at hero scale, green
 * and neutral both render as plain text, and colour appears only once the position
 * actually needs attention.
 *
 * The small status pill still uses `toneColor`, so the success green is present — it is
 * simply proportionate to what it is telling you.
 */
export const healthHeroColor: Record<HealthTone, string> = {
  neutral: text.primary,
  success: text.primary,
  warning: semantic.warning,
  danger: semantic.danger,
};

/** Track fill for the CR scale. Quiet until it matters, for the same reason. */
export const healthFillColor: Record<HealthTone, string> = {
  neutral: 'rgba(255,255,255,0.22)',
  success: 'rgba(255,255,255,0.28)',
  warning: semantic.warning,
  danger: semantic.danger,
};

/** Human-readable status labels. Calm, precise, adult — §1 voice. */
export const healthLabel: Record<string, string> = {
  none: 'No debt',
  healthy: 'Healthy',
  caution: 'Adequate',
  warning: 'Low collateral',
  danger: 'At risk',
  liquidatable: 'Liquidatable',
};
