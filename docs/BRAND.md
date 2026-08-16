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

| Token            | Hex                      | Use                             |
| ---------------- | ------------------------ | ------------------------------- |
| `bg`             | `#08080A`                | Page background                 |
| `surface`        | `#101013`                | Cards, panels                   |
| `surface-raised` | `#17171B`                | Modals, popovers, hovered cards |
| `surface-inset`  | `#0C0C0F`                | Inputs, wells, code blocks      |
| `border`         | `rgba(255,255,255,0.08)` | Default 1px hairline            |
| `border-strong`  | `rgba(255,255,255,0.14)` | Focused / active                |

### Brand

| Token        | Hex       | Use                                                        |
| ------------ | --------- | ---------------------------------------------------------- |
| `violet-400` | `#8B77FF` | Hover, links on dark                                       |
| `violet-500` | `#5B3DF5` | **Primary brand.** CTAs, active states, mesh gradient core |
| `violet-600` | `#4A2BE0` | Pressed                                                    |
| `violet-900` | `#1B1140` | Gradient falloff, tinted backgrounds                       |

### Semantic

| Token     | Hex       | Use                                                                                           |
| --------- | --------- | --------------------------------------------------------------------------------------------- |
| `btc`     | `#F7931A` | **Reserved exclusively for BTC-denominated values and the BTC asset mark.** Never decorative. |
| `musd`    | `#3ECF8E` | MUSD-denominated values and the MUSD asset mark                                               |
| `success` | `#34D399` | Healthy position, confirmed tx                                                                |
| `warning` | `#FBBF24` | CR approaching our warn threshold                                                             |
| `danger`  | `#F87171` | Liquidation risk, failed tx                                                                   |

### Text

| Token         | Hex       | Use                               |
| ------------- | --------- | --------------------------------- |
| `text`        | `#FAFAFA` | Primary                           |
| `text-muted`  | `#A1A1AA` | Secondary, labels                 |
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

| Role       | Size / line-height                 | Weight   | Tracking            |
| ---------- | ---------------------------------- | -------- | ------------------- |
| Display    | `clamp(2.75rem, 6vw, 5rem)` / 1.02 | 700      | `-0.03em`           |
| H1         | `2.5rem` / 1.1                     | 700      | `-0.025em`          |
| H2         | `1.875rem` / 1.15                  | 700      | `-0.02em`           |
| H3         | `1.25rem` / 1.3                    | 500      | `-0.01em`           |
| Body       | `1rem` / 1.6                       | 400      | `0`                 |
| Small      | `0.875rem` / 1.5                   | 400      | `0`                 |
| Label      | `0.75rem` / 1.4                    | 500      | `0.06em`, uppercase |
| Numeric-XL | `3rem` / 1                         | 500 mono | `-0.02em`           |

Headlines are tight and large. Body text never exceeds `68ch`.

---

## 4. Form

- **Radius:** `8px` inputs · `12px` cards · `999px` buttons and pills. Nothing else.
- **Buttons are pills.** Primary = white fill, near-black text, with a circular violet
  icon badge on the right (see reference). Secondary = `surface-raised` fill, hairline
  border, white text. Both `44px` min height for touch.
- **Cards: a hairline on the page background. No fill.** 1px `border` hairline, `12px`
  radius, `24px` padding, and nothing else — no `surface` fill, no inner top highlight,
  no drop shadow. The border is the entire elevation.

  _This is a change._ Cards were `surface` fill plus `inset 0 1px 0 rgba(255,255,255,0.04)`
  at a `16px` radius. Against a near-black page a filled panel reads as a lighter box
  floating over the page rather than as a region of it, and at `16px` the corners were soft
  enough to read as consumer-app rather than instrument. The reference is a hairline and
  nothing else.

- **When a fill is allowed.** Only where a surface must genuinely separate from the page,
  and each case is one of these three:
  - **Modals** — `.card-modal`, `surface-raised` fill and a `border-strong` hairline. A
    dialog sits over the page; transparent, it would show the page through itself.
  - **Popovers** — `surface-raised`. Same reason: they float.
  - **Inset wells** — `surface-inset` for inputs, tab tracks, sliders, disclosure notes and
    code. `surface-inset` is _darker_ than the page, so it recesses rather than floats,
    which is the opposite failure and is fine.

  Controls (buttons, active tabs, active nav pills) may carry a fill because a control
  needs a hit surface. A decorative disc inside a card may not — it is the same floating
  lighter box at a smaller scale.
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128. Nothing off-scale.
- **Section rhythm:** `96px` vertical padding mobile, `128px` desktop.
- **Grid:** 12-column, `1200px` max content width, `24px` gutters.

