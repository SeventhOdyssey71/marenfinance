# Security policy

## Status of this software

Maren Finance is pre-audit. No third-party security audit has been performed on any
contract in this repository.

Everything deployed today is on **Mezo matsnet (chain 31611)**, a test network. There
is no mainnet deployment: `MAREN_ADDRESSES.mainnet` in `packages/sdk/src/addresses.ts`
is all zeroes, and that is not a placeholder waiting to be filled in from somewhere
else. Nothing in this repository is holding real money at present.

A third-party audit of `MarenVault` and `MarenRelayHub` is a gate on mainnet, not a
follow-up to it. See `docs/ARCHITECTURE.md` section 7.

## Contracts that hold user funds and are unaudited

This is the part that matters most, so it is stated plainly rather than buried.

- **`MarenVault`** holds user BTC collateral. Deposits go into a single pooled trove in
  Mezo's own `TroveManager`, and per-user balances are an accounting ledger inside the
  contract, not segregated custody. A bug in that ledger, or a BTC drawdown faster than
  the keeper can respond to, can lose user collateral. This contract is unaudited.
- **`MarenPay`** escrows MUSD for claimable payment links. `createLink` moves MUSD into
  the contract and it sits there until `claimLink` or a refund. Direct payments,
  requests, and splits are non-custodial pass-throughs, but links are not. This contract
  is unaudited.
- **`MarenEarn`** is an ERC-4626 vault holding MUSD deposited into MUSD's Stability
  Pool. It is unaudited.
- **`MarenRelayHub`** holds no user funds, but it is the trusted forwarder every other
  Maren contract believes about who the caller is, so it is on the critical path. The
  relayer service in `apps/relayer` holds a hot key funded with BTC. Compromising that
  key costs Maren gas and lets an attacker censor or reorder Maren meta-transactions. It
  cannot move user funds, because every value transfer downstream is a `transferFrom`
  under the user's own authorisation.

Do not deposit anything you are not willing to lose. On matsnet that is easy advice to
follow. It stays true until an audit report exists and is published here.

## Reporting a vulnerability

Email **exorbilabs@gmail.com**. Put "Maren security" in the subject line.

Please do not open a public issue, a pull request, or a discussion thread for a
vulnerability. A private report gives us the chance to fix it before it is usable.

Useful things to include, none of them required:

- Which contract, app, or endpoint is affected, and at which commit.
- What an attacker gets out of it, and what they need to start.
- A reproduction. A failing Foundry test against `packages/contracts` is the fastest
  possible route to a fix, but a paragraph of prose is entirely welcome too.

## What to expect

This project is currently maintained by one person, so these are the honest numbers
rather than an enterprise SLA:

- **Acknowledgement within 3 working days.** If you have not heard anything by then,
  assume the mail went astray and send it again.
- **An initial assessment within 10 working days**, saying whether we can reproduce it,
  whether we consider it a vulnerability, and roughly when a fix will land.
- **A fix before mainnet** for anything affecting a fund-holding contract. Matsnet
  deployments may be redeployed rather than patched in place.
- **Credit in the release notes** if you want it, and no credit if you would rather have
  none. Tell us which.

If we disagree that a report is a vulnerability, we will say so and explain why, rather
than letting the thread go quiet.

## No bug bounty

There is no bug bounty programme, and there is no reward budget. Maren is
grant-funded and pre-revenue, and offering a bounty we could not pay would be worse
than not offering one. A programme may exist once there is a mainnet deployment worth
attacking. Until then, reports are gratefully received and cannot be paid for.

## Scope

In scope: contracts in `packages/contracts/src`, the SDK in `packages/sdk`, the relayer
in `apps/relayer`, and the web and iOS apps in `apps/`.

Out of scope: Mezo's own protocol contracts (MUSD, `BorrowerOperations`,
`TroveManager`, `StabilityPool`, `PriceFeed` and the oracle precompile). Those belong
to Mezo. Report them to Mezo. If a Mezo issue is only exploitable through Maren, or
Maren makes it materially worse, we do want to hear about it.

Also out of scope: findings that depend on a compromised user device, on the user
signing an arbitrary attacker-supplied message outside our apps, or on public testnet
RPC unavailability. The last one is a known and accepted condition; the apps have an
explicit unavailable state for it.
