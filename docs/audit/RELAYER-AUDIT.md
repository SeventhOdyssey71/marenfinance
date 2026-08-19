# Adversarial audit: the gasless meta-transaction path

Scope: `packages/contracts/src/MarenForwarder.sol` and `MarenRelayHub.sol`, the whole of
`apps/relayer/src`, and `apps/web/src/lib/chain/relay.ts`. Read against
`docs/audit/MEZO-GROUND-TRUTH.md`, and where a claim could be settled on-chain it was:
every "verified live" note below is a `cast` call against Mezo matsnet on 19 August 2026,
not a reading of the source.

Baseline at the start: 286 relayer tests, 108 web tests, 302 Foundry tests, all green.
After this audit: 296, 113, 304.

## Findings

| #   | Severity | Area                  | Finding                                                                                                  | Status     |
| --- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | High     | relayer economics     | A signer-chosen gas ceiling latches the day-long budget halt, and reconciliation never lifted it         | Fixed      |
| 2   | Medium   | relayer economics     | Calldata gas sits outside the signed `request.gas`, so the reservation was unbounded below the real cost | Fixed      |
| 3   | Medium   | relayer economics     | A reservation that failed halfway was never given back                                                   | Fixed      |
| 4   | Medium   | contracts             | The hub called an arbitrary address before validating anything                                           | Fixed      |
| 5   | Medium   | drift control         | The registry drift test compared names, and the drift was never in the names                             | Fixed      |
| 6   | Medium   | web client            | A 202 was believed on the strength of its hash alone                                                     | Fixed      |
| 7   | Low      | relayer observability | The 80% warning was an anonymous log-flood primitive                                                     | Fixed      |
| 8   | Low      | relayer liveness      | `TxWatcher.sweep` had no reentrancy guard                                                                | Fixed      |
| 9   | Low      | web client            | `NEXT_PUBLIC_RELAYER_URL` accepted any scheme, including plaintext                                       | Fixed      |
| 10  | Medium   | contracts, design     | `executeWithFee` has no fee-token or fee-recipient allowlist                                             | Documented |
| 11  | Low      | relayer disclosure    | `/health` and `/healthz` publish secret file paths and key posture to anyone                             | Documented |
| 12  | Low      | relayer economics     | The free tier is Sybilable, and the daily BTC cap is the only real bound                                 | Documented |
| 13  | Low      | relayer boot          | The forwarder's EIP-712 domain is never read from the chain, though a comment says it is                 | Documented |
| 14  | Info     | contracts             | `_checkRelayGas` runs after the revert bubble, unlike OpenZeppelin's ordering                            | Documented |
| 15  | Info     | relayer liveness      | The nonce queue serialises every user behind one slow broadcast                                          | Documented |

Attacked and did not break: EIP-712 domain binding and cross-chain replay, forwarder nonce
replay, fee tampering by the relayer, selector smuggling, value smuggling, the on-chain
allowlist as a second line behind a compromised relayer, the web client's fail-closed
posture on every uncertain state, the read-only verification signer, and the keystore path.
Each is written up under "Attacked and holds" below with what the attack actually was.

---

## 1. HIGH. A signer-chosen gas ceiling takes the relayer offline for the day

**Where** `apps/relayer/src/service.ts`, `#commitSpend` and `reconcile`.

**The attack.** The day-long halt latches on `committed:<day>`, which `#commitSpend` debits
with `projectedGasCostWei = request.gas * maxFeePerGas`. `request.gas` is a ceiling the
signer picked; it is not what the transaction costs. `reconcile()` corrects the counter
downward once the receipt exists, and nothing re-read the latch, so `#budgetHaltedOn`
stayed set until 00:00 UTC on money that was never spent.

Measured, in `budget.test.ts`: one request signing 1,000,000 gas against a budget sized for
exactly that reservation halted the relayer. The transaction settled at 120,000 gas.
Committed spend converged on 6% of the budget and every later request answered
`503 RELAYER_NOT_ACCEPTING` for the rest of the day.

