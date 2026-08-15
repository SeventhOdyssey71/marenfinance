# `@maren/contracts`

Solidity contracts for **Maren Finance** on **Mezo Chain**. Foundry, Solidity `0.8.28`,
OpenZeppelin v5.4.0.

| Network | Chain ID | RPC |
|---|---|---|
| Mezo mainnet | `31612` | `https://jsonrpc-mezo.boar.network` |
| Mezo matsnet | `31611` | `https://rpc.test.mezo.org` |

The native gas token is **BTC** with 18 decimals, passed as `msg.value`. MUSD is a
Threshold-USD / Liquity-v1 fork operated by Mezo. Every MUSD address and function signature
used here was verified live with `cast` on 2026-08-15 — see `src/interfaces/` for the
per-contract provenance notes.

---

## Contracts

### `MarenForwarder`
ERC-2771 trusted forwarder, a thin subclass of OpenZeppelin's `ERC2771Forwarder` with domain
`Maren Forwarder` / version `1`. It adds no logic on purpose: every line added to a forwarder
is a line that can forge a sender.

Combined with MUSD's EIP-2612 `permit`, a first-time user can approve **and** pay while
holding zero BTC.

The relayer key is a **liveness** dependency, not a custody one. Whoever holds it can censor
or reorder Maren meta-transactions and can waste its own BTC. It cannot move user funds,
because every value transfer downstream is a `transferFrom` under the user's own
authorisation.

> **Not ERC-4337.** EntryPoint v0.7 is deployed on Mezo at
> `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, byte-identical to L1, but inert: zero
> UserOperations, and mezod does not implement `debug_traceCall`, so no ERC-7562-compliant
> bundler can validate. EIP-7702 (live on mainnet since block 9,275,000) is the upgrade path,
> which is why every user-facing entrypoint here is small and independently callable rather
> than a monolith — a 7702-delegated account can batch them.

### `MarenRelayHub` — the forwarder actually deployed
`MarenRelayHub` **extends** `MarenForwarder` and adds an atomic, signed-fee relay path. Deploy
**this**, and pass its address as `trustedForwarder` to every other Maren contract. The
standalone `MarenForwarder` is its base class and must **not** also be deployed and trusted —
two trusted forwarders would be two independent ways to forge a sender, and only one of them
would be allowlisted.

It exists because both obvious ways to charge a relay fee are broken:

- **A trailing `uint256 relayFee` on every function** is covered by the signature but no
  contract does anything with it. It is consent to a number with no settlement attached —
  signed but unenforced — and it drags relayer economics into `MarenPay` and `MarenVault`.
- **A fee leg + work leg batched through `executeBatch`** looks correct and is not. See the
  finding below.

Instead, one EIP-712 `RelayedCall` signature covers the target, the exact calldata, the gas,
the nonce, the deadline, **and** `feeToken` / `feeAmount` / `feeRecipient`. The hub takes the
fee and performs the call in the same frame, bubbling any inner revert, so fee and work settle
together or neither does.

| Property | How it is enforced | Test |
|---|---|---|
| Atomic | fee then call in one frame; inner revert is bubbled | `test_property1_revertingWorkRevertsTheFee` |
| Fee inside the signed payload | all three fee fields are members of the EIP-712 struct | `test_property2_relayerCannotRaiseTheFee` / `…RedirectTheFee` / `…SwapTheFeeToken` |
| One trusted forwarder | the hub *is* a `MarenForwarder`; `Deploy.s.sol` wires exactly one | `test_property3_hubIsTheSingleTrustedForwarder` |
| End user survives to the target | ERC-2771 suffix, plus `_isTrustedByTarget` checked first | `test_property4_msgSenderInsideTargetIsTheEndUser` |
| Target + selector allowlist | per-`(target, selector)`, on the fee path **and** the fee-free `execute` | `test_property5_*` |

`executeBatch` is **disabled** — it reverts with `BatchExecutionDisabled()`. Value is never
relayed: `RelayedCall` has no `value` field and `execute` rejects a non-zero one, which is why
`MarenVault.deposit()` is not in the allowlist and every post-deposit action is.

Property 4 is the one most likely to go wrong silently, so it is asserted against
`test/mocks/SenderProbe.sol`, which records both `_msgSender()` and the raw `msg.sender` —
a direct observation rather than an inference from a payment that moved the right balances.

### `MarenRegistry`
`@handle` → address, 3–32 characters of `[a-z0-9_]` validated on-chain, with commit-reveal
registration.

`register("sele")` in a public mempool is a free option for anyone watching it. The commitment
binds the handle to the registrant's address and a secret, so a copied commitment is worthless.
`MIN_COMMITMENT_AGE` (60s) forces it to be at least one block old; `MAX_COMMITMENT_AGE`
(7 days) stops the commitment set becoming a permanent reservation.

Uppercase is **rejected**, not normalised — silently normalising is how `@Sele` and `@sele`
end up hashing to different nodes in a client that forgets to do it too.

One primary handle per address (reverse resolution), plus transfer and release.

### `MarenPay`
MUSD payments: `pay`, `payToHandle`, `payWithPermit`, `payWithPermit2`, payment requests,
claimable links, and N-way `split`.

**Custody, stated plainly.** Everything except links is strictly non-custodial: MUSD moves
wallet → wallet in a single `transferFrom` under the payer's own allowance, permit, or Permit2
signature, and MarenPay's own balance never changes. `createLink` is the one exception and it
is unavoidable — a link must be claimable by someone who does not exist yet, so the MUSD sits
in the contract earmarked to a link id, recoverable by the creator after the expiry they chose.
If you audit one function in this repo, audit that one.

**Links use a keypair, not a hashed secret.** The obvious design — `claimLink(secret)` against
a stored `keccak256(secret)` — is unusable in a public mempool: the claim transaction reveals
the preimage and any searcher can copy it, pay more gas, and take the money. Here the "secret"
is a one-time private key that travels in the URL fragment and never reaches the chain; the
claimer signs *their own recipient address* with it, so a copied signature is only valid for
the recipient it already names.

**Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`, verified deployed on both networks)
is supported so Maren *interoperates* with Mezo's own x402 rail rather than competing with it.
Only `SignatureTransfer` is used — single-use and scoped to one amount and one recipient. The
AllowanceTransfer side, which grants a standing allowance, is deliberately not touched.

