---
title: Go-to-Market
subtitle: How Maren reaches the people it was built for
docId: MRN-005
date: 2026-08-15
classification: Shared with the Mezo ecosystem team
---

# Summary

Maren's go-to-market rests on a single observation about Mezo:

> **MUSD has 29,360 holders. Mezo mainnet has 26 troves.**

Tens of thousands of people already hold Mezo's stablecoin. Fewer than thirty can mint it.
The distance between those two numbers is not a marketing problem — it is a **1,800 MUSD
minimum debt**, which at a responsible collateral ratio means **0.079346 BTC ($5,004.50)**
before anyone can open a position at all.

That reframes the entire launch. We are not persuading people to want MUSD; they already
hold it. We are removing the thing standing between them and being able to create it.

This document covers who we go to, in what order, and what we would ask of Mezo — with an
explicit note on which channels we think are overrated.

---

# 1. Who Maren is for

Three audiences, in the order we pursue them.

## A. The 29,334 — MUSD holders who are not borrowers

**The primary audience, and the reason to be optimistic.** They have already crossed
every hard barrier: they found Mezo, bridged, acquired MUSD, and hold it. They are
pre-qualified in a way no advertising can replicate. The only reason they are not
borrowers is that the minimum excludes them.

The message is not aspirational. It is: _you already use MUSD. Now you can create it
against your own Bitcoin, from 0.001 BTC._

They are reachable, because Mezo already knows where they are.

## B. Small Bitcoin holders outside Mezo

Holders of 0.01–0.1 BTC — too small for a direct trove, exactly the size Maren's pooled
vault is built for. Motivated by tax (selling is a taxable event in most jurisdictions)
and by conviction (they do not want to sell).

Higher acquisition cost, larger pool. This is the growth audience, not the launch audience.

## C. People who want to spend, not to farm

MUSD holders with no consumer-grade way to use it. `@handle` payments, requests, splits,
and payment links — all gasless. This is where retention comes from: borrowing is an
event, spending is a habit.

**We are explicitly not chasing yield tourists.** MUSD's Stability Pool has no token
emissions and its returns are lumpy liquidation gains. We will not advertise an APY we
cannot sustain, and capital that arrives for a number leaves for a bigger one.

---

# 2. Sequence

## Phase 0 — Matsnet, weeks 4–5 (Sept)

Public testnet, opened to the Mezo Discord.

**The goal is not signups. It is to find what breaks with real users**, particularly
around oracle staleness reverts and keeper behaviour under simulated drawdowns — failure
modes that tests do not surface because tests do not behave like people.

_Success:_ 50 testnet users, every core flow exercised, a written list of what broke.

## Phase 1 — Mainnet launch, week 8 (10 Oct)

Vault capped at 5 BTC. Direct troves uncapped.

- Launch post: the 26-vs-29,360 gap, stated with the numbers.
- Technical writeup of the seven ways MUSD diverges from Liquity and the three
  doc/bytecode discrepancies — offered as a contribution to other Mezo builders, not as
  criticism. **This is the piece most likely to travel**, because it is genuinely useful
  and nobody else has written it.
- Co-marketing with Mezo (Discord, @MezoNetwork, @SupernormalFDN).

_Success:_ 50 funded positions, $50k borrowed, zero incidents.

## Phase 2 — Audit and open the cap, weeks 9–14

Publish the audit in full, including findings. Raise the cap to 25 BTC. Apply for Mezo
Market listing.

_Success:_ audit published, cap raised, listed.

## Phase 3 — Payments as the habit, weeks 15–22

Shift the story from borrowing to spending. Handle registration drive; merchant pilot
with 3–5 Mezo ecosystem projects accepting MUSD through `MarenPay`.

_Success:_ 250 funded positions, $250k borrowed, 1,000 payments (the M3 milestone).

## Phase 4 — iOS, weeks 23–28

App Store launch. Mobile is where a payments product becomes a habit or does not.

_Success:_ live on the App Store, sustained 30 days.

---

# 3. Channels

Ranked by expected return, with the ones we are sceptical of named as such.

**1. Mezo's own channels.** 180k-member Discord, @MezoNetwork, @SupernormalFDN. The
highest-intent audience that exists for this product, and the offer on the table. We would
rather use it **twice, well** — at mainnet launch and at iOS launch — than continuously
and thinly.

**2. Technical writing.** The MUSD integration findings, the pooled-vault design, the
gasless architecture on a chain where ERC-4337 is a dead end. This builds the developer
credibility that precedes a serious user base, and it is the channel where the work
already done is the content.