It costs nothing to do on purpose, because it is indistinguishable from ordinary traffic.
The per-request cap allows 1,500,000 gas and `MarenRegistry.commit` costs a fraction of
that. A fresh address gets 25 free actions and addresses are free. And the app does most of
the work unaided: `relayGasLimit` in `relay.ts` signs 1.5x its own estimate plus 60,000, so
an operator's stated daily cap already buys well under half the sponsored transactions they
configured, before anybody attacks it.

This is the same shape as the latching DoS adversarial round 2 removed. That one latched on
RESERVED spend, so a burst of doomed requests took the relayer down having spent nothing.
The fix moved the latch onto committed spend, which is correct, and left the second half
undone: committed spend is also provisional until the receipt lands.

**Fix.** `#reconsiderBudgetHalt` lifts the halt when reconciliation shows committed spend
back under the limit, for the day the reservation was debited against. Three regression
tests: the halt is lifted on a corrected number, is NOT lifted when the reconciled number
still justifies it, and is untouched by a correction belonging to another day.

**Remaining recommendation.** The under-reservation itself is still there, it is just no
longer load-bearing. Reserving against a simulated gas figure rather than the signed
ceiling would remove the 12x to 25x inflation entirely. That needs the simulation to move
ahead of the reservation, which reorders the pipeline, so it is recorded rather than done
here.

## 2. MEDIUM. Calldata is gas the reservation never counted

**Where** `apps/relayer/src/calldata.ts`, `admitCall`.

**The attack.** `ForwardRequest.gas` is the gas handed to the INNER call. Calldata is
charged at the transaction level. So neither `maxGasPerRequest` nor `projectedGasCostWei`
bounds it at all.

`MarenPay.pay(address,uint256,string)` with a 100,000-character memo is a valid,
allowlisted, fully decodable call to a real Maren contract. Measured: 100,132 bytes, about
1,602,112 gas of intrinsic cost before `MarenPay` executes a single opcode. The request
carrying it signed `gas: 300000` and reserved for exactly that. It was admitted, simulated
and broadcast. The reservation was out by more than 6x on one request, and reservations are
the only thing stopping concurrent traffic from overrunning the daily cap before the first
receipt lands. The 52x overshoot, arriving from the other direction.

There was also no bound at all on the HTTP body, so the same request is a memory pressure
lever independent of gas.

**Fix.** `MAX_CALLDATA_BYTES = 8192`, checked before the decode. The number comes from the
widest call Maren actually has: `split` at the contract's maximum 64 recipients is about
4,300 bytes plus a memo, and a test holds that case open so the cap cannot quietly break a
real feature. It bounds the unsigned share of the cost at roughly 131,000 gas.

**Remaining recommendation.** Fold the calldata cost into `projectedGasCostWei`. The cap
turns an unbounded error into a bounded one; it does not make the reservation an upper
bound again.

## 3. MEDIUM. A reservation that failed halfway was never given back

**Where** `apps/relayer/src/service.ts`, `#reserve`.

**The attack.** Not an attack so much as a store that flaps, which Upstash REST over the
public internet does. `#reserve` wrote four independent counters under `Promise.all`. A
rejection from any one of them propagated out while the other three still landed, and
nothing above that frame knew a reservation had been taken, so nothing released it.

Measured with one counter forced to throw: the request answered a bare `500 UPSTREAM_ERROR`
and left the signer's lifetime and daily action counters permanently debited for a relay
that never happened. Two of those counters are a user's own free 25 and one is the shared
daily BTC budget. This is the leak `#release` and `#refund` exist to prevent, one layer up
from where it was being handled, and the module's own comment describes the consequence
exactly: "after 10 rejected requests, nothing broadcast, no BTC spent, the counter read
100% of budget".

**Fix.** `Promise.allSettled`, refunding only the writes that landed (refunding one that
failed is how a counter goes negative), and a typed `503 STORE_UNAVAILABLE` rather than a 500. Two regression tests, including one that asserts the failed counter is not refunded.

## 4. MEDIUM. The hub called an arbitrary address before validating anything

**Where** `packages/contracts/src/MarenRelayHub.sol`, `executeWithFeeAndPermit`.

**The attack.** The permit ran first:

