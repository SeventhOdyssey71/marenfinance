# `@maren/relayer` — gasless meta-transaction relayer

Mezo's native gas token is BTC. Asking someone who refused to sell their Bitcoin to
hold Bitcoin purely to pay gas is the wrong shape for the product. This service pays
that gas on the user's behalf, so a Maren user can hold **zero BTC** and still transact.

The user signs an EIP-712 `ForwardRequest`. This service verifies it, simulates it,
pays the BTC, and submits it through `MarenForwarder` (an OpenZeppelin v5
`ERC2771Forwarder`). Combined with MUSD's EIP-2612 `permit`, a first-time user can
approve *and* pay in a single signed action holding no BTC at all.

Mezo runs the same pattern in production ("Get Gas"): user signs a permit, a backend
relay submits. This is well-trodden ground.

**The economics are not the hard part.** Mezo's base fee is 1,300,000 wei, so a
100,000-gas transaction costs about **$0.0092**. Sponsoring a million transactions
costs roughly **$9,200**. Sponsorship is cheap. *Abuse control is the actual
engineering problem*, and that is what most of this codebase is.

---

## Contents

- [Endpoints](#endpoints)
- [Threat model](#threat-model)
- [What a relayer key compromise costs](#what-a-relayer-key-compromise-costs)
- [Sponsorship policy](#sponsorship-policy)
- [Security controls and the failure each one prevents](#security-controls-and-the-failure-each-one-prevents)
- [Environment variables](#environment-variables)
- [Runbook](#runbook)
- [Architecture notes](#architecture-notes)
- [Known limitations](#known-limitations)

---

## Endpoints

### `POST /relay`

Accepts an ERC-2771 `ForwardRequest` plus its signature. Verifies, simulates, submits.

```jsonc
// request
{
  "from":      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "to":        "0x…",         // must be an allowlisted Maren contract
  "value":     "0",           // must be 0 — see R3
  "gas":       "200000",
  "nonce":     "0",           // must equal MarenForwarder.nonces(from)
  "deadline":  "1755250000",
  "data":      "0x…",         // allowlisted selector; contains the relayFee
  "signature": "0x…"          // 65 bytes, EIP-712 over the fields above
}
```

```jsonc
// 202 Accepted — note the status code and the explicit `success: false`
{
  "hash":     "0x…",
  "state":    "submitted",
  "success":  false,
  "payer":    "0x7099…",      // the RECOVERED signer, never a body field
  "nonce":    41,
  "sponsorship": "free-tier",
  "freeActionsRemaining": 24,
  "function": "marenPay.pay",
  "statusUrl": "/status/0x…"
}
```

**202, not 200, and `success: false`.** A transaction hash is not a payment. Poll
`statusUrl` until `state === "confirmed"` before telling a user anything happened.

Any body field that names a funding source — `sponsor`, `payer`, `funder`,
`feePayer`, `relayer`, `fundingSource`, `sender` — is a hard 400. So is any field
not in the schema above.

### `GET /status/:hash`

The settlement verdict, from the one shared place that decides it.

| `state` | HTTP | `success` | meaning |
|---|---|---|---|
| `submitted` | 202 | `false` | broadcast, no receipt yet |
| `confirmed` | 200 | `true` | on-chain receipt, `status === 'success'` |
| `reverted` | 200 | `false` | on-chain receipt, `status === 'reverted'` — we paid, the call failed |
| `unknown` | 502 | `false` | we could not determine it. Treat as not delivered |

### `GET /quota/:address`

```jsonc
{
  "address": "0x7099…",
  "freeActionsRemaining": 24,
  "freeActionsPerAddress": 25,
  "lifetimeActions": 1,
  "actionsToday": 1,
  "maxActionsPerDay": 50,
  "feeAfterFreeTierMusdWei": "50000000000000000",
  "accepting": true
}
```

### `GET /health`

Relayer address, BTC balance, current nonce, chain id, and whether it is accepting
work. Returns **503 when not accepting**, so a load balancer removes it rather than
sending traffic at a relayer that will refuse.

```jsonc
{
  "ok": true, "accepting": true,
  "relayer": "0x…", "balanceWei": "…", "balanceBtc": "0.25000000",
  "nonce": 41, "chainId": 31611, "network": "testnet",
  "forwarder": "0x…", "rpcs": ["https://rpc.test.mezo.org"],
  "targets": ["marenPay:0x…"], "store": "redis",
  "inFlight": 0, "watching": 2,
  // spentTodayWei is RESERVED (in-flight + committed); committedTodayWei is what
  // actually settled and is the only thing that can latch the daily halt.
  "spentTodayWei": "…", "committedTodayWei": "…", "pendingRefunds": 0,
  "dailyBudgetWei": "…",
  "problems": []
}
```

`problems` is the operator's first stop. A non-empty `problems` array means this
relayer will not relay, and each entry says exactly why.

---

## Threat model

**What we are protecting.** A hot key holding BTC for gas, and a sponsorship budget.
Not user funds — see the next section, which is the point.

**Who we assume the attacker is.** Anyone on the internet who can POST JSON. They can
craft arbitrary bodies, replay captured requests, sign with keys they control, run
many addresses and many IPs, and read every response we produce.

| # | Attack | Control |
|---|---|---|
| T1 | Make the relayer fund something for an attacker by naming a different payer | The payer is the **recovered signer**. `from` is treated as a claim that must match it, never as an input to accounting. Funding-source fields are rejected outright, and the schema is strict. |
| T2 | Swap the fee, recipient, or amount after the user signed | Everything that moves value is inside the EIP-712 struct. The fee is decoded out of the *signed* calldata. There is no parameter beside the signature that changes what happens. |
| T3 | Use the relayer as a generic transaction pump | Target **and** selector allowlist, scoped per target. `claimLink` is a MarenPay function; sending it to MarenEarn is rejected even though both are allowlisted. |
| T4 | Drain the gas float with volume | Free tier of 25 lifetime actions per address, then a required in-band MUSD fee; per-address and per-IP daily caps; a global daily BTC cap that halts the whole service when hit. Every one of those limits is decided on the value the counter's own atomic increment returned, so a concurrent burst cannot slip past a stale read — see T4d. |
| T4b | Forge `x-forwarded-for` to get a fresh IP bucket per request | A forwarding header is read **only** from a configured trusted proxy (`RELAYER_TRUSTED_PROXIES`) or an unforgeable platform header, and then the **rightmost untrusted hop** is taken, not the leftmost. Otherwise the socket address is used. Unattributable traffic shares one bucket. |
| T4c | Run on many instances so each has its own counters | `RELAYER_STORE=memory` and an ephemeral `RELAYER_IP_SALT` are **boot problems** under `VERCEL`. Per-instance counters do not weaken the global BTC cap, they remove it. |
| T4d | Fire N requests simultaneously so they all read the same pre-spend counters | Was a real defect: the cap was checked against a `get`, then two RPC round trips ran, then the increment's return value was **discarded**. Measured at 13× the budget on 25 concurrent requests, 130× on 250. Now the increment happens first and the decision is made on what it returned; losers are refunded and rejected. Independently re-measured at 25/100/250 concurrent: exactly one admitted, zero overshoot. |
| T4e | Send a burst of doomed requests to trip the budget halt and take the relayer offline for a day | The halt latches on **committed** spend (broadcast and never refunded), never on the reserved counter, which transiently exceeds the cap during any burst. A fully-refunded burst leaves the relayer accepting. This was a real defect introduced by the T4d fix: 60 concurrent reverting requests against a budget for 20 spent nothing and still latched the halt until 00:00 UTC. |
| T4f | Flap the quota store so refunds fail and the budget silently fills up | Refunds retry, then queue for a reconciler drained on each sweep and at the head of each relay; `/health` reports anything still owed. Swallowing the error meant 10 rejected requests — nothing broadcast — could read as 100% of budget consumed. |
| T5 | Drain the gas float with reverts | Every request is `eth_call`-simulated before submission and rejected if it would revert. Quota is consumed on submission and **not refunded** on a revert, so deliberate reverts are not a free way to spend our budget. |
| T5b | Race two copies of one signed request through the nonce check | `(payer, nonce)` is held for the duration of a relay; the second gets `409 DUPLICATE_REQUEST_IN_FLIGHT` instead of burning gas reverting on a consumed nonce. **Per instance** — see Known limitations. |
| T5c | Use an expensive ERC-1271 validator to burn gas at our cost | Contract-account signers get a tighter ceiling (`RELAYER_MAX_GAS_CONTRACT_SIGNER`, default 500,000, always ≤ the general cap). |
| T6 | Replay a signed request | Forwarder nonce must equal the on-chain nonce, and the deadline must be in the future and no further out than `RELAYER_MAX_DEADLINE_SECONDS`. |
| T7 | Replay across networks or forwarders | The EIP-712 domain binds chain id and the verifying contract. A mainnet signature does not verify on testnet, and a signature for another forwarder does not verify here. |
| T8 | Make us send BTC somewhere | `value != 0` is refused unconditionally. There is no configuration that enables it. |
| T9 | Collide nonces with concurrent requests | Allocation and broadcast happen inside one serialised critical section per key. Failures invalidate the cached nonce and force a chain resync. |
| T10 | Get us to relay while misconfigured | Configuration parsing never guesses. Any unresolved gate puts the service into a refusing state where `POST /relay` returns 503 and nothing is signed. |
| T11 | Point us at an RPC that cannot simulate | A boot preflight asserts the endpoint serves `eth_call`, `eth_estimateGas`, `eth_getBlockByNumber` and friends, not merely that it answers. See [Known limitations](#known-limitations) for the real incident behind this. |
| T12 | Read secrets out of logs | Signatures, private keys, passwords and raw bodies are never passed to the logger, and `pino`'s redaction list is a second layer. Client IPs are logged as a salted hash. |

**Out of scope, stated plainly.** This service does not defend against a compromised
`MarenForwarder`, a compromised MUSD (which sits behind upgradeable proxies controlled
by a single Mezo multisig — we inherit that risk and disclose it), or an operator who
exfiltrates the hot key. Sybil resistance is economic, not cryptographic: an attacker
with many addresses gets 25 free actions each, which is why the global daily BTC cap
exists as the real backstop.

---

## What a relayer key compromise costs

**It costs us the BTC in the hot key's balance, and nothing else.**

That sentence is only true because of choices you can check in the code:

- The relayer is **never an owner, approver, or custodian** of any Maren contract. It
  holds no role, no allowance, and no user funds. It is one EOA with a BTC balance.
- It only ever calls `MarenForwarder.execute` with a **user-signed** request. It cannot
  fabricate one, because it does not hold user keys and the forwarder verifies the
  signature on-chain.
- It **never forwards native value**. `value != 0` is refused, so it cannot be induced
  to move BTC into a contract.
- User funds move `wallet → wallet` under the user's own permit or approval. The
  relayer is not in the custody path at any point.

So an attacker with the key can: spend the BTC float on gas, submit garbage
transactions, and grief users by censoring or delaying their relays. They **cannot**
move MUSD, cannot touch a trove, cannot change any Maren contract's state except by
relaying a request some user actually signed.

**Containment.** Keep the hot key funded with days, not months, of float — top it up
on a schedule instead of pre-funding it. `RELAYER_MAX_DAILY_SPONSORED_BTC` bounds the
loss per day even before anyone notices. Rotation is: fund a new key, change the env
var, redeploy, sweep the old key. There is no on-chain step, because the relayer has
no on-chain identity to migrate.

---

## Sponsorship policy

One module — `src/policy.ts` — not constants scattered through handlers.

| Rule | Default | Variable |
|---|---|---|
| Free sponsored actions per address (lifetime) | 25 | `RELAYER_FREE_ACTIONS_PER_ADDRESS` |
| MUSD fee once the free tier is spent | *unset → paid tier closed* | `RELAYER_FEE_MUSD` |
| Actions per address per UTC day | 50 | `RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY` |
| Actions per IP per UTC day | 200 | `RELAYER_MAX_ACTIONS_PER_IP_DAY` |
| Global BTC gas spend per UTC day | *unset → nothing is sponsored* | `RELAYER_MAX_DAILY_SPONSORED_BTC` |
| Max `gas` per request | 1,500,000 | `RELAYER_MAX_GAS_PER_REQUEST` |
| Max deadline horizon | 3600s | `RELAYER_MAX_DEADLINE_SECONDS` |

**New users are never blocked at the door.** The first 25 actions are free, which
covers claiming a handle, a first payment, and normal exploration.

**After that, the fee must ride inside the signed payload** — never beside the
signature, because a body field is not signed and can be changed after the fact.

> **The paid tier is not live yet.** The original design gave every relayable function
> a trailing `uint256 relayFee`. That invariant is **withdrawn**: the contracts author
> showed that `ERC2771Forwarder.executeBatch`'s `atomic` flag governs *validation* only,
> not inner-call failures, so a batched fee leg settles even when the work leg reverts
> (including with `refundReceiver == address(0)`). Charging a user for work that did not
> happen is not a trade we will make. The replacement is **`MarenRelayHub`**: one
> forwarded call that takes the fee and invokes the target atomically — fee and work
> settle together or neither does — with fee amount, token and recipient inside the
> signed payload. R2 is preserved, relocated from the target's calldata into the hub's
> request.
>
> Until the hub exists, a call with no readable in-band fee has its paid tier **closed**,
> not made free: once the free 25 are spent the relayer returns
> `402 SPONSORSHIP_UNAVAILABLE`. A missing fee mechanism must never become an unbounded
> subsidy (R16). The attachment point is marked `TODO(MarenRelayHub)` in `registry.ts`,
> `calldata.ts` and `policy.ts`.

**Limits are enforced on the counter's own atomic increment, not on a prior read.**
Every cap debits first and decides on the value the debit returned, refunding and
rejecting if it lost. A `get`-then-`incrBy` is a race by construction, however atomic
the store — that was a real defect here, measured at 130× the daily budget under 250
concurrent requests before it was fixed.

**Two counters, and the distinction matters.** `spend:<day>` is *reserved* — in-flight
plus committed — and is what the cap is enforced against, because a reservation not yet
refunded could still become real spend. `committed:<day>` counts only reservations that
were broadcast and never given back, and is the **only** thing allowed to latch the
day-long halt. Latching on the reserved counter was a free remote denial of service: a
burst that is entirely refunded still transiently pushes it past the cap, and the latch
was never re-evaluated once the refunds landed.

**The two knobs that decide how much money we can lose have no defaults.** If
`RELAYER_MAX_DAILY_SPONSORED_BTC` is unset, nothing is sponsored at all. If
`RELAYER_FEE_MUSD` is unset, the paid tier is *closed* rather than free. A missing
number must never become an unbounded subsidy.

**Quota is consumed at submission and not refunded if the transaction reverts.** We
paid the gas either way, and refunding reverts would make deliberate reverts a free way
to drain the budget. Simulation runs first, so genuine reverts are rare.

**Errors name the limit.** `402 SPONSORSHIP_FEE_REQUIRED`, `402 FEE_BELOW_REQUIRED`,
`402 SPONSORSHIP_UNAVAILABLE`, `429 ADDRESS_RATE_LIMIT`, `429 IP_RATE_LIMIT`,
`429 GLOBAL_DAILY_BUDGET_EXHAUSTED`. There is no path that quietly pays instead.

---

## Security controls and the failure each one prevents

Every rule below is a specific failure from the Talise audit (2026-07-24: 7 Critical,
13 High, 20 Medium, 24 Low), restated as a constraint on this codebase. See
`docs/research/SECURITY-LESSONS.md`.

| Rule | Past failure | Control here | Test |
|---|---|---|---|
| **R1** bind the funding source to the caller | *Talise C1: the shielded relayer could be induced to fund an attacker's deposit, draining the relayer.* | The payer is the address recovered from the EIP-712 signature. `from` must equal it. Funding-source field names are rejected by name; the schema is `.strict()` so unknown fields are a 400. All quota and spend accounting keys off the recovered address. | `signature.test.ts` — "R1: the payer may not be named by the caller" |
| **R2** economically meaningful parameters inside the signed struct | *Talise C7: the shielded withdraw's `relayer` and `relayer_fee` were validated off-chain but not bound by the proof, so they could be swapped after signing.* | Recipient, amount, fee, deadline and nonce are all inside the EIP-712 struct. The fee is decoded from the signed calldata. A registry invariant enforces that every relayable function has a `uint256 relayFee` argument. | `signature.test.ts` — tampering with recipient/amount/relayFee |
| **R3** the relayer holds gas, never user funds | — | Never an owner, approver or custodian. `value != 0` refused unconditionally. Vault BTC deposits are deliberately *not* relayable because they carry value. | `signature.test.ts` — "R3: the relayer never moves value" |
| **R4** allowlist targets **and** selectors | *"A generic 'relay any call' endpoint is how R1 happens."* | Target allowlist from config; selector registry in code, scoped per target. Env can only narrow the registry — there is no syntax for adding a selector. The forwarder is explicitly not a relay target. | `allowlist.test.ts` |
| **R8** gates fail closed | *Talise F-A1: a beta guard on 59 routes read `if (APP_ACCESS_OPEN !== "false") return true;` — a pass-through whenever unset.* | Config parsing never throws and never guesses; it returns `problems`. Any problem ⇒ refusing state ⇒ 503. Malformed numbers resolve to the restrictive value. An unattributable IP shares one bucket rather than being exempt. | `fail-closed.test.ts` — **boot with an empty env and confirm it refuses** |
| **R15** a tx hash is not success | *Talise returned HTTP 200 with a digest-bearing `FailedTransaction` on both broadcast paths.* | `src/receipt.ts` is the one place that decides. Four states, not two — `submitted` and `unknown` are real outcomes. `/relay` answers 202 with `success: false`. | `simulation.test.ts` — "settlement (R15)" |
| **R16** typed failures over silent fallbacks | *Talise returned `ACCUMULATOR_UNDERFUNDED` rather than silently falling back to sponsored gas.* | Typed 402/429 naming the limit. Every rejection test also asserts nothing was broadcast. | `policy.test.ts` |

---

## Environment variables

### Required — the service refuses to relay without these

| Variable | Example | Notes |
|---|---|---|
| `RELAYER_PRIVATE_KEY` | `0x…` (32 bytes) | **or** the keystore pair below. Exactly one. |
| `RELAYER_KEYSTORE_PATH` | `~/.foundry/keystores/maren` | A `cast wallet import` keystore. |
| `RELAYER_KEYSTORE_PASSWORD` | | Required with the path. |
| `RELAYER_FORWARDER_ADDRESS` | `0x…` | Falls back to `MAREN_ADDRESSES` in `@maren/sdk`, which is the zero address until deployment. |
| `RELAYER_ALLOWED_TARGETS` | `marenPay:0x…,marenRegistry:0x…` | `name:address` pairs. Unknown name ⇒ boot problem. Falls back to the non-zero SDK addresses. |
| `RELAYER_MAX_DAILY_SPONSORED_BTC` | `0.01` | **No default.** Unset ⇒ nothing is sponsored. |

### Policy

| Variable | Default |
|---|---|
| `RELAYER_FEE_MUSD` | *unset ⇒ paid tier closed* |
| `RELAYER_FREE_ACTIONS_PER_ADDRESS` | `25` |
| `RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY` | `50` |
| `RELAYER_MAX_ACTIONS_PER_IP_DAY` | `200` |
| `RELAYER_MAX_GAS_PER_REQUEST` | `1500000` |
| `RELAYER_MAX_DEADLINE_SECONDS` | `3600` |
| `RELAYER_ALLOWED_FUNCTIONS` | *unset ⇒ the full code registry*. Can only narrow, e.g. `marenPay.pay,marenPay.payTo` |

### Network

| Variable | Default |
|---|---|
| `RELAYER_NETWORK` | `testnet` (`mainnet` \| `testnet`) |
| `RELAYER_RPC_URLS` | comma-separated, in failover order. Defaults to the verified endpoints for the network. |
| `RELAYER_RPC_URL` | singular alias |

### Storage and operations

| Variable | Default | Notes |
|---|---|---|
| `RELAYER_STORE` | `memory` | `memory` \| `redis`. **`memory` is a boot problem under `VERCEL`** — per-instance counters make the global BTC cap unenforceable. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | | Required when `RELAYER_STORE=redis`. Missing credentials is a boot problem, not a fallback to memory. |
| `RELAYER_IP_SALT` | *random per process* | **Required under `VERCEL`.** A per-instance salt gives the same IP a different bucket per instance, multiplying the limit. |
| `RELAYER_TRUSTED_PROXIES` | *(none — trust no proxy)* | Comma-separated IPs/CIDRs. `x-forwarded-for` is read **only** from these. A malformed entry is a boot problem. |
| `RELAYER_CLIENT_IP_HEADER` | `x-vercel-forwarded-for` under `VERCEL`, else unset | An unforgeable platform header carrying the client IP. |
| `RELAYER_MAX_GAS_CONTRACT_SIGNER` | `500000` | Tighter gas ceiling for ERC-1271 / EIP-7702 signers. Clamped to `RELAYER_MAX_GAS_PER_REQUEST`. |
| `PORT` | `8787` | |
| `LOG_LEVEL` | `info` | |
| `RELAYER_SHUTDOWN_DRAIN_MS` | `20000` | |
| `RELAYER_STUCK_TX_MS` | `45000` | Age at which a receipt-less transaction is replaced |
| `RELAYER_SWEEP_INTERVAL_MS` | `10000` | |

---

## Runbook

### Local

```bash
pnpm install
cp .env.example .env          # at the repo root
pnpm --filter @maren/relayer dev
curl -s localhost:8787/health | jq
```

A fresh checkout will report `accepting: false` with a populated `problems` array,
because `MAREN_ADDRESSES` is still all zeroes and no key is configured. **That is the
correct default state**, and `problems` tells you exactly what to set.

### Tests

```bash
pnpm --filter @maren/relayer test        # 210 tests
pnpm --filter @maren/relayer typecheck
```

Integration tests fork Mezo testnet with `anvil --fork-url https://rpc.test.mezo.org`.
They skip when foundry is absent so a contributor without it is not blocked — but the
skip is **loud**, and **fatal** when the environment says the chain layer is expected:

```bash
# CI: an unavailable anvil is a FAILURE, not a silent skip
MAREN_REQUIRE_CHAIN_TESTS=1 pnpm --filter @maren/relayer test
```

Setting `MEZO_TESTNET_RPC_URL` has the same effect. This exists because review found
the 6 chain tests were being skipped 100% of the time on a runner without foundry while
the job exited 0 — a green build that had never touched a chain.

### Deploying to Vercel

Root directory `apps/relayer`, Node runtime, fluid compute. Set every variable above,
and in particular:

- `RELAYER_STORE=redis` with Upstash credentials. The in-memory store is per-instance;
  on serverless that multiplies every limit by the instance count.
- `RELAYER_IP_SALT` to a fixed random string, for the same reason.

### Deploying standalone

`pnpm --filter @maren/relayer start`. This is the shape that gets the stuck-transaction
sweeper, because it has a process that outlives a request. Prefer it if you can run it.

The `start` script is `node --import tsx src/server.ts`, deliberately **not**
`tsx src/server.ts`. The tsx CLI wrapper runs the program as a child process and does
not forward `SIGTERM` (verified against tsx 4.23.12 — the drain handler never ran).
Under a process manager that would mean every deploy killing in-flight submissions in
the window between "nonce allocated" and "broadcast returned", leaving a nonce gap that
stalls every later transaction. Verified working:

```
{"event":"server.shutdown","signal":"SIGTERM","msg":"shutting down"}
{"event":"relayer.drained","inFlight":0,"msg":"drain complete"}
{"event":"server.stopped","msg":"stopped"}
```

### Common alerts

| Symptom | Cause | Action |
|---|---|---|
| `/health` 503, `problems` mentions a variable | Misconfiguration | Set it. The service is refusing on purpose. |
| `problems: ["daily BTC sponsorship budget is exhausted"]` | `RELAYER_MAX_DAILY_SPONSORED_BTC` genuinely **committed** | Resets at 00:00 UTC. Compare `committedTodayWei` against `dailyBudgetWei` before raising it — the halt cannot be tripped by traffic that was refunded. |
| `problems` mentions "reservation refund(s) could not be written" | The quota store rejected refunds | The reserved counter is inflated until they drain. They retry on each sweep and at the head of each relay; if the number is not falling, the store is down. |
| `RELAYER_UNDERFUNDED` | Hot key out of BTC | Top up. Keep days of float, not months. |
| `problems` mentions "no configured RPC endpoint serves the methods" | Every RPC failed the capability preflight | Usually transient — Mezo endpoints can briefly answer `-32601` while a backend is degraded. Re-probe by hand before concluding an endpoint is broken, then restart. Add endpoints to `RELAYER_RPC_URLS` rather than removing them. |
| `tx.replaced` warnings | Fees too low for current conditions | Normal, self-healing. Persistent ⇒ investigate the queue. |
| Rising `inFlight` on `/health` | Broadcasts are not completing | Check RPC health; the nonce queue is serialised, so one stuck broadcast blocks the rest. |

### Rotating the hot key

1. Fund a new key.
2. Update `RELAYER_PRIVATE_KEY` (or the keystore) and redeploy.
3. Confirm `/health` reports the new address and `accepting: true`.
4. Sweep the old key.

No on-chain step. The relayer has no on-chain identity to migrate — which is the same
property that makes a key compromise cheap.

---

## Architecture notes

### Why not ERC-4337

EntryPoint v0.7 **is** deployed on Mezo (32,073 bytes, byte-identical to L1) and has
**never processed a single UserOperation**. Mezo's RPCs do not implement
`debug_traceCall`, so no ERC-7562-compliant bundler can run against it, and no vendor
(Pimlico, Biconomy, ZeroDev, Alchemy, Gelato, Candide) supports Mezo. It is a dead end.
ERC-2771 + EIP-2612 is the path that works today.

### EIP-7702

Live on Mezo mainnet since block 9,275,000. Not implemented here, and deliberately not
blocked: when `request.from` has code, verification defers to the forwarder's on-chain
`verify()` (OpenZeppelin's `SignatureChecker`) instead of `ecrecover`, so 7702-delegated
and ERC-1271 accounts already work through this service.

### The relay pipeline

Ordered cheapest-first, and every stage can only reject:

1. **posture** — is this relayer accepting work at all? (R8)
2. **shape** — schema; no client-supplied funding source (R1)
3. **admission** — `value == 0`, gas cap, target + selector, decode calldata (R3, R4)
4. **identity** — recover the signer; the payer *is* the signer (R1, R2)
5. **policy** — free tier / in-band fee / rate limits / global budget (R16)
6. **simulation** — `eth_call` then `eth_estimateGas`; reject anything that reverts
7. **reservation** — debit quota and budget *before* broadcasting
8. **submission** — one serialised nonce allocation + broadcast

Nothing after stage 4 uses a value from the HTTP body that was not inside the EIP-712
struct.

---

## Known limitations

Stated because a security document that only lists successes is not a security
document.

- **`packages/contracts` does not exist yet.** The function signatures in
  `src/registry.ts` are the relayer's side of a contract that has not been written.
  They must stay byte-identical to the Solidity. If they drift, the selector changes
  and this service rejects the call with `SELECTOR_NOT_ALLOWED` — the correct failure
  direction, but a failure nonetheless.
- **No full forwarder round trip is tested here.** The anvil suite exercises real
  simulation, broadcast and receipt settlement against a Mezo testnet fork, but there
  is no `MarenForwarder` in this package to deploy, so `execute` itself is unproven
  from the relayer's side. The EIP-712 typehash and field order are no longer an
  inspection-only assumption, though: `packages/contracts` now has a test that builds a
  signature from the pinned typehash and domain alone and executes it.
- **Mezo endpoints transiently claim methods do not exist.** During testing
  `mezo.drpc.org` returned `-32601 "the method does not exist/is not available"` for
  `eth_call`, `eth_getLogs`, `eth_estimateGas` and `eth_blockNumber` across a full
  probe sweep — and then served all of them 10/10 about an hour later. A degraded
  backend behind the load balancer was reporting "unsupported" rather than
  "unavailable", which is indistinguishable from a real capability limit if you probe
  once. **No provider is blocked in this codebase**, and an earlier revision that did
  block one was wrong. What the service does instead: `probeEndpoint` retries before
  recording a method as missing, and the transport fails over across every usable
  endpoint. A boot preflight that asserts method support (rather than mere
  reachability) is still the right control — it just decides liveness *now*, not a
  provider's permanent capabilities. If every endpoint fails the preflight the
  relayer refuses to relay until restarted; on a chain this flaky that is a real
  availability trade, taken deliberately in favour of never burning BTC blind.
- **Nonce serialisation is per instance.** Two Vercel instances can still race on
  nonce allocation. The mitigation is that a failed broadcast invalidates the cached
  nonce and forces a chain resync, but a shared nonce lease is the real fix if this
  runs multi-instance under load.
- **The stuck-transaction sweeper does not run on serverless.** There is no process
  between requests. Run standalone, or drive replacement from an external cron.
- **Redis counters are 64-bit signed.** Spend is tracked in wei, so the daily BTC cap
  must stay below 9.22 BTC. At Mezo's base fee that is ~10 billion sponsored
  transactions per day, so it is theoretical — but it is a real ceiling.
- **Sybil resistance is economic, not cryptographic.** 25 free actions per *address*,
  and addresses are free. The global daily BTC cap is the actual backstop — which is
  why `RELAYER_STORE=memory` under `VERCEL` is a refusal rather than a warning, and why
  every limit is decided on an atomic increment's return value rather than on a prior
  read. With a shared store the overshoot bound is **zero**: `INCRBY` serialises
  globally, so each racing request gets a distinct post-increment value and exactly one
  crosses the line. Independently measured at 25, 100 and 250 concurrent against a
  one-request budget: exactly one admitted, exactly one broadcast, spend exactly to the
  cap. The multi-instance hazard is not the arithmetic, it is running without a shared
  store at all — which is why that is now a boot problem.
- **The `(payer, nonce)` duplicate-request guard is per instance.** It is an in-memory
  `Set` on the service object, so it does **not** hold across the multi-instance
  deployment that `RELAYER_STORE=redis` implies. Two instances can still admit the same
  signed request; one lands and the other reverts on a consumed nonce, costing us that
  gas. Same shape as the nonce-allocation caveat below, and the same fix — a shared
  lease — would close both.
- **Rate limiting depends on the deployment telling us the truth about the client.**
  With no trusted proxy and no platform header, everything behind a load balancer
  resolves to the balancer's address and shares one bucket. That is the safe direction —
  it over-attributes rather than under-attributes — but it will throttle legitimate
  traffic if you deploy behind a proxy and forget `RELAYER_TRUSTED_PROXIES`.
- **The paid tier is closed until `MarenRelayHub` ships.** Post-free-tier requests get
  `402 SPONSORSHIP_UNAVAILABLE`. Deliberate: a fee mechanism that is signed but not
  atomically enforced is worse than none (R13). That principle was invoked here while
  the budget counter itself had a check-then-act race — it does not any more, and the
  two were fixed in the same pass rather than one being used to justify the other.
- **The Vercel deployment path is unverified.** Configuration is written and committed;
  nothing has been deployed from this branch.
