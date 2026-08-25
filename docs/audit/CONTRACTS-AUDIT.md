# MarenVault: adversarial audit

Scope: `packages/contracts/src/MarenVault.sol` and its test suite, with the redemption splitter
(`reconcileRedemption` / `_syncState` / `redemptionCollateralPerShare` / `settleRedemption` /
`collateralOf`) as the primary target. Correctness is measured against
`docs/audit/MEZO-GROUND-TRUTH.md`, which is read from Mezo's own source, and against
`packages/sdk/src/constants.ts` (`LIQUITY_DIVERGENCES`, `DOC_DISCREPANCIES`).

Gates at the time of writing: `forge test` 309 passing (302 before this work, 7 added),
`forge fmt` clean, gas snapshot regenerated, fork suite 11 passing against matsnet.

This is a pre-audit hardening pass by the author's own tooling, not a substitute for the paid
audit. It is written to be useful to that audit: every finding carries either a reproduction or
an argument, and the things that were attacked and held up are recorded as explicitly as the
things that broke.

---

## Findings

| ID  | Severity | One line                                                                                                                                                                      | Status                   |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| H-1 | High     | A recognised `redemptionShortfall` is re-read as a fresh redemption on the next sync and charged pro rata to every remaining debtor, repeatedly, until it is fully socialised | FIXED                    |
| H-2 | High     | Redemption relief is capped by `reserveMUSD` but the collateral debit is not, so users pay collateral for relief that lands in the reserve where nobody can claim it          | FIXED                    |
| M-1 | Medium   | `withdrawProtocolCollateral` pays nobody: `_withdraw` sends to the account it debits, which here is `address(this)`                                                           | DOCUMENTED               |
| M-2 | Medium   | There was no way to cover a `redemptionShortfall`; the H-2 fix makes `depositProtocolCollateral` retire it, which is the make-whole the natspec had claimed                   | FIXED                    |
| M-3 | Medium   | A pooled trove that leaves the active state freezes idle BTC that never entered the trove, and no admin path out of that state exists                                         | DOCUMENTED               |
| L-1 | Low      | `interestIndex` was documented as monotonically non-decreasing; it falls on redemption                                                                                        | FIXED (comment)          |
| L-2 | Low      | `_outstandingDebt()` clamps at zero silently; the clamp is the mechanism behind H-2                                                                                           | DOCUMENTED               |
| I-1 | Info     | `depositAndBorrow`'s revert reason is not the sequential pair's in two orderings, contrary to its docstring                                                                   | FIXED (comment) + pinned |
| I-2 | Info     | `skim()` is the only unguarded mutation and the only one reading `address(this).balance`; attacked, not exploitable                                                           | Guard added + pinned     |
| I-3 | Info     | `redemptionCollateralPerShare` grows without bound as `totalDebtShares` shrinks                                                                                               | DOCUMENTED               |
| I-4 | Info     | `_pendingRedemptionCollateral` returns 0 for a non-active trove while `_reconcileRedemption` reverts, so views keep reporting pre-freeze numbers                              | DOCUMENTED               |
| I-5 | Info     | `skim()` is the only mutation that does not `_syncState()` first, so its `_settleRedemption` can be a no-op                                                                   | DOCUMENTED               |

Verified-correct results, each of which was attacked first, are in **Proofs of correctness**
below. V-1 in particular is the answer to the ground-truth file's headline question about
interest-first ordering.

---

## H-1 (High, FIXED). A recognised shortfall is re-read as a phantom redemption

**Affected:** `src/MarenVault.sol`: `_reconcileRedemption` L1335, `_pendingRedemptionCollateral`
L1257, `_booksInTrove` L1250, `_recogniseShortfall` L1429.

**What the contract promises.** From the file header and from `redemptionShortfall`'s own
natspec: an uncollectable redemption debit is "added back to `totalCollateral` and recorded here
rather than being spread silently onto other users, in exactly the same spirit as
`badDebtRecognised`."

**What it did.** `_recogniseShortfall` credits the uncollectable amount back to
`totalCollateral`, deliberately, so the per-account ledger still sums to it. That leaves the
books permanently above what the protocol holds, by exactly the shortfall. The redemption
detector was:

```solidity
uint256 booksInTrove = totalCollateral > idleCollateral ? totalCollateral - idleCollateral : 0;
if (troveColl >= booksInTrove) return;
uint256 collateralRemoved = booksInTrove - troveColl;
```

That difference IS the shortfall. So the very next `_syncState()` read the recorded shortfall as
a brand new redemption, added `collateralRemoved * 1e36 / totalDebtShares` to
`redemptionCollateralPerShare`, and charged it pro rata to every account still holding debt
shares. `debtRemoved` was zero or dust, because no trove debt had been cancelled, so the charge
came with no relief at all. `totalCollateralRedeemed` was inflated and a `RedemptionReconciled`
event was emitted for a redemption that never happened.