```solidity
if (req.feeAmount > 0) {
    try IERC20Permit(req.feeToken).permit(req.from, address(this), req.feeAmount, ...) {} catch {}
}
_executeWithFee(req);
```

`req.feeToken` is whatever the caller put in the struct, and at that point nothing about
the request has been checked: not the deadline, not the allowlist, not the target's trust
in the hub, not the signature. So anyone holding no signature at all could make
`MarenRelayHub` call any address on Mezo with the
`permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` selector and largely chosen
arguments, with any failure swallowed by the `catch`.

The frame reverts afterwards on the bad signature, so no state change persists. That is the
reason this is Medium and not High. But "the state change is undone" is not "the call did
not happen", and the address making the call is the one every Maren contract grants
trusted-forwarder authority to. A function anywhere in the trusted set whose selector
collides with `permit`'s, now or later, is reachable this way by an unauthenticated caller.

**Fix.** Validation is hoisted into `_validateRelayedCall`, a view, and run before the
permit as well as inside `_executeWithFee`. The cost is one extra `ecrecover`.

The regression test uses `expectCall(..., 0)` rather than a counter on the probe, which is
the point worth recording: the frame reverts, so any state the probe wrote is rolled back
and a counter reads zero whether or not the call happened. A counter-based test passes
against the vulnerable contract. `expectCall` is recorded by the cheatcode VM and survives
the revert; it fails against the vulnerable contract, which was verified by reintroducing
the bug.

## 5. MEDIUM. The drift test compared names, and the drift was never in the names

**Where** `apps/relayer/test/allowlist.test.ts`, "admits nothing MarenRelayHub would refuse
on-chain".

This is the fix the brief asked to verify, and it did not close the gap it was written for.

The existing test reads `script/Deploy.s.sol` and checks that every function id this relayer
admits is one the hub is allowlisted for. It compares NAMES, because `MarenPay.pay.selector`
in a deploy script is all the parse can recover.

The drift it was written for was not a name drift. Every entry in `registry.ts` carried a
trailing `uint256 relayFee` that the contracts never had. The names were all correct. The
SIGNATURES were all wrong, so every selector was wrong, so every relay request the web app
could send was destined for `403 SELECTOR_NOT_ALLOWED`. Verified by reintroducing exactly
that drift on `marenPay.pay`: the name-only test still passes.

The registry as it stands today is correct. Its signatures were checked function by function
against the compiled ABI in `packages/contracts/out`, including the `payWithPermit2` tuple
against `IPermit2.PermitTransferFrom`. So this is a control gap, not a live bug.

**Fix.** A second test reads the parameter lists out of `packages/contracts/src/*.sol` and
holds them against the ABI the registry parses: names, order, and elementary types. A
parameter added, removed, renamed, reordered or retyped moves the selector, and now moves
this. Verified to fail against the reintroduced drift.

**Remaining gap, stated rather than hidden.** Struct parameters are compared by position and
name only. `payWithPermit2` takes an `IPermit2.PermitTransferFrom` that the registry spells
out as a tuple, and resolving a struct's fields from source would make a vitest file into a
Solidity parser. A field changing inside that one struct still moves the selector without
failing a test. The airtight version reads `packages/contracts/out/*.json` and compares
selectors directly, which needs `forge build` to have run before `pnpm test`.

## 6. MEDIUM. A 202 was believed on the strength of its hash alone

**Where** `apps/web/src/lib/chain/relay.ts`, `isAccepted`.

**The attack.** The guard checked that the body carried 32 bytes of hex and nothing else.
The hash is where this client stops being sceptical: `useTxRunner` hands it to
`confirmTransaction`, which reads a receipt and reports what it finds. So a relayer
answering `202` with somebody else's already-confirmed transaction hash renders as this
action succeeding, on a screen that also says Maren paid the gas. Neither is true, and the
app's stated rule is that it never claims a sponsorship it does not perform.

This is the concrete answer to "can a malicious `NEXT_PUBLIC_RELAYER_URL` make the app lie".
It cannot steal a usable signature (see "Attacked and holds"), but it could fabricate an
outcome.

