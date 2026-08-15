# Talise → Maren Finance: Rebuild Blueprint

> **Purpose.** This is the reference document for rebuilding Talise (a Sui-based dollar wallet) as **Maren Finance** on **Mezo** (an EVM L2 where **BTC is the native gas token** and **MUSD** is a BTC-backed stablecoin — users borrow MUSD against BTC without selling).
>
> **Source analysed.** `/Users/eromonseleodigie/Talise` — a complete local working checkout of `github.com/SeventhOdyssey71/talise-main`, HEAD `47e683e7` (2026-08-14), verified identical to remote HEAD.
>
> **Verified coverage.** 25 Move modules · 68 web page routes · 229 API routes · 150 Swift files · 54 Expo routes · 6 CLI commands. All read directly from source, not from documentation.
>
> **Audience.** Build agents. Assume no prior context. Where this document contradicts Talise's own docs, **this document is right** — see §10, Doc-vs-Code Discrepancies.

---

## Table of contents

1. [What Talise is](#1-what-talise-is)
2. [Core user flows, traced end to end](#2-core-user-flows-traced-end-to-end)
3. [Tech stack](#3-tech-stack)
4. [Move contract data model](#4-move-contract-data-model)
5. [Design system](#5-design-system)
6. [What made Talise good](#6-what-made-talise-good)
7. [The port map](#7-the-port-map)
8. [DO NOT REPEAT — security rules](#8-do-not-repeat--security-rules)
9. [Business model](#9-business-model)
10. [Doc-vs-code discrepancies](#10-doc-vs-code-discrepancies)

---

## 1. What Talise is

### One-line pitch

> **"Money that moves like a message."**

A gasless US-dollar account on Sui. Sign in with Google, hold dollars, and send them to a name like `vanessa@talise.sui`. No seed phrase, no gas, settles in under a second.

### The problem it solves

From `docs/strategy/STRATEGY.md`:

> *"Africans lose money every day they hold local currency. We let them save and spend in dollars without ever touching a US bank, a seed phrase, or a 7% remittance fee."*

Nigeria-first. The supporting data table: Africa on-chain crypto volume $205B (+52% YoY); stablecoins are 43% of Sub-Saharan African flow; Nigeria received $92.1B/yr; the naira lost ~70% against USD in a decade; Western Union averages a 6.4% fee; $21B/yr diaspora remittance to Nigeria; the CBN's May-2026 naira-only IMTO rule made existing rails slower.

The litepaper (`docs/product/LITEPAPER.md`, v1.2) frames the technical thesis:

> *"On talise, a payment is a financial action. A single send can round up, route a slice into yield, and mint an on-chain receipt — composed into one signed transaction on Sui, where every step lands together or none does."*

### The real feature set (as evidenced by code, not marketing)

The README undersells this badly. It is a full neobank, not a send-money demo.

| Capability | Code evidence |
|---|---|
| Gasless USDsui send by handle | `0x2::balance::send_funds` at `gasPrice=0`; `app/api/send/*` |
| Sponsored (non-gasless) rail | Onara gas station; `app/api/zk/sponsor*` |
| Claimable payment links ("cheques") | `talise::cheque`; hashlock + expiry + Walrus-encrypted note |
| Streaming payments | `talise::stream`; per-tranche release on Sui `Clock` |
| Team payroll + batch payouts | `talise_payroll`, `talise_payroll_streams`, `batch_pay` (≤50 recipients atomic) |
| Programmable money rules | `talise_automations::standing_order`; permissionless `execute_due` |
| Savings goals vault | `talise_goals::goal_vault` |
| Yield / lending | NAVI (default, ~5% APY), Suilend, Scallop, AlphaLend, DeepBook margin; `talise_yield::yield_router` |
| Shielded private sends | `talise_privacy` — full Groth16 BN254 2-in/2-out shielded pool |
| Selective disclosure | `lib/shield/disclosure/*`, `/app/private/disclose` |
| Fiat on-ramp | Transak (live), Bridge virtual accounts, Stripe Crypto Onramp, Circle Mint |
| Fiat off-ramp | Linq (NGN, live), Bridge (US ACH / SEPA), + M-Pesa/PayNow/Zengin stubs |
| KYC | Bridge hosted — no PII touches Talise |
| Invoicing | `@mysten/payment-kit` on-chain receipts |
| Perps trading | WaterX, at `perps.talise.io` |
| AI copilot | DeepSeek + Walrus MemWal persistent memory |
| Rewards / referrals / round-up-and-save | `lib/rewards/*` |
| Multi-currency display "pockets" | 13 currencies, display-only |
| Scan-to-pay | QR + Vision OCR of bank placards |
| Business workspace | `BUSINESS_NAV` over the same shell |
| Internal team studio | `/studio` |
| Admin console | 9 screens |
| CLI + MCP server | `@talise/cli`, agent-to-agent payments |

### Every screen / route

**Consumer app (`/app`)** — Home · Activity · Agent (copilot) · Earn · Earn/Rewards · Pay (Send) · Pay/Cheques · Pay/Request · Pay/Stream · Private · Private/Disclose · Ramps · Ramps/Cashout/NG · Ramps/Cashout/US · Requests · Rewards · Rules · Settings · Shield-Prove (hidden 0×0 prover harness) · Verify (KYC) · Work · Work/Invoices/[id]

**Business (`/business`)** — Dashboard · Invoices · Team · Pay · Ramps · Activity · Settings (+ marketing landing)

**Studio (`/studio`)** — Pulse · Tasks · Docs · Team · Hiring

**Admin (`/admin`)** — Overview · Users · Transactions · Waitlist · Compliance · Ledger · Rewards · Growth · Raw · Login

**Public money surfaces (deliberately ungated — this is how non-members receive money)** — `/c/[id]` cheque claim · `/i/[id]` invoice · `/req/[id]` request · `/pay/[handle]` · `/u/[handle]` profile · `/r/[code]` referral

**Marketing / content** — `/` (renders the v3 blueprint design) · `/v2` (archived mint design) · `/v3` · `/blog` + 3 posts · `/pitchdeck` · `/privacy` · `/terms` · `/support` · `/analytics` (public) · `/dashboard-analytics` (admin) · `/infra` (speed dashboard) · `/perps` · `/waitlist` · `/litepaper`

**229 API routes** grouped as: auth · zk · send · shield · streams · cheques · requests · invoices · contracts · payouts · rules · earn · yield · markets · predict · onramp · offramp · linq · bridge · kyc · rewards · referral · admin · analytics · cron · agent · chat.

---

## 2. Core user flows, traced end to end

### 2.1 Onboarding (zkLogin)

1. Client generates an ephemeral Ed25519 keypair → `sessionStorage` (web) / Keychain (iOS) / `~/.talise` (CLI).
2. `GET /api/auth/mobile/start?ephemeralPubKey=…` — **server-mediated OAuth**. This is load-bearing: zkLogin derives the address from `(iss, aud, sub)`, so a native OAuth client ID would produce a **different Sui address** for the same human. The backend therefore always uses the *web* client credentials regardless of platform.
3. The OAuth `nonce` is the Poseidon hash of `(extendedEphemeralPubKey, maxEpoch, jwtRandomness)`. Google embeds it verbatim into `id_token.nonce`; the prover later verifies it. **This binding is what stops an attacker swapping in their own ephemeral key** — `sponsor-execute` reads the tuple from the `mobile_sessions` row, never from the client.
4. `shinami_zkw_getOrCreateZkLoginWallet(jwt)` → `{address, salt}`. Shinami manages the salt deterministically per `(iss, sub)` (`lib/shinami.ts`).
5. Proof generation: self-hosted GPU prover → CPU prover → Shinami fallback (`lib/zksigner.ts::callProverWithFallback`, 8s per-attempt timeout, `ZK_PROVER_PRIMARY` / `ZK_PROVER_FALLBACK` / `ZK_PROVER_CANARY_PCT`).
6. JWT + salt stored in an encrypted, httpOnly, 1-hour cookie. `maxEpoch = current + 3` (~72h).
7. Handle claim → `POST /api/username/claim` mints a `name.talise.sui` SuiNS subname bound to the user's address.

**CLI variant** (`cli/src/auth.ts`) is a **browser loopback flow**, not a device flow: binds `127.0.0.1:0`, generates the seed locally, uses a random CSRF token compared with `timingSafeEqual`, shapes OAuth `state` as `cli.<port>.<csrf>.<rand>`. Session at `~/.talise/session.json` mode `0600`, with a base-URL allowlist that validates **even the persisted file**, so a tampered session cannot redirect the bearer token to an attacker host. Talise's own audit contrasts this favourably against the mobile bearer delivery (see §8, rule H-M1).

---

### 2.2 Send money to a handle — the flagship flow

**Step 1 — Amount.** `components/app/pay/SendFlow.tsx` (1,167 lines). Four-step stepper: `amount → recipient → review → success|failure`.

**Step 2 — Recipient resolution** (debounced 280ms, sequence-guarded). A raw `0x` address short-circuits with no network round-trip.

**Step 3 — `GET /api/recipient/resolve?q=<input>`.** Auth required — *"we don't want to leak the handle table to crawlers."* Returns `{address, displayName, recipientBank, shieldIdentity}`.

Resolution logic (`lib/suins.ts`): **on-chain SuiNS is the source of truth.** An ordered candidate list is tried:

```
alice              → [alice.talise.sui, alice.sui]
alice@talise       → [alice.talise.sui]
alice@talise.sui   → [alice.talise.sui]
alice.talise.sui   → [alice.talise.sui]
alice.sui          → [alice.sui]
sub.alice.sui      → [sub.alice.sui]
0x<64 hex>         → bypasses SuiNS entirely
```

Talise subnames are preferred when both could resolve — *"we send to the Talise user because that's what 'alice' means in our app context."* Normalization in `lib/handle.ts`: `USERNAME_RE = /^[a-z0-9_]{3,20}$/`, reserved set `{admin, talise, support, help, api, www, root}`.

Additively and best-effort (never fails resolution): a **masked** recipient bank (`bankName` + `last4` only) and the recipient's shield identity (Poseidon spend pubkey + P-256 encryption pubkey).

**Step 4 — `POST /api/send/sponsor-prepare {to, amount, asset, sponsorFallback?}`** (`route.ts`, 1,062 lines). This route replaced an older two-hop design, saving ~500–800ms. In order:

- **Concurrent gates:** `denyUnlessAppApproved(userId)`, `rateLimitAsync({limit: 30, windowSec: 3600})`, `userById`. Denial precedence: allowlist → rate limit → user row.
- **Validation:** `0x` + 64 hex, no self-send, asset ∈ `{USDsui, SUI}`, positive amount. Gasless minimum **0.01 USDsui = 10,000 micro** → `BELOW_GASLESS_MINIMUM`.
- **Compliance hard stop:** `screenTransfer()` runs *before any signable bytes exist*. Sanctions matching is **fail-closed**; on-chain address risk is **fail-open**. Block → 403 `SCREENING_BLOCK`.
- **Send-limit gate:** `checkSendAllowed(userId, amountUsd)` — tier-based rolling daily/monthly caps. 403 `LIMIT_EXCEEDED`. Fail-open by contract, so a flaky DB never 500s a legitimate send.
- **Round-up plan:** `getRoundupConfig` / `planRoundup` (60s memo).

**Step 5 — Rail choice.** This is the subtle part:

```ts
tryGasless = asset === "USDsui" && !belowGaslessMin && !saveActive
```

**A round-up-ON send skips the gasless rail entirely and goes straight to sponsored.** The reason: the validator's gasless allowlist admits only `0x2::balance::send_funds<T>`, so a NAVI supply call provably cannot ride along in the same transaction.

**Step 6a — The gasless branch.** The free rail, and the mechanics matter:

```ts
// The money movement — pulls straight from the Address-Balance accumulator
tx.moveCall({
  target: "0x2::balance::send_funds<0x44f838…::usdsui::USDSUI>",
  arguments: [tx.balance({ type, balance }), tx.pure.address(to)]
})

tx.setGasPrice(0n)      // must be explicitly zero
tx.setGasBudget(0n)     // must be explicitly zero

// MANDATORY. A pure accumulator pull has no address-owned input, so there is
// no natural expiration anchor. Without this the transaction is unbounded.
tx.setExpiration({
  ValidDuring: {
    minEpoch,
    maxEpoch: minEpoch + 1n,
    chain: <base58 chainIdentifier>,
    nonce
  }
})

// THE LOAD-BEARING LINE. Flips needsTransactionResolution() to false, so
// tx.build() BCS-serializes entirely OFFLINE — no RPC round-trip — and
// produces bytes byte-identical to the old JSON-RPC build path.
tx.setGasPayment([])
```

An explicit gRPC `client.simulateTransaction` still runs, purely to preserve prepare-time error categorization. `setPendingInbound()` stashes recipient + amount + sender display name for the notification the submit leg will fire. `recordSend()` reserves against the rolling limit window. Returns `{bytes, mode: "gasless", save: {applied: false}, roundupUsd: 0}`.

**Step 6b — The sponsored branch.** Payment Kit rail:

```
coinWithBalance({ type: USDSUI_TYPE, balance: amountMicro, useGasCoin: false })
0x1::option::some<address>(receiver)
0xbc126f15…::payment_kit::process_registry_payment<USDSUI>(
  registry, nonce, amount, coin, receiverOpt, 0x6
)
```

The `process_registry_payment` call **is** the money movement for transfer kinds — do not also `transferObjects`. The package address is written explicitly because the SDK's unresolved MVR literal serialized to a zero address and the validator silently dropped the call.

For `asset === "SUI"`: a `0x2::clock::timestamp_ms(0x6)` shim is added (Onara's policy requires at least one MoveCall) plus `coinWithBalance` + `transferObjects`.

**The Spend+Save leg**, when round-up is on:

```
appendNaviSupply(tx, addr, grossUsd, { treasuryFeeBps: 100 })   // bounded by withDeadline(6000ms)
appendPaymentKitReceipt(tx, { kind: "invest", refs: { venue: "navi" } })
```

Critically: **the payment never fails because of the round-up.** On timeout or error the transaction body is rebuilt send-only. A `saveProof` HMAC binds the round-up to the digest the transaction *will* have, computed via `TransactionDataBuilder.getDigestFromBytes(bytes)` **before anyone signs**.

Gas: `setGasOwner(sponsor)`, `setGasPrice(referenceGasPrice)`, `setGasBudget(60_000_000n)`. The fixed budget is load-bearing — auto-selection could pick a dust coin and fail with "Insufficient gas".

Returns `mode ∈ {sponsored, sponsored-save, sponsored-coin-fallback, sponsored-anchor-fallback}`.

**Step 7 — Client signs.** Only the raw Ed25519 part:

```
sig = Ed25519(BLAKE2b256( intent[0,0,0] ‖ txBytes ))
serialized = base64( 0x00 ‖ sig(64) ‖ ephemeralPubKey(32) )
```

All three clients (web, iOS, Expo, CLI) do exactly this. **The server assembles the full zkLoginSignature** (proof + ephemeral sig + JWT metadata). The client never holds proof assembly.

**Step 8 — Execute.**
- `mode === "gasless"` → `POST /api/send/gasless-submit` → direct fullnode `executeTransaction`. **No Onara** — a gasless transaction needs only the user's signature.
- otherwise → `POST /api/zk/sponsor-execute` → `onara().sponsor({sender, txBytes, txSignature})` → Onara signs as gas owner and broadcasts.

One retry with a freshly-minted proof on `"Groth16 proof verify failed"`.

**Step 9 — Confirm / record.** Four best-effort, non-blocking legs: inline notification + analytics + `awardForTx` (unique claim key per `(user, digest, trigger)`); `POST /api/send/gasless-confirm` (for the iOS direct-broadcast rail, returns 204, 60s in-memory dedupe); `POST /api/send/save-confirm` (only when execute returned `save.status === "pending"` — explicitly *"not a queue and not a cron"*); `POST /api/tx/record` (the `tx_history` cache, whose header states plainly: *"tx_history is a hint/cache; for audit-grade truth we read chain directly"*).

Client dispatches `window.dispatchEvent(new CustomEvent("talise:tx", {detail: {digest}}))` so balance and activity hooks refresh.

#### The failure taxonomy — port this exactly

| Condition | Response | Rationale |
|---|---|---|
| `insufficient balance` | 400 | Honest, actionable |
| `ValidDuring` / `address-owned inputs` rejected | fall through → `sponsored-anchor-fallback` | Recoverable shape problem |
| `withdraw reservation` / `accumulator` / `InsufficientGas` **with** `sponsorFallback: true` | fall through → `sponsored-coin-fallback` | Caller opted in to paying |
| same **without** `sponsorFallback` | **400 `ACCUMULATOR_UNDERFUNDED`** | **A plain free send must never silently fall through to sponsored gas and cost Talise money.** The user is told their funds are in `Coin` objects rather than the accumulator. |
| MoveAbort / abort code | **422 `TX_ABORTED`** | A MoveAbort is deterministic — the same PTB aborts identically every time, so "try again" is a lie. 422 marks it as non-retryable. |
| Prover timeout | `PROOF_TIMEOUT` | Typed per-leg |
| Onara timeout | `ONARA_TIMEOUT` (default 26s, client backstop 50s) | Typed per-leg |

**The `FailedTransaction` trap — the single most important defensive detail in the codebase.**

Both Onara and the gRPC client return **HTTP 200 with a digest-bearing `FailedTransaction`** when a transaction aborts on-chain. A naive implementation reads "200 + digest" and reports a successful payment that never happened.

```ts
// Both routes parse the discriminated union:
{ $kind: "Transaction",       Transaction:       { digest } }  // success
{ $kind: "FailedTransaction", FailedTransaction: { digest } }  // FAILED — still has a digest
```

A `FailedTransaction` is **never** reported as a delivered send → 502 `TX_ABORTED`, "funds not moved". Every one of the three broadcast paths (direct fullnode, Onara `/sponsor`, worker-signed JSON-RPC via Hayabusa) has its own bespoke abort detection for this reason.

#### Move targets, send flow

| Rail | Target |
|---|---|
| Gasless USDsui | `0x2::balance::send_funds<0x44f838…::usdsui::USDSUI>` |
| Sponsored USDsui | `0x1::option::some<address>` + `0xbc126f15…::payment_kit::process_registry_payment<USDSUI>` |
| SUI asset | `0x2::clock::timestamp_ms` + `transferObjects` |
| Round-up leg | NAVI `depositCoinPTB` + `splitCoins`/`transferObjects` to treasury at 100 bps + second PK receipt `kind=invest` |

---

### 2.3 Private (shielded) send — deposit → prove → withdraw

Env-gated and **dormant unless `SHIELD_PKG` + `SHIELD_POOL_USDSUI` are set**, with an independent `SHIELD_MAINTENANCE` kill switch and a third flag `SHIELD_INAPP_SEND_ENABLED`. The package ID is deliberately not hardcoded — *"the shielded pool has no mainnet money before the Phase-2 ceremony + audit + legal gates clear."*

**Two legs, two different signers. That asymmetry is the privacy mechanism:** the deposit is user-signed (zkLogin + Onara gas); the withdraw is **relayer-signed**. That is what severs the on-chain link between sender and recipient.

1. **Key derivation.** `pubkey = Poseidon1(sk)`, seed never leaves the device. Encryption key derived to P-256.
2. **Spend-existing-note fast path.** Before depositing, try to satisfy the send from notes already held.
3. **Merkle path.** `POST /api/shield/merkle-path` returns 26 `[left,right]` authentication pairs, performing a **live catch-up index** (in-flight promise sharing, 2.5s rate limit) so a just-landed commitment is usable in seconds rather than waiting on the 2-minute cron.
4. **Prove in-page.** Witness assembly is a line-for-line port of `circuit/src/prover.rs`:
   ```
   commitment = Poseidon4(amount, pubkey, blinding, pool)
   signature  = Poseidon3(sk, commitment, pathIndex)
   nullifier  = Poseidon3(commitment, pathIndex, signature)
   public_amount = +value        (deposit)   /   mod(0 - amount)  (withdraw)
   ```
   Groth16 runs in a **Web Worker** with real browser entropy, producing 128-byte compressed proof points and 8 public inputs.
5. **Encrypt output notes** (P-256 ECIES). On a deposit both are self-encrypted so the note is always recoverable on-chain by `scanNotes(viewingKey)`.
6. **`POST /api/shield/deposit/prepare`** — per-transaction cap **`MAX_DEPOSIT_MICROS = 2_500_000n` ($2.50 pilot cap)**. Move calls:
   ```
   ${SHIELD_PKG}::proof::new<USDSUI>(pool, points, root, publicValue, n0, n1, c0, c1)
   ${SHIELD_PKG}::ext_data::new(value, /*sign*/ true, /*relayer*/ userAddress, /*fee*/ 0, enc0, enc1)
   coinWithBalance({ type: USDSUI_TYPE, balance: amountMicros, useGasCoin: false })
   ${SHIELD_PKG}::shielded_pool::transact<USDSUI>(pool, depositCoin, proofArg, extArg) -> Coin
   transferObjects([out], userAddress)
   ```
   On the deposit leg `ext.relayer` must equal the sender, because on-chain `ext_data::assert_relayer` requires it.
7. **Wait for the commitment to index**, then prove and relay the **withdraw** with `outputRecipient = exitAddress`.
8. **`POST /api/shield/relay {txBytes, exitAddress?}`** — four stages: **gate** → **screen** (the exit address must be declared off-chain because `ExtData` carries no recipient by design) → **validate** → **sponsor + execute**.

**The validate stage is THE security control** (`lib/shield/validate-commands.ts`, 491 lines). The relayer signs as sender on a *user-supplied* PTB, which is a blank cheque unless the shape is pinned exactly:

- Exactly **one** MoveCall, targeting `${SHIELD_PKG}::shielded_pool::transact[_with_account]`, package ID pinned via `normalizeSuiAddress`.
- Exactly one `proof::new` and one `ext_data::new`; no foreign packages.
- Only `SplitCoins`, `MergeCoins`, `MakeMoveVec` permitted alongside. Everything else (`TransferObjects` beyond the pinned one, `Publish`, `Upgrade`, a second MoveCall) is rejected.
- `ExtData.relayer == our relayer address` (read positionally at arg 2).
- `relayerFee <= SHIELD_MAX_RELAYER_FEE` (arg 3).
- A single `TransferObjects` pinned to the pre-screened exit address.

Reject → 400 `INVALID_PTB`, **bytes never forwarded to the gas station**.

Because `coin::zero` is not on the allowlist, the withdraw's deposit-coin slot uses a non-destructive `splitCoins(relayerCoin, [0])`.

9. **Abort handling.** Onara returns HTTP 200 with a `FailedTransaction` when a withdraw aborts on-chain (e.g. a TOCTOU root rotation or a concurrent nullifier spend that passed simulation) → 502 `WITHDRAW_ABORTED`, *"the recipient was not paid and the input note must not be treated as consumed."*

10. **Indexer.** `POST /api/cron/shield-indexer` scans `NewCommitment` / `NullifierSpent`. Note the deliberate split: `SHIELD.module = "events"` (where types are *defined*) vs `SHIELD.emitModule = "shielded_pool"` (what the event filter must *match*). Filtering by `events` returns nothing — the original indexer did exactly that.

---

### 2.4 Earn / yield — supply and withdraw

A **two-hop** pipeline, distinct from sends: the earn prepares return a transaction **kind** (no gas data), so `/api/zk/sponsor` must wrap it before signing.

**Supply:** `POST /api/earn/supply/prepare {venue, amount}` → `POST /api/zk/sponsor {transactionKindB64}` → sign → `POST /api/zk/sponsor-execute`.

Venues: `navi | best` (`best` picks the highest live APY, falling back to NAVI). Scallop is disabled (`SCALLOP_SUPPLY_ENABLED = false`) because the pinned version object is stale and `mint::mint` aborts with code 513. DeepBook margin was removed as a *supply* venue on 2026-07-30 (USDsui borrow demand ~0 → realized APY ~0) but is still accepted on *withdraw* so existing positions can exit.

Coin sourcing (`sourceUsdsuiCoin`) handles **both** `Coin<USDSUI>` objects and the Address-Balance accumulator via `0x2::coin::from_balance` — a coins-only `coinWithBalance` silently broke earn supply for accumulator-funded users. A 100 bps treasury fee is split off first; the deposit takes an explicit *amount*, not "whatever is in the coin", so the post-fee figure must be tracked or the call aborts with 46001.

**Withdraw** must run `updateOraclePriceBeforeUserOperationPTB` (the Pyth refresh NAVI requires for its health check) before `withdrawCoinPTB` — the old skip-Pyth branch left an undestroyed hot-potato in the PTB.

Every earn transaction appends a Payment Kit receipt as a 1-micro self-ping carrying a typed memo (`talise/v1|invest|…|venue=navi`) so the activity classifier reads the kind authoritatively off-chain rather than sniffing MoveCall packages.

```
0x1e4a13a0…::lending::create_account
0x1e4a13a0…::incentive_v3::deposit_with_account_cap<USDSUI>
0x1e4a13a0…::incentive_v3::withdraw_with_account_cap<USDSUI>
0xf95b0614…::lending_market::deposit_liquidity_and_mint_ctokens<MAIN_POOL, USDSUI>
0xe48b33ef…::alpha_lending::{create_position, add_collateral}<USDSUI>
0xa58f2dee…::yield_router::{mint_position, deposit_receipt}
```

---

### 2.5 Cheques — claimable payment links

Two interchangeable rails picked **per-cheque at runtime**, never by a global flag:
- **On-chain** (`CHEQUE_PACKAGE_ID` set): funds live in a per-cheque shared `Cheque<USDSUI>` object.
- **Escrow + scheduler** (the live fallback): a server-custodied escrow keyed by a hashed claim secret.

*Keying the decision off the global flag treated every escrow cheque as on-chain and failed it with `missing_cheque_object`.* A cheque with a `cheque_object_id` is on-chain; one without is escrow.

**Create** → DB row + `secret = randomBytes(32)`, `secret_hash = sha256hex(secret)`. `claimUrl = https://…/c/{id}#{secret}` — **the secret lives in the URL fragment, so it never reaches a server log**.

**Claim** → `POST /api/cheques/{id}/claim/release {secret, turnstileToken}`. `timingSafeEqual` against `secret_hash`; Cloudflare Turnstile captcha, VPN detection and country allowlist enforced **server-side**. Then the lock is taken with a single atomic statement:

```sql
UPDATE cheques SET status='claiming'
WHERE id=? AND status='funded' AND expires_at > ?
RETURNING …
```

Zero rows → `not_claimable`. **That one statement is the double-claim guard on the escrow rail**; the contract's one-shot `claimed` flag is the guard on-chain. On throw, status rolls back to `funded` so the claimer can retry.

`voidCheque()` is rail-aware and **refuses to touch the escrow on the on-chain rail** — the money is in the `Cheque` object, and an escrow transfer would mis-pay from another cheque's balance.

A cron sweep cranks the **permissionless** `reclaim_expired` (v2 only; the older creator-only `reclaim` could not be cron'd).

---

### 2.6 Streams

`lib/streams.ts` header states the design plainly: **"THERE IS NO SCHEDULER."**

A stream is a real shared `Stream<USDSUI>` object holding the full amount as `Balance<USDSUI>`. The on-chain `Clock` decides what is due. Money moves when anyone calls the **permissionless** `claim_accrued`, which hard-transfers every due tranche to the contract-hardwired recipient. Because the destination is fixed at creation, both parties' apps can safely fire due claims on open.

**Truth model:** ACCRUED (pure schedule arithmetic) is kept strictly separate from RELEASED (mirrored only from the contract's own `tranches_done` / `released_amount`). The UI shows RELEASED as progress and ACCRUED only as "ready to claim". `completed` is derived, never stored.

**Pause and cancel each compose `claim_accrued` ahead of themselves in the same PTB.** Without that, stopping a stream would claw back tranches the Clock had already earned the recipient — they sit unclaimed in escrow and `cancel_and_withdraw` refunds the lot to the sender. The one exception is an already-paused stream, where `claim_accrued` would abort on `EPaused`.

```
${STREAM_PKG}::stream::create<USDSUI>
${STREAM_PKG}::stream::claim_accrued<USDSUI>        // PERMISSIONLESS
${STREAM_PKG}::stream::pause<USDSUI>                // sender-only
${STREAM_PKG}::stream::resume<USDSUI>               // sender-only
${STREAM_PKG}::stream::cancel_and_withdraw<USDSUI>  // sender-only, returns Coin
```

---

### 2.7 On-ramp and off-ramp

**No contract calls exist on either ramp** (verified by grep across all ramp libraries and routes). The on-chain leg is a plain transfer to a provider-watched address, or a Cetus swap. Every provider integration is env-gated and **fails closed**.

**On-ramp, three coexisting rails:**
- **Transak** (live) — hosted widget with the user's Sui address locked in; tiered KYC happens inside Transak's widget so Talise collects no identity fields. Delivers **USDC**, so a Cetus swap leg converts to USDsui.
- **Bridge virtual accounts** (default provider) — issues the customer a persistent bank account number / IBAN; **fiat deposited there is minted on Sui straight to the user's own address.** Explicitly: *"non-custodial, so Talise performs NO server-side credit and the on-ramp has no double-credit surface at all."* **This is the model Maren should copy for MUSD funding.**
- **Stripe Crypto Onramp** (legacy) — deposits land directly in the Address-Balance accumulator, which is exactly what the send route's `ACCUMULATOR_UNDERFUNDED` error points users at.

**Off-ramp** is a provider-agnostic layer: `config` (fail-closed product gate), `registry` (currency → *ordered* primary/fallback providers), `provider` (idempotent `submitPayout`), `breaker` (circuit breaking), `status` (**monotonic** phase writes — terminal states are sticky), `reconcile`, `caps`, `store`.

Live rails are **Linq (NGN)** and **Bridge (USD/EUR)**. `paynow-sg`, `zengin-jp`, `mpesa-ke` and `generic-bank` are stubs, **deliberately unselectable outside development** — *"a stub reports 'pending' forever, which a user cannot distinguish from a payout that died."*

Linq flow: `resolve` (bank account → account name) → `quote` (locked rate) → `create` (fails closed **before any order exists**, so no deposit address is issued and no user is debited; idempotency via an `Idempotency-Key` header so a timeout retry replays rather than minting a second address) → **the ordinary send pipeline with `sponsorFallback: true`** (a cash-out must land; a dead end is worse than paying for gas) → `deposit` (records the digest as **evidence, not authorization** — *"the digest is not a grant… it tells reconciliation and support that the user believes they paid"*) → poll `status` + HMAC-verified webhook.

Linq disburses to the bank itself, so **Talise needs no treasury float**. Beta cap $200/withdrawal and $200/day. `LINQ_BASE_URL` is runtime-overridable *"so a real-money payout rail's endpoint is not pinned by a code deploy and can be moved during an incident."*

---

## 3. Tech stack

### Web (`web/`)

| | |
|---|---|
| Framework | Next.js `^15.5` App Router, React `^19`, TypeScript `^5.6` |
| Runtime | Node ≥22, pnpm 10.19 |
| Styling | **Tailwind v4**, CSS-first `@theme` — **there is no `tailwind.config`** |
| Components | shadcn/ui (new-york, zinc base, CSS variables) — but only `dropdown-menu` and `select` are actually used; everything else is bespoke |
| Icons | **Hugeicons** (`@hugeicons/react`) primary; lucide-react present via shadcn |
| Animation | framer-motion `^12.38` (in-app, dynamically imported), **GSAP `^3.15` + ScrollTrigger** (marketing), **Lenis `^1.3`** (momentum scroll) |
| Charts | lightweight-charts `^5.2` |
| PDF | `@react-pdf/renderer` `^4.6` (client-side statements) |
| **State management** | **None.** No SWR, React Query, Zustand or Redux. A hand-rolled module-level `Map` cache with in-flight dedupe, 30s revalidation, cross-component subscription and server-seeded hydration (`components/app/data/hooks.ts`), plus React Context for currency/toast and `useSyncExternalStore` for hide-amounts |
| Chain SDKs | `@mysten/sui ^2.23`, `@mysten/zklogin`, `@mysten/suins`, `@mysten/payment-kit`, `@mysten/deepbook-v3`, `@cetusprotocol/aggregator-sdk`, `@naviprotocol/lending`, `@t2000/sdk`, `@waterx/sdk` |
| Transport | **gRPC-first** (Hayabusa → QuickNode → Shinami → public fullnode) with a `lint:no-jsonrpc` CI guard. JSON-RPC retained only where gRPC misbehaves |
| Database | **Postgres** via the `postgres` driver, behind a libsql-shaped API for migration compatibility (`lib/db.ts`, 2,452 lines, ~75 tables) |
| Rate limiting | Upstash Redis REST (atomic `INCR`), in-process `Map` fallback, **fail-open** |
| Email | Resend + `@react-email` |
| AI | Vercel AI SDK v6 + **DeepSeek** (`deepseek-v4-flash`, thinking disabled for latency) |
| Storage | Walrus blobs (cheque notes), MemWal (agent memory) |
| Deploy | Vercel primary; Railway/Docker configs present |

### Auth and gas infrastructure (`infra/`)

- **zkLogin:** Shinami wallet + prover. **Not Enoki** — Mysten's hosted mainnet prover whitelists OAuth audiences and Talise's is not on the list.
- **Self-hosted provers:** `prover/gpu` (RunPod L4, ~$317/mo) and `prover/cpu` (Docker Compose, 3.2GB proving key), with Shinami as automatic fallback on any 5xx/timeout.
- **Gas station: Onara** — their own open-source policy server (Hono on Cloudflare Workers), published as `onara` on npm. Policy: `gasBudgetMax 100000000`, `maxCommands 50`, `targets: ["*"]`, allowed command kinds `SplitCoins, MergeCoins, TransferObjects, MoveCall, MakeMoveVec, Publish`. The `targets: ["*"]` wildcard is described in their own threat model as *"the largest single posture trade-off in the policy file."*

### iOS (`ios/`)

SwiftUI, **150 Swift files / ~47k lines**, iOS 18+, portrait-only, forced dark. Uses the **Observation framework** (`@Observable`, not `ObservableObject`). Custom `SuiGrpcKit` Swift gRPC client and a hand-rolled BLAKE2b. Navigation is a custom 4-tab floating pill (not `TabView`) — **Home · Finance · Rewards · Profile** — with every money flow as a `.fullScreenCover` dispatched via `NotificationCenter`, blurring the underlying tab by 14pt.

Session state machine: `launching → signedOut → onboarding → pinSetup → ready | locked`.

23 feature modules: Chat, Cheques, Contracts, Deposit, Earn, Home, Invoices, KYC, Onboarding, Payroll, PinEntry, Profile, Ramps, Receive, Requests, Rewards, Rules, Scan, Send, Stream, Trade, Wallet, Withdraw.

Private sends are iOS-only and run through a hidden **0×0 WKWebView** loading `/app/shield-prove` (authenticated via a bearer→web-session bridge), so the Groth16 proof is built in the user's own browser session and the relayer never sees note secrets. It is the only WKWebView in the app, with an origin gate (`isMainFrame` + host match) and a navigation gate.

### Mobile (`mobile/`)

**Expo SDK 57 + expo-router**, React Native 0.86, React 19.2, Reanimated 4.5, **54 routes**. An Android-first, screen-for-screen port of the iOS app, with `src/design/tokens.ts` mirroring `Tokens.swift` verbatim. **This is the highest-ROI starting point for Maren's mobile app** — RN + EVM tooling is far more mature than RN + Sui.

### CLI (`cli/`)

`@talise/cli` v0.1.0, ESM, Node ≥22. **Only runtime dependency is `@mysten/sui`** — the arg parser, MCP server and SSE reader are all hand-rolled. 2,471 LOC.

Commands: `login`, `logout`, `whoami`, `balance`, `activity`, `resolve`, `send`, `request`, `swap`, `save`, `withdraw`, `cashout`, `teams`, `batch`, `stream`, `ask`, `chat`, `agent {whoami,pay,recv,provision,wallets,revoke}`, `session {export,import}`, `mcp`.

The `mcp` command runs a **dependency-free MCP server** over stdio (JSON-RPC 2.0, protocol `2024-11-05`), exposing 6 tools. **Money safety:** `talise_send` requires `confirm: true`; without it, it resolves the recipient and returns `{dryRun: true, wouldSend: {...}}` and sends nothing.

---

## 4. Move contract data model

**9 packages, 25 modules, ~7,500 lines, zero external Move dependencies.**

### Deployment record (`docs/contracts/DEPLOYED.md`)

| Package / object | ID | Status |
|---|---|---|
| `talise` core (v7) | `0x8a807f53…eb9f3` | live |
| `talise_pay` (stream + cheque v1) | `0x4ba838c7ded1b57aededff4e825aa251858b05b720083856351dd8325094a13e` | live |
| ├ `stream::StreamRegistry` (shared) | `0x8209bffc…eab5af9c` | |
| ├ `cheque::ChequeRegistry` v1 (shared) | `0xfd010c37…a94ba13d` | |
| **cheque v2 (active)** | `0x097a9560a34766d4556f98881672e81f33c1c0c35188728813595cd05fb160a8` | live |
| └ registry v2 | `0xfab3729ac22049d8e428ebf5f2b64ccfc7151a00af6a880d594f8e46414b0767` | |
| `talise_privacy` | `0x87227907…6f9bf` | **dormant** (env commented out) |
| `talise_payroll_streams` | `0xcff874d3…54c7c` | env blank |
| `talise_goals` | `0xb0898eef5734ee9ebfbdbacd9e39533d7070159d4a87287ddde8a5b331059947` | live |
| `talise_yield` | `0xa58f2dee1dd01ac655ef2d9180a96228ab4667219049cfc1286752b3923ad730` | live |
| └ registry | `0x9ba71e51…c3d7e21` | |
| `talise_profile` | `0x2e09b4ab…67dd2` | live |
| `talise_automations` (v2) | `0x9d440636…64fb9a` | env blank |
| `talise_payroll` | `0x7a4b457c…16f7fc` | env blank |
| Sui Payment Kit (third-party) | `0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6` | live |
| Stream worker | `0x78cf4eab…e509123` | hot key |
| Cheque worker | `0x39d4ded1…c90b1ae7b` | hot key |

Settlement asset **USDsui** `0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI` (6 decimals) — a **third-party** Bridge-issued asset, not a Talise contract.

⚠️ `DEPLOYED.md` warns that after a `move-doctor` cleanup, **deployed bytecode has diverged from source** (event renames, `add_worker` / `remove_worker` / `set_paused` parameter reorders). Any worker script run against the live package must use the OLD argument order.

### Module by module

**`talise::receipt`** — owned `PaymentReceipt` NFT with a `Display` registration. Fields: sender, recipient, amount, coin type, memo, timestamp.

**`talise::send`** — atomic transfer + receipt mint. Memo capped at 80 bytes.

**`talise::batch_pay`** — `pay_many(recipients, amounts)`. Enforces an exact-sum invariant (`ESumMismatch`) and runs per-recipient compliance. ≤50 recipients in the product; the module tolerates more.

**`talise::compliance`** — shared `ComplianceRegistry` + `ComplianceAdminCap`. Denylist, allowlist, **global pause**. ⚠️ Its claim to be the "enforcement floor" is **false in practice**: `send` takes no registry argument, and `batch_pay` screens recipients but never `ctx.sender()`.

**`talise::vault`** — shared `TaliseVault` holding heterogeneous balances in a `Bag`, with a `SwapTicket` **hot-potato** enforcing atomic rotation.

**`talise::auto_swap`** — v1 plus a full v7 governance rewrite: two-step 48h admin rotation (with a snapshot that defeats shrink attacks), worker/oncall/treasury roles, daily budgets, destination and provider allowlists.

**`talise::remit_escrow`** — fiat off-ramp escrow where `commit` and `reclaim` are **mutually exclusive by construction**, not by a status check.

**`talise::stream`** — per-tranche release with an overflow-safe solvency guard that uses **division rather than multiplication** to avoid overflow.

**`talise::cheque`** — hashlock + bound recipient + expiry; at least one claim condition is required.

**`talise_privacy` — the flagship.** `ShieldedPool<CoinType>` is a shared object (one per coin) holding:
- a `PreparedVerifyingKey` (Groth16, BN254)
- a `Table<u256, bool>` nullifier set
- a `MerkleTree` as a dynamic **object** field — height **26** (≈67M leaves), **100-root ring buffer**, Poseidon BN254, two leaves appended per transaction
- a fail-closed `RelayerPolicy` dynamic field

One entry point, `transact()`, performs deposit / private transfer / withdraw, distinguished by a **signed public delta**.

The canonical **8 public inputs** — a reorder silently breaks soundness:

```
[ pool, root, public_value, nullifier0, nullifier1, commitment0, commitment1, hashed_secret ]
```

The SNARK invariant is `Σ inputs + public_amount = Σ outputs`, plus 248-bit range checks and distinct nullifiers. The relayer fee is capped at an immutable **500 bps** and — the key correctness fix — is payable **only on a public leg**, because a private leg's `public_value == 0` would make any fee unbacked value creation. `assert_compliant` checks `paused` **first**, so the kill switch covers private transfers too.

⚠️ Two facts a rewrite must know: (a) module comments claim a cross-package call to `talise::compliance::assert_clear_external` that **does not exist in the source**, and `talise-privacy/Move.toml` does not even declare that dependency; (b) the verifying key comes from a **single-party trusted setup** (`circuit/keygen.rs`, arkworks `OsRng`), fit only for an operator-trusted capped pilot.

**`talise_goals::goal_vault`** — `{create, create_with, deposit, withdraw, park_receipt, take_receipt, close}`. Parks a yield-venue receipt as a dynamic object field.

**`talise_yield::yield_router`** — `{mint_position, deposit_receipt}`, venue bitset + rotation caps.

**`talise_automations::standing_order`** — `{create, cancel, top_up, execute_due}`. The contract *is* the scheduler.

**`talise_payroll::payroll`** — `{create, set_roster, delete}`.
**`talise_payroll_streams::team_stream`** — `{create, release_due_tranche, cancel}`.
**`talise_profile::profile`** — `{create, set}`.

### Recurring patterns worth preserving

1. **Registry singleton + AdminCap + worker allowlist + global pause** — repeated across five modules.
2. **Hot-potato tickets** for atomicity.
3. **Permissionless-but-non-discretionary release** — `execute_due`, `release_due_tranche`, `claim_accrued`, `reclaim_expired`. Anyone may crank; destination and amount are immutable state, so there is no extraction surface.
4. **Cursor-advance-before-pay** as on-chain idempotency.
5. **Truncating split with creator-reclaimable dust.**
6. **Fail-closed defaults** on every gate.

---

## 5. Design system

> **UI agents: build from this section.** Two distinct systems exist. **iOS/Expo are dark. Web is light "engineering blueprint."** The canonical direction, chosen 2026-07-20, is **light / editorial** — `docs/design/THE-TALISE-DESIGN.md`.

### 5.1 Principles (verbatim from the design doc)

1. **Calm canvas, one accent.** A soft off-white ground; forest green is the single brand accent; mint is a bright highlight used sparingly (success, key numbers). Never more than one loud thing per view.
2. **Structure with hairlines, not boxes.** Thin rules and corner ticks imply a grid. Avoid heavy borders, drop shadows, and filled panels except product cards.
3. **Type carries the page.** TWK Everett for display and body; italic Everett for a single accent word; JetBrains Mono for labels, meta, and numbers.
4. **Meta in mono, uppercase, tracked.** Kickers, counters, footers and captions are mono uppercase with wide letter-spacing.
5. **Numbers are tabular.** Money and stats use mono / tabular figures and align.
6. **Whitespace is a feature.** Let headlines breathe; don't fill the frame.

### 5.2 Canonical colour tokens (verbatim)

```css
:root{
  /* ground */
  --canvas:#ecefe8;   /* page background (soft sage-white) */
  --panel:#f5f7f2;    /* raised surface / table header */
  --white:#ffffff;    /* product cards */

  /* ink */
  --ink:#121a0f;      /* near-black text (green-biased) */
  --muted:#55634e;    /* secondary text */
  --dim:#8a9784;      /* meta / captions */

  /* lines */
  --line:rgba(18,26,15,.14);
  --line-soft:rgba(18,26,15,.06);

  /* accents — ONE loud at a time */
  --forest:#2f6a1f;   /* primary brand accent */
  --mint:#caffb8;     /* bright highlight / success fill */
  --danger:#c0503f;   /* problem / negative */
  --gold:#a9791f;     /* "soon" / caution */
}
```

> *"Neutrals are deliberately **green-biased**, not pure grey. Pure white is reserved for product cards so they lift off the canvas."*

### 5.3 The web `@theme` block (verbatim, `web/app/globals.css`)

Tailwind v4 — **CSS-first, there is no `tailwind.config.js`.**

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --color-bg: #0a0e0b;
  --color-surface: #131815;
  --color-surface-2: #1b221e;
  --color-line: #ffffff12;
  --color-fg: #f2f4f2;
  --color-fg-muted: #b9c0bb;
  --color-fg-dim: #6f7872;
  --color-accent: #caffb8;
  --color-accent-light: #caffb8;
  --color-accent-deep: #4b8a37;
  --color-accent-soft: #2a2a2a;
  --color-danger: #e08d8a;

  --font-sans: "Google Sans Variable", "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-display: "Google Sans Variable", "Google Sans", system-ui, sans-serif;
  --font-mono: var(--font-mono), "JetBrains Mono", "SF Mono", Menlo, monospace;
  --font-serif: var(--font-serif), "Instrument Serif", Georgia, "Times New Roman", serif;
}

/* shadcn/ui token bridge — maps shadcn semantic names onto OUR brand tokens */
@theme inline {
  --color-background: var(--color-surface);
  --color-foreground: var(--color-fg);
  --color-card: var(--color-surface);
  --color-card-foreground: var(--color-fg);
  --color-popover: var(--color-surface);
  --color-popover-foreground: var(--color-fg);
  --color-primary: var(--color-accent-deep);
  --color-primary-foreground: #ffffff;
  --color-secondary: var(--color-accent-soft);
  --color-secondary-foreground: var(--color-fg);
  --color-muted: var(--color-surface-2);
  --color-muted-foreground: var(--color-fg-dim);
  --color-destructive: var(--color-danger);
  --color-destructive-foreground: #ffffff;
  --color-border: var(--color-line);
  --color-input: var(--color-line);
  --color-ring: var(--color-accent-deep);
}

:root { --radius: 0.75rem; }
```

The `@theme` defaults above are the **dark** base. Light themes are applied by scope classes on an inner wrapper, shadowing the variables via normal CSS inheritance:

```css
/* PRODUCT surfaces (/app + /business) — the blueprint skin */
.app-clean {
  --color-bg: #edf0ea;          /* neutral blueprint canvas */
  --color-surface: #ffffff;     /* white cards */
  --color-surface-2: #f4f6f1;   /* soft fill — chips, secondary tiles */
  --color-fg: #121a0f;          /* ink */
  --color-fg-muted: #55634e;    /* secondary text (AA) */
  --color-fg-dim: #8a9784;      /* tertiary / labels */
  --color-line: rgba(18, 26, 15, 0.12);
  --color-accent: #2f6a1f;      /* forest — links / accent text */
  --color-accent-light: #caffb8;
  --color-accent-deep: #2f6a1f; /* solid CTA fill (white text, AA) */
  --color-accent-soft: #e6efdd; /* soft mint — chip / pill backgrounds */
  --font-display: "TWK Everett", var(--font-display-v2), "Hanken Grotesk", system-ui, sans-serif;
  letter-spacing: -0.05em;      /* TWK Everett wants a tight -0.05em app-wide */
  color: var(--color-fg);
  background: var(--color-bg);
}

/* MARKETING landing — the airy two-green identity */
.landing-mint {
  --color-bg: #ecf8e0;
  --color-surface: #ffffff;
  --color-surface-2: #e6f5d6;
  --color-fg: #15300c;          /* deep ink-green primary text */
  --color-fg-muted: #46663a;    /* 6.5:1 on white — AA */
  --color-fg-dim: #557050;      /* 5.0:1 on mint — AA */
  --color-line: #cfe7bd;
  --color-accent: #3c7a2a;      /* forest — readable as accent TEXT on mint */
  --color-accent-light: #caffb8;
  --color-accent-deep: #3d7a29; /* CTA fill — 5.2:1 with white text (AA) */
  --color-accent-soft: #dcf2cc;
  background:
    radial-gradient(125% 62% at 50% -12%, #d6f4c2 0%, rgba(214,244,194,0) 58%),
    linear-gradient(180deg, #e7f6d7 0%, #f1faea 55%, #f7fcf2 100%);
  background-attachment: fixed;
}

/* CONTENT pages (legal, blog, docs) */
.bp-page {
  --color-bg: #ecefe8;  --color-surface: #ffffff;  --color-surface-2: #f4f6f1;
  --color-fg: #121a0f;  --color-fg-muted: #55634e; --color-fg-dim: #8a9784;
  --color-line: rgba(18,26,15,0.12);  --color-line-soft: rgba(18,26,15,0.06);
  --color-accent: #2f6a1f; --color-accent-deep: #2f6a1f;
  --color-accent-soft: #e6efdd; --color-accent-light: #caffb8;
  letter-spacing: -0.02em;
}
```

Overscroll is tinted to match whichever theme is mounted, using `:has()`, so rubber-band scrolling never flashes the dark root:

```css
html:has(.app-clean), html:has(.app-clean) body      { background: #edf0ea; }
html:has(.landing-mint), html:has(.landing-mint) body { background: #f7fcf2; }
html:has(.landing-v3), html:has(.landing-v3) body     { background: #ecefe8; }
```

### 5.4 iOS / Expo tokens (verbatim, `ios/Talise/DesignSystem/Tokens.swift`)

Dark-only. The Expo app's `src/design/tokens.ts` mirrors these 1:1.

```
bg                 #000000   page background
surface            #161616   flat card surface (activity, sheets, panels)
surface2           #242424   raised flat surface (chips, small action buttons)
surfaceGlass       #1C1C1C   flat card / nav pill
surfaceGlassStrong #2C2C2C   active nav pill (raised)
usernameCard       #161616
fg                 #FFFFFF   primary text
fgSubtle           #FAFAFA
fgMuted            #B5B5B5
fgDim              #636363
line               rgba(255,255,255,0.08)
accent             #79D96C   "Earn up to 11%" green
accentSoft         #2A2A2A
greenMint          #CAFFB8   mint — readable accent on dark
greenDeep          #4B8A37   forest — solid CTA fill
live / success     #79D96C
warmGold           #C08A3E
danger             #A05A3E

badgeSent          rgba(108,58,56,0.5)   /* #6C3A38 @ 0.5 */
badgeReceived      rgba(53,95,64,0.5)    /* #355F40 @ 0.5 */
badgeNeutral       rgba(74,74,74,0.6)    /* #4A4A4A @ 0.6 */

inkOnAccent        #0A140C   button label on accent/mint fills
primaryLabel       #F2FFEC   primary button label on greenDeep
```

Note: glassmorphism is **retired**. `TaliseGlass` still exists so 100+ call sites compile, but every member now returns a flat value — no specular gradients, no white sheens.

### 5.5 Spacing, radii, sizing

```
spacing   xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48
radius    sm 10 · md 14 · lg 20 · xl 25 (big cards) · pill 40 (bottom nav)
height    buttonSm 32 · buttonMd 40 · buttonLg 44
button    sm {h32, px12, fs12} · md {h40, px16, fs13} · lg {h44, px20, fs14}
web       --radius: 0.75rem
```

The app shell dials global rounding down at one point, because `rounded-3xl` / `rounded-2xl` read too soft:

```css
.talise-appshell .rounded-3xl { border-radius: 1.125rem; }  /* 24px → 18px */
.talise-appshell .rounded-2xl { border-radius: 0.875rem; }  /* 16px → 14px */
```

### 5.6 Typography

| Role | Family |
|---|---|
| Web display / headings | **TWK Everett** (Weltkern, licensed), fallback Hanken Grotesk |
| Web body / **all numbers** | **Google Sans Variable** (self-hosted via `@fontsource-variable/google-sans`, OFL-1.1) |
| Mono (labels, meta, addresses) | **JetBrains Mono** (next/font/google) |
| Accent word | **Instrument Serif**, italic available |
| iOS / Expo | **SF Pro** + **SF Mono** — *"the system font IS the brand here"* |

```css
--sans:'TWK Everett','Hanken Grotesk',system-ui,sans-serif;
--mono:'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

- **Display / headings** — TWK Everett Regular (`font-weight:500`), `letter-spacing:-.03em`, `line-height:1.04`. Large: 44–74px.
- **Body** — TWK Everett Light (`font-weight:400`), 16–19px, `line-height:1.5`, colour `--muted`.
- **Labels / kickers / meta** — JetBrains Mono, uppercase, `letter-spacing:.12–.20em`, 10–11px, colour `--dim` or `--forest`.
- Headings get `text-wrap:balance`; body measure ≤ ~60–65ch.

Two `@font-face` declarations ship **one** Everett Light file across the whole 100–400 range and Regular across 500–900, deliberately, so no heading ever renders bold:

```css
@font-face { font-family:"TWK Everett"; src:url("/fonts/TWKEverett-Light.otf") format("opentype");
             font-weight:100 400; font-style:normal; font-display:swap; }
@font-face { font-family:"TWK Everett"; src:url("/fonts/TWKEverett-Regular.otf") format("opentype");
             font-weight:500 900; font-style:normal; font-display:swap; }
```

**All numbers render in Google Sans**, enforced with `!important` so an inline Everett or mono on a figure loses:

```css
.app-clean .tabular-nums {
  font-family: "Google Sans Variable", var(--font-sans-v2), system-ui, sans-serif !important;
  letter-spacing: -0.02em;
}
```

### 5.7 Signature motifs

**Construction frame** — content sits in a column with `border-left` / `border-right` hairlines.

**Corner ticks** — small green `+` marks at the four frame corners, built from a 1px vertical plus a 1px horizontal bar:

```css
.tick{ position:absolute; width:11px; height:11px; }
.tick::before,.tick::after{ content:''; position:absolute; background:var(--forest); }
.tick::before{ left:5px; top:0; width:1px; height:11px; }
.tick::after{ top:5px; left:0; height:1px; width:11px; }
```

**Kicker** — mono uppercase label preceded by an 8px solid forest square: `■ CASH OUT · UNITED STATES`.

```css
.kicker{ display:inline-flex; align-items:center; gap:8px;
  font-family:var(--mono); font-size:11px; letter-spacing:.2em; text-transform:uppercase;
  color:var(--forest); }
.kicker::before{ content:''; width:8px; height:8px; background:currentColor; }
```

**Pill** — mono uppercase chip, white fill, hairline border, forest text, small leading dot.

```css
.pill{ display:inline-flex; align-items:center; gap:7px;
  font-family:var(--mono); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase;
  padding:8px 13px; border-radius:5px; background:var(--white); color:var(--forest);
  border:1px solid var(--line); }
.pill::before{ content:''; width:6px; height:6px; background:currentColor; }
.pill.nb::before{ display:none; }  .pill.soon{ color:var(--gold); }
```

**Product card** — white surface, hairline border, `border-radius:8–12px`; soft shadow only on real product mockups: `box-shadow:0 26px 60px -34px rgba(18,26,15,.5)`.

**Bracket buttons** — mono uppercase with 11px bracket corners at ±4px inset, 1.5px borders, `translateY(-2px)` on hover:

```css
.app-clean .bp-btn {
  height:46px; padding:0 22px;
  font-family:var(--font-mono), monospace; font-size:12.5px;
  letter-spacing:0.06em; text-transform:uppercase;
  transition: transform 180ms ease, background 180ms ease, color 180ms ease,
              border-color 180ms ease, opacity 180ms ease;
}
.app-clean .bp-btn:not(:disabled):hover { transform: translateY(-2px); }
.app-clean .bp-btn-solid { background: var(--color-accent-deep); color: #f4fbef; }
.app-clean .bp-btn-solid:not(:disabled):hover { background: #256016; }
.app-clean .bp-btn-ghost { background: transparent; color: var(--color-fg); border: 1px solid var(--color-line); }
.app-clean .bp-btn-danger { background: transparent; color: #b8503a; border: 1px solid #b8503a; }
```

**TopGlow** — the green horizon wash at the top of every authenticated page, with **identical stops in CSS and SwiftUI** so an onboarding→tabs transition has no visual jump:

```css
.talise-top-glow {
  position:absolute; top:0; left:0; right:0; height:360px;
  pointer-events:none; z-index:0;
  background:
    radial-gradient(ellipse 100% 90% at 50% -60%,
      rgba(75,138,55,0.55) 0%, rgba(75,138,55,0.18) 35%,
      rgba(75,138,55,0.04) 65%, transparent 100%),
    radial-gradient(ellipse 60% 50% at 50% 0%,
      rgba(202,255,184,0.30) 0%, transparent 50%);
  filter: blur(8px);
}
```

**Directional history rows** — borderless, hover-filled, tinted by direction:

```css
.app-clean .talise-history-row {
  background:transparent; border:1px solid transparent; border-radius:12px;
  transition: background 150ms ease, transform 150ms ease;
}
.app-clean .talise-history-row:hover { background: var(--color-surface-2); }
.app-clean .talise-history-row[data-direction="sent"]:hover     { background: color-mix(in srgb, #c95a4a 8%, var(--color-surface-2)); }
.app-clean .talise-history-row[data-direction="received"]:hover { background: color-mix(in srgb, #2f7d31 8%, var(--color-surface-2)); }
/* dark-theme tints: sent #c95a4a · received #4fb35e · invest #4b8a37 · withdraw #4fb35e */
```

**Success mark** — mint circle with a forest/ink check.

**Grain overlay** — an inline SVG `feTurbulence` at `opacity:0.025`, `mix-blend-mode:multiply`.

### 5.8 Animation vocabulary

Standard entrance easing is `cubic-bezier(0.22, 1, 0.36, 1)`.

```css
@keyframes taliseToastIn      { from{opacity:0; transform:translateY(10px) scale(0.98)} to{opacity:1; transform:translateY(0) scale(1)} }
@keyframes taliseSheetPanelIn { from{opacity:0; transform:translateY(16px) scale(0.99)} to{opacity:1; transform:translateY(0) scale(1)} }
.talise-toast-in     { animation: taliseToastIn 220ms cubic-bezier(0.22,1,0.36,1) both; }
.talise-sheet-panel  { animation: taliseSheetPanelIn 260ms cubic-bezier(0.22,1,0.36,1) both; }
.talise-sheet-backdrop { animation: taliseSheetBackdropIn 180ms ease both; }
```

- **Numeric transitions** — every money figure uses `.contentTransition(.numericText())` with `.snappy(0.18)` on iOS.
- **ScrapbookEntry** (iOS signature) — the celebration illustration drops in at `scale 1.16`, rotated `±6–7°`, lifted `-26pt`, with **low spring damping for a visible 1–2 wobble settle, "the way a paper cutout wobbles when you press it onto a scrapbook page."** Alternating tilt signs across stacked elements read as hand-placed rather than mechanical; `delay` staggers illustration then headline.
- **Paper plane** — a `.trim` draw-on followed by a perpetual ±4° flutter over 14 sine-driven shimmer bars.
- **CoinBurst / PiggySave** — success celebrations.
- **SlideToConfirm** — 58pt track, commits past 80%, springs back if released early, spinner while pending, checkmark + haptic on success, pointer events covering mouse and touch, with a real VoiceOver fallback.
- **Collage entrance** — two-stage: glow fades and scales first (1100ms, 80ms delay), artwork drops up from `translateY(28px) scale(0.94) blur(6px)` (1000ms, 220ms delay).

**Every animation honours `prefers-reduced-motion: reduce`.** Lenis smooth scroll is disabled inside `[data-lenis-prevent]` regions (sheets, dialogs, terminal panels).

### 5.9 Component inventory

Web (`components/app/ui/`): `AmountDisplay`, `BackButton`, `BankSelect`, `EmptyState`, `Field`, `Flag`, `GlassCard`, `GlassPill`, `Numpad`, `OptionRow`, `PrimaryButton`, `QrImage`, `Segmented`, `Sheet`, `SlideToConfirm`, `Spinner`, `StatusPill`, `Typography`.

Home (`components/app/home/`): `ActionPills`, `BalanceHero`, `DoMoreCard`, `IdentityCard`, `QuickActions`, `ReceiveSheet`, `RecentActivity`, `RewardBanner`, `ScanSheet`, `SecondaryActions`, `TokenBucketSheet`.

iOS (`DesignSystem/Components/`): `HeroNumber`, `LiquidGlassButton`, `LiquidGlassDivider`, `LiquidGlassPill`, `LiquidGlassSheet`, `OptionCardRow`, `PageHeader`, `ScrapbookEntry`, `SlideToConfirm`, `TaliseButton`.

The **Numpad** is a 3-column grid, `h-14` keys, `rounded-2xl`, `text-2xl`, `tabular-nums`, hover `#CAFFB8/50`, active `#CAFFB8`.

---

## 6. What made Talise good

Carry these forward. They are the actual product, not the chain.

1. **Honesty as a UI principle** — the strongest through-line in the codebase. Receipts render the *server-verified* outcome, never the hoped-for one (`saved` / `pending` / `failed` / `none`). Insights show `-` rather than a confident ₦0 on a partial response. The shield harness reports "finalizing" and *never fakes a success and never moves funds*. Gated features render explanatory states, not fake ones.

2. **One atomic transaction per user action.** Round-up-and-save is a leg of the send's own transaction — one signature, one digest. The receipt says "1 atomic transaction" and means it.

3. **The FX overspend guard.** `convertToUsd` returns **0**, not identity, when a rate hasn't loaded — because an `?? 1` fallback would make an NGN user typing "100" send **$100 instead of ₦100**, a ~1600× overspend. Returning 0 makes the send button refuse.

4. **Stale-while-revalidate everywhere.** Server-seeded balance snapshots paint on first byte. A zero from a non-fresh read can never clobber a non-zero already on screen. Activity never downgrades on a transient empty response. A 90s-TTL optimistic stub registry reconciles at 0s and 5s.

5. **Send-path warmers.** On idle the shell pre-mints the zkLogin proof, so the first send skips the 2–4s prover hop.

6. **Non-custodial automation.** The contract *is* the scheduler — no cron, no scheduler key. `execute_due` is permissionless precisely because recipient and amount are immutable state.

7. **The relayer command allowlist.** Parsing a user-supplied transaction and pinning its exact shape before signing as gas owner.

8. **Privacy that is actually private.** Proof built in the user's own session; note secrets never leave the device; cheque secrets live in the **URL fragment**; disclosure verification runs against a fullnode *the reader names*, not a Talise endpoint — *"a disclosure you have to trust us about is worthless."*

9. **They removed a feature for privacy.** The public `/analytics` page used to publish every handle, address, counterparty and amount with a search box — *"a directory of who paid whom, for a product whose pitch is that money is private."* Replaced with a heatmap that shows the same activity as a shape and identifies nobody.

10. **Rewards only exist if you have one.** The banner renders nothing unless *this* account has an unopened gift — *"a user who was not rewarded never learns rewards exist."* Referral points pay on **activation** (first chain-verified send), not signup, because signup is free and 500pts/signup is a sybil bounty priced at the cost of a browser profile.

11. **Network-loss copy.** *"A deposit sent on the wrong network is gone. Not delayed — gone."* The chosen network is repeated at **four** points, including inside the copy confirmation.

12. **Agent safety model** — *"Agent proposes → server validates → human confirms."* Execution never trusts the model's amount or recipient; it uses the server-resolved address and routes through the same hooks as manual flows. MCP `talise_send` refuses without `confirm: true`.

13. **Fail-open guards, fail-closed gates.** Rate limiting, address-risk screening and send limits deliberately fail open — *"guards, not gates"* — while product/feature switches and sanctions matching fail closed. The distinction is explicit and documented per module.

14. **Craft details:** dollars solid white and cents muted on the balance; the skeuomorphic paper cheque with amount-in-words and a rotated rubber stamp; the leather card pocket; the torn-edge receipt with a digest-derived barcode; one shell driving two products via a `NavConfig`.

---

## 7. The port map

### Mezo target constraints

- **EVM / Solidity.** No Move, no object model, no PTBs.
- **BTC is the native gas token.** Gas is denominated in BTC; display in **sats**, never a raw BTC decimal.
- **MUSD** is the BTC-backed stablecoin — the unit of account.
- **No zkLogin. No Enoki.** Neither exists on EVM.
- **Gasless = EIP-2612 `permit` + ERC-2771 trusted forwarder / relayer.** **Not ERC-4337** — account abstraction via bundlers is a dead end on Mezo.
- **EIP-7702 is live** — use it for delegation and session keys.

### The table

| # | Talise capability | Verdict | How to rebuild on Mezo |
|---|---|---|---|
| 1 | USDsui as unit of account | **ADAPT** | **MUSD.** Everything settles in MUSD. Keep the "you hold dollars, the chain is invisible" framing. |
| 2 | zkLogin via Shinami (salt service, prover fleet, `aud` binding) | **REPLACE** | No EVM equivalent and none needed. Embedded wallets + passkeys (Privy / Dynamic / Para). Deletes ~1,500 lines: no salt service, no provers, no `maxEpoch`, no proof cache, no ephemeral-key rotation. **Keep the server-mediated OAuth discipline** so one human maps to one address across platforms. |
| 3 | Ephemeral key + server-assembled signature | **REPLACE** | **EIP-7702 delegation** with scoped session keys (spend cap, allowed target contracts, expiry). Client signs; the server never assembles a signature. |
| 4 | Onara gas station (Cloudflare Workers policy server) | **ADAPT** | Keep the *architecture*, swap the mechanism: an **ERC-2771 trusted forwarder** plus a relayer EOA funded in **BTC**, fronted by the same policy server (per-user rate limits, target+selector allowlist, gas budget). Onara's policy JSON maps almost 1:1 onto forwarder validation. |
| 5 | `0x2::balance::send_funds` gasless rail (`gasPrice=0`, `gasBudget=0`, `ValidDuring`, `setGasPayment([])`) | **REPLACE** | **No EVM equivalent** — this is a Sui-native stablecoin primitive. Use **EIP-2612 `permit` + ERC-2771 relayer**: user signs an off-chain `permit` (gasless), relayer submits and pays BTC gas. Budget for this — it is the single biggest free lunch Talise had that Mezo does not. Keep the deadline/nonce discipline that `ValidDuring` provided; `permit` already carries both. |
| 6 | SuiNS `name.talise.sui` subnames | **ADAPT** | `MarenNameRegistry.sol` — `mapping(bytes32 => address)` + reverse records, exposing an ENS-compatible resolver interface so external wallets can read it. **Port the multi-form resolver and reserved-names list verbatim** from `lib/handle.ts` / `lib/suins.ts`. |
| 7 | `talise::send` + `PaymentReceipt` NFT | **ADAPT** | `Payments.sol` with `send(to, amount, memo)` emitting `Sent`. **Drop the receipt NFT** — on EVM, events plus an indexer are the receipt. Keep the 80-byte memo cap. |
| 8 | `cheque` (claimable links) | **DIRECT PORT + FIX** | `Cheques.sol`: escrow + expiry + optional `boundRecipient` + `keccak256` hashlock, **all enforced on-chain**. Set `claimed` *before* transferring. Permissionless `reclaimExpired`. ⚠️ Talise's *live* rail enforces the hashlock and gates **off-chain**, which is precisely what enabled Critical C3 — build the on-chain version their docs describe, not the one they shipped. |
| 9 | `stream` + `team_stream` | **DIRECT PORT** | `Streams.sol`, `block.timestamp` for Sui `Clock`. **Keep cursor-advance-before-pay** (the idempotency mechanism) and **keep pause/cancel composing `claimAccrued` first** so stopping never claws back earned tranches. Keep truncating-split-with-reclaimable-dust. |
| 10 | `standing_order` (money rules) | **DIRECT PORT** | `StandingOrders.sol` with permissionless `executeDue()`. Genuinely *better* on EVM — a Gelato / Chainlink Automation keeper can crank it, or keep the client-side opportunistic fire. |
| 11 | `batch_pay` / payroll | **DIRECT PORT** | `batchTransfer(recipients[], amounts[])` with the exact-sum check and a screening hook. Cheaper on EVM than in Move. **Screen `msg.sender` too** — Talise's version never did (see §8). |
| 12 | `goal_vault` savings | **DIRECT PORT** | `Goals.sol`, `mapping(address => Goal[])`. Dynamic-object-field receipt parking becomes `address venue; uint256 basis;`. |
| 13 | `compliance` registry | **DIRECT PORT** | OpenZeppelin `AccessControl` + `Pausable`. AdminCap → role mapping is mechanical. **Actually wire it into `send`** — Talise's `send` takes no registry argument, making its "enforcement floor" claim false. |
| 14 | `vault` `Bag` of heterogeneous balances | **ADAPT** | `mapping(address token => uint256)`. The `SwapTicket` hot potato has **no EVM type-system equivalent** → use a callback pattern (`flashRotate(target, calldata)` re-checking invariants after the external call) plus `ReentrancyGuard`. |
| 15 | `talise_privacy` shielded pool | **ADAPT — and easier on EVM** | BN254 pairing precompiles (`0x06`/`0x07`/`0x08`) are native, so the Groth16 verifier is a standard snarkjs-generated `Verifier.sol`. **Keep the 8-input ordering, the 100-root ring buffer, the immutable 500bps fee ceiling, and fee-only-on-a-public-leg.** ⚠️ Two real costs: **Poseidon in Solidity is gas-expensive** (budget it, or use a precompile if Mezo exposes one), and you must run a **real multi-party ceremony** — Talise's VK is single-party and they say so. |
| 16 | Shield relayer command allowlist | **DIRECT PORT — do not skip** | The EVM analogue: the forwarder/relayer validates `to == ShieldedPool && selector == transact.selector`, decodes calldata, checks `relayer == ours` and `fee <= MAX`, **and binds the fee parameters inside the proof** (Critical C7 was exactly this omission). Without it your relayer is a blank cheque. |
| 17 | NAVI / Suilend / Scallop / DeepBook yield | **REPLACE** | Mezo-native. The obvious substitution: **"Earn" becomes the MUSD savings rate / MUSD liquidity provision.** `yield_router`'s venue bitset + rotation caps port directly once Mezo has ≥2 venues. |
| 18 | Cetus swap aggregator | **REPLACE** | Whatever DEX/aggregator exists on Mezo; otherwise drop the token-bucket swap and hold MUSD only. |
| 19 | On/off-ramps (Transak, Bridge, Linq, Stripe, Circle) | **DIRECT PORT** | Fully chain-agnostic — **zero contract calls exist on either ramp.** Change the settlement asset to MUSD and the deposit address to an EVM address. The provider registry, circuit breaker, monotonic status writer, idempotency keys and corridor ordering are the most reusable code in the repo. **Copy Bridge's virtual-account model** (fiat mints straight to the user's own address → no server-side credit, no double-credit surface). |
| 20 | KYC (Bridge hosted) | **DIRECT PORT** | Unchanged. Keep "no PII touches us". |
| 21 | Postgres schema (~75 tables) | **DIRECT PORT** | Drop `shield_*` if privacy is deferred. Swap `sui_address` → `evm_address`, `digest` → `tx_hash`. |
| 22 | Sui checkpoint / gRPC indexer | **REPLACE** | EVM log indexing — **Ponder** or **Envio**, or `viem` `watchContractEvent` with a durable cursor. Keep the resumable-cursor + wall-clock-budget cron pattern. |
| 23 | `@mysten/payment-kit` invoice receipts | **ADAPT** | `Invoices.sol` emitting `InvoicePaid(id, payer, amount)`. Verify settlement by receipt log rather than a dynamic field. |
| 24 | Walrus (encrypted cheque notes) | **REPLACE** | Encrypted blob in Postgres is simplest and sufficient — the secret is already client-side in the URL fragment. IPFS/Arweave only if decentralisation is a selling point. |
| 25 | MemWal agent memory | **REPLACE** | Postgres + pgvector, or Redis. **Keep the "await the write before the stream closes" fix** — that is a serverless gotcha, not a Walrus one. |
| 26 | AI copilot (DeepSeek + intent fences) | **DIRECT PORT** | Chain-agnostic. Port `lib/agent/plan.ts` wholesale — *"agent proposes → server validates → human confirms"* is the single best pattern in the repo. |
| 27 | CLI + MCP server | **DIRECT PORT** | 6 commands plus a dependency-free stdio MCP server. Keep `confirm: true` on send. **Port the loopback+CSRF auth flow** — it is the one Talise got right. |
| 28 | Perps (WaterX) | **DROP** | Off-strategy for a BTC-backed dollar account and it dilutes the pitch. |
| 29 | Rewards / referrals / round-up | **DIRECT PORT** | Keep the anti-sybil economics exactly: **0 points for signup**, pay on chain-verified first send, idempotent and reversible. |
| 30 | Multi-currency display pockets | **DIRECT PORT** | Display-only FX over one MUSD balance. Never touches settlement. Keep the return-0-not-1 FX guard. |
| 31 | App Attest / PIN / biometrics | **ADAPT — with real fixes** | Talise's App Attest is **structural only** (checks two headers are non-empty; a no-op on the money routes). Implement real assertion verification or don't claim it. **Fix the PIN**: Argon2id/scrypt, attempt limiting with lockout, bound to a `SecAccessControl` Keychain item so it actually wraps the session key. **Gate sends behind biometrics** — Talise's slide gesture is not user-presence. |
| 32 | Web app (Next 15 + Tailwind 4 + hand-rolled cache) | **DIRECT PORT** | Keep the design system, the shell, the `NavConfig` two-product trick, and the cache layer. Swap the chain SDK for **viem + wagmi**. |
| 33 | iOS SwiftUI app | **ADAPT** | Keep the design system, flows and micro-interactions. Replace `SuiGrpcKit` / BLAKE2b / zkLogin with an EVM signer or an embedded-wallet Swift SDK. The hidden-WebView prover pattern still applies for client-side Groth16. |
| 34 | Expo app (`mobile/`) | **DIRECT PORT — start here** | Best ROI in the repo: 54 routes, tokens already mirrored from iOS, and RN + EVM tooling is far more mature than RN + Sui. One codebase ships Android and iOS. |
| 35 | **BTC collateral → borrow MUSD** | **NET-NEW** | The headline flow Talise has no analogue for. Deposit BTC → borrow MUSD → spend/send/earn without selling. Needs collateral and health-factor UI, liquidation-risk warnings, a borrow/repay flow, and "your BTC is still yours" framing. **This replaces "Add money" as the primary funding path.** |
| 36 | **Gas paid in BTC** | **NET-NEW** | Talise's whole promise was "$0, sponsored". Either keep sponsoring via the ERC-2771 relayer (and say `$0` truthfully) or show gas in **sats** — never a raw BTC decimal. Decide before designing the receipt. |
| 37 | **BTC-denominated balance toggle** | **NET-NEW** | Extends the existing hide-amounts / currency-pocket machinery: view your balance in MUSD or in sats. |
| 38 | **CI/CD secret hygiene** | **NET-NEW** | Critical C2 was a process failure, not a code one (prod DB dumps + Apple signing keys uploaded to a third-party build service on *every* mobile build). Audit artifact uploads **before** the first Maren mobile build. |
| 39 | **UpgradeCap → proxy admin** | **ADAPT** | Sui `UpgradeCap` becomes a Solidity proxy admin. Talise's own audit names single-key upgrade authority the **highest-leverage open risk**, with all 7 packages still holding live single-key caps. **Timelock + multisig from deployment one**, not later. |

### Recommended build order

1. **Contracts** — `Payments`, `NameRegistry`, `Cheques`, `Streams`, `StandingOrders`, `Goals`, plus an `AccessControl`/`Pausable` base. All direct ports; ship first.
2. **Auth + relayer** — embedded wallets, EIP-7702 session keys, ERC-2771 forwarder + EIP-2612 permit, with the Onara policy model. This is the critical path and the biggest deviation from Talise.
3. **Expo app + Next web** on the shared design system, reusing the offramp / KYC / rewards / agent server code nearly unchanged.
4. **BTC→MUSD borrow flow** as the funding path. Net-new; do not treat it as an afterthought.
5. **Shielded pool last** — only with a real multi-party ceremony and an external audit, exactly as Talise gated it.

### Explicitly do not port

The unstretched PIN · the inert cert pinning (`pinnedSPKIs` is an empty TODO) · sends without user-presence confirmation · the duplicate `talise` / `talise_pay` deployment · permissionless `bootstrap` / `new_registry` functions · off-chain-only cheque claim conditions · `APP_ACCESS_OPEN` defaulting to open.

---

## 8. DO NOT REPEAT — security rules

Derived from `docs/security/AUDIT-2026-07-24.md` (1,389 lines, commit `ccfa19b4`): **7 Critical · 13 High · 20 Medium · 24 Low · 9 Info** across 205 routes, 21 Move modules, 8 packages.

The audit's own headline is worth keeping in view — the architecture was sound, the implementation had holes:

> *"The core custody model holds… we traced the full send → prepare → sponsor → execute pipeline and found no way for one user to move another user's money. The IDOR sweep across every `[id]` route came back clean."*

### Critical → rules

| From | **Rule for Maren** |
|---|---|
| **C1** — shielded relayer could be made to fund an attacker's deposit, draining the relayer and burning the pool | **Bind the funding source to the caller.** A relayer must never pay for value it did not verify the caller supplied. |
| **C2** — production DB dumps and Apple signing keys uploaded to a third-party build service on *every* mobile build | **Audit every CI artifact upload before the first build.** Never let build tooling see production data or signing material. |
| **C3** — on the live cheque rail, any user could fund their own cheque with someone else's escrow deposit and claim it | **Never key escrow by a shared address.** Every escrowed instrument gets its own accounting identity, and the claim path must verify the funding belongs to *that* instrument. |
| **C4** — team payroll streams accept a client-asserted funding digest with no on-chain verification | **Verify funding on-chain, always.** A transaction hash supplied by a client is evidence, never authorization. |
| **C5** — permissionless `yield_router` registry creation | **Use `initializer` modifiers.** No bootstrap function may be callable twice or by anyone. |
| **C6** — permissionless `auto_swap::bootstrap_v7` | Same rule. **Every `bootstrap` / `new_registry` is an access-control decision.** |
| **C7** — shielded withdraw `relayer` and `relayer_fee` not bound by the proof | **Bind economic parameters inside the proof**, not merely validated off-chain. Anything the relayer pays out must be constrained by the circuit. |

### High → rules

| From | **Rule for Maren** |
|---|---|
| **F-A1** — the private-beta guard wired to 59 routes read `if (APP_ACCESS_OPEN !== "false") return true;`, a pass-through by default | **Gates must fail closed.** An unset or malformed env var means *denied*, never *allowed*. (Distinguish from *guards* — rate limits, risk scoring — which may fail open by explicit design.) |
| **H1 / M13** — send-cap and off-ramp-cap reservations are read-then-write with no atomicity; batch pay, money rules and team streams never write the cap ledger at all | **Make every limit check atomic** (a single conditional `UPDATE … RETURNING`, or a DB transaction). **Every money path writes the ledger** — a path that skips it is an uncapped path. |
| **H4** — the on-ramp KYC webhook processed unverified events, allowing forged KYC approval | **Verify every webhook signature before parsing the body.** Fail closed when the signing secret is unset. |
| **I-2** — App Attest is structural only: it checks two headers are non-empty, covers 3 route prefixes, and is a **no-op** on `gasless-submit`, `assemble-signature`, cheque claim and handle-retarget | **Do not ship a security control you have not verified end-to-end.** Either walk the full attestation certificate chain or remove the claim from your docs. |
| **I-3** — all 7 published packages retain a live single-key `UpgradeCap`; none immutable | **Timelock + multisig the proxy admin from day one.** Upgrade authority over contracts holding user funds is the highest-leverage key you own. |
| **I-7** — `talise-pay` is a byte-identical fork of `talise`'s cheque and stream modules, separately published with divergent admin state | **Never deploy the same logic twice.** Two copies with two admin states is an operational hazard, not redundancy. |
| **M1** — the mobile bearer token is delivered over an unverified `talise://` custom scheme, claimable by any Android app | **Use loopback + CSRF, not custom URL schemes**, for any credential hand-off. Talise's CLI got this right; its mobile app did not. |
| **M6** — `cancel_and_withdraw` can front-run an accrued tranche | **Settle before you stop.** Compose the claim ahead of any pause/cancel in the same transaction. |
| **M7** — unvalidated `start_ms` with `_clock` ignored | **Validate every time parameter against on-chain time.** An ignored clock argument is a silent trust assumption. |
| **M9** — unbounded `claim_accrued` bypasses the kill switch | **Every state-changing entry point respects the global pause**, including permissionless ones. |
| **M10** — `compliance.move`'s "enforcement floor" claim is false: `send` takes no registry, `batch_pay` never screens `ctx.sender()`, and `shielded_pool::assert_compliant` calls into a package not declared as a dependency | **Screen both sides of every transfer.** And if a module claims to be an enforcement floor, wire it into every path that moves value — or delete the claim. |
| **M12** — the manual off-ramp concierge queue bypasses both the kill switch and the daily cap | **No manual path may bypass automated limits.** Ops tooling is inside the control perimeter, not outside it. |
| **M17** — the cheque preview endpoint accepts a bearer secret in a **query string** (logged by every proxy) | **Bearer instruments go in the request body or a fragment, never a query string.** |
| **M18** — stream `record` does not check that the funding transaction's sender equals the caller, and uses `ON CONFLICT DO NOTHING`, so a front-runner can seize the DB row | **Verify tx sender == caller** on any record-what-happened endpoint, and treat conflict as an error, not a no-op. |
| **L9** — for hashlock-only cheques, a compromised worker can choose the recipient freely | **Bind the recipient on-chain**, not in the worker. |
| **L23** — the Bridge off-ramp path has no daily cap and no send-limit gate, unlike Linq | **Apply limits uniformly across rails.** A per-provider gap is a per-provider bypass. |

### The incident (`AUDIT §7`)

An **unauthenticated command-injection route reached production for ~6 minutes** on 2026-07-24. All in-scope secrets were treated as compromised and rotated. The audit's framing is the rule itself:

> *"A security document that only lists successes is not a security document."*

**Rule: publish your incidents internally, with timelines.** And: **no route ships without an auth check in review.**

### Custody honesty (`docs/security/SECURITY.md`)

Talise explicitly labels what is *not* non-custodial, and Maren must do the same. Genuinely non-custodial: funds at rest and signing (the key never leaves the client, so *"a full compromise of Talise's servers does not yield the ability to sign a user's transaction"*). **Server-mediated / trust required:** the gas station, JWT+salt custody (*"this is not server-blind"*), cheque/stream/payroll escrow keys (*"funds in an open cheque or stream are custodially exposed to Talise"*), the shielded relayer, the off-ramp treasury, the name-service operator (*"a handle is a routing convenience, not a custody primitive"*), and package upgrade capabilities.

On the shielded pool they disclaim, in their own docs: **not a trustless setup** (*"a captured trapdoor forges proofs and drains the pool undetectably"*), **not a large anonymity set**, **amounts are public**, the operator sees the link, note master keys sit in Postgres, and there is operator pause with no forced exit.

**Rule: write the equivalent disclosure for Maren before launch, not after.**

---

## 9. Business model

Source: `docs/product/BUSINESS-MODEL.md` (draft v1), `docs/product/LITEPAPER.md` (v1.2), `docs/pitch/PITCH-DECK-2026.md`.

### Scope of "free"

"Free" is scoped narrowly and deliberately: **the network fee and the per-transfer fee only.** Holding dollars and paying another Talise handle are free structurally, not promotionally.

### The four revenue lines (ranked by confidence)

| Line | Rate | Notes | Status |
|---|---|---|---|
| **FX spread on auto-swap** | **30 bps** | A $200 remittance costs $0.60 vs Western Union's $10–20 | ILLUSTRATIVE |
| **Off-ramp margin** | **50 bps** | The largest line **and the biggest gap** — the rail Talise least controls | ILLUSTRATIVE |
| **Yield rebate** | **~100 bps** | Of the NAVI supply spread | ILLUSTRATIVE |
| **On-ramp take** | **50 bps** | Subject to a Stripe ToS check that had not been completed | ILLUSTRATIVE |

A premium tier is deferred to v2+.

### Unit economics

- **~$14.10 / year per active corridor user** — **ILLUSTRATIVE**, explicitly modelled, not observed.
- **→ $1.41M at 100k users** — **ILLUSTRATIVE**, a straight multiplication of the above.

⚠️ These constants live in `web/lib/economics.ts` as `ECONOMICS` and are **not wired into any flow.** No fee in the shipped product is computed from them. The only fee actually charged in code is the **100 bps treasury fee on the round-up save leg** (`SAVE_TREASURY_FEE_BPS = 100`), plus Bridge's `BRIDGE_DEVELOPER_FEE_PERCENT`. Everything else is a plan.

`BUSINESS-MODEL.md` §6 is a self-critique listing where the landing page and litepaper overpromise relative to what is implemented — worth reading before writing any Maren marketing copy.

### Token stance

**There is no token and no tokenomics section.** Revenue is entirely fee, spread and float based. The litepaper does not mention a token anywhere. **Recommend preserving this stance for Maren** — it is a credibility asset, and a BTC-backed stablecoin product does not need one.

### Traction

| Metric | Value | Status |
|---|---|---|
| Waitlist signups | **1,900+** | **VERIFIED** (pitch deck marks it verified; backed by the `waitlist_signups` table) |
| Handles claimed **on chain** | **1,400+** | **VERIFIED** (on-chain SuiNS subnames — independently checkable) |
| Live on Sui mainnet | yes | **VERIFIED** (9 published packages, addresses in §4) |
| iOS on TestFlight | yes | **VERIFIED** |
| Linq NGN off-ramp live | yes, capped **$200/withdrawal, $200/day** in beta | **VERIFIED** in code (`checkDailyOfframpCap`) |
| Shielded pool live on mainnet | **NO** | Package published, but env is commented out — the subsystem ships **dormant**. The README's claim that private sends are "live on mainnet" is **not supported by the shipped configuration**. |
| TAM figure | — | **MISSING** — deck slide 9 still reads `[Insert your sourced TAM figure]` |
| The ask | — | **MISSING** — deck slide 12 still reads `[State your ask plainly]` |

### Positioning (from the litepaper §11)

- **vs Wise / Remitly** — does not fight on FX basis points; competes on the `@handle` and on holding dollars where a Wise balance cannot reach.
- **vs Phantom / Suiet** — *"the right tool for a sovereign portfolio, the wrong abstraction for someone who just wants the equivalent of fifteen dollars."*
- **vs Privy / Magic** — *"Talise is the destination, not the SDK."*

Copy rules enforced across the deck and site: no em dashes; *"in under a second"* never *"in seconds"*; never the bare word *"free"*; no APY figures.

**For Maren, the equivalent positioning sentence still needs writing** — specifically about BTC self-custody, since the product asks users to post BTC as collateral.

---

## 10. Doc-vs-code discrepancies

**Do not rebuild from Talise's own documentation without checking it against source.** Four confirmed divergences:

### 1. The architecture docs describe a product that was never built

`docs/architecture/WEB_ARCHITECTURE.md` and `docs/archive/ARCHITECTURE.md` specify **`@mysten/enoki`** for zkLogin and sponsorship, **`@mysten/dapp-kit`** for wallet connection, **`@mysten/codegen`** for typed Move calls, **TanStack Query** for state, **Walrus Sites** for deployment, **Next.js 16**, and DeepBook Margin as the yield venue.

**None of this shipped.** The real stack is Shinami zkLogin + self-hosted provers, Onara sponsorship, hand-written transaction builders, a hand-rolled cache, Vercel, Next 15, and NAVI.

> **Use `docs/generated/codebase/` instead** — a 26-document auto-generated code map (~27k words, generated 2026-05-27) that reflects actual source. This is also why the original brief for this analysis wrongly assumed Enoki.

### 2. The cheque v2 ABI is documented one way and deployed another

`docs/contracts/DEPLOYED.md` documents cheque v2 as a 6-argument `create` taking `bound_recipient: Option<address>` and `hashlock: Option<vector<u8>>`, with a `claim` taking `secret` and `sha2_256(secret)` enforced **on-chain**.

The **code** says otherwise. `web/lib/cheques.ts` comments state the deployed package takes neither: `create` is `(registry, Balance, expiry, clock)` and `claim` is `(registry, cheque, recipient, clock)`, with the secret and all gates enforced **off-chain** at `/claim/release`. `claimOnChain`'s third parameter is literally named `_secret` — unused.

This gap is what enabled **Critical C3**. **For Maren, build the on-chain version the doc describes.**

### 3. The streaming doc describes the design they replaced

`docs/features/streaming-payments.md` still documents an escrow + cron-scheduler design. `web/lib/streams.ts` implements the scheduler-less `claim_accrued` design and says so in its header: *"THERE IS NO SCHEDULER."*

The confusion is real but explicable: the **team payroll** streams surface *is* still on the escrow rail (and carries Critical C4). Consumer streams are not.

### 4. Deployed bytecode has diverged from Move source

`docs/contracts/DEPLOYED.md` warns that after a `move-doctor` 100/100 cleanup, the source no longer matches deployed bytecode — event renames plus parameter reorders in `add_worker`, `remove_worker` and `set_paused`. **Any worker script run against the live package must use the OLD argument order.**

### Also worth knowing

- `docs/product/PITCH.md` is marked stale in its own header.
- `docs/archive/*` is explicitly labelled "may drift".
- Many docs exist as `.md` + `.pdf` + `.html` triples; the PDFs and HTML are renders, not separate content.
- The single best document in the repo for understanding *why* decisions were made is `docs/generated/codebase/45-protocol-design-decisions.md`, which covers why USDsui over USDC, why Cetus, why NAVI, why zkLogin over WalletConnect, why sponsored gas, and the four-role admin model in plain English. Read it before rebuilding anything.

---

## Appendix — key file paths

| What | Path (relative to the Talise checkout) |
|---|---|
| Design system doc | `docs/design/THE-TALISE-DESIGN.md` |
| Web theme (verbatim source for §5) | `web/app/globals.css` |
| iOS tokens | `ios/Talise/DesignSystem/Tokens.swift` |
| Expo tokens (mirrors iOS) | `mobile/src/design/tokens.ts` |
| Send route (the money path) | `web/app/api/send/sponsor-prepare/route.ts` |
| Client send pipeline | `web/components/app/data/send.ts` |
| Recipient resolution | `web/lib/suins.ts`, `web/lib/handle.ts` |
| Relayer command allowlist | `web/lib/shield/validate-commands.ts` |
| Agent safety brain | `web/lib/agent/plan.ts` |
| DB layer + table map | `web/lib/db.ts` |
| Off-ramp provider layer | `web/lib/offramp/` |
| Gas station | `infra/gas-sponsorship/` |
| Security audit | `docs/security/AUDIT-2026-07-24.md` |
| Threat model | `docs/security/THREAT_MODEL.md` |
| Custody posture | `docs/security/SECURITY.md` |
| Deployment record | `docs/contracts/DEPLOYED.md` |
| Design rationale | `docs/generated/codebase/45-protocol-design-decisions.md` |
| Accurate code map | `docs/generated/codebase/INDEX.md` |
| Litepaper | `docs/product/LITEPAPER.md` |
| Business model | `docs/product/BUSINESS-MODEL.md` |
| Strategy / wedge | `docs/strategy/STRATEGY.md` |
| Privacy design | `docs/strategy/PRIVACY-TALISE.md` |
| Expo porting plan (78 iOS screens mapped) | `mobile/PORTING.md` |

---

*Compiled from direct source reading at HEAD `47e683e7`. Where this document and Talise's own docs disagree, this document reflects the code.*
