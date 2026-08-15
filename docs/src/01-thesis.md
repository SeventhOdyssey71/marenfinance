---
title: Maren Finance — Investment & Grant Thesis
subtitle: Mezo's Bitcoin credit primitive works. The constraint is distribution. Maren is the consumer layer that removes it.
docId: MRN-001
date: 2026-08-15
version: '1.0'
classification: Confidential
audience: Mezo Ecosystem
colophon: |
  Every protocol parameter, address, and chain fact in this document was read live from Mezo RPCs on 2026-08-15 and is recorded in machine-readable form in `packages/sdk/src/constants.ts` and `packages/sdk/src/addresses.ts`. Where Mezo's published documentation contradicts the deployed bytecode, this document follows the bytecode and says so.

  Figures describing Talise are stated as measured. Figures describing Maren's future are stated as projections and labelled as such. Nothing in this document is an audited claim; Maren is pre-audit and says so in section 9.
---

## Executive summary

Mezo's core primitive works. A Bitcoin holder can post BTC, borrow MUSD, and never
sell. That is the hard part, and it is already shipped, live on mainnet, and correct.

The constraint on Mezo is not the primitive. It is distribution. Three numbers frame it:

| Measure                     | Value                    | Read from                                    |
| --------------------------- | ------------------------ | -------------------------------------------- |
| MUSD holders                | 29,360                   | MUSD token contract, mainnet                 |
| Troves open on Mezo mainnet | 26                       | `TroveManager.getTroveOwnersCount()`         |
| Collateral to open one      | 0.079346 BTC ($5,004.50) | `minNetDebt()` at 250% CR, live oracle price |

Tens of thousands of people hold MUSD. Twenty-six can mint it. That gap is not a
marketing problem — it is three mechanical frictions, and every one is fixable in
application code without Mezo changing anything.

**Maren Finance is the consumer layer that removes them.** Pooled Bitcoin credit from
**0.001 BTC**, roughly eighty times below the protocol minimum. Gasless end to end, so a
user never has to hold the asset they refused to sell just to spend against it. And
payments to an `@handle` instead of a hex address.

The economics are unusually favourable here. Mezo's base fee is 1,300,000 wei, putting a
100,000-gas transaction at about **$0.008** — under a cent at any BTC price below roughly
$77,000. On most chains gasless is a subsidy with an end date. On Mezo it is a structural
property that can be held indefinitely.

Maren is not a first attempt. It is the second, by a builder who shipped a payments
system on another chain, commissioned an audit of it, and published the result — seven
Critical and thirteen High severity findings, in public, with the remediations.

**The ask is the ecosystem grant of up to $15,000 MUSD, 40% released on mainnet
deployment and the balance against the milestones in section 8.** Spent entirely on
sponsored gas it would cover approximately 1.8 million user transactions; it is sized by
what an audit costs, not by what gasless costs.

Section 9 prices the risks: pooled-trove systemic risk, a relayer hot key, an upgradeable
MUSD proxy, oracle staleness, and pre-audit status.

<!-- pagebreak -->

## The opportunity

Mezo has done the difficult, unglamorous work. MUSD is a Threshold-USD / Liquity-v1 fork
with real risk parameters, a live liquidation engine, an oracle fed by the validator set,
and a Stability Pool that pays out in BTC. The collateral is native BTC passed as
`msg.value` — no wrapper, no bridge, no synthetic. A Bitcoin holder can draw dollars
against Bitcoin and keep the Bitcoin. That is the whole promise of the chain and it
functions today.

The parameters are conservative and, importantly for a consumer product, _stable_:

| Parameter                 | Value     | Notes                                                   |
| ------------------------- | --------- | ------------------------------------------------------- |
| Minimum collateral ratio  | 110%      | Hardcoded `constant`, not governable                    |
| Critical (recovery) ratio | 150%      | Hardcoded `constant`, not governable                    |
| Borrowing fee             | 0.10%     | Governable, 7-day timelock                              |
| Interest rate             | 1.00% APR | Simple, non-compounding, fixed for the life of the loan |
| Redemption fee            | 0.75%     | Taken in BTC, paid to the PCV                           |
| Governance delay          | 7 days    | On every governable parameter                           |

A fixed 1.00% simple APR that a trove keeps forever is a genuinely good consumer credit
product. It is cheaper than every card, most mortgages, and every other on-chain
Bitcoin-backed loan we are aware of. It does not float, it does not compound, and a
global rate change does not touch a loan already open.

So the product is good. The distribution is the problem, and the distribution problem
is not vague. It is three mechanical frictions, each with a number attached.