**Fix.** `payer` is the only field tying the answer back to the request, so it is checked
against the `from` that went out rather than read for display, along with
`state === 'submitted'`. A 202 failing either is reported as `RELAYER_ANSWER_UNRECOGNISED`
with nothing claimed as sent.

**Remaining recommendation.** This removes the case that needs no relationship with the user
at all. A hostile relayer could still return the hash of a different transaction it sent for
the same signer. Closing that means checking the receipt's `to` against the hub and its
input against the signed request, which belongs in `confirmTransaction` rather than here.

## 7. LOW. The 80% warning was an anonymous log-flood primitive

**Where** `apps/relayer/src/service.ts`, `#warnBudgetNearLimit` and `#warnNearLimit`.

The warnings fired on RESERVED counters at reservation time. A request that fails simulation
still reserves, crosses the threshold, warns, and is then refunded back under it, so the
next one crosses again. Measured: six reverting requests produced six `budget.near_limit`
lines against zero wei of spend. Unbounded, unauthenticated, and aimed at the one signal an
operator is meant to page on.

The comment above the call site claimed this was already handled: "Only admitted requests
count towards the approaching-the-limit signal. A rejected burst is refunded, so warning on
it would mean an attacker could fill the log with limit warnings for traffic that consumed
nothing." The reasoning was right and "admitted" had been read as "passed policy" rather
than "was broadcast". `DEPLOY.md` repeats the claim in its alert table.

**Fix.** The budget warning is taken inside `#commitSpend`, off committed spend. The
per-address and per-IP warnings are taken after the broadcast. A regression test drives six
doomed requests and asserts zero warnings of either kind.

## 8. LOW. `TxWatcher.sweep` had no reentrancy guard

`start` fires the sweep on an interval with `void`, and one pass costs a receipt read per
pending transaction plus a broadcast for the stuck ones, so a slow RPC makes a sweep outlast
its own interval easily. Two overlapping sweeps iterate the same snapshot and both replace
the same stuck transaction at the same nonce: two hashes in `#pending` for one slot, only
one of which can ever get a receipt. The other is watched forever, its `onSettled` never
fires, and the reservation it carries is never reconciled, so the day's committed spend
stays permanently above what was really paid. Which is now exactly the number that has to
converge for finding 1's fix to work.

**Fix.** A `#sweeping` flag; a second call while one is running returns. Skipping is right
rather than queueing, because the next tick is seconds away and the work is idempotent.

## 9. LOW. The relayer URL accepted any scheme

`normaliseUrl` trimmed whitespace and stripped trailing slashes. `http://relay.example.com`
was accepted. What crosses that connection is a signed `ForwardRequest`: the signature
covers every field so nobody can alter it, but an observer on a plaintext hop reads the
user's address, the target, the amount and the memo, and can replay it to the hub themselves
inside the deadline.

**Fix.** Three shapes accepted and nothing else: a same-origin path (what `DEPLOY.md` tells
an operator to configure, because the relayer sets no CORS headers and must be proxied),
`https://`, and `http://` to localhost for `pnpm dev`. Anything else reads as no relayer at
all, so `shouldRelay` is false and the screen says the user pays before they press anything.

## 10. MEDIUM, design. `executeWithFee` has no fee-token or fee-recipient allowlist

**Not fixed.** It needs an admin-settable allowlist on a deployed contract, and this audit
does not redeploy.

`RelayedCall` binds `feeToken`, `feeAmount` and `feeRecipient` into the digest, and the hub
reads all three from the signed struct. That property holds and is asserted three ways in
`MarenRelayHub.t.sol`. But the values themselves are unconstrained: the hub will
`safeTransferFrom` any amount of any ERC-20 the user has approved to it, to any address.

So `MarenRelayHub` is, for anyone who can obtain one EIP-712 signature under the
"Maren Forwarder" domain, a general "move this token to this address" primitive. The user
signs it, and a wallet does render the struct, so this is a phishing surface rather than a
theft primitive. `executeWithFeeAndPermit` widens it: a user induced to produce a permit and
a `RelayedCall` in one flow needs no prior approval at all.

