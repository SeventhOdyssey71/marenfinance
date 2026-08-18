---
title: Maren Finance — Product Plan
subtitle: A money app for Bitcoin. Spend it in the real world, never sell it. The product, the phases, the economics, and how it is measured.
docId: MRN-200
date: 2026-08-19
version: '1.2'
classification: Confidential
audience: Mezo Ecosystem
colophon: |
  This document plans forward, and it marks the boundary honestly: sections describing
  what exists are stated as fact and are verifiable on-chain; sections describing what
  comes next are plans and say so; revenue figures are illustrative worked examples,
  labelled as such, not projections. Chain figures were read live on 19 August 2026.
---

## The goal

Build the app that lets someone use their Bitcoin in the real world without selling
it. On web and iOS.

The mechanics underneath are a collateralised loan on Mezo: deposit BTC, borrow MUSD
against it. But the product is not a lending dashboard. It is a money app. You put
Bitcoin in once, and from then on you pay a name, drop money into a link and send it
to anyone, request and get paid, cash out to your bank, and pay at a shop. Your
Bitcoin stays yours the whole time, and when you repay, you get all of it back.

## Who it is for

Three people, in order:

1. **The holder who will not sell.** They have Bitcoin, they have expenses, and today
   their only choices are selling (a taxable event and an ideological defeat) or a
   centralised lender (custody risk they specifically got into Bitcoin to avoid).
   Maren gives them spendable dollars against self-custodied collateral, from 0.001
   BTC, which no venue on Mezo offers today.
2. **The person being paid.** Money links and requests work for people who have never
   held crypto: open a link, claim the money. Every link recipient is a prospective
   depositor who arrives with a funded account and a reason to stay.
3. **The MUSD holder with nowhere to spend.** Mezo has tens of thousands of MUSD
   holders and, today, almost no consumer surface. Maren's payments layer works for
   them from day one, borrowing or not.

## Why this, why here

Mezo already runs the hard part: a live, audited borrowing engine where BTC mints a
dollar. What it does not have is a consumer door. Opening a position requires roughly
0.079 BTC (about $5,000) before the first dollar, every action costs BTC gas, and once
you hold MUSD there is almost nowhere to spend it. The result is visible on-chain:
tens of thousands of MUSD holders, fewer than thirty minting positions.

Maren removes all three barriers in one product:

| Barrier                    | Maren's answer                                                          |
| -------------------------- | ----------------------------------------------------------------------- |
| $5,000 minimum             | A pooled vault opens the same loan from 0.001 BTC, about 80x lower      |
| Every action costs BTC gas | Users sign; Maren's relayer submits and pays. About one cent per action |
| Nowhere to spend MUSD      | Names, links, requests, cashout, and shops, below                       |

Every Maren user is a new borrower Mezo could not otherwise have. Maren does not
compete with the existing troves; it addresses the population underneath the minimum,
which is currently zero by construction.

## The app

One product, two clients sharing one SDK, so a rule enforced on one is the rule on the
other. The web app runs live against matsnet today; the iOS app runs the same screens
on a mock layer with identical signatures, and goes live by replacing one file.

### Home

The first screen answers one question: what do I have, and what can I do with it?
Bitcoin deposited, its dollar value, spendable MUSD, and one action. No debt means no
liquidation, and the app says so in a sentence instead of showing an empty gauge.

### Borrow

A slider, bounded by what the contract will actually accept, with a recommended safe
level marked. The app computes every rule the contract enforces before asking for a
signature, so an offer on screen is an offer that clears. Health is shown as a plain
number with a plain meaning: how far Bitcoin can fall before anything is at risk.
Maren refuses new borrowing below a 180% collateral ratio, well above the protocol's
110% liquidation threshold, because the buffer is the product.

### Pay a name

Money moves to `@names`, registered on-chain through commit-reveal so they cannot be
front-run. Type `@amaka`, an amount, an optional note. No addresses to copy, nothing
to get wrong. Raw addresses still work for anyone without a name yet.

