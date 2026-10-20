# Mezo mainnet deployment plan

Written 2026-10-14. Every number here was read from chain on that date, not carried over
from a document. Re-read them before acting: BTC moves, and three of the figures below are
denominated in it.

---

## Where things stand

Mezo mainnet is live and the protocol Maren depends on is fully deployed there.

|                           | mainnet (31612)               | matsnet (31611)      |
| ------------------------- | ----------------------------- | -------------------- |
| chain                     | block 12,505,025              | block 16,152,947     |
| MUSD                      | `0xdD468A1D…F9F186`, 6,436 B  | `0x118917a4…3Ac503`  |
| BorrowerOperations        | `0x44b1bac6…1dEe031`, 1,159 B | `0xCdF7028c…994beE5` |
| TroveManager              | `0x94AfB503…B93c193`, 1,159 B | `0xE47c80e8…D16bb0`  |
| PriceFeed                 | `0xc5aC5A88…3fFcA88`, 1,159 B | `0x86bCF084…1b9366`  |
| **Maren's own contracts** | **not deployed — all zero**   | deployed 2026-08-15  |

The 1,159-byte contracts are proxies, which is expected.

**The protocol parameters are identical on both chains**, verified today:

|                     | mainnet    | matsnet    |
| ------------------- | ---------- | ---------- |
| MCR (liquidation)   | 110%       | 110%       |
| CCR (recovery mode) | 150%       | 150%       |
| minimum net debt    | 1,800 MUSD | 1,800 MUSD |
| interest rate       | 1%         | 1%         |

This is the single most useful finding for planning: nothing in the product's design has to
change for mainnet. The floors, the minimum trove size and the liquidation maths all carry
over unaltered. Matsnet has been a faithful rehearsal.

---

## The decision that is not technical

`marenfinance.xyz/docs/security/audits` is published and says, in these words:

> **A paid audit gates mainnet.** No Maren contract reaches mainnet before an independent
> audit of `MarenVault`, `MarenEarn` and `MarenRelayHub` — Earn holds user principal in a
> pool that can lose it, which puts it in scope — with findings and remediations published.

That page returns HTTP 200 today and the funder reviewing the grant can read it. Deploying
before an audit is possible and nothing technical prevents it; it contradicts a public
commitment, which is a different kind of cost and one only you can price.

Three options, each coherent:

1. **Audit first.** Weeks of calendar time, five figures. The plan below runs unchanged
   afterwards.
2. **Deploy with the page amended first.** If the commitment changes, change it before the
   deployment, not after — an amended page dated before the deploy reads as a decision; one
   dated after reads as a cover-up.
3. **Deploy a limited mainnet** — contracts live, caps set so that total exposure is bounded
   to an amount you would accept losing — and keep the audit gate for lifting the caps. This
   is the only option that gets something real on mainnet soon without contradicting the page,
   because the page gates _reaching_ mainnet, which option 3 does breach. Read it carefully
   before choosing this; it may require the same amendment as option 2.

Everything below is independent of which you pick.

---

## Phase 0 — redeploy to matsnet first (mandatory)

**The contracts you would deploy to mainnet have never executed on any chain.**

The deployed matsnet vault `0x46252B00…645b` is 14,508 bytes. The current build is 18,012.
That 3,504-byte difference is two corrections that exist only in source:

- the **redemption splitter** — `reconcileRedemption`, `settleRedemption`, `collateralOf`
  and `redemptionShortfall` are absent from the deployed dispatch table, verified with
  `cast code`. A redemption against the pooled trove today would go unreconciled.
- the **pending-redistribution fix** in `_troveCollAndNetDebt`, which stops a redistribution
  being double-counted.

`MarenVault` is immutable by design. There is no upgrade path and no patch. Whatever is
deployed is what runs forever, so the first chain to execute this code must not be the one
holding real BTC.

Encouraging evidence: all **13 fork tests pass against live Mezo bytecode** (run 2026-10-14,
198s), including `test_fork_realRedemptionIsSplitAcrossPooledPositions` and
`test_fork_maxBorrowingCapacityIsFrozenUntilRefinance`. They are gated behind
`MEZO_TESTNET_RPC_URL`, `MAREN_REPAIR_FORK_RPC` and `MAREN_REPAIR_PRICE_WEI`, and skip
silently when unset — so a green CI run does not mean they ran. Set them in
`ci-nightly.yml` before relying on that signal.

