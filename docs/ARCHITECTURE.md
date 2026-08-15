# Maren Finance — Technical Architecture

**Chain:** Mezo (EVM). Mainnet `31612`, matsnet `31611`. Native gas token is **BTC (18 decimals)**.
**Stablecoin:** MUSD, a Threshold-USD/Liquity-v1 fork operated by Mezo.

All chain facts in this document were verified live against Mezo RPCs on 2026-08-15.
See `packages/sdk/src/constants.ts` for the machine-readable versions, including the
list of ways MUSD diverges from Liquity and the places Mezo's docs contradict its code.

---

## 1. The problem we are actually solving

Mezo already lets a Bitcoin holder borrow MUSD against BTC without selling. That
primitive works. Three frictions stop it from becoming something people use daily:

**F1 — The minimum is too big.** A trove requires **1,800 MUSD minimum net debt**
(2,000 total including the 200 MUSD gas compensation). At a responsible 250% CR and
~$63k BTC, that is **~0.079 BTC (~$5,000)** of collateral before you can open a
position at all. Most Bitcoin holders hold far less than that. Mainnet currently has
**26 troves**. This is the single largest cap on Mezo's user count.

**F2 — Every action costs BTC gas.** A user who borrows MUSD to spend must keep a BTC
balance to move it. Asking someone to hold the asset they refused to sell _just to pay
gas_ is precisely the wrong shape.

**F3 — There is nowhere consumer-grade to spend it.** MUSD exists; a payments surface
for it does not.

Maren addresses all three. None of the three requires Mezo to change anything.

---

## 2. Product

Four surfaces, one account.

| Surface       | What it does                                                                            |
| ------------- | --------------------------------------------------------------------------------------- |
| **Vault**     | Deposit BTC → draw MUSD. Direct trove for large positions, pooled trove for small ones. |
| **Pay**       | Send MUSD to a `@handle`, payment link, request, or split. Gasless.                     |
| **Earn**      | Idle MUSD → Stability Pool yield via an ERC-4626 vault.                                 |
| **Portfolio** | Position health, borrowing capacity, history, alerts.                                   |

---

## 3. Contracts

Solidity `0.8.28`, Foundry, OpenZeppelin v5. All in `packages/contracts/src/`.

### 3.1 `MarenForwarder` — gasless execution

ERC-2771 trusted forwarder (OpenZeppelin `ERC2771Forwarder`). Users sign an EIP-712
`ForwardRequest`; our relayer submits it and pays the BTC gas.

- Domain: `Maren Forwarder` / version `1`.
- Only Maren contracts trust it. It is never a general-purpose relayer.
- Replay protection via per-signer nonce + `deadline`.

Combined with **MUSD's EIP-2612 `permit`**, a first-time user can approve _and_ pay in
a single signed action holding **zero BTC**.

> Note: Mezo also ships `BorrowerOperationsSignatures`, an EIP-712 signed variant of
> every borrower operation. For **direct** troves we use Mezo's own contract rather
> than wrapping it — fewer moving parts and no added trust. `MarenForwarder` covers
> Maren-native actions (Pay, Earn, Registry, pooled Vault).

### 3.2 `MarenRegistry` — human-readable handles

`@sele` → address. Commit-reveal registration to stop front-running, 3–32 chars
`[a-z0-9_]`, one primary handle per address, reverse resolution for display.
Handles are the backbone of the Pay UX and cost one cheap tx to claim.

### 3.3 `MarenPay` — payments

`ERC2771Context`. Operates on MUSD.

- `pay(to, amount, memo)` — direct transfer with an on-chain memo event.
- `payTo(handle, amount, memo)` — resolves via `MarenRegistry`.
- `createRequest(from, amount, memo)` / `fulfillRequest(id)` — payment requests.
- `createLink(amountHash, expiry)` / `claimLink(secret)` — claimable links; the claimer
  needs no prior relationship and no BTC.
- `split(recipients[], amounts[], memo)` — one signature, N recipients.

Everything emits indexable events. No custody: MUSD moves wallet→wallet via
`transferFrom` under the user's own permit/approval.

### 3.4 `MarenVault` — pooled Bitcoin credit **(the differentiator)**

Solves F1. Maren runs **one large, conservatively managed trove**; users hold a
proportional claim inside it with a per-user ledger.

- Deposit from **0.001 BTC** — ~80× below the protocol minimum.
- Per-user `collateral` and `debt` accounting; per-user ICR computed off the same oracle.
- **Maren enforces a stricter 140% internal liquidation CR** against the protocol's
  110%, so the pooled trove is never near the protocol cliff.
