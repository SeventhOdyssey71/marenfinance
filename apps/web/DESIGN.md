# Maren web: the UI system

One light system on every surface, one typeface, one accent, and no rounded corners.
The reference is the Nuntio dashboard: flat, square, drawn in hairlines, with small
"+" registration ticks at card corners and bracketed mono section labels. If a screen
needs an idea that is not here, it probably does not need it.

## The look in one breath

Light grey page, white square cards with a 1px hairline and corner ticks, a grey rail on
the left, a breadcrumb top bar, one centred column. Headlines in Neue Montreal 500,
often centred. Section labels like `[ RECENT ]` in Geist Mono capitals. One violet
action per view; inline actions are violet text links. No shadows, no glows, no pills.

## Type: Neue Montreal, and nothing else

- Inherited from `body`. Never set `font-family` in a component.
- Two weights: **400** to read, **500** to lead. No bold, no light below 48px.
- Scale (classes in `globals.css`):
  - `.t-display`: hero only, 44 to 84px, 500, -0.045em
  - `.t-h1`: screen titles, 30 to 40px
  - `.t-h2`: section leads on marketing pages, 24 to 30px
  - `.t-h3`: card titles, 18px
  - body: 15px (`text-[0.9375rem]`) in the app, 16 to 18px on the landing
  - small: 13px (`text-[0.8125rem]`); captions 12px (`text-xs`), never smaller
- `.t-bracket` is the **section label**: Geist Mono, 12px, capitals, tracked, muted.
  Write the brackets in the text: `[ Recent ]`. `SectionHeader` and `Panel` add them for you.
- `.t-label` is a quiet sentence-case **field** label (13px, muted).
- Amounts: `.num` (Neue Montreal, tight tracking). Greyed decimals stay greyed.
- Mono is for `.t-bracket` labels and machine strings (addresses, hashes, block numbers,
  env names, `.mono`). Never for prose or amounts.
- Neue Montreal has no tabular figures. Do not add `tabular-nums` expecting it to work.
- Headings get `text-wrap: balance` (built into the classes); descriptions `text-pretty`.

## Colour (Tailwind token classes; no new hex in components)

| Role | Class |
| --- | --- |
| Page (landing, docs) | `bg-bg` (white) |
| App working field | `bg-canvas` (#f9f9fb), set by the shell |
| App rail | `bg-rail` (#f4f4f6) |
| Card | `.card` (white, square, hairline, corner ticks; `.ticks` adds ticks to anything) |
| Well, input, quiet button | `bg-surface-inset` |
| Ink fill (dark band, Google button) | `bg-ink` |
| Text | `text-text`, `text-text-muted`, `text-text-subtle` (decimals/placeholders only) |
| Accent | `bg-violet-500` fill, `text-violet-400` text, `bg-violet-900` wash |
| Meaning | `text-success`, `text-warning`, `text-danger`, `text-btc`, `text-musd`, money-in/out |
| Hairline | `border-[var(--border-hairline)]` |

Violet means "this is the action" or "this is the current place". One violet thing per
view is the default. Status never relies on colour alone: pair it with a word or a sign.

## Shape and space

- **Square.** Cards, inputs, buttons, tabs, nav rows, images, sheets: radius 0. Only true
  circles (status dots, avatars, spinners) are round. Never `rounded-*` on a box.
- **Flat.** No shadows on cards or buttons. A sheet over a scrim may carry `--shadow-pop`.
- Separation is a 1px hairline (`border-[var(--border-hairline)]`); `--border-strong` for
  an input or a secondary button edge.
- Card padding: 20 on mobile, 24 at md+. Gap between cards: 16. Between groups: 40 or more.
- The app content is **one centred column, max 880px** (the shell sets it). Stack
  sections; use 2 or 3 columns only inside a section for small stats. Flows (send,
  borrow, deposit) are narrower, ~520px, centred.
- A screen opens with `PageHeader`; the home screen uses `align="center"` for a greeting
  with a one-line summary and inline violet links under it.
- Empty states are one quiet sentence in a hairline box ("Nothing yet. Payments and
  requests show up here."), not an illustration.
- Mobile is one column; the shell adds bottom padding for the tab bar.

## Components (use these; do not fork their paint)

- `PageHeader` (`components/app/primitives`): every app screen starts with it.
  `title` + optional `eyebrow` (rendered as a bracket label), `description`, `actions`,
  `align` (`left` default, `center` for a greeting).
- `SectionHeader`: the `[ LABEL ]` above a group, with an optional violet text action
  ("View all").
- `AppCard`, `Panel`, `PanelBody`, `MetricStrip`, `Metric`, `StatRow`, `Note`, `EmptyState`,
  `Skeleton`, `Loading`, `Refreshing`: in `primitives.tsx`.
- `PillButton` (link) / `PillAction` (button) / `ActionButton` / `ActionLink` (the names are
  historical; they are square blocks now): `primary` (solid violet), `secondary` (white,
  strong hairline), `ghost` (violet text link), `dark` (ink). Sizes sm 36, md 44, lg 52.
  Trailing icons are bare glyphs.
- `AmountField`, `AmountSlider`, `Segmented`: in `controls.tsx`.
- `Money`, `Btc`, `Musd` etc.: in `money.tsx`.

## Motion

Only `transform`, `opacity`, `filter`. Name the properties (`transition-[color,background-color]`),
never `transition-all`. 150ms for interactions; entrances 400 to 700ms on
`--ease-entrance`, once. Respect `prefers-reduced-motion`.

## Rules that are tests or contracts

- **No em dash (U+2014) in any user-visible string.** `src/lib/em-dash.test.ts` fails
  the build. Use a colon, a full stop or a comma. Comments are exempt.
- A failed read must never render as a real value. Do not touch the data layer, the
  hooks, the preflight, the receipts or any `lib/` file to make a screen look better.
- Keep every risk statement and disclosure. Rewording for clarity is fine; deleting is not.
- No new numeric claims. Every figure on screen is read from the chain.
- Hit areas: 44px on touch. `:focus-visible` is global; never remove an outline without
  replacing it. Hover via Tailwind `hover:` (already gated to hover devices).