### Money links

Put MUSD into a link and send the link: WhatsApp, iMessage, anywhere text goes. The
recipient opens it and claims the money, with or without a Maren account. Unclaimed
links can be cancelled and refunded. This is how money crosses from Maren users to
everyone else, and it is the product's built-in growth loop: every link is an
invitation carrying money.

### Requests

The reverse direction: ask for an amount with a note, share it as a link, and the
payer settles it in two taps. Settled requests appear in both parties' history with
the transaction hash attached.

### Cash out to a bank

MUSD out to local currency in a bank account. Off-ramp partners are integrated behind
one screen, starting with the corridors our users actually live in, so cashing out
feels like part of the app rather than a trip to an exchange. Regulatory posture:
Maren integrates licensed off-ramp providers rather than taking custody of fiat
itself; partner selection and compliance review are part of the phase, not an
afterthought. Planned, not built.

### Pay at a shop

Merchant payments settle in MUSD with a QR at the counter, built on the x402 payment
rail Mezo already operates: the buyer signs once, the merchant is settled on-chain,
nobody handles gas. The plan starts with a small merchant pilot in one city rather
than a directory nobody uses. Planned, not built.

### Earn

Idle MUSD can sit productively in a vault backed by MUSD's Stability Pool. Returns
come from real liquidation gains, which are lumpy, so the app shows trailing realised
yield and refuses to advertise a rate it cannot guarantee. There are no token
emissions and no points.

## What runs today, and what comes next

Phase 1 is live on Mezo matsnet, chain 31611, at these addresses, every one
source-verified on Blockscout:

| Contract      | Address                                      |
| ------------- | -------------------------------------------- |
| MarenVault    | `0x46252B00AB59384518d9dB6D1f210ffF1221645b` |
| MarenPay      | `0xe475Ff919D54E055809f516E3bed8a5c7a101836` |
| MarenRelayHub | `0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C` |
| MarenRegistry | `0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E` |
| MarenEarn     | `0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826` |

The companion Progress & Evidence document carries the transaction-level proof.

| Phase         | Scope                                                                                                | State                                     |
| ------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1. The engine | Pooled vault from 0.001 BTC, borrow and repay, names, payments, requests, Earn, web and iOS          | Built. Live on matsnet, borrowing enabled |
| 2. Mainnet    | Third-party audit, then mainnet with a capped vault; gasless relayer hosted so users stop paying gas | Next. Audit is the gate, deliberately     |
| 3. Real world | Money links polished for non-crypto recipients, bank cashout in first corridors, x402 merchant pilot | Planned                                   |
| 4. Scale      | Cap raises as the pooled position proves out, more corridors, more shops                             | Planned                                   |

The order is a safety decision, not a marketing one: nothing that touches other
people's Bitcoin reaches mainnet before an independent audit, and the vault launches
capped either way, with the cap raised only as the position proves out.

## Revenue

No token, and no plan for one. Revenue is spread on real usage, on four lines. The
rates below are target ranges, set conservatively; final pricing is decided at mainnet
and stated in the app rather than buried.

| Line                    | Mechanism                                                                                                                                                                | Target pricing                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Pooled borrowing spread | A margin over the protocol's 1.00% fixed APR, charged to pooled borrowers for the service of existing below the protocol minimum                                         | 1.0 to 2.0 points over, fixed at open like the underlying rate |
| Payments                | Fee on MUSD payment volume above a free tier. The first 25 sponsored actions per address are always free, so a new user is never charged to find out what the product is | 10 to 30 basis points on volume past the tier                  |
| Cashout                 | Margin inside the off-ramp partner's quote, disclosed as one all-in rate on the confirmation screen                                                                      | 30 to 50 basis points                                          |
| Earn performance fee    | A share of realised liquidation gains only. No yield, no fee                                                                                                             | 10% of realised gains                                          |

