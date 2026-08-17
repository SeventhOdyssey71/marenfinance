---
title: Roadmap & Grant Milestones
subtitle: A milestone schedule for the Mezo ecosystem grant
docId: MRN-006
date: 2026-08-15
classification: Shared with the Mezo ecosystem team
---

# Summary

This document proposes a milestone schedule for the **$15,000 MUSD** ecosystem grant, with
**40% released on mainnet deployment** and the remainder tied to verifiable, on-chain
outcomes rather than to effort or elapsed time.

Two principles shape it.

**Every milestone is independently verifiable.** Each one can be confirmed by the Mezo
team from a block explorer, a public repository, or an app store listing. None require
taking our word for anything.

**The work is already underway and is not contingent on the grant.** Contracts, both
applications, and this document set are being built now, self-funded. The grant
accelerates the schedule and pays for the audit; it is not what makes the project happen.
We think that is the right basis on which to ask.

---

# Milestone schedule

| #      | Milestone                                                               | Release  | Amount      | Target               |
| ------ | ----------------------------------------------------------------------- | -------- | ----------- | -------------------- |
| **M1** | Mainnet deployment                                                      | **40%**  | **$6,000**  | Week 8, 10 Oct 2026  |
| **M2** | Third-party audit complete, findings resolved                           | 25%      | $3,750      | Week 14, 21 Nov 2026 |
| **M3** | Traction: 250 funded positions and $250,000 MUSD borrowed through Maren | 20%      | $3,000      | Week 22, 16 Jan 2027 |
| **M4** | iOS app live on the App Store, sustained for 30 days                    | 15%      | $2,250      | Week 28, 27 Feb 2027 |
|        | **Total**                                                               | **100%** | **$15,000** |                      |

---

# M1: Mainnet deployment · 40% · $6,000

**Target: 10 October 2026 (week 8).**

## Acceptance criteria

1. `MarenVault`, `MarenPay`, `MarenForwarder`, `MarenRegistry`, and `MarenEarn` deployed
   and **source-verified on `explorer.mezo.org`** for chain 31612.
2. The pooled vault holds a live MUSD trove with real BTC collateral, visible on-chain.
3. `app.maren.finance` live, connected to mainnet, with a complete deposit → borrow →
   pay → repay → withdraw cycle demonstrable end to end.
4. The gasless relayer live, with a public `/health` endpoint reporting its address,
   balance, and sponsorship budget.
5. Contract addresses published in the public repository and in these documents.

## What precedes it

- **Weeks 1–3 (now – 5 Sep):** contracts complete with full test coverage, including
  fork tests against matsnet exercising the real MUSD protocol; web and iOS applications
  feature-complete against testnet.
- **Weeks 4–5 (5 – 19 Sep):** full matsnet deployment. Public testnet open to the Mezo
  Discord, this is where we would most value the ecosystem team's help, because the
  failure modes we care about only appear with real users.
- **Weeks 6–7 (19 Sep – 3 Oct):** fix what testnet finds. Freeze contracts.
- **Week 8:** mainnet deployment, **with the vault capped** (see _Risk-managed launch_).

---

# M2: Audit complete · 25% · $3,750

**Target: 21 November 2026 (week 14).**

## Acceptance criteria

1. A third-party audit report covering `MarenVault` and `MarenForwarder`, published in
   the public repository.
2. All Critical and High findings resolved, with the resolutions diffable in git.
3. The report submitted to the Supernormal Foundation, satisfying the Mezo Market
   listing requirement.

## Scope, and an honest note on cost

The audit scope is deliberately narrow: **`MarenVault` and `MarenForwarder`**. Those two
contracts hold every meaningful risk in the system. `MarenPay`, `MarenRegistry`, and
`MarenEarn` are non-custodial and mechanically simple, and we would rather buy depth on
the dangerous parts than breadth across the safe ones.

We should be straightforward about the economics: **a competent audit of a pooled CDP
contract typically costs more than this entire grant.** We are not proposing that the
grant pay for it in full, and we would rather say so now than discover it at M2.

Three routes, in order of preference:

1. **An introduction from the Mezo team to the firm that audited MUSD (Cantina, April
   2025).** An auditor already holding context on the MUSD protocol can review a contract
   that sits directly on top of it far more cheaply and far more effectively than one
   starting cold. **This introduction is worth more to us than the grant money**, and it
   is the single most valuable non-financial thing Mezo could offer.
2. A scoped engagement with a smaller firm, part-funded by the grant and part by us.
3. A competitive audit (Cantina, Sherlock, Code4rena), which trades a longer calendar for
   a lower price.

If none of these lands in time, M2 slips and we say so publicly rather than launching the
pooled vault uncapped without a review. That is a commitment, not a caveat.

---

