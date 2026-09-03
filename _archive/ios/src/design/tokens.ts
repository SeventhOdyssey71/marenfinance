/**
 * Maren design tokens — the consumer-light app palette.
 *
 * The product UI moved from dark to light. `apps/web/src/app/globals.css`
 * `[data-app-theme='light']` is the authoritative set, and everything in `base`, `brand`
 * and `text` below is a literal transcription of it. BRAND.md §2's dark values still
 * describe the marketing site, which did not move.
 *
 * Two adaptations are iOS-only and both are documented where they appear:
 *
 *   1. §5 forbids mounting a shader above the fold on the iOS app, so `gradients` are
 *      static colour ramps fed to expo-linear-gradient rather than a MeshGradient.
 *   2. On light, a card is a white surface with a soft drop rather than a hairline —
 *      see components/Card.tsx, which mirrors the web `.card` rule exactly.
 */

/**
 * §2 Base — the soft UGLYCASH surface set. Canvas is a plain neutral grey; cards are
 * pure white and float on a soft drop with no hairline; the inset is a soft neutral grey.
 *
 * The theme moved off the violet-tinted light set onto the clean, calm UGLYCASH look:
 * a #F2F2F2 cream-grey canvas under borderless white cards. `surfaceInset` is the same
 * soft grey the quiet pill uses (#ECECEF), so a recessed panel, a segmented track and a
 * quiet action all read as one material.
 */
export const base = {
  bg: '#F2F2F2',
  surface: '#FFFFFF',
  /**
   * Kept as its own token because the iOS app uses it for the selected segment of a
   * control sitting on `surfaceInset`, where white-on-grey is exactly the affordance we
   * want.
   */
  surfaceRaised: '#FFFFFF',
  surfaceInset: '#ECECEF',
  border: 'rgba(16,16,19,0.07)',
  borderStrong: 'rgba(16,16,19,0.14)',
  /**
   * Text and glyphs that sit ON a saturated fill — the white glyph in the pink accent
   * badge, the label of the pink primary pill. Not a surface.
   */
  onAccent: '#FFFFFF',
} as const;

/**
 * §2 Brand — the one glowing accent. Pink is the ONLY saturated colour on a default
 * screen.
 *
 * The brand accent moved from violet to UGLYCASH pink (#FA00FF): the pink primary pill,
 * the accent badge, the active tab, the ambient top glow. The token names are kept
 * (`violet*`) so every call site cascades on the value change alone — the values are
 * pink. `violet600` is the pressed/darker pink; `violet900` is the palest pink, the end
 * of a wash that falls off into the page and the fill of a soft accent chip.
 */
export const brand = {
  violet400: '#FA00FF',
  violet500: '#FA00FF',
  violet600: '#C400C9',
  violet900: '#FCE3FF',
} as const;

/**
 * §2 Semantic — the web light values, verbatim.
 *
 * These are the FILL colours: status dots, bar fills, hairlines, icon glyphs, large
 * figures. Every one of those needs 3:1 (WCAG 1.4.11 non-text / 1.4.3 large text) and
 * every one of them clears it.
 *
 * `btc` is the one value the web light block does not define, so it is still emitting
 * #F7931A onto a #F7F6FB page at 2.14:1. That is a web bug, not a palette decision, and
 * it is not reproduced here: BTC orange is darkened by the same amount the other four
 * were. `btc` stays reserved exclusively for BTC-denominated values and the BTC asset
 * mark, `musd` for MUSD; neither is ever decorative.
 */
export const semantic = {
  btc: '#A85E00',
  musd: '#0D9E70',
  success: '#0F9D6A',
  warning: '#B45309',
  danger: '#DC2626',
} as const;

/**
 * The same five semantics, pushed until they clear 4.5:1 on all three light surfaces.
 *
 * This split is the light theme's one real cost. On near-black, a saturated status
 * colour was simultaneously a good fill and a legible 13px label — #3ECF8E was 9.5:1.
 * On white the two jobs separate: #0D9E70 is a fine dot at 3.42:1 and an illegible unit
 * mark at the same ratio. So fills keep the web hex, and anything that renders as TEXT
 * below 24px takes the value from here.
 *
 *   btc      #9A5300   5.41 / 5.82 / 5.02
 *   musd     #09754F   5.32 / 5.72 / 4.94
 *   success  #08704B   5.71 / 6.14 / 5.29
 *   warning  #A34A08   5.52 / 5.93 / 5.12
 *   danger   #C81E1E   5.34 / 5.74 / 4.95
 *
 * (bg #F2F2F2 / surface #FFFFFF / inset #ECECEF; the surfaces only got marginally
 * lighter/darker, so each still clears 4.5:1 with room.)
 */