It repeats. The underwater account's slice of the phantom is itself uncollectable, so it becomes
a new shortfall, which becomes the next phantom. The series converges, and it converges on the
whole shortfall having been transferred onto the solvent debtors: total loss to them tends to
`S * f_solvent / (1 - f_underwater)`, which approaches `S` as the underwater position's share of
the pool grows.

**Reachability.** Both `settleRedemption(address)` and `reconcileRedemption()` are permissionless
and neither needs a price. Any passer-by can drive the loop in a single transaction. The only
precondition is a position below 100% collateralisation, which the contract explicitly expects
("BAD DEBT IS RECOGNISED, NOT PAPERED OVER") and which every one of its own drawdown scenarios
produces.

**Reproduction** (measured, not estimated). Seed trove 1 BTC; alice 1 BTC / 30,000 MUSD; bob
10 BTC / 1,000 MUSD; BTC falls to a third; a 25,000 MUSD redemption lands.

```
shortfall recognised on settling alice   0.150692705016944437 BTC
bob's claim, straight after that         9.956780222274749247 BTC
bob's claim after 8 more idle rounds     9.923140617198225274 BTC
drained from bob, no relief given        0.033639605076523973 BTC   (~$2,122 at $63,071.83)
```

`totalCollateralRedeemed` grew by the full shortfall on the first phantom alone.

**Why the existing suite missed it.** `test_redemption_shortfallIsRecordedNotSocialised` asserts
against carol, who is a pure depositor with zero debt shares. The phantom is charged by debt
share, so carol is untouched by construction and the test passes while solvent _debtors_ are
being drained. The invariant suite missed it for the mirror-image reason: it asserts
`sum(claims) <= held + redemptionShortfall`, and the phantom pushes claims DOWN, so it can only
make that inequality more true.

**Fix.** Both the detector and the view that previews it now go through one function, which
subtracts the shortfall before comparing books with trove:

```solidity
function _booksInTrove() private view returns (uint256) {
    uint256 elsewhere = idleCollateral + redemptionShortfall;
    return totalCollateral > elsewhere ? totalCollateral - elsewhere : 0;
}
```

Saturating, so it cannot underflow if the ledger is ever driven below the recorded shortfall.
Routing both callers through it also removes the possibility of the detector and the preview
disagreeing about what counts, which was the shape of the original mistake.

**Regression tests** (both fail on the pre-fix contract, verified by reverting the one-line
change and re-running):

- `test_redemption_recognisedShortfallIsNotReReadAsAFreshRedemption`. It grinds both
  permissionless entrypoints ten times over a recognised shortfall and asserts no phantom is
  booked, the solvent debtor's ledger and claim are byte-identical, no phantom relief is handed
  out, and the shortfall stays exactly one shortfall.
- `test_redemption_afterAShortfallIsStillMeasuredExactly`. A genuine redemption arriving after
  a recognised shortfall is still measured at full size, value neutrality still holds for the
  solvent debtor, and the recorded shortfall is not disturbed.

---

## H-2 (High, FIXED). Relief is capped by the reserve; the collateral debit is not

**Affected:** `src/MarenVault.sol`: `_reconcileRedemption` L1335 (the `debtRemoved` branch,
L1358), `_outstandingDebt` L1200.

**The mechanism.** `outstandingDebt = troveNetDebt - reserveMUSD`. The splitter's debt relief is
`debtRemoved = accountedDebt - outstandingDebt`, which cannot exceed `accountedDebt`, because the
index can only cancel debt users actually have. The collateral side has no such cap: the full
`collateralRemoved` measured off the trove is split across debt shares whatever the relief turned
out to be.

So when a redemption cancels more trove debt than the pool's users owe, which needs
`reserveMUSD > 0` and a large `mUSDLot`, users are charged collateral for relief they never
received. The excess relief lands in `reserveMUSD`, which no user has a claim on: the only things
that spend it are `_borrow` (serving _future_ borrowers) and `deleverage`.

**Measured, pre-fix** (the scenario the pin now inverts). Alice
2 BTC / 30,000 MUSD, bob 2 BTC / 10,000 MUSD; the oracle goes stale, alice repays 25,000 which
`_pushRepayment` cannot push into the trove and which therefore piles up in the reserve; the
oracle recovers; a 25,000 MUSD redemption lands.

```
reserveMUSD at the moment of redemption   25,000 MUSD
trove net debt                            40,040 MUSD
outstandingDebt (what users owe)          15,040 MUSD
debt relief handed to users               15,038 MUSD
collateral charged to users                0.396326029841268349 BTC
that collateral is worth                  24,997 MUSD
--------------------------------------------------------------
value taken with nothing given for it      9,959 MUSD
```

Before the fix the vault held 25,000 MUSD of reserve against a trove that owed 15,040 and had
socialised the 9,960 MUSD collateral cost onto users. After the fix, that same excess is charged to
the protocol's own position: alice and bob each end value-neutral, and the protocol's position
absorbs the ~9,960 MUSD, which the inverted pin now asserts.