# M3: Traction · 20% · $3,000

**Target: 16 January 2027 (week 22).**

## Acceptance criteria, all verifiable on-chain

1. **250 funded positions** in `MarenVault`: distinct addresses with non-zero collateral.
2. **$250,000 MUSD** cumulative borrowed through Maren.
3. **1,000 MUSD payments** settled through `MarenPay`.

## Why these numbers

Mezo mainnet currently has **27 troves** against **roughly 29,360 MUSD holders** (16 August 2026). The gap between
those two figures is the entire thesis: tens of thousands of people hold MUSD and
almost none of them can mint it, because the protocol's 1,800 MUSD minimum net debt
requires roughly **0.079 BTC (~$5,000)** of collateral at a responsible ratio.

250 funded positions would be a **tenfold increase in the number of borrowing accounts on
Mezo**. We have set the target where it is meaningful to Mezo rather than flattering to
us, and we would rather commit to a number we might miss than to one we would certainly
hit.

The $250,000 borrowed figure is deliberately modest relative to the position count,
because the users this product is built for are, by definition, small. The point is not
volume. The point is that the borrower base stops being a few dozen people.

---

# M4: iOS live · 15% · $2,250

**Target: 27 February 2027 (week 28).**

## Acceptance criteria

1. Maren live on the **iOS App Store**, publicly downloadable.
2. Sustained for **30 consecutive days** without removal or a critical incident.
3. Full functionality: deposit, borrow, gasless pay, scan-to-pay, earn, portfolio.

Mobile is where a payments product either becomes a habit or does not. App Review is also
a genuine external gate, a crypto app that passes it has cleared a bar that is not
self-assessed. We have budgeted a month for review cycles because we have been through
this before and it is never one submission.

---

# Risk-managed launch

The pooled vault is the one component in Maren carrying systemic risk, and we intend to
launch it the way something with systemic risk should be launched.

| Phase              | Vault cap   | Gate to advance                      |
| ------------------ | ----------- | ------------------------------------ |
| Mainnet day 1 (M1) | **5 BTC**   | 14 days with no keeper failure       |
| Post-audit (M2)    | **25 BTC**  | All Critical/High findings resolved  |
| Post-traction (M3) | **100 BTC** | 60 days of clean liquidation history |
| Steady state       | Governed    | Multisig + timelock decision         |

Direct troves, for users above the ~0.079 BTC threshold, are **uncapped from day one**,
because they carry no pooling risk at all. The cap constrains only the novel mechanism.

The interface routes any user with enough BTC for a direct trove _to a direct trove_, and
tells them why. We would rather lose pooled volume than put someone into a shared position
they did not need.

---

# What we are asking Mezo for, beyond the money

Ranked by how much it would actually help.

1. **An introduction to the MUSD auditors.** As above, worth more than the cash.
2. **Testnet users from the Discord**, in weeks 4–5. Fifty real people on matsnet will
   find things a hundred tests will not.
3. **A technical contact for MUSD protocol questions.** We have found three places where
   the published documentation and the deployed bytecode disagree, and we would rather
   raise those directly than guess. They are documented in the Technical Feasibility
   paper and offered back as contributions.
4. **Co-marketing at M1 and M4**: the launches, not the milestones in between.
5. **Mezo Market listing** once M2 is complete and the listing requirements are met.

---

# What Mezo gets

Stated plainly, so it can be held against the outcome.

- **A new class of MUSD borrower.** Maren's floor is 0.001 BTC against the protocol's
  effective ~0.079 BTC. That is roughly an eightyfold reduction in the entry requirement,
  aimed squarely at the holders who cannot currently participate.
- **Fees and activity that accrue to Mezo.** Maren deploys its own contracts on Mezo,
  settles in MUSD, and pays BTC gas on Mezo. There is no other chain in the loop.
- **Upstream contributions already prepared.** Corrections to viem's Mezo chain
  definition (its default RPC does not resolve and its mainnet entry omits Multicall3,
  silently breaking batched reads), to the subgraph documentation's network slug (a
  manifest copied from the docs fails to deploy), and to several dead RPC hosts in the
  developer documentation. These are prepared and will be offered regardless of the
  grant's outcome.
- **A consumer surface for MUSD.** MUSD has more than 29,000 holders and, today, nowhere
  consumer-grade to spend it.

---

# If milestones slip

They sometimes do. Our commitment is on process rather than on certainty:

- We report a slip **when we know**, not at the milestone date.
- A missed milestone releases no funds. We are not asking for good faith on a number.
- If the pooled vault cannot be made safe to our own satisfaction, **we ship direct
  troves, gasless payments, and earn without it**, return the unearned portion, and say
  publicly why. Those three surfaces are valuable on their own, and the vault is the
  only part that could fail in a way that costs users money.
