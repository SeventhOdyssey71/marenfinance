# @maren/web

The Maren Finance site and dApp. Next.js 15 (App Router), Tailwind v4, Satoshi + Geist
Mono, dark only.

```
/            marketing — static, no wallet stack in the bundle
/app         Portfolio  — position health, borrowing capacity, balances, recent activity
/app/vault   Vault      — deposit, borrow, repay, withdraw
/app/pay     Pay        — send to a @handle or address, request, claimable links
/app/earn    Earn       — ERC-4626 deposit/withdraw over the MUSD Stability Pool
/app/activity Activity  — history with status and explorer links
```

## Running it

```bash
CI=true pnpm install --frozen-lockfile
CI=true pnpm --filter @maren/web dev          # http://localhost:3000
CI=true pnpm --filter @maren/web typecheck
CI=true NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web build
```

Prefix pnpm with `CI=true`. Without it, pnpm can stop on a prompt that has no TTY to
answer it, which looks exactly like a network hang.

### Environment

| Variable                               | Default   | Effect                                                                                                                                                          |
| -------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_MEZO_NETWORK`             | `testnet` | `testnet` (31611) or `mainnet` (31612). Resolved through `resolveNetwork()` in `@maren/sdk`, which defaults to testnet for safety.                              |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset     | Adds the WalletConnect connector. Without it only the injected connector is offered — a connector that throws when clicked is worse than one that is not there. |

---

## Mock vs live data

**Maren's contracts are not deployed.** `getMarenAddresses()` in `@maren/sdk` returns the
zero address for all five, so `isDeployed()` is false and the app runs on mock data with
a disclosure banner on every screen.

The decision is made in **one place**, `src/lib/data/source.ts`:

```ts
export function dataMode(network = NETWORK): DataMode {
  return isDeployed(getMarenAddresses(network).marenVault) ? 'live' : 'mock';
}
```

Everything downstream calls the same hooks — `usePosition()`, `usePrice()`,
`useBalances()`, `useEarn()`, `useActivity()` — and those hooks pick a side. No screen
branches on the mode; the only component that knows about it is the banner that discloses
it.

| File                     | Role                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/data/source.ts` | **The gate.** Hooks, query keys, and the `isDeployed()` check.                                                                          |
| `src/lib/data/live.ts`   | Real viem reads against real ABIs and the SDK's verified addresses. Compiled and typechecked today; selected the moment addresses land. |
| `src/lib/data/mock.ts`   | Demo state. Two accounts (direct trove, pooled), a drifting BTC price, seeded activity, requests and links.                             |
| `src/lib/data/demo.ts`   | The demo controls — switch account, stall the oracle. Mock mode only.                                                                   |
| `src/lib/chain/abis.ts`  | ABIs transcribed from `packages/contracts/src/*.sol`. Nothing invented.                                                                 |

### Turning it live

1. Deploy with `packages/contracts/script/Deploy.s.sol`.
2. Write the addresses into `MAREN_ADDRESSES` in `packages/sdk/src/addresses.ts`.
3. Nothing else. `isDeployed()` flips, `source.ts` selects `live.ts`, the banner
   disappears, and the same screens read from chain.

Two reads stay mocked past that point and say so in the code:

- **Activity** needs the Goldsky index described in `docs/ARCHITECTURE.md` §4. There is no
  public Mezo subgraph to read instead.
- **Earn's trailing yield** is the sum of share-price movement across a window, which
  needs `Harvested` event history. The live path reports a zero-length window rather than
  inventing a figure — a fabricated trailing return is the same dishonesty as a forward
  APY, only backdated.

---

## Rules this app is built to keep

These are product commitments, not implementation details. Each has a check in
`scripts/verify-behaviour.mjs`.

**A transaction hash is not a success.** `src/lib/chain/receipt.ts` is the only place that
decides what "delivered" means, and it means a receipt with `status === 'success'`. The
`Delivered` type carries a unique symbol, so it cannot be constructed without going
through that check. In mock mode the sheet says _Simulated — nothing was broadcast_; it
never borrows the language of a receipt it did not fetch.

**A stale price is never rendered as live.** Mezo's oracle reverts above 60 seconds of
staleness. `src/lib/chain/price.ts` models a price as a discriminated union where only the
`live` case carries a number, so a screen cannot read a stale one by accident. Borrowing
is blocked; repay stays open; withdrawal stays open whenever the contract allows it
(`vaultActionGate()` reads its rules off `MarenVault.sol`'s own per-entrypoint notes).

**Gasless copy is per-action.** `MarenVault.deposit()` is payable and `MarenRelayHub`
reverts on any request carrying value, so a first deposit costs the user BTC gas and
everything after it is sponsored. Nowhere in this app does it say "no gas, ever" — there
is a check that fails the build if it ever does.

**Borrowing capacity is the contract's ceiling.** `TroveManager.getTroveMaxBorrowingCapacity()`,
never an ICR-derived estimate. Mezo fixes that ceiling at the price the trove opened at and
adding collateral does not raise it, so both limits are shown and the binding one is named.

**No forward APY on Earn.** The Stability Pool has no emissions. Trailing realised MUSD
only, labelled backward-looking, with the liquidation-event count kept visible.

**All position maths comes from `@maren/sdk`.** `src/lib/vault.ts` composes it; it does not
re-derive ratios, liquidation prices or formatting. Where it adds arithmetic — headroom on
an existing position, the pooled collateral requirement — the comment says why the SDK
function does not apply and points at the contract that agrees with it.

---

## Verification

All three scripts need a build running on port 3000 and use `playwright-core`:

```bash
CI=true NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web build
CI=true NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web start &

export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.js
node scripts/screenshot.mjs        # .screenshots/ — every route at 1440 and 390
node scripts/verify-behaviour.mjs  # a11y, the rules above, 390px overflow
node scripts/verify-contrast.mjs   # worst-case contrast against what is actually painted
```

**Screenshot with WebGL enabled.** The scripts pass `--use-gl=angle`. Running Chrome with
`--disable-gpu` renders no shader at all, which makes a working page look broken — the
health card's PulsingBorder is a status indicator, and its absence is not a neutral
difference.

`CHROME_EXECUTABLE` points at an installed Chrome instead of a Playwright download.
