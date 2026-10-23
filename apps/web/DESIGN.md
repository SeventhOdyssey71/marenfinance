# Maren web: the UI system

One light system on every surface, one typeface, one accent. If a screen needs a new
idea that is not here, it probably does not need it.

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
- `.t-label` is a quiet **sentence-case** label (13px, muted). No tracked-out capitals.
- Amounts: `.num` (Neue Montreal, tight tracking). Greyed decimals stay greyed.
- Addresses, hashes, block numbers, env names: `.mono` (Geist Mono). Nothing else is mono.
- Neue Montreal has no tabular figures. Do not add `tabular-nums` expecting it to work.
- Headings get `text-wrap: balance` (built into the classes); descriptions `text-pretty`.

## Colour (Tailwind token classes; no new hex in components)

| Role | Class |
| --- | --- |
| Page (landing, docs) | `bg-bg` (white) |
| App working field | `bg-canvas` (#f7f7f8), set by the shell |
| Card | `.card` (white, hairline border, faint shadow) |
| Well, input, quiet button | `bg-surface-inset` |
| Ink fill (dark band, Google button) | `bg-ink` |
| Text | `text-text`, `text-text-muted`, `text-text-subtle` (decimals/placeholders only) |
| Accent | `bg-violet-500` fill, `text-violet-400` text, `bg-violet-900` wash |
| Meaning | `text-success`, `text-warning`, `text-danger`, `text-btc`, `text-musd`, money-in/out |
| Hairline | `border-[var(--border-hairline)]` |

Violet means "this is the action" or "this is the current place". One violet thing per
view is the default. Status never relies on colour alone: pair it with a word or a sign.

## Shape and space

- Radii are concentric: card 20 (`--radius-card`), input/well 12 (`--radius-input`),
  small 8, pills 999. A 12px element inside a 20px card sits on 8px of padding.
- Card padding: 20 on mobile, 24 at md+. Gap between cards: 16. Between groups: 32 or more.
- The gap between groups is at least twice the gap inside one.
- App content max width is 1120px (the shell). Use the width at `lg`: two-column grids
  (`lg:grid-cols-[minmax(0,1fr)_360px]` main + side, or `lg:grid-cols-2`), never one
  card stretched across 1000px. Flows (send, borrow, deposit) are a centred column of
  ~480 to 560px, on purpose.
- Mobile is one column. The shell adds bottom padding for the tab bar.

## Components (use these; do not fork their paint)

- `PageHeader` (`components/app/primitives`): every app screen starts with it.
  `title` + optional `eyebrow`, `description`, `actions`.
- `SectionHeader`: a quiet heading above a group of cards.
- `AppCard`, `Panel`, `PanelBody`, `MetricStrip`, `Metric`, `StatRow`, `Note`, `EmptyState`,
  `Skeleton`, `Loading`, `Refreshing`: in `primitives.tsx`.
- `PillButton` (link) / `PillAction` (button) / `ActionButton` / `ActionLink`: variants
  `primary` (violet), `secondary` (grey), `ghost`, `dark` (ink). Sizes sm 36, md 44, lg 52.
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