**Bound.** The loss is at most `reserveMUSD` at the instant the redemption lands, because the
excess relief is exactly the part of `mUSDLot` that the reserve was already covering.

**Reachability.** `reserveMUSD` is not an exotic state. It is 1,800 MUSD immediately after
`openPooledTrove` (harmless there, because the only shareholder is the protocol's own position, so
the protocol pays for it). It grows whenever the trove sits near the 1,800 MUSD floor, and it grows
during an oracle outage, because `_pushRepayment` deliberately swallows the failure so a
repayment can still settle for the user. Mezo's oracle reverting above 60 seconds of staleness
is a documented, expected condition, and point 3 of the file's own READ THIS FIRST.

**Fixed: the protocol absorbs the excess.** Candidate 1 was taken. `_reconcileRedemption` now
splits `collateralRemoved` in two. The share-holders pay only for the collateral matching relief
they actually received; the EXCESS (the collateral matching relief that landed in the reserve) is
charged to `collateral[address(this)]`, mirroring the `shares == 0` branch that already routes
unattributable amounts to the protocol. The excess is measured directly from state at the moment
of reconciliation: `excessRelief = reserveMUSD - troveNetDebt` when the reserve over-covers the
trove (which is exactly the reserve-clamped case), and the excess collateral is that same fraction
of `collateralRemoved`, since `collateralRemoved` is worth `debtRemoved + excessRelief` of cancelled
trove debt. It is rounded UP toward the protocol, so no share-holder's collateral loss can exceed
the value of the debt it stopped owing. `_previewCollateralPerShare` mirrors the split so the views
stay honest in the window before anyone reconciles. After the fix the splitter's central claim,
"each debtor loses collateral worth exactly the debt they stopped owing", holds again.

The alternative, distributing the surplus reserve back to the debtors who paid for it, needs a
second per-share accumulator on the MUSD side and is a larger design change; it was not taken.

**Residual an auditor should still note.** If the reserve excess is larger than the protocol's own
position (`collateral[address(this)]`), the uncovered remainder falls to the existing
`_recogniseShortfall(address(this))` path, exactly as the `shares == 0` branch does. The seed
position (1 BTC) covers the reachable cases, but exhaustion is possible with a large enough reserve.
The H-2 change also makes `depositProtocolCollateral` actually retire that shortfall: real BTC
deposited there now lowers `redemptionShortfall` in lockstep (without re-crediting `totalCollateral`
or any account, since the collateral was a loss the protocol already took), so the protocol can be
made whole. That is the reverse of M-2's finding for this specific path.

