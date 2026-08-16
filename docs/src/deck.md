---
title: Maren Finance Demo Day
subtitle: Spend Bitcoin. Never sell it. Built on Mezo.
docId: MRN-008
date: 2026-08-16
classification: Shared with the Mezo ecosystem team
format: deck
presenter: Sele
network: Mezo matsnet 31611
---

<!-- slide: title -->

# Maren Finance

Spend Bitcoin. Never sell it. Built on Mezo.

<!-- slide: stat | kicker: The gap | tag: Mainnet | foot: getTroveOwnersCount() on TroveManager, and the MUSD token holder count. Read 16 August 2026. -->

```stat
27 | Troves open on Mezo mainnet
29,360 | People holding MUSD
```

<!-- slide: stat | kicker: Why | tag: Protocol | foot: minNetDebt() returns 1,800 MUSD. 250% is a responsible ratio, not the 110% liquidation floor. -->

# You cannot borrow a dollar until you have committed five thousand.

```stat
1,800 MUSD | Minimum net debt, before anyone can borrow
0.079346 BTC | The collateral that needs, about $5,004
```

<!-- slide: stat | kicker: The wedge | tag: Verified | foot: 0.079346 / 0.001 = 79.346. Asserted in packages/sdk/src/position.test.ts against a pinned oracle price. -->

# Maren opens the same product at 0.001 BTC.

```stat
0.001 BTC | Maren's minimum deposit
79.3× | Lower. Roughly eighty times, not a hundred.
```

<!-- slide: points | kicker: How -->

# One trove. A ledger inside it.

- **One pooled trove**, opened in MUSD's own TroveManager
- **A per-user ledger** inside it. Collateral is segregated in accounting, not in custody
- **Internal liquidation at 140%**, against the protocol's 110%

<!-- slide: points | kicker: The other two frictions | foot: The first deposit is payable, so it costs the user gas. Everything after it does not. -->

# Gas you do not hold, and nowhere to spend.

- **Gas.** ERC-2771 relaying, with the fee inside the signed payload
- **Spending.** Payments to `@handles`, plus requests, links and splits

<!-- slide: table | kicker: It is built | tag: matsnet 31611 | foot: All five verified on Blockscout. 11 transactions, 11,688,063 gas, about 4 nano-BTC. -->

# Five contracts, live and source-verified.

| Contract      | Address                                      |
| ------------- | -------------------------------------------- |
| MarenVault    | `0x46252B00AB59384518d9dB6D1f210ffF1221645b` |
| MarenPay      | `0xe475Ff919D54E055809f516E3bed8a5c7a101836` |
| MarenRegistry | `0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E` |
| MarenEarn     | `0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826` |
| MarenRelayHub | `0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C` |

<!-- slide: stat | kicker: It is exercised | tag: On chain | foot: A user deposited 0.001 BTC from their own wallet, tx 0x3b34e664…95e8dd2, block 14,923,865. -->

# The pooled trove is open and active in MUSD's own TroveManager.

```stat
0.050 BTC | Collateral
2,001.8 MUSD | Debt
157.6% | Collateral ratio
```

<!-- slide: stat | kicker: What we found in the chain | tag: Findings | foot: Zero per the Mezo explorer index. No Mezo RPC implements debug_traceCall, so no compliant bundler can run. Mainnet does accept EIP-7702 type-4 transactions. -->

# We read the chain, not the documentation.

```stat
0 | UserOperations ever processed by the deployed ERC-4337 EntryPoint
$0.0092 | What 100,000 gas costs
```

<!-- slide: points | kicker: What we are giving back | foot: Written, pushed, and awaiting one command each. -->

# Four upstream fixes, none of them about Maren.

1. `viem` ships a Mezo mainnet RPC that does not resolve, and omits `multicall3`
2. The Goldsky network slug is `mezo`, not the documented `mezo-mainnet`
3. Three RPC hosts in Mezo's documentation do not resolve
4. Two places where MUSD's documentation and its deployed bytecode disagree

<!-- slide: points | kicker: Honest status | foot: This is the list we open with, not the one you have to go and find. -->

# What is not true yet.

- **Not audited.** No third party has reviewed a line of it
- **Not on mainnet.** That is gated on the audit, deliberately
- **The relayer is not hosted.** Gasless is implemented and tested, and running nowhere

<!-- slide: stat | kicker: The ask -->

```stat
$15,000 | MUSD, with 40% released on mainnet deployment
```

<!-- slide: points | kicker: And two asks worth more than the money -->

# Neither of them costs Mezo a dollar.

1. **An introduction to the MUSD auditors.** An auditor already holding MUSD context can review a contract sitting on top of it far more cheaply than one starting cold
2. **Fifty testnet users from the Discord.** Real people find what tests do not

<!-- slide: table | kicker: Milestones | foot: Every acceptance criterion is checkable on-chain by someone who does not trust us. -->

# Four tranches, all verifiable.

| Milestone                                       | Share | Amount |
| ----------------------------------------------- | ----- | ------ |
| M1 Mainnet deployment                           | 40%   | $6,000 |
| M2 Audit complete, findings resolved            | 25%   | $3,750 |
| M3 250 funded positions, $250,000 MUSD borrowed | 20%   | $3,000 |
| M4 iOS live, sustained for 30 days              | 15%   | $2,250 |

<!-- slide: close | tag: Verify | foot: Every number in this deck is readable from the chain. -->

# Spend Bitcoin. Never sell it.

|            |                                            |
| ---------- | ------------------------------------------ |
| Repository | `github.com/SeventhOdyssey71/marenfinance` |
| Contracts  | `explorer.test.mezo.org`                   |