Phase 0 steps:

1. Unblock matsnet borrowing: `node tools/ops/topup-collateral.mjs --execute`.
   Currently 3.1 points below the 180% floor; capacity is 100.00 MUSD, which is exactly
   `reserveMUSD()` — the trove contributes nothing.
2. Deploy the corrected contracts to matsnet as a **new** deployment, not a replacement.
3. Write the migration plan for the existing matsnet positions. The old vault is immutable
   and still holds 0.281 BTC; users must be moved deliberately, not abandoned.
4. Exercise a real redemption against the new vault on matsnet. This is the code path that
   has never run. Do not skip it because the fork test passed — the fork test proves the
   logic against forked state, not against a live counterparty.
5. Let it sit under the TestFlight cohort for long enough to mean something.

Only after a redemption has actually settled on matsnet does the mainnet deploy stop being
a first run.

---

## Phase 1 — mainnet contracts

Deploys from `packages/contracts/script/Deploy.s.sol`, the same script matsnet used.

```bash
cast wallet import maren-mainnet --interactive     # a NEW key, not the matsnet deployer
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://jsonrpc-mezo.boar.network \
  --account maren-mainnet \
  --broadcast --verify \
  --verifier blockscout \
  --verifier-url https://api.explorer.mezo.org/api
```

Use a key generated for mainnet. The matsnet deployer `0x54196397…cD341885` is also the
keeper, has been used in this session's tooling, and its keystore password has already been
a point of friction — none of which belongs near a key holding real BTC.

Order matters: Registry → Pay → RelayHub → Vault → Earn. `MarenRelayHub` extends
`MarenForwarder` and **is** the trusted forwarder; the standalone forwarder is deliberately
not deployed, and `MarenPay.trustedForwarder()` must return the RelayHub address.

Record in `docs/DEPLOYMENTS.md`: addresses, tx hashes, runtime byte sizes checked against
the local build, and the deployment block for each contract.

---

## Phase 2 — seed the pooled trove

The smallest legal trove carries **2,000 MUSD** of debt (1,800 minimum net debt + 200 gas
compensation). At $83,333/BTC:

| target ratio | BTC        | USD        | meaning                                      |
| ------------ | ---------- | ---------- | -------------------------------------------- |
| 110%         | 0.0264     | $2,200     | liquidation — never seed here                |
| 180%         | 0.0432     | $3,600     | Maren's borrow floor, zero headroom          |
| **250%**     | **0.0600** | **$5,000** | recommended                                  |
| 370%         | 0.0888     | $7,400     | where matsnet lands after the pending top-up |

At a 250% seed, BTC can fall **28%** before borrowing stops, **40%** before recovery mode,
and **56%** before liquidation. At a 180% seed the first of those is zero — which is exactly
the state matsnet has been stuck in for three weeks, and the reason this row is bold.

Seed through `openPooledTrove`, then push collateral in with `topUpCollateral` rather than
leaving it idle. The deposit gas trap applies on mainnet identically: `deposit` catches a
failed `addColl` and holds BTC idle instead of reverting, so `estimateGas` prices the cheap
fallback (~294k) and any estimate-derived limit silently fails to push. **The floor is
1.2M gas.** Both clients already size from the push path; nothing else may use an estimate.

---

## Phase 3 — relayer

A separate Worker and a separate signer. Do not reuse the matsnet relayer.

`apps/relayer/wrangler.jsonc` needs every one of these changed:

| var                                | matsnet               | mainnet                     |
| ---------------------------------- | --------------------- | --------------------------- |
| `RELAYER_NETWORK`                  | `testnet`             | `mainnet`                   |
| `RELAYER_RPC_URLS`                 | `rpc.test.mezo.org,…` | `jsonrpc-mezo.boar.network` |
| `RELAYER_FORWARDER_ADDRESS`        | `0x22cC1Adf…`         | new RelayHub                |
| `RELAYER_ALLOWED_TARGETS`          | matsnet trio          | new Pay/Registry/Vault      |
| `RELAYER_MAX_DAILY_SPONSORED_BTC`  | `0.01`                | **see below**               |
| `RELAYER_FREE_ACTIONS_PER_ADDRESS` | `250`                 | **see below**               |
| `RELAYER_IP_SALT`                  | `…testnet…v1`         | a new salt                  |
| `RELAYER_ALLOWED_ORIGINS`          | current               | mainnet origins only        |