**Pinned by** `test_redemption_reliefBeyondUserDebtIsAbsorbedByTheProtocolNotUsers` (the inversion
of the old pin), `testFuzz_redemption_userLossNeverExceedsRelief` (the H-2 invariant: after any
redemption, no user's collateral loss exceeds the value of their relief), and
`test_redemption_depositProtocolCollateralRetiresTheShortfall` (the residual make-whole).

---

## M-1 (Medium, DOCUMENTED). `withdrawProtocolCollateral` pays nobody

**Affected:** `src/MarenVault.sol`: `withdrawProtocolCollateral` L997, `_withdraw` L1588,
`_sendCollateral` L1606.

`_withdraw` sends to the account it debits. `withdrawProtocolCollateral` debits `address(this)`,
so `_sendCollateral` ends in `Address.sendValue(payable(address(this)), amount)`, a self-call
that `receive()` accepts and that moves no BTC. The natspec said "Withdraw protocol-owned
collateral", which it does not do.

What it does do: pull `amount` out of the trove into the contract's raw balance while lowering
`collateral[address(this)]`, `totalCollateral` and `idleCollateral` by `amount`, turning
protocol-owned collateral into unattributed surplus. `skim()` credits that surplus straight back,
so nothing is lost, but nothing is withdrawn either, and in between the contract's balance and
its `idleCollateral` disagree.

There was no test for this function at all, which is why it survived. There is one now
(`test_withdrawProtocolCollateral_paysNobodyAndOnlySkimRecoversIt`).

**Not fixed, deliberately.** Making it pay out means opening an admin exit for real BTC. That is
a decision to take on purpose. The minimal version does not change the ABI (give `_withdraw` an
internal recipient argument and pass `_msgSender()` here), but it still converts a function that
cannot move value out of the contract into one that can, and that belongs to whoever owns the
threat model, not to an audit pass.

---

## M-2 (Medium, FIXED alongside H-2). A recognised shortfall can now be covered

**Affected:** `src/MarenVault.sol`: `redemptionShortfall` natspec L321, `depositProtocolCollateral`
L890.

The natspec used to claim "an admin makes it whole with `depositProtocolCollateral`" while the
function did not: it raised `totalCollateral` by `msg.value` at the same time as it added
`msg.value` to the trove, so the gap between books and reality was exactly what it was before.

The H-2 fix delivered the make-whole this finding asked for, because H-2's residual needs it: when
a redemption drains the protocol's own position past zero, `_recogniseShortfall(address(this))`
records the uncovered part, and `depositProtocolCollateral` now retires it. Real BTC deposited there
lowers `redemptionShortfall` in lockstep with the deposit (capped at the shortfall) WITHOUT
re-crediting `totalCollateral` or any account, because that collateral was a loss the protocol
already took; only the surplus over the shortfall becomes claimable protocol collateral. This is
the shape the finding described (`redemptionShortfall` moved down in lockstep so `_booksInTrove`
does not under-report), folded into the existing entrypoint rather than a new one.

**Pinned by** `test_redemption_depositProtocolCollateralRetiresTheShortfall`.

---

## M-3 (Medium, DOCUMENTED). The freeze strands BTC that was never in the trove

**Affected:** `src/MarenVault.sol`: `_requireTroveActive` L1306, called from
`_reconcileRedemption` L1337; `closePooledTrove` L922.

The file header is candid about the freeze: when the pooled trove leaves the active state every
mutation halts, and the collateral the protocol did not take sits in the MUSD CollSurplusPool
which this contract does not call. Two things it does not say:

1. **`idleCollateral` is frozen too.** That is native BTC held in this contract, which never
   entered the trove, whose payout needs no trove, no oracle and no protocol call. It is frozen
   anyway, because `_syncState()` runs first on every mutation and `_reconcileRedemption` reverts
   on a non-active trove before it does anything else. Idle collateral is not a rare state: it is
   where every deposit lands whenever Mezo's oracle is stale, which the contract treats as a
   normal condition.

2. **There is no admin path out.** `closePooledTrove` is the only thing that clears `troveOpen`,
   and it calls `_syncState()` first, so it reverts with `TroveNoLongerActive` in exactly the
   state where it is the only thing that could help. `withdrawProtocolCollateral`,
   `topUpCollateral`, `deleverage` and `refinancePooledTrove` all revert for the same reason.
   Only `skim()` and the three setters still function, none of which can pay anyone.

`test_frozenTroveStrandsIdleBtcWithNoAdminPathOut` pins this: 3 BTC sitting in the contract,
liquidate the pooled trove, and every route to it, user and admin alike, reverts.

**Not fixed, deliberately.** The header argues that freezing is the honest failure and that
building a wind-down means deciding how a shortfall is shared, which is governance. That argument
is sound for trove collateral. It is much weaker for idle BTC, where there is no shortfall to
share out: the BTC is present, unencumbered, and individually attributed. A minimal, defensible
change is to let a _debt-free_ account withdraw from `idleCollateral` while frozen. It is still a
policy decision, so it is written down rather than guessed at.

---

## L-1 (Low, FIXED). `interestIndex` was documented as monotonic

`interestIndex`'s storage comment read "Monotonically non-decreasing. Starts at 1e18." It has not
been monotonic since the splitter landed: `_reconcileRedemption` moves it down, which
`_accrue`'s own comment correctly acknowledges two hundred lines away. A stale comment on the
storage slot itself is where a future change would read it. Corrected to name the one place it
falls and to say plainly not to write code that assumes otherwise.

---

## L-2 (Low, DOCUMENTED). `_outstandingDebt()` clamps at zero silently

```solidity
return netDebt > reserve ? netDebt - reserve : 0;
```

A zero from this is read by `_reconcileRedemption` as "every last unit of user debt was
cancelled", and it re-pegs `interestIndex` to its floor accordingly. That is the mechanism behind
H-2 and it is recorded separately because the clamp is worth seeing on its own.

Worth stating precisely: **the clamp is unreachable through anything the vault itself does.**
Borrow raises `outstanding` by `amount` (reserve down, netDebt flat) or by `amount + fee` (reserve
flat, netDebt up); repay lowers reserve and netDebt in lockstep so `outstanding` falls by exactly
`repaid` and cannot cross zero, because a user can only repay what they owe and what they owe is
bounded by `accounted`; `deleverage` moves reserve into the trove, changing neither side of the
subtraction; `openPooledTrove` leaves `outstanding` at the origination fee. Only a redemption,
which reduces `netDebt` without touching `reserveMUSD`, can drive it to the clamp. That is H-2,
and it is the entire attack surface of this line.

---

## I-1 (Info, FIXED as comment + pinned). `depositAndBorrow` revert parity

The docstring claimed "the revert a caller gets from this is the revert they would have got from
whichever of the two single calls failed first". Not true. The composite runs BOTH guard sets
before either leg. That is deliberate, so a doomed borrow does not pay for an `addColl` the
revert is about to undo, and it means a borrow-leg guard beats a deposit-leg failure that only surfaces at
or after the state sync. Exactly two orderings differ, both verified against selectors:

| situation                      | `deposit` alone                         | `depositAndBorrow`                 |
| ------------------------------ | --------------------------------------- | ---------------------------------- |
| over the cap, zero borrow      | `DepositCapExceeded` (`0xb2aafb25`)     | `ZeroAmount` (`0x1f2a2005`)        |
| frozen trove, borrowing paused | `TroveNoLongerActive(3)` (`0x35b2ba3b`) | `BorrowingIsPaused` (`0xaa864f37`) |

Nothing executes in either case, so what a caller loses is diagnosis, not state. Left as-is
because restoring parity means moving `_requireBorrowAllowed` behind the sync, which reintroduces
the wasted `addColl`, which is the worse trade. The docstring now says which two orderings differ and
why, and `test_depositAndBorrow_revertParityBreaksInExactlyTwoOrderings` pins them so the claim
cannot drift back.

The rest of the shared-internal extraction holds up. `_requireDepositAllowed` /
`_requireBorrowAllowed` / `_creditDeposit` / `_borrow` are each called from exactly one place per
leg, no check was dropped, the 180% floor is genuinely measured on the post-deposit position
because `_creditDeposit` runs first, and the sync/settle pair runs once for both legs rather than
twice, which is equivalent because the second pass would find nothing.

---

## I-2 (Info, guard added + pinned). `skim()` reentrancy: attacked, does not work

`skim()` is the only function here deriving state from `address(this).balance`, and it was the
only mutation without `nonReentrant`. The attack to rule out: an admin who is also a withdrawal
recipient re-enters from their `receive` hook and skims the BTC on its way out, crediting
`collateral[address(this)]` for it twice and leaving `idleCollateral` above the contract's real
balance, which is exactly the invariant the fuzz suite asserts.

**It does not work, and the reason is worth recording rather than asserting.** The EVM debits the
call value before the callee runs. By the time the hook executes, `_sendCollateral` has already
lowered `idleCollateral` AND the BTC has already left, so balance and ledger agree and `skim()`
reverts with `NothingToSkim`. Traced and confirmed. Every other function reachable from that hook
is either `nonReentrant` (and the outer `withdraw` holds the guard) or a role-gated setter that
touches nothing relevant.

`nonReentrant` added anyway, as hygiene: it makes "every mutation on this contract is guarded"
true without a footnote, and the argument above rests on an EVM detail rather than on anything
local. `test_skim_cannotBeReenteredFromAWithdrawal` asserts the outcome rather than the
mechanism, so it stays meaningful if the guard is ever removed for gas.

---

## I-3 (Info, DOCUMENTED). `redemptionCollateralPerShare` growth

The per-share increment is `ceil(collateralRemoved * 1e36 / totalDebtShares)`. As
`totalDebtShares` falls the increment grows without bound; with a single residual share it is
`collateralRemoved * 1e36`. `redemptionCollateralPerShare` is a cumulative `uint256`, so enough
such events overflow and brick every settlement permanently.

Not realistic, since it needs on the order of 1e20 redemptions against a pool with one wei of
debt share, and the state that produces a tiny share count is one where a redemption cannot happen,
because a redemption needs trove debt to cancel. Recorded because the interaction between
`REDEMPTION_PRECISION = 1e36` and a shrinking denominator is the sort of thing an auditor should
be told has been thought about rather than left to find. The constant's own natspec covers the
opposite end (a huge share count after an index collapse) and the invariant suite drives it.

---

## I-4 (Info, DOCUMENTED). Views and the freeze disagree

`_pendingRedemptionCollateral` returns 0 when the trove is not active; `_reconcileRedemption`
reverts. So while the vault is frozen, `collateralOf`, `debtOf`, `collateralRatioOf` and the rest
keep reporting pre-freeze numbers as though nothing had happened, with no signal in the view
layer that every mutation is now reverting. `troveStatus()` is the only tell and a UI has to know
to call it.

Defensible, since views that revert are worse than views that are stale, and this is why
`reconcileRedemption()` can be called by anyone to make them exact; but the asymmetry should be
deliberate and visible. Recommend a `frozen()` or `troveActive()` view so a client does not have
to infer it.

---

## I-5 (Info, DOCUMENTED). `skim()` does not sync

`skim()` is the only mutation that does not call `_syncState()` first, which is deliberate: it is
a recovery tool and has to keep working when the trove has left the active state (see M-3, where it is
one of the two things that still function there). The consequence is that its
`_settleRedemption(address(this))` call runs against a `redemptionCollateralPerShare` that an
unreconciled redemption has not bumped yet, so it can be a no-op.

Harmless. The debit is priced off debt shares, which `skim` does not touch, so it lands
identically on the next sync; and crediting before debiting is the more favourable order for the
shortfall cap, not the less. Noted so the omission reads as a decision.

---

## Proofs of correctness

Everything below was attacked first. These are the results that held.

### V-1. Interest-first debt reduction cannot misattribute, because nothing models it

This is the ground-truth file's headline question, and the answer is that the splitter never
separates principal from interest, so the ordering cannot reach it.

Ground truth item 2: a redemption reduces trove debt by exactly `mUSDLot`, paying accrued
interest first and principal second. The concern is that a splitter assuming a proportional or
principal-first reduction would misattribute.

`_troveCollAndNetDebt` reads Mezo's six-return `getEntireDebtAndColl` and immediately collapses
it:

```solidity
uint256 gross = principal + interest + pendPrincipal + pendInterest;
netDebt = gross > MUSD_GAS_COMPENSATION ? gross - MUSD_GAS_COMPENSATION : 0;
```

A reduction of `mUSDLot` lowers `gross` by `mUSDLot` whichever component absorbs it. `debtRemoved`
is then derived as `accountedDebt - outstandingDebt`, both of which are functions of `netDebt`
alone. The interest/principal split is not an input to any arithmetic in this contract, so
interest-first, principal-first and proportional are indistinguishable to it. The ordering does
change _future_ interest accrual on Mezo, since interest accrues on principal; that is also
invisible here, because `_accrue` re-measures the trove every time rather than modelling a rate.

Sound for the same reason the ACCOUNTING header gives for measuring rather than modelling
everywhere else, and it is the strongest single argument for that discipline in the file.

### V-2. Per-position value neutrality, and where it holds

Ground truth items 1 and 3 give, for one redemption of `mUSDLot` at `price`:
`collateralRemoved = mUSDLot * 1e18 / price`, `debtRemoved = mUSDLot`, and the fee is paid by the
redeemer out of the collateral they receive, so the trove is value neutral at the instant.

The splitter charges account `i` a collateral debit of `shares_i / shares * collateralRemoved` and
grants it relief of `shares_i / shares * debtRemoved`. The ratio of the two is therefore
`collateralRemoved / debtRemoved`, identical for every account, so if it equals `1 / price` for
the pool it equals `1 / price` for every position. Value neutrality is a pool-level property
propagated by a single pro-rata split, which is why it needs no per-user price read.

Two things that look like they should break it and do not:

- **Interest accrued since the last sync.** `debtRemoved = accounted - outstanding` nets the
  redemption against interest that accrued in the same window, so it is not `mUSDLot`. That is
  correct rather than wrong: the interest is real debt the users owe regardless, and the two
  effects are independent. The end state is `index = outstanding * 1e18 / shares`, which is
  exactly what `_accrue` would have produced on its own.
- **The banked rounding surplus.** Also folded into `debtRemoved`, also acknowledged in the code,
  and bounded by `totalDebtShares / 1e18` wei.

The one place this used to break was H-2, where `debtRemoved` is capped and `collateralRemoved` is
not. That is now handled: the uncapped remainder of `collateralRemoved` is charged to the protocol's
own position rather than socialised across users (see H-2, FIXED).

### V-3. Rounding directions all favour the pool

Enumerated, with the direction of each and who absorbs it:

| site                                                   | direction | absorbed by                                    |
| ------------------------------------------------------ | --------- | ---------------------------------------------- |
| `debtOf` / `previewDebtOf`                             | Ceil      | the debtor                                     |
| `_mintDebtShares`                                      | Ceil      | the borrower                                   |
| `_burnDebtShares`                                      | Floor     | the repayer keeps the dust as debt             |
| `_accrue` candidate index                              | Ceil      | debtors                                        |
| `_reconcileRedemption` new index                       | Ceil      | debtors keep at least what the trove owes      |
| per-share redemption debit                             | Ceil      | debits collectively exceed what left the trove |
| `_settleRedemption` owed                               | Ceil      | the account, not the pool                      |
| `_collateralRatio`                                     | Floor     | the position looks less healthy than it is     |
| `collateralRequiredForDebt`                            | Ceil      | quotes more collateral, not less               |
| `maxBorrowable`                                        | Floor     | quotes less headroom, not more                 |
| `liquidationPriceOf`                                   | Ceil      | liquidation looks nearer than it is            |
| `_computeLiquidation` maxRepay / collForDebt / penalty | Floor     | the liquidator                                 |

The per-share debit rounding up is the one that determines whether `sum(collateralOf)` can exceed
the trove's real collateral. It cannot: rounding up means the sum of debits is at or above
`collateralRemoved`, so per-account balances fall by at least as much as `totalCollateral` does,
and the residue is un-withdrawable dust left in the pool. The overshoot is bounded by
`totalDebtShares / 1e36` wei per redemption, which is why `REDEMPTION_PRECISION` is 1e36 and not
1e18: at 1e18, with the 1e40 share counts a collapsed index produces, the same rounding is
worth thousands of BTC. The constant's natspec says so and the invariant suite drives that state.

The only way `sum(collateralOf)` exceeds real collateral is the recorded `redemptionShortfall`,
which is exactly what that variable exists to make visible, and which pre-fix was also the H-1
bug.

### V-4. `sum(debtOf) >= outstandingDebt` survives the down-peg

The down-peg is `newIndex = ceil(oldIndex * outstanding / accounted)` where
`accounted = floor(shares * oldIndex / 1e18)`. Then

```
shares * newIndex / 1e18  >=  (shares * oldIndex / 1e18) * outstanding / accounted
                          >=  accounted * outstanding / accounted
                          =   outstanding
```

using `accounted <= shares * oldIndex / 1e18`, and `debtOf` rounds up on top of that. The floor at
1 fires only when `outstanding == 0`, where there is nothing to cover. The invariant holds
through the one place the index moves down.

### V-5. `collateralOf()` is canonical on every mutation path

Every read of `collateral[...]` and every mutation of `debtShares[...]` was enumerated, and each
is preceded by `_settleRedemption` on the account concerned:

- `_creditDeposit`, `_borrow` (the 180% floor), `_withdraw`, `_repay`, `closePosition` are reached
  only from `deposit` / `borrow` / `depositAndBorrow` / `repay` / `repayWithPermit` / `withdraw` /
  `closePosition`, all of which run `_syncState(); _settleRedemption(user);` first.
- `liquidateUser` settles both the defaulter and `address(this)` before `_computeLiquidation`
  reads either ledger.
- `openPooledTrove`, `refinancePooledTrove`, `depositProtocolCollateral`, `closePooledTrove`,
  `withdrawProtocolCollateral`, `skim` all settle `address(this)` before touching its balance or
  its shares.
- The `shares == 0` branch of `_reconcileRedemption` writes `collateral[address(this)]` without
  settling, which is sound precisely because there are no shares and therefore no pending debit
  for anybody.

This matters more than it looks. The debit is priced against the shares held when the redemption
landed, so a path that changed shares before settling would misprice it. There is no such path.
The raw `collateral` mapping is stale only in the window between a redemption landing and an
account's next transaction, and no mutation reads it inside that window.

### V-6. No reentrancy in the sync path

`_syncState` is `_reconcileRedemption` then `_accrue`. Between them they make exactly three
external calls, `getTroveStatus` and `getEntireDebtAndColl` (twice, via
`_troveCollAndNetDebt`), and they are all `view`, all STATICCALL, none capable of re-entering. No MUSD or BorrowerOperations call
happens anywhere in the sync. Every state-changing external call in the contract
(`addColl`, `withdrawColl`, `withdrawMUSD`, `repayMUSD`, `openTrove`, `closeTrove`, `refinance`,
`transfer`, `transferFrom`, `sendValue`) sits after the effects of its own function and inside a
`nonReentrant` entrypoint. Checks-effects-interactions is respected in `_withdraw` (ledger and
`totalCollateral` written before `_sendCollateral`) and in `liquidateUser` (all six ledger writes
before the first token movement).

### V-7. Sequential redemptions and interleavings

`redemptionCollateralPerShare` is cumulative and `redemptionSnapshot` is per-account, so any
number of redemptions between two touches of an account collapse into one `perShare - snapshot`
difference. Correct as long as the account's share count does not change between them without
settling, which V-5 establishes it cannot. Exercised by the existing
`test_redemption_sequentialRedemptionsCompose`, `test_redemption_isReconciledByEveryMutation`,
`test_redemption_thenDepositIsNotChargedForTheEarlierRedemption`,
`test_redemption_thenBorrowPricesSharesAtTheNewIndex` and
`test_redemption_withdrawCannotTakeThePreRedemptionEntitlement`, plus the composed suite's
`_withAPendingRedemption` fuzz, plus the invariant handler which interleaves redemptions with
deposits, borrows, repayments, withdrawals, price moves, time and oracle outages.

### V-8. Liquidation is never reconciled as a redemption

The discrimination is `getTroveStatus`, not the collateral ledger, which is right: a liquidation
and a redemption are identical on the collateral ledger and differ only in whether user debt was
cancelled with it. `_requireTroveActive` runs at the top of `_reconcileRedemption`, before the
shortfall comparison, so a non-active trove halts rather than mis-splitting. Verified against
`ITroveManager`'s documented enum (0 nonExistent, 1 active, 2 closedByOwner, 3
closedByLiquidation, 4 closedByRedemption), which the interface records as probed live on matsnet.
The cost of that hard stop is M-3.