export const semanticText = {
  btc: '#9A5300',
  musd: '#09754F',
  success: '#08704B',
  warning: '#A34A08',
  danger: '#C81E1E',
} as const;

/**
 * §2 Text.
 *
 * `subtle` is #82828C — the web light value — and it is 3.54 / 3.80 / 3.28 on the three
 * surfaces. That clears 3:1 for ornament and for text at 24px and above, and it does not
 * clear 4.5:1 for anything smaller. It is therefore not used for informational copy
 * anywhere in this app; see components/Text.tsx for the rule and the two places it is
 * still legitimately used.
 */
export const text = {
  primary: '#101013',
  muted: '#6E6E6E',
  /**
   * The greyed trailing decimals of a hero balance (#9A9AA2) — the UGLYCASH numeral
   * treatment — and quiet graphical ornament (a disclosure chevron, a disabled badge).
   * At ≥24px large text it clears 3:1; it is never used for informational copy below
   * that size, which takes `muted`.
   */
  subtle: '#9A9AA2',
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

/** §4 Radius. Cards are softened toward the rounder UGLYCASH card (~20). */
export const radius = {
  input: 10,
  card: 20,
  pill: 999,
} as const;

/** §4 — 44px minimum height for touch, on every interactive element. */
export const hit = {
  min: 44,
} as const;

/**
 * §4 Cards, light: "the card IS a white surface with a soft drop, which is the whole
 * consumer feel in one rule."
 *
 * The web rule is two stacked shadows:
 *
 *     0 1px 2px rgba(23,20,41,0.05), 0 8px 24px -12px rgba(23,20,41,0.14)
 *
 * React Native takes one shadow per view, so this is the visually equivalent single
 * drop — the tight contact shadow is folded into the offset and the ambient one sets
 * the radius. The inner top highlight the dark theme used is gone entirely: on white it
 * would be invisible, and the elevation now comes from the drop.
 */
export const cardShadow = {
  shadowColor: '#101013',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.07,
  shadowRadius: 20,
  /** Android parity; harmless on iOS. */
  elevation: 3,
} as const;

/** The modal variant — heavier, because a sheet sits above the whole page. */
export const modalShadow = {
  shadowColor: '#171429',
  shadowOffset: { width: 0, height: -8 },
  shadowOpacity: 0.18,
  shadowRadius: 32,
  elevation: 16,
} as const;

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
 * On dark these were a violet bleed lifting the header off a near-black page. On light
 * the same alphas are a lilac slab — the first build of this theme put a visibly purple
 * band across the top quarter of every screen, which is the opposite of the reference.
 * The web app shell runs no wash at all on light. These are what is left after taking
 * that seriously: a tint you notice only if you look for it, present so that a phone
 * screen of white cards on off-white has somewhere to start.
 */
export const gradients = {
  /** The subtle ambient glow behind the top of the page. Pink core → pale pink → canvas. */
  hero: ['rgba(250,0,255,0.05)', 'rgba(252,227,255,0.20)', 'rgba(242,242,242,0)'] as const,
  /** The closing CTA band on onboarding. */
  ctaBand: ['rgba(250,0,255,0.06)', 'rgba(252,227,255,0.16)', 'rgba(242,242,242,0)'] as const,
  /** Neutral card sheen used on the balance hero card only. */
  cardSheen: ['rgba(250,0,255,0.04)', 'rgba(255,255,255,0)'] as const,
} as const;

export type HealthTone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * Map the SDK's HealthStatus onto the §2 semantic colours.
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

/**
 * The colour of the small status pill beside a position.
 *
 * Text values, not fills — the pill is a 12px label, so these come from `semanticText`.
 */
export const toneColor: Record<HealthTone, string> = {
  neutral: text.muted,
  success: semanticText.success,
  warning: semanticText.warning,
  danger: semanticText.danger,
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
 * At 44px these are large text, so the fill values are legible here and are used.
 */
export const healthHeroColor: Record<HealthTone, string> = {
  neutral: text.primary,
  success: text.primary,
  warning: semantic.warning,
  danger: semantic.danger,
};

/** Track fill for the CR scale. Quiet until it matters, for the same reason. */
export const healthFillColor: Record<HealthTone, string> = {
  neutral: 'rgba(20,18,35,0.22)',
  success: 'rgba(20,18,35,0.28)',
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
