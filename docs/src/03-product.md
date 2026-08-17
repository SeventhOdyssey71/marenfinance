---
title: Product Specification
subtitle: What Maren does, screen by screen
docId: MRN-003
date: 2026-08-15
classification: Shared with the Mezo ecosystem team
---

# Summary

Maren is a Bitcoin-backed account. Four surfaces, one identity, on web and iOS.

| Surface       | What it does                                                 |
| ------------- | ------------------------------------------------------------ |
| **Vault**     | Deposit BTC, draw MUSD against it without selling            |
| **Pay**       | Send, request, split, and link MUSD, gasless, to a `@handle` |
| **Earn**      | Put idle MUSD to work                                        |
| **Portfolio** | Position health, capacity, history, alerts                   |

The design constraint that shapes every screen: **a Maren user should never need to hold
BTC to use their own money.** On a chain where BTC is the gas token, that is not a
convenience, it is the difference between a product a Bitcoin holder will use and one
they will not.

---

# 1. Onboarding

Three panels, then a wallet. No email, no KYC, no waitlist.

The first thing a new user sees is not a marketing claim but their actual situation:

> **You hold 0.043 BTC.**
> That is below the 0.079 BTC needed to open a Mezo loan directly, so Maren will pool
> your deposit with others. Here is what that means, and what it risks.

We show the constraint before we show the product. A user who understands why the pooled
vault exists understands the risk they are taking, and a user who does not should not be
in it.

**Wallet:** connect an existing EVM wallet (Mezo is a standard EVM chain, no special SDK
required), or create one in-app. On iOS the key lives in the Keychain behind biometrics,
and every signature requires Face ID.

---

# 2. Vault

## Deposit

Native BTC, minimum **0.001 BTC**. On deposit, Maren states which route the user is on
and why:

- **Direct trove** (≥ ~0.079 BTC at target ratio), their own MUSD trove, no pooling risk.
- **Pooled** (below that), a share of Maren's managed trove, with the risk stated.

The interface **prefers the direct route whenever it is available**, even though pooled
volume is better for Maren. A user with enough collateral is told, in plain words, that
they do not need to accept pooling risk.

## Borrow

A slider, not a number field. Dragging it updates three things live:

1. Collateral ratio (rounds **down**: never flatters)
2. Liquidation price in dollars
3. How far BTC can fall before liquidation

The slider **stops at 180%** and will not cross it. Below our recommended 250% the
figures shift from neutral to amber; the copy changes from descriptive to a question:
_BTC would only need to fall 34% to liquidate this position. Continue?_

Costs are shown before confirmation, itemised: 0.1% origination fee, 200 MUSD liquidation
reserve (refunded on close), 1.00% APR simple interest fixed for the life of the loan.

## Repay, add, withdraw

Standard, with one rule: **withdrawal remains available even when borrowing is paused.**
If Maren halts the vault, entries close and exits stay open. A user is never trapped.

## When the price feed is stale

Mezo's oracle reverts if the price is more than 60 seconds old, which makes every
borrow path fail for reasons unrelated to the user. Rather than showing an opaque error,
the Vault enters an explicit state:

> **Price feed unavailable.** Mezo's oracle has not updated in over 60 seconds. You can
> still repay and withdraw. New borrowing is paused until it recovers.

We never display a stale price as if it were live, and never let a user borrow against one.

---

# 3. Pay

The habit-forming surface. Everything here is gasless.

**Send**: to a `@handle` or an address. The resolved address is always displayed
alongside the handle before confirmation; a user always sees where money is actually
going. Optional memo, stored on-chain as an event.

**Request**: generate a request another user fulfils in one action.

**Link**: a claimable payment link, hash-locked with a secret and an expiry. The
recipient needs no prior relationship with Maren and **no BTC**. This is the sharpest
demonstration of the gasless architecture: a person with an empty wallet can receive and
then spend money.

**Split**: one signature, many recipients.

**Scan to pay** (iOS), QR, for in-person and merchant use.

## What "gasless" actually means, in the interface

We do not let the word do undefined work. On the confirmation screen:

> **No gas.** Maren pays the Bitcoin network fee for this transaction.
> 23 of your 25 free actions remaining this month.

After the free tier, the fee is taken in MUSD inside the same transaction and shown
before signing. The user is never surprised, and never blocked at the door.

---

# 4. Earn

Deposit idle MUSD into an ERC-4626 vault over MUSD's Stability Pool.

**This screen is deliberately unexciting.** MUSD's Stability Pool has no token emissions, returns come from liquidation gains, which are lumpy and unpredictable. So:

- We show **trailing realised yield**, explicitly labelled as backward-looking.
- We show **no forward APY**, because we would be making it up.
- The copy says so: _Returns come from liquidations, which are irregular. Past returns
  do not predict future ones._

A less honest version of this screen would raise more deposits. It would also attract
capital that leaves for the next number, and this product is not for those users.

---

# 5. Portfolio

The home screen. Position health is the hero element, not the balance.

- Collateral ratio, liquidation price, and BTC drop tolerance, in that order
- Health state as colour: healthy / caution / warning / danger, with the thresholds shown
- Borrowing capacity, the **real** limit from
  `TroveManager.getTroveMaxBorrowingCapacity()`, not an ICR-derived estimate

That last point is a Mezo-specific trap worth stating. MUSD fixes a per-trove borrowing
ceiling at the price when the trove opened, and **adding collateral does not raise it**, only `refinance()` does. A user whose BTC has doubled will see improved health and still
be unable to borrow more. Maren shows the real ceiling and offers refinance when it would
help, instead of letting the transaction fail with an opaque revert.

**Alerts:** push and email when a position crosses into warning, and again at danger.
Liquidation should never be the first time a user hears from us.

---

# 6. Cross-cutting rules

**Numbers.** Always with units. Tabular figures so digits do not jitter. Health figures
round conservatively. Exact values on hover or long-press for anything abbreviated.

**Transaction states.** A hash is not success. A payment is delivered only on a receipt
with `status === 'success'`: checked in one shared place, applied everywhere.

**Reduced motion** honoured throughout. Full keyboard navigation on web, VoiceOver and
dynamic type on iOS, 44pt minimum touch targets.

**Pre-audit disclosure** is in the interface, not buried in a terms page.

---

# 7. What we are not building

Stated so scope stays honest:

- **No fiat on/off ramp at launch.** No provider reaches Mezo today; we found none. Users
  arrive via Mezo's own bridge, and we say so rather than implying otherwise.
- **No token.** Not at launch, not later.
- **No cross-chain.** Mezo only. Activity and fees accrue to Mezo, which is the deal.
- **No leverage loops or one-tap recursive borrowing.** The mechanism is easy to build and
  hard to use responsibly, and it is not what this product is for.
- **No Bitcoin-native wallet login at launch.** Mezo Passport supports it, but it excludes
  Taproot addresses and pins an older RainbowKit. Worth revisiting; not on the critical path.
