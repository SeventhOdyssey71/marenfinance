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

<!-- slide: stat | kicker: What the chain shows | tag: Mainnet | foot: getEntireSystemDebt() on TroveManager and the Stability Pool balance, against ~31M MUSD supply. Read 16 August 2026. -->

```stat
~4.6% | of MUSD's ~31M supply was created by user borrowing
~46% | sits in the Stability Pool, farmed, not spent
```

<!-- slide: stat | kicker: Why | tag: Protocol | foot: minNetDebt() returns 1,800 MUSD; 200 MUSD gas compensation makes the floor 2,000. $3,000 is the responsible door, $5,000 the safe-250% figure. -->

# The protocol has a minimum loan size.

```stat
2,000 MUSD | Minimum loan, before anyone can borrow at all
~$3,000 | of BTC to open one responsibly. No smaller position exists.
```

<!-- slide: stat | kicker: The wedge | tag: Verified | foot: MarenVault's 0.001 BTC deposit floor is asserted in packages/sdk/src/position.test.ts. The edge is removing the minimum, not cheaper collateral. -->

# Maren removes the minimum. Borrow from 0.001 BTC.

```stat
0.001 BTC | Maren's minimum deposit, against a 2,000 MUSD protocol minimum
No minimum loan | Borrow $25 against $77 of BTC, which the protocol cannot
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

<!-- slide: stat | kicker: It is exercised | tag: On chain | foot: A user deposited 0.001 BTC from their own wallet, tx 0x3b34e664140c594c3b10f4b500e4ea2e582f00002086485b93c972f1695e8dd2. Ratio after the protocol-owned top-up of 17 August, which cleared Maren's own 180% borrow floor. -->

# The pooled trove is open and active in MUSD's own TroveManager.

```stat
0.069 BTC | Collateral
2,001.8 MUSD | Debt
220.0% | Collateral ratio
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
