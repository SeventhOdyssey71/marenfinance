# Maren Finance — Brand & Design System

This is the single source of truth for how Maren looks. Every app (web, iOS) and every
document (PDF) follows it. If something isn't specified here, match the spirit: dark,
quiet, expensive, and legible before it is decorative.

---

## 1. Positioning

**Maren Finance — Spend Bitcoin. Never sell it.**

Bitcoin liquidity, gasless spending, and yield, built on Mezo Chain.

Voice: calm, precise, adult. We are handling people's Bitcoin. No hype words, no
"revolutionary", no rocket emoji. Numbers are stated exactly. Risk is stated plainly.

---

## 2. Colour

Dark-first. There is no light mode in the product UI (documents are light — see §7).

### Base
| Token | Hex | Use |
|---|---|---|
| `bg` | `#08080A` | Page background |
| `surface` | `#101013` | Cards, panels |
| `surface-raised` | `#17171B` | Modals, popovers, hovered cards |
| `surface-inset` | `#0C0C0F` | Inputs, wells, code blocks |
| `border` | `rgba(255,255,255,0.08)` | Default 1px hairline |
| `border-strong` | `rgba(255,255,255,0.14)` | Focused / active |

### Brand
| Token | Hex | Use |
|---|---|---|
| `violet-400` | `#8B77FF` | Hover, links on dark |
| `violet-500` | `#5B3DF5` | **Primary brand.** CTAs, active states, mesh gradient core |
| `violet-600` | `#4A2BE0` | Pressed |
| `violet-900` | `#1B1140` | Gradient falloff, tinted backgrounds |

### Semantic
| Token | Hex | Use |
|---|---|---|
| `btc` | `#F7931A` | **Reserved exclusively for BTC-denominated values and the BTC asset mark.** Never decorative. |
| `musd` | `#3ECF8E` | MUSD-denominated values and the MUSD asset mark |
| `success` | `#34D399` | Healthy position, confirmed tx |
| `warning` | `#FBBF24` | CR approaching our warn threshold |
| `danger` | `#F87171` | Liquidation risk, failed tx |

### Text
| Token | Hex | Use |
|---|---|---|
| `text` | `#FAFAFA` | Primary |
| `text-muted` | `#A1A1AA` | Secondary, labels |
| `text-subtle` | `#6B6B75` | Tertiary, timestamps, helper text |

**Rule:** the only saturated colour on a default screen is the violet CTA. Health
colours appear only when they carry meaning. A screen where everything is coloured is
a screen where nothing is important.

**Rule — one accent per component, and asset colours are not decoration.**
`btc` and `musd` colour a figure only when that figure is the single subject of its
component: a balance headline, an asset row in a wallet list. They must **never** be
applied across a row of metrics. An early version of the landing page's example
position card rendered the collateral in BTC orange, the debt in MUSD green, the
collateral ratio in success green, and put a green status pill above all three — four
saturated colours in one small card. It read as decoration rather than information,
which is the tell of machine-generated design. The fix is the rule: in any multi-metric
display the figures are `text`, and only the one element carrying a genuine signal —
the health chip — is coloured.

---

## 3. Typography

- **Display + UI: Satoshi** (Fontshare, free). Geometric grotesque; matches the reference
  design language and is a deliberate nod to Satoshi Nakamoto — worth one line in the deck.
  Self-host via `next/font/local`. Weights: 400, 500, 700, 900.
- **Numerals + addresses: Geist Mono** (npm `geist`). All balances, CRs, APRs, hashes,
  and addresses. Always `font-variant-numeric: tabular-nums` so digits don't jitter as
  values update.
- **Fallback if Satoshi cannot be fetched:** Geist Sans. Do not silently substitute
  Inter — it reads generic and breaks the reference look.

### Scale
| Role | Size / line-height | Weight | Tracking |
|---|---|---|---|
| Display | `clamp(2.75rem, 6vw, 5rem)` / 1.02 | 700 | `-0.03em` |
| H1 | `2.5rem` / 1.1 | 700 | `-0.025em` |
| H2 | `1.875rem` / 1.15 | 700 | `-0.02em` |
| H3 | `1.25rem` / 1.3 | 500 | `-0.01em` |
| Body | `1rem` / 1.6 | 400 | `0` |
| Small | `0.875rem` / 1.5 | 400 | `0` |
| Label | `0.75rem` / 1.4 | 500 | `0.06em`, uppercase |
| Numeric-XL | `3rem` / 1 | 500 mono | `-0.02em` |