### V-9. Ground-truth cross-check

No Liquity-divergence assumption in `MarenVault.sol` contradicts the ground-truth file:

- No `maxFeePercentage` is passed anywhere; `IBorrowerOperations` carries the Mezo signatures and
  records that they were probed live rather than transcribed.
- Collateral is native BTC via `msg.value` throughout; there is no ERC-20 approve step for
  collateral anywhere in the file.
- `_troveCollAndNetDebt` uses the six-return `getEntireDebtAndColl` and includes the pending
  redistribution components, not Liquity's four.
- `fetchPrice()` is treated as a reverting `view` with no `lastGoodPrice()` fallback, and every
  price read funnels through `_price()` so staleness surfaces as `PriceFeedUnavailable()`. A zero
  price is treated as unavailable rather than trusted.
- `maxBorrowingCapacity` is treated as frozen at open with `refinance()` as the only thing that
  raises it, which `refinancePooledTrove` exists for and which the mock reproduces.
- The 200 MUSD gas compensation is subtracted out of every debt figure, once, at the pool level.
- Recovery Mode blocking `closeTrove` and `refinance` is reflected in the keeper functions'
  failure modes rather than modelled.

### V-10. Access control

`KEEPER_ROLE`: `openPooledTrove`, `topUpCollateral`, `deleverage`, `refinancePooledTrove`,
`depositProtocolCollateral`, `liquidateUser`. `DEFAULT_ADMIN_ROLE`: `closePooledTrove`, `skim`,
`withdrawProtocolCollateral`, `setDepositCap`. `GUARDIAN_ROLE`: `setDepositsPaused`,
`setBorrowingPaused`. Permissionless: `reconcileRedemption`, `settleRedemption`, `syncTrove`, and
all user actions. The constructor grants only `DEFAULT_ADMIN_ROLE`.