The design only ever intends MUSD to Maren's own fee recipient. Recommendation: an
admin-settable `allowedFeeToken[token]` and `allowedFeeRecipient[recipient]`, checked in
`_validateRelayedCall`, plus a ceiling on `feeAmount`. Each is one mapping and one require,
and each narrows the signature to what the product actually needs.

Worth noting for scope: the relayer service does not drive `executeWithFee` at all today.
`chain.ts` encodes the inherited `execute(ForwardRequestData)`, every `feeArgIndex` in the
registry is null, and `policy.ts` therefore closes the paid tier with
`402 SPONSORSHIP_UNAVAILABLE` rather than opening a free one. So this is latent surface on a
deployed contract, not a live path.

## 11. LOW. `/health` and `/healthz` publish operational internals to anyone

Neither endpoint is authenticated, and `DEPLOY.md` tells an operator to proxy both at the
web app's hostname. Between them they publish: the hot key address, its BTC balance, the key
source mode (`env` tells an attacker the raw key is in the process environment), the daily
budget and how much of it is committed, nonce and queue depth, the RPC endpoint list, and
every `problems` and `warnings` string.

The strings are the sharp part, because two of them carry filesystem paths:

- `could not load the relayer signing key: cannot read keystore at <path>`
- `the keystore passphrase file at <path> is mode 644; it is readable by other users on this host`

The second announces the path of a passphrase file AND that it is world-readable, to
anonymous callers.

Recommendation: keep the detail in the log and publish a code. `secretFileModeWarning`
should return a message naming the label, not the path, for the public view. Longer term
these belong on a separate port or behind a bearer token; the container healthcheck only
needs `ok` and `accepting`.

## 12. LOW. The free tier is Sybilable and the daily cap is the only real bound

Stated because the code does not state it. `freeActionsPerAddress` is 25 lifetime actions
per address, and addresses cost nothing to create. `maxActionsPerAddressPerDay` therefore
brakes nothing an attacker cares about. `maxActionsPerIpPerDay` (200) is the only per-caller
cost, bucketed at a /64 for IPv6, which is the right choice and still cheap.

So the whole abuse model rests on `RELAYER_MAX_DAILY_SPONSORED_BTC`. `create.ts` already
knows this and refuses to boot multi-instance without shared storage for exactly this
reason. The consequence to state plainly is that the daily budget is not a backstop, it is
the control, and findings 1, 2 and 3 were all ways to make it read the wrong number.

`RELAYER_CLIENT_IP_HEADER` is a related footgun. It is trusted unconditionally, which is
correct for `x-vercel-forwarded-for`, and an operator behind nginx who sets it to
`x-forwarded-for` hands every client the ability to mint a fresh rate-limit bucket per
request. Recommendation: refuse `x-forwarded-for` as a value for that variable, and point at
`RELAYER_TRUSTED_PROXIES` instead.

## 13. LOW. The forwarder's domain is never read from the chain

`MarenForwarder.sol` says of `DOMAIN_NAME` and `DOMAIN_VERSION`: "the `maren/sdk` package
hardcodes them and the relayer asserts they match before signing anything." The relayer does
not. `forwarder.ts` builds the domain from local literals, `domain.test.ts` pins those
literals against hardcoded strings, and nothing ever calls `eip712Domain()` on the
configured address.

The failure direction is safe. A wrong `RELAYER_FORWARDER_ADDRESS` produces signatures that
recover to an address that does not match `from`, so the request is refused with
`401 INVALID_SIGNATURE`, or reaches simulation and reverts `CallNotAllowed`. Nothing is
mis-executed. But the comment describes a check that is not there, which is the shape the
repo's own R13 forbids.

Recommendation: read `eip712Domain()` in the boot preflight, next to the RPC capability
probe in `rpc.ts`, and compare name, version, chainId and verifyingContract. It turns a
misconfiguration that currently fails on every request into one that fails at boot with an
explanation. Verified live: the deployed hub returns exactly `("Maren Forwarder", "1",
31611, 0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C)`, so the check would pass today.

## 14. INFO. `_checkRelayGas` runs after the revert bubble

In `_executeWithFee`:

```solidity
if (!success) _bubbleRevert();
_checkRelayGas(gasLeft, reqGas);
```