### `MarenVault` — pooled Bitcoin credit
**The differentiator, and the contract that carries real risk.** Maren runs ONE trove on MUSD's
`BorrowerOperations`; users hold a segregated *accounting* claim inside it and can deposit from
**0.001 BTC**.

For scale: opening a direct trove needs 1,800 MUSD of net debt, which at a responsible 250%
ratio and the live price of $63,071.83 is **0.079346 BTC (~$5,004.50)**. Maren's floor is
**79.3× lower**. Mainnet currently has 26 troves; this gap is the single largest cap on Mezo's
user count, and closing it is the entire reason this contract exists.

#### How the accounting works
The hard problem is distributing the pooled trove's continuously accruing interest across users
without ever looping over them. Debt is held in **shares** against a monotonically
non-decreasing `interestIndex`:

```
debtOf(user)  = ceil(debtShares[user] * interestIndex / 1e18)
interestIndex = max(interestIndex, ceil(outstandingDebt * 1e18 / totalDebtShares))
outstandingDebt = troveEntireDebt - 200e18 gas compensation - reserveMUSD
```

`outstandingDebt` is **measured from the live trove, not modelled**. The borrowing fee is
governable, interest is fixed-at-open, and redistributions from other troves can add debt we
never asked for — any of which would drift a hand-rolled model out of sync within days.
`borrow` and `repay` record the trove's outstanding debt before and after and mint or burn
shares against the *observed* delta, so the vault's books track the protocol's books by
construction.

Every rounding decision goes the protocol's way: shares round **up** when minted and **down**
when burned, `debtOf` rounds **up**, and the index never decreases. The result — asserted by
fuzzing and by invariant — is that `sum(debtOf(user)) >= outstandingDebt`, always.

`reserveMUSD` is MUSD held by the contract that already counts as repaid. It is what lets a user
borrow 50 MUSD without touching the trove at all, and what lets a repayment settle when pushing
it into the trove would drop net debt below the protocol's 1,800 floor. Because it is subtracted
from `outstandingDebt`, moving MUSD between reserve and trove changes nothing for users — which
is exactly what makes `deleverage()` safe.

#### Risk model — read this before deploying anything

1. **Pooling is not custody segregation.** Each user's collateral is a number in storage; the
   BTC is one undifferentiated balance in one trove. If the MUSD protocol liquidates that trove,
   **all** users lose collateral pro rata regardless of their individual health. The defence is
   distance from the cliff: no borrowing below **180%**, internal liquidation at **140%**, versus
   the protocol's **110%**. That is a 30-point buffer, not a guarantee.
