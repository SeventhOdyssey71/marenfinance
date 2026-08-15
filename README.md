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

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical case and
[`docs/BRAND.md`](docs/BRAND.md) for the design system.

## Networks

| | Chain ID | RPC | Explorer |
|---|---|---|---|
| Mainnet | `31612` | `https://jsonrpc-mezo.boar.network` | [explorer.mezo.org](https://explorer.mezo.org) |
| Matsnet (testnet) | `31611` | `https://rpc.test.mezo.org` | [explorer.test.mezo.org](https://explorer.test.mezo.org) |

Native gas token is **BTC (18 decimals)**.

> Several official Mezo doc pages list RPC hosts that do not resolve (`rpc.mezo.org`,
> `testnet-rpc.mezo.org`). The endpoints above were verified live with `cast chain-id`.
> Re-verify before changing them.

## Layout

```
apps/web        Next.js 15 — landing + dApp
apps/ios        Expo — iOS app
apps/relayer    Hono — gasless meta-transaction relayer
packages/contracts  Foundry — MarenVault, MarenPay, MarenForwarder, MarenRegistry, MarenEarn
packages/sdk    @maren/sdk — chains, verified addresses, ABIs, position math
packages/ui     shared design-system primitives
docs            Markdown sources → branded PDFs
```

## Getting started

```bash
pnpm install
cp .env.example .env        # then fill in the values

pnpm dev                    # all apps
pnpm --filter @maren/web dev

pnpm contracts:test         # forge test
pnpm docs:pdf               # build the PDF document set
```

Foundry is required for contract work: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

## A note on facts

Chain IDs, contract addresses, and protocol parameters in this repo were read **live
from Mezo RPCs**, cross-checked against the `mezo-org/musd` deployment artifacts and
the OpenZeppelin proxy manifest. Where Mezo's published docs contradict the deployed
bytecode, this repo follows the bytecode and records the discrepancy in
[`packages/sdk/src/constants.ts`](packages/sdk/src/constants.ts).

Do not add an address to this repo that you have not verified with `cast`.

## Security

Maren is pre-audit. Do not use it with funds you cannot afford to lose.
`MarenVault` and `MarenForwarder` carry the protocol's risk and are the audit scope.

Report vulnerabilities privately to **security@maren.finance** — not via a public issue.

## Licence

MIT © 2026 Maren Finance