OpenZeppelin runs `_checkForwardedGas` BEFORE deciding what to do with `success`. The
reordering does not create an exploit here, because a failed inner call takes the entire
frame down with it, so the insufficient-gas griefing outcome OpenZeppelin defends against
(the forwarding succeeds while the inner call is starved) cannot occur on this path. The
check still runs on the success path, which is where it matters, so the property holds by a
different argument than OpenZeppelin's. Recorded because the divergence is easy to
misdiagnose later. Matching OpenZeppelin's order costs nothing.

## 15. INFO. The nonce queue serialises every user behind one slow broadcast

`NonceManager.submit` holds the critical section across the network round trip, and on a
nonce-mismatch error across two more. viem's transport is 15s with two retries, so one bad
endpoint can stall every concurrent relay for tens of seconds. `/healthz` exposes
`nonce.queued` for exactly this, and `DEPLOY.md` documents watching it. Correct as built for
a single-key relayer; noted because it is the throughput ceiling, and because a nonce lease
is the fix if this ever needs a second instance.

`nonce.ts` also carries its own accurate note on the lost-response case: a broadcast the RPC
accepted but whose response was lost is treated as "not broadcast", so the transaction lands
and the reservation is refunded. It under-counts spend, which is the unsafe direction for
the budget. Bounded to one request's gas. Left as recorded.

---

## Attacked and holds

**EIP-712 domain binding, and cross-chain replay.** `ERC2771Forwarder` constructs
`EIP712(name, "1")`, so the domain separator covers `chainId` and `verifyingContract`.
Verified live on the deployed hub: `eip712Domain()` returns `("Maren Forwarder", "1", 31611,
0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C)`. A matsnet signature cannot verify on mainnet
even if the hub were deployed at the same address there, because 31611 is inside the digest.
The relayer rejects a request signed for another chain before any chain read
(`signature.test.ts:141`), and the standalone `MarenForwarder` is deliberately never
deployed, so there is exactly one verifying contract. Verified live:
`MarenPay.trustedForwarder()` returns the hub.

**Forwarder nonce replay.** `_useNonce(req.from)` is called before the outward call in both
`_executeWithFee` and OpenZeppelin's `_execute`, and both read the same `Nonces` counter, so
a request cannot be replayed through the other entrypoint either. The relayer additionally
refuses any request whose signed nonce is not the current on-chain nonce, and holds a
`(payer, nonce)` in-flight slot so two copies arriving together cannot both reach submission.
Tried: replaying a used request, submitting at a future nonce, and racing two identical
requests. All refused.

**Fee tampering by the relayer.** Every fee field is inside `RELAYED_CALL_TYPEHASH` and the
hub reads `req.feeToken`, `req.feeAmount` and `req.feeRecipient` directly from the verified
struct. There is no path by which a relayer substitutes a different value; changing any of
them changes the digest. Asserted in `MarenRelayHub.t.sol` by raising the fee, redirecting
it, and swapping the token. See finding 10 for what is NOT constrained, which is the values
the user themselves signs.

**Selector smuggling.** Tried: calldata whose first four bytes are an allowed selector
followed by a payload for something else; an allowed selector pointed at a different
allowlisted Maren contract; trailing bytes appended after a valid ABI encoding. The relayer
decodes the full calldata against the specific function's ABI and scopes selectors per
target, so the cross-target case is refused (`SELECTOR_NOT_ALLOWED`) and the undecodable
case is refused (`CALLDATA_UNDECODABLE`). Trailing garbage after a valid encoding IS accepted
by viem and by Solidity, and is a no-op in both, so it changes nothing about what executes;
it was a way to inflate cost, which finding 2 now bounds.

**Value smuggling.** `MarenRelayHub.execute` rejects both `msg.value != 0` and
`request.value != 0`; `RelayedCall` has no `value` member at all; the relayer refuses a
non-zero `value` in `admitCall` before anything else; and the web client pins it at zero in
`buildForwardRequest`. Four independent refusals. Verified live that the payable
`MarenVault.deposit(address,address)` is NOT on the hub's allowlist while `borrow` is.