2. **A fast drawdown can outrun the keeper.** Internal liquidation is a transaction someone has
   to land. Between 140% and 110% there is ~21% of BTC price. A gap larger than that, or a
   window where the oracle is stale and nothing can be liquidated at all, socialises the loss.
   The insurance buffer — funded by the 5% liquidation penalty and by protocol-owned seed
   collateral — absorbs the first slice. It is not sized for a 2020-03-12.
3. **The oracle can simply stop.** `PriceFeed.fetchPrice()` reverts when Mezo's Skip Connect
   oracle is >60s stale, and there is no `lastGoodPrice()` fallback. While it is down: no
   borrowing, no liquidation, no collateral withdrawal *out of the trove*. Deposits and
   repayments still work — they need no price. Every price-dependent path fails with
   `PriceFeedUnavailable()` rather than an opaque revert, so the UI can say so honestly.
4. **Users large enough for a direct trove should open one.** A direct trove carries none of the
   above. The UI is required to steer anyone above the protocol minimum to one, and to say why.
5. **Bad debt is recognised, not papered over.** If a position goes underwater faster than it can
   be liquidated, `liquidateUser` seizes what it can, repays what that covers, and leaves the
   shortfall on the defaulter's ledger while emitting `BadDebtRecognised`. It is never silently
   spread across other users' balances.

#### Guard rails
- **Entries and exits are separate switches, structurally.** `setDepositsPaused` and
  `setBorrowingPaused` exist; there is no global pause and no pause modifier anywhere on
  `withdraw`, `repay`, `closePosition` or `liquidateUser`. No guardian key — compromised,
  coerced, or merely mistaken — can trap a user's collateral. Asserted by
  `test_exitsStayOpenWhileEntriesArePaused` and again on a matsnet fork.
- A global `depositCap`, starting small and raised as the position proves out.
- `nonReentrant` on every external state-changing function, checks-effects-interactions
  throughout.
- Hints (`_upperHint` / `_lowerHint`) are **parameters**, computed off-chain. Walking
  `SortedTroves` on-chain is unbounded gas.
- `liquidateUser` is `KEEPER_ROLE`-only. An open liquidation market would be more decentralised,
  but a public liquidator profiting from the penalty has an incentive to push users over the
  line, and at 140% there is nothing to arbitrage against — the protocol is happy at 110%. Maren
  runs it at cost: the liquidator receives collateral worth exactly what they repaid and the 5%
  penalty goes to the insurance buffer.

#### Agreement with `packages/sdk/src/position.ts`
The SDK and this contract must never quote different numbers, or the UI offers users borrows
the contract then rejects. They use the **same rounding discipline** — collateral ratios round
DOWN, required collateral and liquidation prices round UP, always in the direction that makes a
position look less safe — and the same core expressions.

They differ in one deliberate place, and the contract's view functions are named to say so:

| SDK (direct trove) | Vault (pooled) |
|---|---|
| `collateralRequiredFor(netDebt, …)` grosses up by the 0.1% fee **and** the 200 MUSD gas compensation | `collateralRequiredForDebt(debt, targetCr)` takes the pooled debt as-is |
| `maxNetDebtAt(…)` subtracts gas compensation and divides out the fee | `maxBorrowable(user)` does neither |

A pooled position carries no per-user gas compensation — there is one for the whole pooled
trove, already paid by the protocol's own seed position — and a borrow served from
`reserveMUSD` pays no origination fee at all. Grossing up in the vault would over-quote every
pooled user by 200 MUSD of collateral they do not owe. `assessBorrowRoute` decides which of the
two a given user is quoted; use the SDK's functions for the direct route and the contract's for
the pooled one.

#### Mezo divergences that shape this contract
- No `_maxFeePercentage` parameter anywhere. A ported Liquity ABI encodes the wrong selector.
- `maxBorrowingCapacity` is a per-trove ceiling frozen at the price when the trove opened.
  Adding collateral does **not** raise it — only `refinance()` does, which is why
  `refinancePooledTrove()` exists and why a pooled trove held through a BTC rally hits that
  ceiling long before any collateral limit.
- `getEntireDebtAndColl` returns **six** values, not Liquity's four, because debt is split into
  principal and interest.
- Recovery Mode does **not** expand liquidations; the threshold stays 110% in both modes.

### `MarenEarn`
ERC-4626 over MUSD, deposited into the MUSD Stability Pool.