**The caps must come down before mainnet, not after.** Mainnet gas is 1,462,500 wei against
matsnet's 146 — **10,017×**. The same `0.01 BTC/day` ceiling that authorised about 8 cents a
day on matsnet authorises **$833/day, $24,989/month** on mainnet, and funds ~14,000 sponsored
borrows a day. That is a loss limit, not a budget, and it is currently set to a number chosen
when the units were meaningless.

Per-action cost at mainnet gas: borrow **$0.058**, payment **$0.022**, collateral push
**$0.146**. Pick the daily cap from how much you will accept losing to abuse in one day, then
divide. `maxActionsPerAddressPerDay` (50) is a `POLICY_DEFAULTS` constant and not
env-overridable; `freeActionsPerAddress` is, and 250 lifetime actions at mainnet prices is
roughly $15 of sponsorship per address.

Fund the signer deliberately. When it empties, nothing is sponsored — the app does not fall
back to self-paid, it stops.

---

## Phase 4 — clients

| file                                | change                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `packages/sdk/src/addresses.ts`     | `MAREN_ADDRESSES.mainnet` — five `ZERO`s become real                        |
| `packages/sdk/src/addresses.ts`     | `MAREN_DEPLOYMENT_BLOCK.mainnet` — `null` becomes the earliest deploy block |
| `packages/sdk/src/chains.ts`        | mainnet RPC and explorer wiring                                             |
| `apps/web`                          | `NEXT_PUBLIC_MEZO_NETWORK`, relayer URL, Privy chain config                 |
| `apps/ios-native`                   | network constant, relayer URL, explorer base                                |
| `docs-site/reference/contracts.mdx` | the Mainnet (31612) tab is currently empty                                  |
| `docs-site/reference/networks.mdx`  | same                                                                        |

`MAREN_DEPLOYMENT_BLOCK.mainnet` is `null` deliberately — the comment says `null` means
"there is no history to read", which callers handle as unavailable rather than empty. Set it
to the real block or history queries will scan from genesis.

The iOS app needs a new build and another Beta App Review pass. The review notes in
`_grant/TESTFLIGHT-REVIEW-NOTES.md` are written for a testnet build and say, repeatedly,
that no real funds are at risk and the app cannot transact on a production network. **Every
one of those sentences becomes false on mainnet.** Rewrite them before submitting, or the
submission is a false statement to Apple.

---

## Phase 5 — verification

1. `node tools/ops/readiness.mjs` against mainnet — it is currently hardcoded to chain 31611
   and the matsnet addresses; it needs a network flag before it can check mainnet at all.
2. One real borrow, one real repayment, one real withdrawal, from a fresh address.
3. A redemption, if one can be provoked.
4. `cast code` every deployed address and compare byte-for-byte with the local build.
5. Confirm `MarenPay.trustedForwarder()` returns the RelayHub.
6. Watch the relayer signer balance for a day under real traffic before announcing anything.

---

## Costs

|                                             | BTC       | USD                                 |
| ------------------------------------------- | --------- | ----------------------------------- |
| Contract deployment, 11 txs, 11,688,063 gas | 0.0000171 | **$1.42**                           |
| Seed trove at 250%                          | 0.0600    | **$5,000**                          |
| Relayer float, initial                      | your call | —                                   |
| Audit                                       | —         | **five figures, and the long pole** |

Gas is not the constraint and never will be on this chain. The seed and the audit are the
real numbers.

---

## What has no undo

- **`MarenVault` is immutable.** A bug ships permanently. The only remedy is a new deployment
  and a user migration.
- **Real BTC.** Matsnet mistakes cost nothing and several have already been made and fixed in
  this codebase; the deposit gas trap ran undetected for five weeks and silently stranded 75%
  of pooled collateral. That same class of bug on mainnet is user funds.
- **Redemptions.** Mezo can redeem against the pooled trove at any time without warning. The
  splitter that handles this correctly has never executed on any chain.
- **The audits page.** It is published, indexed, and the funder has the link.

---

## Open questions

1. Audit — commissioned, quoted, or not yet started? This sets the whole timeline.
2. Is there a migration plan for the 0.281 BTC and existing handles on matsnet, or does
   mainnet start empty?
3. What daily sponsorship loss is acceptable? Every relayer cap follows from that one number.
4. Does mainnet launch with Earn enabled? It holds user principal in a pool that can lose it,
   which is why the audits page names it in scope.
