---
title: Maren Finance — Product Plan
subtitle: A money app for Bitcoin. Spend it in the real world, never sell it.
docId: MRN-200
date: 2026-08-17
version: '1.0'
classification: Confidential
audience: Mezo Ecosystem
colophon: |
  This document plans forward, and it marks the boundary honestly: sections describing
  what exists are stated as fact and are verifiable on-chain; sections describing what
  comes next are plans, and say so. Chain figures were read live on 17 August 2026.
---

## The goal

Build the app that lets someone use their Bitcoin in the real world without selling
it. On web and iOS.

The mechanics underneath are a collateralised loan on Mezo: deposit BTC, borrow MUSD
against it. But the product is not a lending dashboard. It is a money app. You put
Bitcoin in once, and from then on you pay a name, drop money into a link and send it
to anyone, request and get paid, cash out to your bank, and pay at a shop. Your
Bitcoin stays yours the whole time, and when you repay, you get all of it back.

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

Every Maren user is a new borrower Mezo could not otherwise have.

## The app

One product, two clients. The web app and the iOS app share the same SDK, the same
contract reads, and the same rules, so a number shown on one is the number shown on
the other.

### Home

The first screen answers one question: what do I have, and what can I do with it?
Bitcoin deposited, its dollar value, spendable MUSD, and one action. No debt means no
liquidation, and the app says so in a sentence instead of showing an empty gauge.

### Borrow

A slider, bounded by what the contract will actually accept, with a recommended safe
level marked. The app computes every rule the contract enforces before asking for a
signature, so an offer on screen is an offer that clears. Health is shown as a plain
number with a plain meaning: how far Bitcoin can fall before anything is at risk.

### Pay a name

Money moves to `@names`, registered on-chain through commit-reveal so they cannot be
front-run. Type `@amaka`, an amount, an optional note. No addresses to copy, nothing
to get wrong. Raw addresses still work for anyone without a name yet.

### Money links

Put MUSD into a link and send the link: WhatsApp, iMessage, anywhere text goes. The
recipient opens it and claims the money, with or without a Maren account. Unclaimed
links can be cancelled and refunded. This is how money crosses from Maren users to
everyone else.

### Requests

The reverse direction: ask for an amount with a note, share it as a link, and the
payer settles it in two taps. Settled requests appear in both parties' history with
the transaction hash attached.

### Cash out to a bank

MUSD out to local currency in a bank account. Off-ramp partners are integrated behind
one screen, starting with the corridors our users actually live in, so "cash out"
feels like part of the app rather than a trip to an exchange. This is planned, not
built; partner selection and licensing review is part of the next phase.

### Pay at a shop

Merchant payments settle in MUSD with a QR at the counter, built on the x402 payment
rail Mezo already operates: the buyer signs once, the merchant is settled on-chain,
nobody handles gas. The plan starts with a small merchant pilot rather than a
directory nobody uses. Planned, not built.

### Earn

Idle MUSD can sit productively in a vault backed by MUSD's Stability Pool. Returns
come from real liquidation gains, which are lumpy, so the app shows trailing realised
yield and refuses to advertise a rate it cannot guarantee. There are no token
emissions and no points.

## What runs today, and what comes next

Phase 1 is live on matsnet and verifiable at the addresses in the companion Progress &
Evidence document.

| Phase         | Scope                                                                                                | State                                     |
| ------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1. The engine | Pooled vault from 0.001 BTC, borrow and repay, names, payments, requests, Earn, web and iOS          | Built. Live on matsnet, borrowing enabled |
| 2. Mainnet    | Third-party audit, then mainnet with a capped vault; gasless relayer hosted so users stop paying gas | Next. Audit is the gate, deliberately     |
| 3. Real world | Money links polished for non-crypto recipients, bank cashout in first corridors, x402 merchant pilot | Planned                                   |
| 4. Scale      | Cap raises as the pooled position proves out, more corridors, more shops                             | Planned                                   |

The order is a safety decision, not a marketing one: nothing that touches other
people's Bitcoin reaches mainnet before an independent audit, and the vault launches
capped either way.

## Being straight about risk

Pooled deposits share one large, conservatively managed position. Maren keeps it far
from the protocol's liquidation threshold, pauses new borrowing long before exits, and
steers anyone holding more than the protocol minimum to their own separate position,
because that carries no pooling risk at all. A catastrophic, faster-than-keeper crash
could still socialise losses across the pool, and the app says this where the decision
is made rather than in a footnote. Bitcoin can fall; a collateralised loan can be
liquidated. No design removes that, and no screen in Maren pretends otherwise.

## What this costs to run

Sponsoring a user action on Mezo costs about a cent. The revenue design is spread on
real usage rather than a token: a small margin over the protocol's 1% borrow rate on
pooled positions, a fee on payment volume above a free tier, and a performance fee on
realised Earn yield. Gas sponsorship is a customer-acquisition cost measured in cents;
there is no token and no plan for one.

## The measure of success

Positions funded and dollars moving: borrowers who could not exist under the $5,000
minimum, payments settling against names and links, and Bitcoin that never had to be
sold. All of it readable from the chain by anyone, which is how this document prefers
every claim to be checked.