**What the yield actually is:** the Stability Pool has **no token emissions**. The only return
is liquidation gains — depositors' MUSD is burned to absorb liquidated debt and they receive the
BTC collateral at a discount. That makes it lumpy, arriving in discrete events, and impossible
to quote as a fixed APY. Show trailing realised yield, labelled backward-looking. Anyone
advertising a forward APY on this is guessing.

**The BTC problem, honestly:** gains arrive as native BTC but the vault's unit of account is
MUSD, and converting needs a DEX that Maren has not verified exists on Mezo. So `swapRouter` is
`address(0)` at deployment and `harvest()` simply **holds** the BTC, counted in `totalAssets()`
at the oracle price. Shareholders own it and it is not stranded — but the vault is then partly
BTC-denominated and its share price moves with BTC. That is a real, deliberate exposure. When
governance sets a reviewed router, `harvest()` starts converting and compounding and the
exposure goes away. `ISwapRouter` is a seam, not an integration.

`totalAssets()` never reverts: live price, else the last price seen during a harvest, else BTC
counts as **zero**. Valuing at zero understates the vault, which costs a redeemer and protects
everyone who stays — the only safe direction to be wrong in. It is still a stale price being
used for share pricing, which is why the router should be wired sooner rather than later.

`_decimalsOffset()` is 3, making the classic first-depositor inflation attack cost ~1000× what
it could steal.

---

## Testing

```bash
forge test                       # 210 local tests, no network needed
forge test --match-path 'test/MarenVault*'
FOUNDRY_PROFILE=ci forge test    # 2048 fuzz runs, 256 invariant runs

# Fork tests against real matsnet MUSD contracts (8 tests):
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*' -vv
```

Fork tests **skip** rather than fail when `MEZO_TESTNET_RPC_URL` is unset or the RPC is
unreachable, so a public testnet cannot break CI.

### A real limitation of forking Mezo
Mezo's BTC/USD oracle is **Skip Connect**, a consensus-level `x/oracle` module in mezod — not
Chainlink, not Pyth, and not a deployed contract. `eth_getCode` at
`0x7b7c000000000000000000000000000000000015` does return bytecode, but that bytecode is a stub
whose only action is to call *itself*; on Mezo, mezod intercepts and the native handler answers.
Inside foundry's EVM there is no handler, so it recurses and reverts — taking
`PriceFeed.fetchPrice()` and every borrow/adjust/liquidate path down with it.

The fork suite therefore `vm.etch`es `test/mocks/ForkOracleStub.sol` at that address.
**Everything else is real deployed bytecode** — BorrowerOperations, TroveManager, MUSD,
SortedTroves, HintHelpers, and the PriceFeed contract's own staleness logic. Only the consensus
oracle underneath is substituted, because it cannot be replayed. The live precompile is verified
out of band with `cast`.

> Pyth **is** deployed on Mezo, but its feeds are ~28 days stale and ETH/USD reverts outright.
> Never read Pyth for liquidation math.

---

## Deploy runbook

### 1. Pre-flight
```bash
forge fmt --check
forge build --sizes          # all five contracts must be under 24,576 B
forge test
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'
```

### 2. Dry run
```bash
forge script script/Deploy.s.sol --rpc-url mezo_testnet
```
Prints the addresses as JSON and writes `deployments/<chainid>.json`. No key required.

### 3. Deploy
```bash
cast wallet import maren-deployer --interactive   # never use a raw key

MAREN_ADMIN=0x...      \
MAREN_KEEPER=0x...     \
MAREN_GUARDIAN=0x...   \
VAULT_DEPOSIT_CAP=5000000000000000000 \
forge script script/Deploy.s.sol \
  --rpc-url mezo_testnet --broadcast --account maren-deployer \
  --verify --verifier blockscout \
  --verifier-url https://api.explorer.test.mezo.org/api
```

Deployment order matters: `MarenRegistry` before `MarenPay`. Nothing in the script opens the
pooled trove — that is a separate, deliberate keeper action after the deployment is reviewed.

> **Why verification is on the command line and not in `foundry.toml`.** foundry 1.4.3 resolves
> its `[etherscan]` table by looking the chain id up in a built-in chain list, and Mezo is not in
> it. *Any* `[etherscan]` entry naming 31611 or 31612 makes `forge script` fail outright with
> `Error: Chain 31611 not supported`, before it does anything else. Verified by bisection. The
> `--verifier blockscout --verifier-url ...` flags work today. Note the `api.` subdomain —
> `explorer.mezo.org/api` without it 404s.

