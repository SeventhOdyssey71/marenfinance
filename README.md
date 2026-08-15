<div align="center">

# Maren Finance

**Spend Bitcoin. Never sell it.**

Bitcoin liquidity, gasless spending, and yield — built on [Mezo Chain](https://mezo.org).

</div>

---

## What this is

Mezo lets Bitcoin holders borrow MUSD against BTC without selling. That primitive
works. Maren is the consumer layer on top of it, and it exists to remove the three
frictions that stop it from being used daily:

1. **The minimum is too big.** A MUSD trove requires 1,800 MUSD of net debt — roughly
   **0.079 BTC (~$5,000)** of collateral at a responsible ratio. Mezo mainnet has 26
   troves. Maren's pooled vault opens the same product at **0.001 BTC**.
2. **Every action costs BTC gas.** Asking someone to hold the asset they refused to
   sell, purely to pay gas, is the wrong shape. Maren is gasless end to end.
3. **There is nowhere consumer-grade to spend MUSD.** Maren Pay is send, request,
   split, and payment links against a `@handle`, not a hex address.

## What works today

**Five contracts are deployed and source-verified on Mezo matsnet (chain 31611)** and
have been exercised on-chain against real MUSD — a handle registered, a pooled trove
opened, collateral deposited and topped up. Addresses, tx hashes, and the two findings
that came out of running it for real are in **[`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)**.

| Piece                | State                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `packages/contracts` | Deployed + verified on matsnet. 236 Foundry tests green.                         |
| `packages/sdk`       | Live matsnet addresses. Position, borrow, and format math — the source of truth. |
| `apps/web`           | Next.js landing + dApp. Reads live from matsnet; no test suite yet.              |
| `apps/ios`           | Expo app. Runs on mock data.                                                     |
| `apps/relayer`       | Hono gasless relayer. Tested, **not yet exercised against the deployment.**      |

Not done yet: a gasless meta-transaction through `MarenRelayHub`, a user borrow (the
seeded trove sits at 154% against a 180% floor — see the deployment record), and a
`MarenEarn` Stability Pool deposit. **Mainnet is not deployed** and is gated on an audit.

Maren is pre-audit. Do not use it with funds you cannot afford to lose.

## Run it

Requires **Node >=22**, **pnpm 10**, and [Foundry](https://getfoundry.sh) for contract work.

```bash
CI=true pnpm install --frozen-lockfile   # CI=true is required — see below
cp .env.example .env                     # then fill in the values

pnpm dev                                 # all apps
pnpm --filter @maren/web dev             # just the web app, on :3000

pnpm contracts:test                      # forge test — 236 tests
pnpm docs:pdf                            # build the seven branded PDFs
```

> **Always prefix pnpm with `CI=true`.** Without it pnpm can stop on an interactive
> prompt that never renders in a non-TTY, and it looks exactly like a network hang.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers each workspace, the full CI sequence, how to
deploy, and the review conventions.

## Layout

```
apps/web            Next.js 15 — landing + dApp
apps/ios            Expo — iOS app
apps/relayer        Hono — gasless meta-transaction relayer
packages/contracts  Foundry — MarenVault, MarenPay, MarenRelayHub, MarenRegistry, MarenEarn
packages/sdk        @maren/sdk — chains, verified addresses, position + borrow math, formatting
docs                Markdown sources → branded PDFs (tools/pdf)
tools/pdf           The PDF builder
```

`packages/contracts` is a Foundry project, not a pnpm workspace — drive it with the
`contracts:*` root scripts or `forge` directly.

## Networks

|                   | Chain ID | RPC                                 | Explorer                                                 |
| ----------------- | -------- | ----------------------------------- | -------------------------------------------------------- |
| Mainnet           | `31612`  | `https://jsonrpc-mezo.boar.network` | [explorer.mezo.org](https://explorer.mezo.org)           |
| Matsnet (testnet) | `31611`  | `https://rpc.test.mezo.org`         | [explorer.test.mezo.org](https://explorer.test.mezo.org) |

Native gas token is **BTC (18 decimals)**.

> Several official Mezo doc pages list RPC hosts that do not resolve (`rpc.mezo.org`,
> `testnet-rpc.mezo.org`). The endpoints above were verified live with `cast chain-id`.
> Re-verify before changing them.

## Documentation

| Document                                                                 | What it covers                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                           | The technical case, contract by contract          |
| [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)                             | Live addresses, tx hashes, findings from the run  |
| [`docs/BRAND.md`](docs/BRAND.md)                                         | Design system — the source of truth for both apps |
| [`docs/research/SECURITY-LESSONS.md`](docs/research/SECURITY-LESSONS.md) | R1–R17, the review criteria a PR must satisfy     |
| [`docs/research/CODEBASE-AUDIT.md`](docs/research/CODEBASE-AUDIT.md)     | Structural audit: what is clean, what is not      |
| `docs/src/*.md`                                                          | The seven documents that build to PDFs            |

## A note on facts

Chain IDs, contract addresses, and protocol parameters in this repo were read **live
from Mezo RPCs**, cross-checked against the `mezo-org/musd` deployment artifacts and
the OpenZeppelin proxy manifest. Where Mezo's published docs contradict the deployed
bytecode, this repo follows the bytecode and records the discrepancy in
[`packages/sdk/src/constants.ts`](packages/sdk/src/constants.ts).

Do not add an address to this repo that you have not verified with `cast`.

## Security

`MarenVault` and `MarenRelayHub` carry the protocol's risk and are the audit scope.

Report vulnerabilities privately to **security@maren.finance** — not via a public issue.

## Licence

MIT © 2026 Maren Finance
