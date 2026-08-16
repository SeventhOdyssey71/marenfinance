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

## Where the data comes from

**There is one data source: the chain.** `src/lib/data/live.ts` holds every read, and
`src/lib/data/source.ts` is the only place they are wired to React. There is no second
implementation to fall back to.

There used to be. `src/lib/data/mock.ts` held a seeded world — a cast of handles
(`@nadia`, `@okonkwo`, `@mira`), amounts, timestamps and **invented transaction hashes
that Activity rendered as working links to `explorer.test.mezo.org`**, under a header
reading "Live from Mezo testnet". A `mock`/`live` switch chose between it and the real
reads, and it selected the mock whenever no wallet was connected — which is every first
visit. That file, the switch, and the demo-control store beside it are deleted.

**Nothing in this app synthesises a hash, an address, a handle, an amount or a
timestamp.** Not for a demo, not for a screenshot, not behind a flag. When a figure is
unknown it renders an em dash; when a list is empty it says so; when a read fails it says
that instead, because "empty" and "we could not look" are different claims.

### What a visitor without a wallet sees

Empty states, and `ProtocolPanel` — the BTC/USD oracle precompile, `MarenVault.troveStatus()`
and the vault's MUSD reserve. Those are public, real, and repeatable by anyone with an RPC.
It is a quieter first screen than the demo portfolio it replaces, and it is the only one
that survives being checked.

