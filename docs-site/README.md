# Maren Finance documentation site

A [Mintlify](https://mintlify.com) documentation site for Maren Finance, built on the current
`docs.json` schema.

Every address, number, and claim here is drawn from the honest source docs in `../docs/src`,
`../docs/audit`, and `../packages/sdk`. Maren is pre-audit and deployed to Mezo matsnet (chain
`31611`) only; its mainnet addresses are all zeroes on purpose.

## Preview locally

One command, from this `docs-site/` directory:

```bash
npx mintlify dev
```

That serves the site at `http://localhost:3000` with hot reload. Install the CLI globally with
`npm i -g mintlify` if you prefer `mintlify dev`.

To check for broken internal links:

```bash
npx mintlify broken-links
```

## Deploy

The site deploys through Mintlify's GitHub app:

1. Connect the repository in the [Mintlify dashboard](https://dashboard.mintlify.com).
2. Set the docs directory to `docs-site` (where `docs.json` lives).
3. Every push to the default branch redeploys automatically.

No build step or hosting of your own is required; Mintlify builds and hosts the site.

## Structure

```
docs-site/
  docs.json              # navigation, theme, brand colors, logo, favicon
  favicon.png            # copied from apps/web/src/app/icon.png
  logo/                  # brand mark, light and dark variants
  get-started/           # introduction, quickstart, roadmap
  product/               # social-vault, borrow, pay, earn, activity
  how-it-works/          # pooled-vault, gasless, preflight, redemptions
  reference/             # contracts, networks, sdk
  security/              # risk, audits
  developers/            # run-locally, verify-on-chain
```

## Editing rules

- **No em dashes** in prose. The repo enforces this on app copy via
  `node ../tools/copy/em-dash-scan.mjs`; keep MDX to the same standard and rewrite the sentence
  rather than deleting the glyph.
- **No fabricated numbers, addresses, or APYs.** Addresses come from
  `../packages/sdk/src/addresses.ts`; protocol constants from `../packages/sdk/src/constants.ts`;
  facts and transaction hashes from `../docs/src/progress.md`.
- **Never write "zero gas".** The relayer is built and tested but not hosted, and the first
  deposit always costs gas.
- Keep the pre-audit and testnet-only framing prominent, including the `<Warning>` on the
  introduction.
