# Security lessons carried into Maren

Talise — the author's Sui payments app and Maren's direct predecessor — was audited on
**2026-07-24**. The audit found **7 Critical, 13 High, 20 Medium, and 24 Low** severity
issues. It also recorded that an unauthenticated command-injection route reached
production for roughly six minutes that day, and that all in-scope secrets were rotated.

That audit is the single most useful input to Maren's design. Every rule below is a
specific failure that already happened once, restated as a constraint on this codebase.
These are not aspirations. They are review criteria: a pull request that violates one of
them does not merge.

The audit's own framing is worth keeping: *"A security document that only lists
successes is not a security document."*

---

## Relayer and sponsorship

**R1 — Bind the funding source to the caller.**
*Talise C1: the shielded relayer could be induced to fund an attacker's deposit, draining
the relayer.*
Maren's relayer must derive the payer from the verified ERC-2771 signer, never from a
client-supplied field. A relay request may not name its own funding source.

**R2 — Bind fee parameters inside the signed payload.**
*Talise C7: the shielded withdraw's `relayer` and `relayer_fee` were validated off-chain
but not bound by the proof, so they could be swapped after signing.*
Every parameter that moves value — recipient, amount, fee, relayer — is inside the
EIP-712 struct that the user signs. Nothing economically meaningful is passed alongside
the signature.

**R3 — The relayer holds gas, never user funds.**
A full compromise of the relayer key must cost Maren its BTC gas float and nothing else.
The relayer is never an owner, never an approver, and never a custodian.

**R4 — Allowlist targets and selectors.**
The relayer relays only to known Maren contracts and only for known function selectors.
A generic "relay any call" endpoint is how R1 happens.

## Escrow and shared balances

**R5 — Never key escrow by a shared address.**
*Talise C3: on the live cheque rail, a user could fund their own cheque from someone
else's escrow deposit and claim it.*
Every escrowed balance in `MarenPay` (links, requests, splits) is keyed by
`(creator, id)` and debited only from the creator's own balance. Pooled contracts keep a
per-user ledger; a shared pot with per-user claims is the exact shape that failed.

**R6 — Verify funding on-chain. Never trust a client-asserted digest.**
*Talise C4: payroll streams accepted a client-asserted funding digest with no on-chain
verification.*
If the contract needs to know that money arrived, it reads its own balance or checks the
transfer's return value. It does not take the client's word.

**R7 — Enforce hashlocks and recipient binding on-chain.**
*Talise's deployed cheque contract took neither a hashlock nor a bound recipient and
gated both off-chain — the parameter in the claim path was literally named `_secret` and
unused. This is what enabled C3.*
`MarenPay.claimLink` verifies the secret preimage on-chain, and a recipient-bound link
checks `msg.sender` on-chain. Off-chain gating is not a control.

## Access control and upgrades

**R8 — Gates fail closed.**
*Talise F-A1: the private-beta guard wired to 59 routes read
`if (APP_ACCESS_OPEN !== "false") return true;` — a pass-through whenever the variable
was unset.*
Every feature flag, pause, allowlist, and access gate defaults to **denied**. A missing
or malformed environment variable must never widen access. Test the unset case.

**R9 — Timelock and multisig the proxy admin from deployment day one.**
*Talise I-3: all seven packages retained a live single-key upgrade capability; its own
audit named single-key upgrade authority the highest-leverage open risk.*
Maren's upgradeable contracts are owned by a multisig behind a timelock **at deploy
time**, not "before mainnet". Note that MUSD itself is behind upgradeable proxies
controlled by a single Mezo multisig — we inherit that risk and must disclose it, which
is all the more reason not to add our own.

**R10 — Use `initializer` modifiers on every initialisation path.**
*Talise C5/C6: a permissionless `yield_router` registry and a permissionless
`bootstrap_v7`.*
Any function that can only sensibly run once is guarded, and the guard is tested by
calling it twice.

**R11 — Do not deploy the same logic twice.**
*Talise I-7: `talise-pay` was a byte-identical fork of the cheque and stream logic,
separately published, with divergent admin state.*
One deployment per behaviour. Divergent admin state across duplicate contracts is a
liability nobody tracks.

## Authentication

**R12 — Loopback + CSRF, not custom URL schemes.**
*Talise M1: the mobile bearer token was delivered over an unverified `talise://` custom
scheme, claimable by any Android app. Its CLI got this right — `127.0.0.1:0`, a random
CSRF token compared with `timingSafeEqual`, and a base-URL allowlist that validates even
the persisted session file.*
Maren's iOS app uses `ASWebAuthenticationSession` with a verified universal link, or a
loopback listener with CSRF. Never a bare custom scheme.

**R13 — Do not claim an attestation you have not implemented.**
*Talise I-2: App Attest was structural only — it checked that two headers were non-empty,
and the check was a no-op on the money routes it was advertised as protecting.*
Either verify the attestation assertion properly, or say the product does not use
attestation. A security control that exists in the marketing and not in the code is worse
than none, because it stops people looking.

## Process

**R14 — Audit CI artifact uploads before the first mobile build.**
*Talise C2: production database dumps and Apple signing keys were uploaded to a
third-party build service on every mobile build.*
Before Maren's first Expo/EAS build, enumerate exactly what leaves the machine. Secrets
live in the CI provider's secret store, never in an uploaded artifact, never in the repo.

**R15 — A failed transaction must never be reported as a delivered payment.**
*Talise found that both its broadcast paths returned HTTP 200 with a digest-bearing
`FailedTransaction` object, requiring bespoke abort detection on every path.*
Maren treats a transaction as successful only on an on-chain receipt with `status ===
'success'`. A transaction hash is not a success. This is checked in one shared place, not
per call site.

**R16 — Prefer an explicit typed failure over a silent fallback.**
*Talise deliberately returned `ACCUMULATOR_UNDERFUNDED` (400) rather than silently
falling back to sponsored gas, "so a plain free send never silently costs Talise gas."*
Good instinct; keep it. Fallbacks that cost money are opt-in and logged.

**R17 — Build from deployed behaviour, not from documentation.**
*Three of Talise's own architecture documents described systems that never shipped
(Enoki, dApp Kit, Walrus Sites), and its deployed bytecode had diverged from source after
a cleanup that reordered function parameters.*
This is why Maren's chain facts are read with `cast` and its ABIs come from
`@mezo-org/musd-contracts` rather than being transcribed. We found the same class of
problem on Mezo's side — documented behaviour that the bytecode does not implement, and
published RPC hosts that do not resolve. See `packages/sdk/src/constants.ts`.

---

## What this means for Maren's own disclosures

Talise's `SECURITY.md` labelled its custodial surfaces explicitly, including the sentence
*"funds in an open cheque or stream are custodially exposed to Talise."* Maren owes users
the same clarity about its one genuinely risky component:

**`MarenVault` pools many users into a single MUSD trove. Collateral is segregated in
accounting, not in custody. A drawdown faster than the keeper can respond could socialise
losses across pooled users.** The 140% internal liquidation threshold against the
protocol's 110%, the per-user ledger, the deposit cap, and the insurance buffer are
mitigations, not guarantees. Users with enough BTC to open a direct trove are steered to
one, and the interface says why.

Talise's design rationale doc contains the line *"for users who want sovereign custody,
Talise is not the right product."* Maren's equivalent sentence: **if you will not accept
pooled-trove risk, use a direct trove — Maren supports it, and above ~0.079 BTC it is the
better choice.**