### Iconography

**HugeIcons** (`@hugeicons/react` + `@hugeicons/core-free-icons`), drawn through one
wrapper module — `apps/web/src/components/ui/icons.tsx`. Nothing imports the icon package
directly; call sites import named components from the wrapper, so weight, colour and
sizing are decided once. The previous set was hand-rolled SVG: consistent at three icons,
not at fourteen, and with no vocabulary left for a denser dApp.

- **Stroke is 1.5 device pixels at every size**, enforced with
  `vector-effect: non-scaling-stroke`. HugeIcons draws on a 24-unit grid at
  `stroke-width: 1.5`, which thins to 0.75–1.25px at the 12–20px sizes this app actually
  uses; taking the stroke out of the viewBox transform keeps the line work at the weight
  the rest of the page is drawn at.
- **Size comes from a Tailwind `size-*` class**, never from the `size` prop. CSS beats the
  SVG width/height attributes, so alignment is unaffected by the icon set.
- **An icon means what it labels.** A vault icon for the Vault (`BitcoinSafeIcon` — a safe
  holding Bitcoin, which is what `MarenVault` is), money leaving for Pay, a rising line for
  Earn. Not a generic square. Where the copy makes a promise the icon must not contradict
  it: Earn is a rising line and never a piggy bank, because the screen's own disclosure
  says it is not a savings account.
- **Colour is `currentColor`.** No icon carries its own fill.

---

## 5. Shaders

We use **`@paper-design/shaders-react`**, and we use it in exactly **three** places.
Restraint is the point — the reference design is 95% black with a few gradient bleeds.

1. **`Warp`** — the hero background and the closing CTA band. A striped base pattern
   folded by noise and swirl, rotated ~38° so the bands run bottom-left to top-right.
   Palette `#08080A → #241268 → #6C4BFF → #B9A6FF`. Hero `speed 0.9`, CTA band `0.6`, hard-capped at `1.2`.

   _Not `MeshGradient`._ Mesh blends colour blobs, and on a dark palette it averages
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

- Shader speed is capped at `1.2`, not `0.2` as originally written — at `0.14` the silk was
  visually static and read as a still image rather than a moving surface.
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

### 7.1 The deck is the exception: it stays dark

`docs/src/deck.md` builds to `docs/build/deck.pdf` and **does not invert**. It keeps the
product palette: `bg` ground, violet accent, `text` on near-black.

The rule in §7 is not "documents are light". It is **match the surface the thing is read
on**. The seven papers are light because they get printed and read in daylight, and a
committee should not have to fight a black PDF. The deck is never printed. It is
projected, in a room with the lights down, where a light ground is a wall of glare behind
the speaker and every slide bleaches out the presenter. Same rule, opposite answer.

Everything else about the deck follows the brand unchanged: Satoshi display, **Geist Mono
with tabular figures for every numeral**, violet as the only saturated colour, the same
grain pass and accent rule as the document cover.

| | Papers | Deck |
| --- | --- | --- |
| Page | A4 portrait, `20mm` margins | 16:9 landscape, `1280x720` |
| Ground | `#FFFFFF` | `#08080A` |
| Text | `#111114` | `#FAFAFA` |
| Read at | Arm's length, on paper | Six feet away, projected |
| Smallest type carrying meaning | 9pt | 20px |

Two constraints follow from projection rather than from the palette:

- **Nothing carrying meaning is set below 20px.** The type scale is decided by the back
  of the room, not by the grid.
- **`text-subtle` (`#6B6B75`) is not used for words.** It fails WCAG AA on dark, which is
  survivable on a phone held at arm's length and is not survivable on a projector.
  `text-muted` (`#A1A1AA`) is the floor for anything anyone has to read.

---

## 8. Writing numbers

This is a financial product; number formatting is part of the design.

- BTC: 6 decimals max, trailing zeros trimmed, `₿` never used — write `BTC`.
- MUSD: 2 decimals, thousands separated.
- Percentages: 2 decimals for rates (`1.00% APR`), 1 decimal for ratios (`225.9%`).
- Always show the unit. Never a bare number.
- Never round a number _up_ in a way that flatters a position's safety. Health figures
  round toward the conservative side.
- Show exact values on hover/long-press for any abbreviated figure.