Headlines are tight and large. Body text never exceeds `68ch`.

---

## 4. Form

- **Radius:** `8px` inputs · `16px` cards · `999px` buttons and pills. Nothing else.
- **Buttons are pills.** Primary = white fill, near-black text, with a circular violet
  icon badge on the right (see reference). Secondary = `surface-raised` fill, hairline
  border, white text. Both `44px` min height for touch.
- **Cards:** `surface` fill, 1px `border` hairline, `16px` radius, `24px` padding.
  Elevation comes from the hairline and a barely-there inner top highlight
  (`inset 0 1px 0 rgba(255,255,255,0.04)`), never from a heavy drop shadow.
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128. Nothing off-scale.
- **Section rhythm:** `96px` vertical padding mobile, `128px` desktop.
- **Grid:** 12-column, `1200px` max content width, `24px` gutters.

---

## 5. Shaders

We use **`@paper-design/shaders-react`**, and we use it in exactly **three** places.
Restraint is the point — the reference design is 95% black with a few gradient bleeds.

1. **`Warp`** — the hero background and the closing CTA band. A striped base pattern
   folded by noise and swirl, rotated ~38° so the bands run bottom-left to top-right.
   Palette `#08080A → #241268 → #6C4BFF → #B9A6FF`. Slow: `speed <= 0.2`.

   *Not `MeshGradient`.* Mesh blends colour blobs, and on a dark palette it averages
   into a soft haze with no structure — the hero read as a flat dark rectangle however
   the palette was tuned. Warp keeps an edge on each fold, which is what produces the
   silk-like bands and the bright specular highlights. Legibility is protected by the
   scrims over the shader, never by dimming the palette until the shader disappears.
2. **`PulsingBorder`** — on the live position-health card only, and only while a
   position is open. It is a status indicator, not decoration; colour tracks the health
   state (`success` / `warning` / `danger`).
3. **`GrainGradient`** — a single low-opacity texture pass over the CTA band to kill
   gradient banding and add a printed-paper quality.

Verify the exact export names against the installed package before use; do not guess.

**Non-negotiable shader rules**
- Every shader respects `prefers-reduced-motion: reduce` → render a static CSS gradient
  fallback instead.
- Shaders never sit behind body copy at an opacity that drops contrast below 4.5:1.
- Never mount a shader above the fold on the iOS app — use a static gradient there.
- Lazy-mount below-fold shaders with `IntersectionObserver`; pause when off-screen.

---

## 6. Motion

- Durations: `120ms` micro (hover, press) · `240ms` standard (panel, tab) · `480ms`
  entrance. Easing `cubic-bezier(0.22, 1, 0.36, 1)` for entrances, `ease-out` otherwise.
- Numbers that change value animate by **counting**, not fading.
- Entrance animations fire once, on first view. Nothing re-animates on scroll-back.
- All motion is disabled under `prefers-reduced-motion: reduce`.

---

## 7. Documents (PDF)

Documents invert: **light background, dark text**, because they get printed and read in
daylight, and because a grant committee should not have to fight a black PDF.

- Page: A4, `20mm` margins, `#FFFFFF`.
- Text `#111114`, muted `#5A5A66`, hairlines `#E6E6EC`.
- Violet `#5B3DF5` for headings, rules, and the cover block only.
- Cover: full-bleed violet-to-near-black gradient with the wordmark.
- Same type pairing (Satoshi / Geist Mono).
- Every page carries a footer: `Maren Finance · <Doc title> · <page>/<total>`.
- Tables: no vertical rules, `1px` horizontal hairlines only, numeric columns right-aligned in mono.

---

## 8. Writing numbers

This is a financial product; number formatting is part of the design.

- BTC: 6 decimals max, trailing zeros trimmed, `₿` never used — write `BTC`.
- MUSD: 2 decimals, thousands separated.
- Percentages: 2 decimals for rates (`1.00% APR`), 1 decimal for ratios (`225.9%`).
- Always show the unit. Never a bare number.
- Never round a number *up* in a way that flatters a position's safety. Health figures
  round toward the conservative side.
- Show exact values on hover/long-press for any abbreviated figure.