## The three frictions

### The minimum is too big

`BorrowerOperations.minNetDebt()` returns 1,800 MUSD. Opening a trove also escrows a
200 MUSD gas compensation, refunded on close, so the minimum total debt at open is
**2,000 MUSD**.

At the 250% collateral ratio Maren's own policy treats as responsible, and at the live
oracle price of $63,071.83, that is **0.079346 BTC — $5,004.50** — before a user can open
a position at all. At a riskier 200% it is still about 0.063 BTC, roughly $4,000.

That figure is not an estimate written into a document. It is the output of
`collateralRequiredFor()` in `packages/sdk/src/position.ts`, executed against the live
oracle price, with a test asserting the result falls between 0.078 and 0.080 BTC. Anyone
who clones the repository can check it.

> [!NOTE]
> This is not a criticism of the parameter. A 1,800 MUSD floor is the correct choice for
> a protocol that has to make liquidations economic: below it, the gas compensation and
> the liquidator's 0.5% share stop covering the cost of liquidating. The floor is right
> for the protocol and wrong for the consumer. That is exactly the kind of gap an
> application layer exists to close.

The consequence is visible on-chain. Mezo mainnet carries **26 troves**. Not 26 thousand.
Twenty-six. Meanwhile MUSD has **29,360 holders** and roughly 31.08 million supply. The
people are already here. They arrived through bridges, the Mezo Market, and points
programmes. What they cannot do is mint, because minting has a $5,000 door.

This is the single largest cap on Mezo's borrower count, and it is the number Maren
exists to move.

### Every action costs BTC gas

Mezo's gas token is BTC. That is coherent and it is part of the chain's identity. It also
produces a specific absurdity at the consumer layer: a user borrows MUSD precisely so
they do not have to sell Bitcoin, and then must hold a Bitcoin balance in order to move
the MUSD.

For a $5,000 borrower this is a rounding error. For the user Maren is built for — someone
with 0.01 BTC who wants $200 of spending power — being told to first acquire and hold a
separate BTC balance for gas is a hard stop. It is also a conceptual stop: the product's
promise is "you do not have to touch your Bitcoin", and the first screen asks them to.

The fix costs almost nothing on this chain, which is the point of section 4.

### There is nowhere consumer-grade to spend it

MUSD exists. A payments surface for it does not. Sending MUSD today means a hex address,
a manually-managed BTC balance for gas, and no memo, no request, no split, no link, no
receipt. That is a settlement primitive, not a payments product.

Nobody adopts a dollar because it exists. They adopt it because their rent, their
contractor, and their friend can all receive it in one action.

## The wedge

Maren addresses all three frictions in application code. None of it requires Mezo to
change a parameter, upgrade a contract, or grant a permission.

| Friction               | Today on Mezo            | With Maren                             |
| ---------------------- | ------------------------ | -------------------------------------- |
| Minimum to borrow      | 0.079346 BTC ($5,004.50) | **0.001 BTC** ($63.07)                 |
| BTC needed to transact | Yes, for every action    | **None**                               |
| Send MUSD to           | A hex address            | **`@handle`**, link, request, or split |

### Pooled Bitcoin credit, from 0.001 BTC

`MarenVault` runs one large, conservatively managed trove and gives each depositor a
proportional claim inside it, with per-user collateral and debt accounting and a per-user
ICR computed off the same oracle the protocol uses.

The floor is **0.001 BTC** — a 79.3× reduction against what the protocol alone permits.
Maren enforces an internal liquidation ratio of **140%** against the protocol's 110%, so
the pooled trove is never operated near the protocol cliff, and a keeper tops up
collateral, repays debt, and internally liquidates unhealthy users before the protocol
would ever see the position. Users above the protocol minimum are steered to a **direct**
trove instead, which carries no pooling risk at all, and the interface says so plainly.

This is the differentiator, and it is also where Maren's risk lives. Section 9 does not
soften it.

### Gasless, at a cost that does not bite

Mezo's base fee is **1,300,000 wei**. A 100,000-gas transaction therefore costs
1.3 × 10⁻⁷ BTC — **about $0.008** at BTC $63,000, and under one cent at any BTC price
below roughly $77,000.

| Sponsored actions | Approximate cost |
| ----------------- | ---------------- |
| 1,000             | $8               |
| 100,000           | $820             |
| 1,000,000         | $8,200           |