Two properties of this design matter more than any single rate. First, every line
scales with usage the chain can measure, so revenue claims are auditable the same way
the product's other claims are. Second, nothing charges for holding: fees sit on
actions, so an account that parks Bitcoin and does nothing costs its owner nothing.

### An illustrative year, labelled as such

These are worked examples at stated assumptions, not projections. At 2,000 funded
accounts averaging 400 MUSD of pooled debt (0.8M MUSD outstanding), a 1.5 point
spread earns about $12,000 a year. The same accounts moving $150 a month each through
payments past the free tier, at 20 basis points, add $7,200. Cashout at 40% of that
payment volume and 40 basis points adds about $5,800. Earn contributes only what
liquidations actually yield and is deliberately not modelled here.

Against that, costs are small and mostly fixed: sponsoring one user action on Mezo
costs about one cent at current gas prices, so even a million sponsored actions cost
under $10,000 a year; relayer hosting is a single small server; the significant
one-time cost is the independent audit, which is priced separately and treated as the
gate to mainnet. The point of the example is shape, not precision: break-even sits at
a few thousand active accounts, and every driver of it is a number Mezo can read off
its own chain.

## Distribution

- **Mezo's own community first.** The people most likely to want MUSD without $5,000
  of collateral already hold MUSD or sit in Mezo's Discord. A testnet cohort drawn
  from there is the first fifty users, and their transactions are the launch evidence.
- **Money links as the loop.** Every link sent to a non-user is an onboarding with
  money inside. This is the channel the product is structurally built around.
- **The predecessor's audience.** The team's previous product validated this exact
  consumer pattern on another chain: 1,900 waitlisted, 1,400 names claimed on-chain.
  That audience is contactable and the pattern is proven; the chain moved, the users
  can too.
- **Co-marketing with the ecosystem** at mainnet: launch post, walkthrough video, and
  the on-chain numbers stated plainly, in public, dated.

## Being straight about risk

**Pooling risk.** Pooled deposits share one large, conservatively managed position.
Maren keeps it far from the protocol's liquidation threshold, liquidates internally at
140% against the protocol's 110%, pauses new borrowing long before exits, and steers
anyone holding more than the protocol minimum to their own separate position, because
that carries no pooling risk at all. A catastrophic, faster-than-keeper crash could
still socialise losses across the pool, and the app says this where the decision is
made rather than in a footnote.

**Market risk.** Bitcoin can fall; a collateralised loan can be liquidated. No design
removes that, and no screen in Maren pretends otherwise. The default borrowing level
the app recommends (250%) is set so that Bitcoin must roughly halve before a position
approaches Maren's internal threshold.

**Oracle and infrastructure risk.** Mezo's price feed reverts when stale, and public
RPCs are transiently flaky. Both apps carry explicit degraded states and never render
a stale figure as live.

**Regulatory surface.** Borrowing against self-custodied collateral and on-chain
payments are the core; fiat touches the system only through licensed off-ramp
partners, and the merchant pilot settles on-chain in MUSD. Scope grows corridor by
corridor with the partner's licence, not ahead of it.

**Execution risk.** The honest one. The mitigations are the ones evidenced in the
companion document: verification-first engineering, adversarial review that has
already caught real money bugs before users could, and a mainnet gate that is an
audit rather than a date.

## The measure of success

Positions funded and dollars moving, all readable from the chain by anyone:

| Metric                                      | Meaning                                        |
| ------------------------------------------- | ---------------------------------------------- |
| Funded positions below the protocol minimum | Borrowers who could not exist without Maren    |
| MUSD borrowed through the pooled vault      | New MUSD in circulation, attributable on-chain |
| Payments settled against names and links    | The money-app claim, measured                  |
| Link claims by brand-new addresses          | The growth loop working                        |
| Realised Earn yield distributed             | Yield paid from real events, not emissions     |

The first public target is simple: several hundred funded positions and six figures of
borrowing within the first quarter after mainnet, which would multiply the number of
borrowing accounts on Mezo, and every step of it checkable by the people it is
reported to.