The structural claim the file makes, that no guardian key, compromised or not, can trap user
collateral, holds: there is no modifier on `withdraw`, `repay`, `closePosition` or
`liquidateUser`, and the two pause flags are read only by `_requireDepositAllowed` and
`_requireBorrowAllowed`. The claim is about the _guardian_, and it survives. It is not a claim
about the trove leaving the active state, which traps everything (M-3).

`settleRedemption(address)` being permissionless is safe on its own terms, since settling only moves
an account from its stale balance to the entitlement every view already reports, and it was H-1's
trigger only because of the phantom, which is fixed.

### V-11. `_tryPushCollateral`'s catch

The catch is correct in the direction that matters: `idleCollateral` is incremented by the caller
_before_ the push is attempted and decremented only in the success branch, so a failed push
leaves the BTC credited and idle rather than lost. The catch is broad, swallowing any revert and
not just oracle staleness, but the mitigation is real rather than nominal: the revert selector
goes out on `CollateralPushFailed` so a keeper can distinguish a stale oracle from something
nobody predicted, and the BTC never leaves the contract either way. Same shape in
`_pushRepayment`, which additionally reports the pushed amount as zero so `deleverage` can raise
`NothingRepaid` instead of emitting a success event carrying a zero.

### V-12. `deleverage`