> [!VERIFIED]
> Derived from the live base fee of 1,300,000 wei and BTC at $63,072 as reported by
> Mezo's own oracle precompile on 2026-08-15. At a planning price of $70,000 the
> per-transaction figure is $0.0091 and a million actions cost $9,100. The conclusion is
> insensitive to the price: gasless on Mezo is cheap at any Bitcoin price a Bitcoin
> holder would be happy about.

Mechanically, Maren combines an ERC-2771 trusted forwarder with MUSD's EIP-2612 `permit`,
so a first-time user can approve _and_ transact in a single signed action while holding
zero BTC. For direct troves we use Mezo's own `BorrowerOperationsSignatures` rather than
wrapping it — fewer moving parts and no additional trust assumption.

This matters strategically, not just operationally. On most chains, sponsored transactions
are a growth subsidy with an end date; the unit economics force the training wheels off.
On Mezo the subsidy is a rounding error against any plausible revenue line, so it never
has to stop. Gasless can be a permanent property of the product rather than a campaign.

### Payments against `@handles`

`MarenRegistry` maps `@sele` to an address, with commit-reveal registration to stop
front-running and reverse resolution for display. `MarenPay` operates on MUSD and covers
direct payment with an on-chain memo, payment requests, claimable links, and one-signature
splits to many recipients. Nothing is custodial — MUSD moves wallet to wallet under the
user's own permit.

A claimable link is the specific unlock. The recipient needs no prior relationship with
Maren, no MUSD, and no BTC. That is the mechanism by which an existing Mezo user brings
someone who has never heard of Mezo onto the chain.

## Why this is good for Mezo specifically

This is not a general-purpose wallet that happens to support Mezo. Every part of the
argument is chain-specific.

**Every Maren user is a new MUSD borrower.** Maren does not compete for the existing 26
troves. It addresses the population underneath the 1,800 MUSD floor, which is currently
zero and which is where the 29,360 MUSD holders mostly live. The pooled vault mints new
MUSD against new BTC collateral; the direct-trove path sends larger users to Mezo's own
contracts unchanged.

**Every Maren action is a Mezo transaction.** Payments, handle registrations, vault
adjustments, and Earn deposits all settle on Mezo and pay Mezo's fees — and because Maren
sponsors the gas, those fees get paid whether or not the user holds BTC.

**Maren's own contracts deploy on Mezo.** `MarenVault`, `MarenPay`, `MarenRelayHub`,
`MarenRegistry`, and `MarenEarn` are Maren-authored Solidity written, tested, and bound
for 31612. The activity, the fees, and the TVL accrue to the chain, not to a chain Maren
likes better.