| File                         | Role                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/data/source.ts`     | The hooks and their query keys. Live-only; `isDeployed()` now selects an honest unavailable state rather than a mock.       |
| `src/lib/data/live.ts`       | Every contract read, against the verified addresses in `@maren/sdk`.                                                        |
| `src/lib/chain/logs.ts`      | Activity, decoded from `eth_getLogs`.                                                                                       |
| `src/lib/chain/write.ts`     | Every transaction the app can send. Chain-guarded, hinted off-chain, simulated before signing.                              |
| `src/lib/chain/preflight.ts` | The contract's own preconditions, evaluated before a control is enabled. `preflight.test.ts` pins them to matsnet fixtures. |
| `src/lib/chain/handle.ts`    | Commit-reveal handle registration and the secret's storage.                                                                 |
| `src/lib/chain/errors.ts`    | Custom errors decoded into English. `errors.test.ts` asserts none can render as hex.                                        |
| `src/lib/chain/abis.ts`      | ABIs transcribed from `packages/contracts/src/*.sol`. Nothing invented.                                                     |

### Activity, and the 10,000-block limit

Activity reads `MarenVault`, `MarenPay` and `MarenEarn` logs directly. **Mezo's public RPC
refuses any `eth_getLogs` spanning more than 10,000 blocks** — a wider range returns
`{"code":-32000,"message":"maximum [from, to] blocks distance: 10000"}`. At matsnet's
~4.7-second blocks that is roughly thirteen hours per request.

So the reader walks backwards in 10,000-block windows from the head, up to
`MAX_WINDOWS` (6, about 3.3 days) or until it reaches `MAREN_DEPLOYMENT_BLOCK` — whichever
comes first. That constant is in `packages/sdk/src/addresses.ts`, derived by bisecting
`eth_getCode` rather than copied from a deploy log.

Reaching the deployment block matters more than the span: **if the scan reached it, an
empty result means "this account has never transacted", which is a fact.** If it did not,
an empty result only means "nothing in the last few days", and the screen says that
instead. `ActivityWindow.complete` carries the distinction and the UI renders a different
empty state for each. The coverage line under the list always states the exact block range
that was read.

**This is the honest ceiling, not a finished answer.** Today the contracts are young
enough that one window covers their entire history, so `complete` is true and the whole
ledger is on screen. As the chain moves on, older history will fall outside the window and
the app will say so rather than quietly truncating. The fix is an indexer
(`docs/ARCHITECTURE.md` §4), not a larger number here — a page load that fans out to
hundreds of RPC calls is its own kind of dishonesty about what the app can do.

**Earn's trailing yield** has the same shape of limit: it needs `Harvested` event history
to be meaningful, so the live path reports a zero-length window and the screen renders
"No return to report yet" rather than inventing a figure. A fabricated trailing return is
the same dishonesty as a forward APY, only backdated.

### What is deliberately not wired

**No relayer is deployed.** `MarenRelayHub` exists on matsnet and the contracts trust it
under ERC-2771, but `apps/relayer` runs on no host, so there is nothing to submit through
it. `RELAYER_AVAILABLE` in `src/lib/chain/write.ts` is the single place that fact lives,
and `gasNote()` reads from it, so every gas claim in the product says the user pays —
because the user does. Nothing is routed through the hub and no action is simulated to
paper over its absence.

---

## Rules this app is built to keep

These are product commitments, not implementation details. Each has a check in
`scripts/verify-behaviour.mjs`.

**A transaction hash is not a success.** `src/lib/chain/receipt.ts` is the only place that
decides what "delivered" means, and it means a receipt with `status === 'success'`. The
`Delivered` type carries a unique symbol, so it cannot be constructed without going
through that check. The sheet shows the explorer link the moment a hash exists and still
says _Submitted. Waiting for a receipt_ until one comes back.

**There is no simulated path.** The transaction runner used to have one, for mock mode.
Every action now either produces a real hash or fails with a decoded reason, and an action
the app cannot perform is disabled at the button with that reason beside it — never
offered and then faked.

**A user never pays to discover a refusal we could have read for free.** This is the rule
`src/lib/chain/preflight.ts` exists for, and it was written after a real transaction: the
borrow slider offered a 0–35 MUSD range while the pooled trove sat at 151% against the
vault's 180% `MIN_TROVE_CR`, so every value on it reverted. Someone dragged it to 17.95
MUSD, pressed Borrow, and paid for the answer.

Before any control is enabled, the preflight evaluates the conditions `MarenVault.sol`
will evaluate, in its order, from chain state — pause flags, deposit cap, oracle
staleness, the account's ratio, its borrow ceiling, its wallet balances, and the shared
trove's ratio, which is the constraint no user-side arithmetic finds because it is not
about the user. Three properties hold:

- **The copy is the contract's.** Every refusal is built by `describeRevert()`, so the
  sentence on a disabled button is literally the sentence the revert would have carried,
  with the same live numbers. There is no second copy deck to go stale.
- **The range is the truth.** `AmountSlider`'s `max` is `Preflight.maxWei`, so it cannot
  travel anywhere that reverts. When nothing can succeed it is disabled at zero with the
  explanation above it.
- **It fails closed.** Unread balances, unread `ProtocolStats`, an unclassified price feed
  — all of them block. "We do not know" and "you may proceed" are different answers.

`simulateThenSign()` in `write.ts` is the second defence and is not redundant with the
first: the preflight stops a doomed action being _offered_, from state read at render;
the `eth_call` stops one being _signed_, from state as it is at the press. `prove-preflight.mjs`
demonstrates the whole thing against the live chain with a signer that cannot sign.

**A stale price is never rendered as live.** Mezo's oracle reverts above 60 seconds of
staleness. `src/lib/chain/price.ts` models a price as a discriminated union where only the
`live` case carries a number, so a screen cannot read a stale one by accident. Borrowing
is blocked; repay stays open; withdrawal stays open whenever the contract allows it
(`vaultActionGate()` reads its rules off `MarenVault.sol`'s own per-entrypoint notes).

**Gas copy describes what is actually running.** No relayer is deployed, so the app says
the user pays — everywhere. Separately and permanently, `MarenVault.deposit()` is payable
and `MarenRelayHub` reverts on any request carrying value, so a deposit can never be
sponsored even once a relayer exists. `verify-behaviour.mjs` asserts all three: that the
copy never says "no gas, ever", that it states the first-deposit exception, and that it
does not claim Maren pays while `RELAYER_AVAILABLE` is false.

**Borrowing capacity is the contract's ceiling.** `TroveManager.getTroveMaxBorrowingCapacity()`,
never an ICR-derived estimate. Mezo fixes that ceiling at the price the trove opened at and
adding collateral does not raise it, so both limits are shown and the binding one is named.

**No forward APY on Earn.** The Stability Pool has no emissions. Trailing realised MUSD
only, labelled backward-looking, with the liquidation-event count kept visible.

**Every custom error decodes into English.** `src/lib/chain/errors.ts` maps all ~50 of
them, and `errors.test.ts` walks the whole table asserting that none renders as a
selector and none reaches the "no plain-language mapping yet" fallback. Its fixture for
`InsufficientCollateralRatio` is the literal revert data matsnet returned for a real
reverted borrow, not a hand-written blob.

**All position maths comes from `@maren/sdk`.** It is not composed locally any more:
what used to be `src/lib/vault.ts` now lives in `packages/sdk/src/borrow.ts`, because a
second copy of it had been written inline in the iOS vault screen and the two had
drifted. Nothing in this app re-derives a ratio, a liquidation price, a borrow ceiling
or a number format.

---

## Verification

All the scripts need a build running on port 3000 and use `playwright-core`:

```bash
CI=true pnpm --filter @maren/web test          # the revert decoder and the preflight, offline
CI=true NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web build
CI=true NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web start &

export PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.js

node scripts/verify-behaviour.mjs  # 87 checks: a11y, the rules above, preflight, 390px overflow
node scripts/verify-contrast.mjs   # worst-case contrast against what is actually painted
node scripts/prove-preflight.mjs   # 36 checks: the disabled borrow, against the live chain
node scripts/capture-tx-states.mjs # screenshots of every transaction-sheet state
node scripts/prove-onchain.mjs     # drives a real handle registration, prints the hashes
node scripts/prove-activity.mjs    # renders real history, then diffs it against eth_getLogs
```

**`verify-behaviour.mjs` runs three passes.** Once disconnected, asserting the empty
states and that no invented handle, hash or counterparty has come back. Once with a real
signer injected at `window.ethereum` (`scripts/injected-wallet.mjs`), asserting live
registry resolution, the minimum-deposit refusal and the two-step handle flow — signing
happens in Node, so key material never enters the page. And once with a **read-only**
signer at an account that has a real position, for the preflight checks.

It no longer refuses to start without `MAREN_TEST_PRIVATE_KEY`: not one of its assertions
submits a transaction, so it generates a throwaway key per run and says so. Set the
variable to pin a specific account.

**`prove-preflight.mjs` proves a negative, which needs a signer that cannot sign.**
`installReadOnlyWallet` impersonates a real address against Mezo's own RPC — every read is
that account's genuine state — and every signing method throws while recording the
attempt. So "no signature was requested" is measured rather than asserted, and the
account's nonce is read from the chain before and after the run to show that nothing was
submitted.

**`capture-tx-states.mjs` broadcasts nothing, and its two settled states are labelled.**
Five of its seven states are reached exactly as a user reaches them. To render `delivered`
and `failed on-chain` it answers `eth_sendTransaction` with the hash of a transaction that
is _already mined_ on matsnet — the real 0.001 BTC deposit `0x3b34e664…95e8dd2`, and the
real reverted borrow `0x9da5b3ed…86a0d47f`. Every receipt, block, gas figure and decoded
revert reason on screen is read live and is true of those transactions; the only fiction
is that this run's click produced them. Those images are for judging the sheet's design.
`prove-preflight.mjs` is the script that proves things.

The checks used to reach their interesting states by clicking a "Demo controls" panel that
only existed in mock mode. There is no mock mode, so they reach them the way a user does.

**Screenshot with WebGL enabled.** The scripts pass `--use-gl=angle`. Running Chrome with
`--disable-gpu` renders no shader at all, which makes a working page look broken — the
health card's PulsingBorder is a status indicator, and its absence is not a neutral
difference.

`CHROME_EXECUTABLE` points at an installed Chrome instead of a Playwright download.