### 4. Open the pooled trove
Compute hints off-chain from `SortedTroves` / `HintHelpers`, then, as `KEEPER_ROLE`:
```bash
cast send $VAULT "openPooledTrove(uint256,address,address)" \
  1800000000000000000000 $UPPER_HINT $LOWER_HINT \
  --value 1ether --rpc-url mezo_testnet --account maren-keeper
```
The drawn 1,800 MUSD stays in the vault as `reserveMUSD`, so the vault's outstanding debt
immediately afterwards is only the 0.1% origination fee — which is charged to the protocol's own
position, not to users.

### 5. Post-deploy checklist
- [ ] `MAREN_ADMIN` is a multisig on mainnet, not an EOA.
- [ ] `KEEPER_ROLE` and `GUARDIAN_ROLE` granted, and the deployer's `DEFAULT_ADMIN_ROLE`
      renounced if it was a throwaway.
- [ ] `depositCap` set to the reviewed launch number.
- [ ] Keeper bot running, with alerting on `MarenVault.isLiquidatable` and on the trove's own
      ICR — the protocol liquidates on the latter.
- [ ] Relayer allowlist updated with the deployed addresses and the non-payable selectors
      (`borrow`, `repay`, `withdraw`, `closePosition`, plus all of `MarenPay` and
      `MarenRegistry`).
- [ ] `packages/sdk/src/addresses.ts` updated from `deployments/<chainid>.json`.
- [ ] Third-party audit before mainnet, per `docs/ARCHITECTURE.md` §7. **Audit scope is
      `MarenVault`, `MarenForwarder` AND `MarenRelayHub`** — the hub holds no funds, but it can
      make an arbitrary allowlisted call appear to come from any user who has signed anything,
      and it moves fees under user allowances. It carries authority, which is the thing worth
      auditing.

---

## Integration with `apps/relayer`

`test/RelayerIntegration.t.sol` is the contract half of that seam. It pins the exact EIP-712
constants the relayer must reproduce and proves them with a real `execute` round trip:

| | |
|---|---|
| `ForwardRequest` typehash | `0x7f96328b83274ebc7c1cf4f7a3abda602b51a78b7fa1d86a2ce353d75e587cac` |
| Type string | `ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)` |
| Domain | name `Maren Forwarder`, version `1`, plus chainId and verifyingContract |

Four things the relayer needs to know:

1. **No Maren function takes a trailing `uint256 relayFee`, and none will.** Charge fees through
   `MarenRelayHub.executeWithFee`, where `feeToken`, `feeAmount` and `feeRecipient` are members
   of the signed `RelayedCall` struct. Build the digest with `relayedCallDigest(...)` rather
   than transcribing the type string — a one-character difference means every sponsored
   transaction fails signature recovery in production and nothing catches it first.
2. **`executeBatch` is NOT atomic for inner-call failures**, in either mode. OpenZeppelin's
   `atomic` flag governs *validation* only — untrusted target, expired deadline, bad signature.
   The inner call is a raw `call` whose `success` is recorded and used for nothing but refunding
   `value`. So a batched fee leg settles even when the work leg reverts, including with
   `refundReceiver == address(0)`. Proven by `test_executeBatchIsNotAtomicForInnerCallFailures`.
   **This is why `MarenRelayHub` disables `executeBatch` outright.** Single `execute` does
   bubble the inner revert and remains available as the fee-free sponsored path.
3. **Nothing relays until it is allowlisted.** `MarenRelayHub` enforces a per-`(target,
   selector)` allowlist on both the fee path and `execute`. `Deploy.s.sol` seeds it; anything
   added later needs an explicit `setAllowedCalls` from `RELAY_ADMIN_ROLE`.
4. **Value-bearing calls are not relayable** — the hub rejects them. The vault is built for it:
   `deposit()` is the only payable entrypoint, and `borrow` / `repay` / `withdraw` /
   `closePosition` are separate non-payable externals. A user pays for their first deposit and
   everything afterwards can be sponsored.

Use `apps/relayer`'s allowlist as a second layer, not the only one. The hub's allowlist is the
one that is on-chain and cannot be bypassed by a compromised relayer key.

---

## Dependencies

Git submodules, pinned by tag:

| | Version | Commit |
|---|---|---|
| `lib/openzeppelin-contracts` | v5.4.0 | `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` |
| `lib/forge-std` | v1.9.7 | `77041d2ce690e692d6e03cc812b57d1ddaa4d505` |

```bash
git submodule update --init --recursive
```