**3. Ecosystem partnerships.** Merchant acceptance with other Mezo projects. Mutually
useful, low cost, and it makes MUSD circulate rather than sit.

**4. Bitcoin-native communities.** Nostr, Bitcoin Twitter, r/Bitcoin. High conviction,
high scepticism, and rightly hostile to anything that smells like a token. Maren's lack of
a token is an asset here — but this audience punishes overreach, so we enter with the
technical writing, not with marketing.

**Explicitly deprioritised:** paid acquisition (wrong stage, wrong trust dynamics),
influencer campaigns (actively counterproductive with a Bitcoin audience), airdrop
farming (attracts precisely the users we do not want), and a token (we are not launching
one — see below).

---

# 4. What we ask of Mezo

Ranked by value to us, which is not the same as cost to them.

1. **An introduction to the MUSD auditors.** Worth more than the grant money. See the
   Roadmap paper.
2. **Fifty testnet users from the Discord in September.** Cheap for Mezo, disproportionately
   valuable to us.
3. **A technical contact for MUSD questions**, particularly the three doc/bytecode
   discrepancies.
4. **Co-marketing at the two launches**, M1 and M4 — not continuously.
5. **Mezo Market listing** once the audit is complete.
6. **Introductions to 3–5 ecosystem projects** for the merchant pilot.

---

# 5. Positioning

**Maren — Spend Bitcoin. Never sell it.**

What we say:

- Bitcoin-backed credit from **0.001 BTC**, where the protocol minimum is ~0.079 BTC.
- **No gas.** You never need to hold BTC to move your money.
- Payments that work like messaging: `@handle`, requests, splits, links.
- **No token.** Revenue comes from spread on real usage.

What we deliberately do not say:

- No fixed APY on Earn. The yield is lumpy liquidation gains and we show trailing
  realised returns, labelled as backward-looking.
- No "100% Bitcoin-backed" claim about MUSD generally — true of the CDP portion, not of
  most circulating supply.
- No "your funds are safe" about the pooled vault. It is a mechanism, and mechanisms fail.
- No "audited" until it is.

**Voice:** calm, precise, adult. We are handling people's Bitcoin. The competition for
attention in crypto is won by volume; the competition for custody is won by restraint.

---

# 6. On not launching a token

Maren will not have a token. Stated here because it is a go-to-market decision, not just a
financial one.

A token would be the fastest way to acquire users and the fastest way to acquire the wrong
ones. For a Bitcoin-native audience, "we are not printing a token" is a positive signal,
and the predecessor product held the same line.

Revenue instead comes from spread on real usage: a margin over the protocol's 1% borrow
rate on pooled positions, a fee on payment volume above the free tier, and a performance
fee on Earn. At **$0.0092 per 100,000 gas**, the gas Maren sponsors is a rounding error
against any of these — sponsorship is a customer-acquisition cost measured in cents.

---

# 7. Honest measures

Metrics chosen because they are hard to game, not because they flatter.

| Metric                            | Why it is honest                                            |
| --------------------------------- | ----------------------------------------------------------- |
| Funded positions                  | Requires real collateral; cannot be farmed                  |
| MUSD borrowed through Maren       | On-chain, verifiable by Mezo                                |
| Payments settled                  | Usage, not deposits                                         |
| **30-day retention of borrowers** | The number that decides whether this is a product           |
| Median position size              | Confirms we are reaching small holders, not just large ones |

Deliberately excluded: TVL (measures deposits, not use), waitlist size, social followers,
and testnet transactions.

The single number we hold ourselves to: **250 funded positions**, a tenfold increase in
borrowing accounts on Mezo. We would rather commit to a figure we might miss than to one
we would certainly hit.

---

# 8. What we already bring

Not projections. Things that exist today.

- **A shipped predecessor.** Talise, on Sui: 1,900+ waitlist signups, 1,400+ handles
  claimed on-chain, live mainnet contracts, and a published security audit.
- **Upstream contributions prepared**, and offered regardless of the grant outcome: a fix
  for viem's Mezo chain definition (its default RPC does not resolve and the mainnet
  entry omits Multicall3, silently breaking batched reads for every wagmi user), a
  correction to the subgraph documentation's network slug (a manifest copied from the
  docs fails to deploy), and several dead RPC hosts in the developer docs.
- **A verified integration map for MUSD** — the seven Liquity divergences and the three
  doc/bytecode discrepancies — which is the document we wish had existed when we started,
  and which we intend to publish for the next builder.