**Maren builds with the grain of what Mezo already shipped.** Mezo operates its own
gasless payment rail — the x402 settlement proxy at
`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, live on both networks, where MUSD's
permit support lets a buyer authorise with a single EIP-712 signature and no approval
transaction. Maren interoperates with that rail rather than building a competing one.
Where Mezo ships a signed-operation contract, Maren calls it instead of wrapping it.

### What Mezo gets beyond the application

Building Maren has required reading Mezo's deployed bytecode rather than its
documentation, and that produced findings worth handing back regardless of the grant:

| Finding                                                                                                                        | Status                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| viem's bundled `mezo` chain definition uses an RPC host that fails DNS, and omits `multicall3` although Multicall3 is deployed | Corrected definition shipped in `packages/sdk/src/chains.ts`; upstreamable |
| Three hosts published in Mezo's own docs return NXDOMAIN: `rpc.mezo.org`, `testnet-rpc.mezo.org`, `testnet-explorer.mezo.org`  | Confirmed; a correcting pull request is prepared                           |
| Three places where Mezo's published docs contradict the deployed contracts                                                     | Enumerated in `packages/sdk/src/constants.ts`, offered to Mezo as findings |
| ERC-4337 is deployed on Mezo but structurally unusable, and the reason is specific                                             | Written up in the feasibility document                                     |

These are offered as contributions, not complaints. A chain with a thin tooling layer
benefits from builders who write down what they had to discover.

## Traction and credibility

### What is already built, and how you can check

The contracts are not a proposal. Everything in this table is in the repository today and
reproducible from a clean checkout, which is the only kind of traction a pre-launch
project can honestly offer.

| Component                 | State                                                                          | How to check it             |
| ------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| Core contracts            | Five, all under the 24,576-byte limit — `MarenVault` is 14,508 bytes           | `forge build --sizes`       |
| Contract test suite       | **236 tests passing**, 8 of them fork tests against real matsnet MUSD          | `forge test`                |
| Gasless relaying          | `MarenRelayHub`, atomic signed-fee ERC-2771                                    | `MarenRelayHub.sol`         |
| Relayer service           | **214 tests passing**, 6 against a live Mezo testnet anvil fork                | `apps/relayer`              |
| Landing page              | 17/17 behavioural checks, 8/8 contrast probes, 112 kB first load, fully static | `apps/web/scripts/verify-*` |
| The 0.079346 BTC boundary | Asserted by an executable test, not merely computed in prose                   | `MarenVault.t.sol`          |

The last row matters more than its size suggests. The number this entire document rests
on — that a user needs $5,004.50 of Bitcoin before Mezo's CDP will speak to them — is now
pinned by a test that fails if the protocol's own constants move. It decomposes as 1,800
MUSD net debt plus a 1.8 MUSD origination fee plus 200 MUSD gas compensation, taken to a
250% ratio at an oracle price of $63,071.83. If that figure is wrong, the build goes red.

### The team

Maren is new. The person building it is not.

**Talise** is a payments application on Sui, built by the same author for Sui Overflow and
carried past the hackathon into production. What it has, stated as measured:

| Measure                  | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| Waitlist signups         | 1,900+                                                         |
| Handles claimed on-chain | 1,400+                                                         |
| Live mainnet deployments | Payments, cheques, streams, payroll, yield router, payment kit |
| Published security audit | 2026-07-24                                                     |

There is no TVL figure here, no revenue figure, and no monthly-active number, because
those are not figures we can substantiate. A grant committee should assume any number
absent from this table does not exist.

### The part that should actually persuade you

Talise commissioned a security audit of its own codebase and **published it**. It found
**7 Critical and 13 High severity issues**. The accompanying `SECURITY.md` labels parts
of the system custodial, discloses that the shielded pool is not a trustless setup and
has a small anonymity set, and documents that an unauthenticated command-injection route
reached production for approximately six minutes on 2026-07-24, after which all in-scope
secrets were rotated. It states, in the author's own words, that "a security document
that only lists successes is not a security document."

Most teams applying for a grant present their first system. This application presents a
second system, designed by someone holding a specific written list of what went wrong in
the first one. Maren's architecture encodes those lessons directly:

- the relayer's funding source is bound to the caller, never inferred;
- nothing is keyed by a shared address, so no two users can ever collide in escrow;
- funding is verified on-chain rather than trusted from a client-asserted digest;
- access gates fail closed;
- the proxy admin is behind a timelock and a multisig from deployment day one;
- local authentication uses loopback with CSRF protection rather than custom URL schemes.

The same discipline is applied to Maren's own documentation. Talise's written docs
describe an Enoki, dApp Kit, and Walrus Sites integration that never actually shipped —
the generated codebase docs are the accurate map, and the prose was aspirational. That is
precisely the failure mode found on Mezo's side too: documentation promising a borrower
redemption-fee waiver that does not exist in the bytecode, and RPC hosts that do not
resolve. Maren's documents are therefore written from verified deployed behaviour, and
where something is intent rather than fact, it is labelled as intent.

## Business model

Maren has no token. Talise has no token and no tokenomics, and Maren will not launch one.
In a Bitcoin-native ecosystem, "we are not printing a token" is a feature, and it removes
the single largest source of misaligned incentives from the design.

Revenue comes from spread on real usage. The natural lines on Mezo:

| Line                 | Basis                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Pooled vault spread  | A small margin over the protocol's 1.00% APR, charged to pooled borrowers for the service of being under the minimum |
| Payments fee         | A fee on MUSD payment volume above a free tier; the first 25 sponsored actions per address are always free           |
| Earn performance fee | A performance fee on realised `MarenEarn` yield, never on principal                                                  |

For scale, Talise's model ranks four revenue lines — FX/auto-swap spread at 30 bps,
off-ramp margin at 50 bps, yield rebate at roughly 100 bps of the lending spread, and
on-ramp take at 50 bps — which produce an illustrative $14.10 per active user per year,
or $1.41M at 100,000 users.

> [!WARNING]
> Those unit economics are **illustrative, not achieved**. The constants exist in Talise's
> code; they are not wired into a live revenue flow, and no revenue has been collected
> against them. They are included to show the shape of the model, not to imply a run rate.
> Maren's equivalent lines are not live either. What is verifiable today is that at
> $0.008 per sponsored transaction, gas is a rounding error against any of them.

## The ask

**An ecosystem grant of up to $15,000 MUSD, with 40% ($6,000) released on mainnet
deployment and the remaining $9,000 released against the milestones below**, plus the
co-marketing support the ecosystem team offers.

| Milestone                      | Release | Definition of done                                                                                                                            |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Mainnet deployment        | $6,000  | All five Maren contracts verified on 31612; pooled vault live with a cap; addresses published                                                 |
| M1 — Audited                   | $3,000  | Third-party audit of `MarenVault` and `MarenRelayHub` complete and published, findings and remediations in the open                           |
| M2 — Borrowers under the floor | $3,000  | 100 distinct addresses holding a pooled position below the 1,800 MUSD protocol minimum — that is, 100 borrowers Mezo could not otherwise have |
| M3 — Payments live             | $3,000  | 1,000 settled `MarenPay` transactions and 500 registered handles, all gasless                                                                 |

The milestones are deliberately written as counts of things Mezo does not have today
rather than as TVL. TVL can be bought. A hundred borrowers below a floor that currently
admits nobody cannot.

How the money is used, in order: audit engagement first, relayer gas float second,
infrastructure third. Development is not funded by this grant; it is already underway.

> [!NOTE]
> On the gas float specifically: $15,000 spent entirely on sponsored transactions would
> cover approximately 1.8 million user actions at Mezo's current base fee. The grant is
> not sized by what gasless costs — it is sized by what an audit costs.

## Risks, stated plainly

A committee that has to discover a risk after funding has been given a worse document
than one that names it first.

**Pooled-trove systemic risk.** This is the largest one and it is inherent to the design.
Users in `MarenVault` share a single trove. A user's collateral is segregated _in
accounting_, not in custody. A BTC drawdown faster than the keeper can respond could
socialise losses across pooled depositors. Mitigations — the 140%-versus-110% buffer,
per-block keeper checks, the 0.001 BTC deposit floor, halting new borrowing before
halting withdrawals, and an insurance buffer funded from vault fees — reduce the
probability. They are not a guarantee, and the product interface says exactly that.
Users large enough to open a direct trove are steered to one, which has none of this risk.

**Relayer key risk.** The relayer holds a hot key funded with BTC. It is allowlisted to
Maren contracts and known selectors only, rate-limited per address and per IP, and it
never holds user funds. A compromise costs Maren its gas float. It cannot move a user's
MUSD or collateral, because every user action is authorised by the user's own EIP-712
signature and MUSD moves under the user's own permit.

**MUSD is upgradeable.** Every core MUSD contract is a `TransparentUpgradeableProxy`
controlled by Mezo's multisig. Maren integrates against the proxies, as one must, which
means Maren inherits whatever the proxy admin does. Governable parameters carry a 7-day
timelock; the implementation behind the proxy is a trust assumption in Mezo, and it
belongs on this list even though it is not Maren's to fix.

**Oracle risk.** The BTC/USD feed MUSD consumes is Skip Connect, Mezo's own
consensus-level oracle module, exposed as a chain precompile at
`0x7b7c000000000000000000000000000000000015`. It is not Chainlink and it is not Pyth: it
is secured by Mezo's validator set rather than by an independent third party. It reverts
if the price is more than 60 seconds stale, which means every borrow, adjust, and
liquidate path can revert for reasons that have nothing to do with the user, and a
liquidation cannot execute while the feed is down. Both Maren clients have an explicit
"price feed unavailable" state; we never render a stale price as if it were live.

**Pre-audit.** Maren is pre-audit today. `MarenVault` and `MarenRelayHub` are the two
contracts that carry risk and are the audit scope. Mainnet deployment ships with the
vault capped, and the cap is raised only as the position proves out. The first use of
grant money is the audit engagement.

**Execution risk.** Maren is a small team building a consumer application on a chain with
a thin tooling layer, no public subgraph, and a short list of working RPC endpoints. The
feasibility document quantifies exactly what that costs and what the fallbacks are, which
is the honest way to state it.

## What we are asking you to fund

Not a new primitive. Mezo already built the primitive and it works.

We are asking you to fund the layer that takes a $5,004.50 minimum down to $63.07, removes the
requirement to hold Bitcoin in order to spend against Bitcoin, and gives MUSD somewhere
to go — on a chain where the gas to do all of that costs less than a cent a transaction.

Mezo's borrower count is 26 because of a floor, not because of a lack of interest. There
are 29,360 people already holding the stablecoin. Maren is the shortest path from that
number to the other one.

The technical case, including the contract-level integration surface, the seven ways MUSD
diverges from Liquity, and the reasons the obvious account-abstraction path is a dead end
on this chain, is set out in **MRN-002, Technical Feasibility & Architecture**.