`_outstandingDebt` subtracts `reserveMUSD`, so moving MUSD from reserve into the trove lowers
`netDebt` and `reserve` by the same amount and leaves `outstanding`, and therefore every user's
debt, untouched, which is the property that makes the keeper's main drawdown lever safe. Room is
measured against the protocol's 1,800 MUSD floor from the live trove rather than modelled.
`NothingRepaid` closes the silent-no-op gap. Nothing here needs a price except the inner
`repayMUSD`, whose failure is caught and reported.

---

## What changed in this pass

Code:

- `_booksInTrove()` added; `_reconcileRedemption` and `_pendingRedemptionCollateral` both route
  through it, subtracting `redemptionShortfall`. **(H-1, the only behavioural fix.)**
- `nonReentrant` on `skim()`. (I-2, hygiene; the attack it blocks does not work anyway.)

Comments, all correcting claims that were false:

- `interestIndex` is no longer described as monotonic. (L-1)
- `redemptionShortfall` now states that it is a permanent gap and that every books-versus-trove
  comparison must subtract it. (M-2)
- `_reconcileRedemption` now charges the reserve-excess collateral to the protocol's own position
  and states H-2 as FIXED, with the protocol-exhaustion shortfall as its residual.
- `withdrawProtocolCollateral` now says it pays nobody. (M-1)
- `depositAndBorrow` now names the two orderings where revert parity does not hold. (I-1)
- `skim()` now records why the reentrancy does not work and why the guard is there anyway. (I-2)

Tests, 7 added, whole suite green at 309:

| test                                                                     | file       | pins               |
| ------------------------------------------------------------------------ | ---------- | ------------------ |
| `test_redemption_recognisedShortfallIsNotReReadAsAFreshRedemption`       | redemption | H-1, fails pre-fix |
| `test_redemption_afterAShortfallIsStillMeasuredExactly`                  | redemption | H-1, fails pre-fix |
| `test_redemption_reliefBeyondUserDebtIsAbsorbedByTheProtocolNotUsers`    | redemption | H-2, fails pre-fix |
| `test_withdrawProtocolCollateral_paysNobodyAndOnlySkimRecoversIt`        | vault      | M-1                |
| `test_frozenTroveStrandsIdleBtcWithNoAdminPathOut`                       | vault      | M-3                |
| `test_skim_cannotBeReenteredFromAWithdrawal`                             | vault      | I-2                |
| `test_depositAndBorrow_revertParityBreaksInExactlyTwoOrderings`          | composed   | I-1                |

The three that pin known limits assert the current behaviour including the part that is wrong,
so that the day each is fixed the test inverts rather than silently continuing to pass.