- Keeper (`MarenKeeper` role) rebalances: tops up collateral, repays debt, and
  internally liquidates unhealthy users by seizing their collateral at a 5% penalty
  and repaying their share of the pooled debt.
- Users can always exit: repay their debt share and withdraw their collateral.
- If the pooled trove would breach policy, borrowing is halted before withdrawal is —
  exits stay open when entries close.

**Honest risk statement (must appear in the UI and in the docs):** pooled positions
share one trove. A user's collateral is _segregated in accounting_, not in custody. A
catastrophic, faster-than-keeper BTC drawdown could socialise losses. The 140/110
buffer, the 0.001 BTC floor on deposits, per-block keeper checks, and a protocol-owned
insurance buffer funded from vault fees are the mitigations — not a guarantee. Users
above the protocol minimum are steered to a **direct** trove, which carries no pooling
risk, and the UI says so.

### 3.5 `MarenEarn` — yield

ERC-4626 vault. Assets in MUSD, deposited into MUSD's Stability Pool. Handles the BTC
liquidation gains the Stability Pool pays out: gains are swept, converted, and
compounded back into MUSD, so `totalAssets()` grows for shareholders.

> Reality check for the docs: the Stability Pool has **no token emissions**. Yield is
> liquidation gains only, and is therefore lumpy and not an APY we may advertise as
> fixed. The UI shows trailing realised yield, clearly labelled as backward-looking.

---

## 4. Off-chain

### `apps/relayer`

Hono on Node. Holds a hot key funded with BTC.

- `POST /relay` — verifies the ERC-2771 signature, simulates via `eth_call`, submits.
- **Allowlist**: will only relay to Maren contracts, only for known selectors.
- **Rate limits**: per-address and per-IP; sponsorship budget per address per day.
- **Sponsorship policy**: first 25 actions free per address, then a small fee taken in
  MUSD inside the same transaction. New users are never blocked at the door.
- Nonce management with a per-key mutex; replacement-fee bump on stuck txs.
- Never holds user funds. Compromise of the relayer key costs us gas, not user money.

### Indexing

**Goldsky** (network slugs `mezo`, `mezo-testnet`) — Mezo has no public subgraph
(`mezo-org/subgraphs` 404s) and is not in The Graph's registry. Blockscout REST at
`https://api.explorer.mezo.org/api/v2` covers ad-hoc reads. Note the `api.` subdomain;
`explorer.mezo.org/api/...` 404s.

### Price

`PriceFeed.fetchPrice()` reads a **native chain precompile** at
`0x7b7c...0015`, fed by Mezo's validator set — not Chainlink or Pyth. It **reverts if
the price is >60s stale**, which means every borrow/adjust/liquidate path can revert
for reasons unrelated to the user. Both apps have an explicit "price feed unavailable"
state; we never display a stale price as if it were live.

---

## 5. Client stack

| Layer   | Choice                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| Web     | Next.js 15 App Router, React 19, TypeScript strict                                              |
| Styling | Tailwind CSS v4, tokens from `docs/BRAND.md`                                                    |
| Chain   | viem 2.x + wagmi 2.x                                                                            |
| Wallets | Reown AppKit (WalletConnect) + injected. Mezo is a standard EVM chain; no special SDK required. |
| Shaders | `@paper-design/shaders-react` — three usages, per `docs/BRAND.md` §5                            |
| State   | TanStack Query for chain reads; Zustand for local UI                                            |
| iOS     | Expo (React Native), sharing `@maren/sdk`                                                       |
| ABIs    | `@mezo-org/musd-contracts` — never hand-transcribed                                             |

`@mezo-org/passport` is **not** required: it exists to let Bitcoin-native wallets
(Unisat/Xverse/OKX) act as Mezo EVM accounts. We may add it later as an onboarding
path, but it is not on the critical path and it pulls in RainbowKit.

---

## 6. Repo layout

```
apps/
  web/        Next.js — landing + dApp
  ios/        Expo — iOS app
  relayer/    Hono — gasless relayer
packages/
  contracts/  Foundry — Maren contracts
  sdk/        @maren/sdk — chains, addresses, ABIs, hooks, math
  ui/         shared design-system primitives
docs/         Markdown sources -> branded PDFs (tools/pdf)
```

---

## 7. Deployment order

1. matsnet (31611): deploy all contracts, seed a pooled trove, run the full flow end to end.
2. Third-party audit of `MarenVault` + `MarenForwarder` (the two that hold risk).
3. Mainnet (31612) with the vault capped, raised as the position proves out.

Mezo Market listing requires MUSD integration, a third-party audit submitted to the
Supernormal Foundation, and a live mainnet deployment. Deployment itself is permissionless.