**A compromised relayer.** The allowlist is enforced on-chain, on `executeWithFee` AND on the
inherited fee-free `execute`, so whoever holds the relayer key can censor and reorder but
cannot execute an arbitrary call. Verified live against the deployed hub rather than the
source: `pay` on MarenPay, `commit` on MarenRegistry and `borrow` on MarenVault all return
`true`; the payable `deposit` returns `false`. The on-chain allowlist, the relayer registry
and the deploy script agree.

**The web client's fail-closed posture.** Tried: a health probe that times out, one that
returns unparseable bytes, one that returns 503 with `accepting: true`, one that returns 200
with `accepting: true` from a proxy rewriting the status, and no probe at all. Every one
resolves to `accepting: false`, and `shouldRelay` requires a configured URL AND a probe that
said yes AND a call the hub will forward. The initial state is "you pay" and copy moves off
it only on a positive answer. A refusal that will still hold next time knocks the cached
health down, so the interface goes back to saying the user pays before the retry. And when
the sheet claimed sponsorship and the relayer has since gone cold, `submitCall` refuses
rather than silently self-submitting, which would be the same lie with the sign flipped.

**Signature leakage to a malicious relayer URL.** A `ForwardRequest` signature is bound to
chainId 31611 and to the hub address, and covers `from`, `to`, `value`, `gas`, `nonce`,
`deadline` and the exact calldata. A hostile relayer that receives one can do precisely one
thing with it: submit it to the hub, executing exactly the call the user signed. It cannot
retarget it, cannot change the amount, cannot use it on another chain, and cannot use it
twice. It can withhold or delay it inside the 600-second deadline, and it learns the user's
address and intent. What it could also do was fabricate an outcome, which is finding 6.

**The read-only verification signer.** `apps/web/scripts/injected-wallet.mjs` refuses
`eth_signTypedData_v4` along with every other signing method, returning EIP-1193 4001. wagmi's
`useSignTypedData` goes through exactly that method, so the read-only provider is
structurally unable to produce a `ForwardRequest` signature. Unchanged by this work.

**Key handling.** `keystore.ts` verifies the MAC before using any decryption output, refuses
anything but v3 and `aes-128-ctr`, sizes scrypt's memory allowance from the file's own
parameters, and names the one geth profile Node's OpenSSL cannot derive rather than
surfacing a misleading error. Nothing in it logs, and no error it raises carries the key or
the passphrase. `resolvePrivateKey` errors reach `problems` as a message naming the keystore
PATH only. `logger.ts` redacts `signature`, `privateKey`, `password`, `RELAYER_PRIVATE_KEY`,
`RELAYER_KEYSTORE_PASSWORD` and `body`, from a list the tests import rather than restate.
The private key never enters `RelayerConfig`; it is resolved once in `create.ts` and passed
straight to `privateKeyToAccount`. A raw key in the environment is a hard boot problem on
mainnet, not a warning. The only leak found is the PATH disclosure in finding 11, not the
secrets themselves. The MAC comparison is not constant-time, which is not exploitable by
anyone who does not already hold the file.

**CORS.** The relayer sets no CORS headers, and that is the correct posture rather than an
omission: `POST /relay` from a browser on any other origin is blocked at the preflight, and
`DEPLOY.md` documents proxying it at the app's own hostname. There is no CSRF exposure
either way, because a relay request is worthless without a valid EIP-712 signature over it.
The failure mode of getting this wrong is safe: the health probe cannot read a cross-origin
response, so it resolves to `accepting: false` and the app tells the user they pay.

---

## What was fixed, and what was left

Fixed with regression tests: findings 1, 2, 3, 4, 5, 6, 7, 8, 9.

Left documented: finding 10 needs a contract change and a redeploy. Findings 11, 12, 13 are
operational posture and one comment that overstates a check. Findings 14 and 15 are recorded
divergences with an argument for why each currently holds.

The single highest-severity issue in the meta-transaction path is finding 1: any user, at no
cost, using the relayer exactly as intended, could take Maren's sponsorship offline for the
rest of the UTC day while spending a small fraction of the budget. It was reachable by
accident as well as on purpose, because the web client signs a padded gas ceiling on every
relayed action.
