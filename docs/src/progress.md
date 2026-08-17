---
title: Maren Finance — Progress & Evidence
subtitle: What has been built so far, deployed where, proven how, and the exact commands that let you check every claim without trusting us.
docId: MRN-100
date: 2026-08-17
version: '1.0'
classification: Confidential
audience: Mezo Ecosystem
colophon: |
  Every chain figure in this document was read live from Mezo RPCs on 17 August 2026,
  and each one is paired with the command or address that reproduces it. Counts that
  drift daily are quoted at the precision at which they hold. Where Mezo's published
  documentation and the deployed bytecode disagree, this document follows the bytecode
  and says so.
---

## What Maren is, in one paragraph

Maren is a consumer borrowing and payments app for Mezo, on web and iOS. Users deposit
Bitcoin, borrow MUSD against it from as little as 0.001 BTC, and spend it: pay a
`@name`, share a payment link, request money. It is built for Mezo and deployed
nowhere else. Everything below is what exists today, with the evidence.

## Deployed contracts, Mezo matsnet (31611)

Five contracts, all source-verified on Blockscout, deployed from
`0x54196397D6f01b48739dB3957257cB33cD341885` in 11 transactions costing 11,688,063 gas
in total (about 4 nano-BTC).

| Contract      | Address                                      | Runtime bytes |
| ------------- | -------------------------------------------- | ------------: |
| MarenVault    | `0x46252B00AB59384518d9dB6D1f210ffF1221645b` |        14,508 |
| MarenPay      | `0xe475Ff919D54E055809f516E3bed8a5c7a101836` |         9,264 |
| MarenRelayHub | `0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C` |         7,934 |
| MarenRegistry | `0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E` |         4,742 |
| MarenEarn     | `0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826` |        11,396 |

MarenRelayHub extends the ERC-2771 forwarder and is the single trusted forwarder;
`MarenPay.trustedForwarder()` returns its address on-chain.

## Exercised on-chain, not just deployed

- **A pooled MUSD trove is open and active inside Mezo's own TroveManager**, at
  0.069 BTC collateral against 2,001.9 MUSD of debt: an ICR of **220%**, with
  borrowing enabled. Verify:
  `cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getTroveColl(address)(uint256)" 0x46252B00AB59384518d9dB6D1f210ffF1221645b --rpc-url https://rpc.test.mezo.org`
- **A live borrow is offered and correctly bounded.** From the funded test account, a
  30 MUSD borrow simulates clean and a 40 MUSD borrow reverts with
  `InsufficientCollateralRatio` at the account's own 180% floor. The interface offers
  exactly the range the contract accepts, computed before any signature is requested.
- **The `@sele` handle is registered** through commit-reveal:
  `resolve("sele")` returns the deployer address on-chain.
- **User flows executed on the live chain:** Bitcoin deposits, a withdrawal, a keeper
  collateral top-up, and an on-chain payment request of 0.50 MUSD. Each one is a row in
  the app's Activity screen with its transaction hash linked to the explorer, because
  the app reads history from contract logs and renders nothing it cannot prove.

## Test evidence

| Suite                            | Count | Runs against                                                                                 |
| -------------------------------- | ----: | -------------------------------------------------------------------------------------------- |
| Contract unit and property tests |   236 | Foundry                                                                                      |
| Fork tests                       |     8 | The real MUSD contracts on matsnet                                                           |
| Relayer                          |   214 | Four adversarial review rounds, each of which found and fixed a real defect                  |
| Web behaviour suite              |    87 | The built app against live matsnet, through an injected wallet that structurally cannot sign |

The behaviour suite deserves one sentence of explanation: it drives the real interface
against the real chain with a read-only signer, asserts that every offered action
matches what the deployed contract would accept, and proves that no signature is ever
requested. The account nonce is read before and after as the final check.

## The product, as it runs today

Unretouched captures of the web app in a read-only session against live matsnet,
17 August 2026. Every figure shown is a contract read.

![Portfolio. A funded account with no debt: 0.001 BTC deposited, and the interface states plainly that nothing can be liquidated while debt is zero.](assets/app-portfolio.png)

![Vault. Borrowing live against the pooled trove: the slider is bounded by the same computation the contract enforces, with the recommended 250% marked.](assets/app-vault.png)

![Pay. MUSD moves against @handles or raw addresses, with an on-chain memo. An empty wallet is told where MUSD comes from rather than just refused.](assets/app-pay.png)

The iOS app is built with Expo, 18 screens, verified in the simulator including the
stale-oracle state.

## Findings from reading the chain

This work surfaced several things that are useful to Mezo regardless of anything else:

1. **`viem`'s Mezo chain definition** ships a default RPC that does not resolve and is
   missing `multicall3` on mainnet, which silently degrades batched reads for every
   wagmi user on the chain. A fix is drafted.
2. **The subgraph documentation** says `network: mezo-mainnet`; Goldsky's actual slug
   is `mezo`, so a manifest copied from the docs is rejected at deploy. Fix drafted.
3. **Three RPC hosts in the developer docs do not resolve.** Fix drafted.
4. **Two places the MUSD docs and deployed bytecode disagree:** the borrower
   redemption-fee waiver does not appear in `TroveManager`, and the refinance fee
   computes to roughly 0.02% rather than the documented 0.1%.
5. **ERC-4337 is not viable on Mezo today.** EntryPoint v0.7 is deployed byte-identical
   to Ethereum L1 but has processed zero UserOperations per the block explorer index,
   and the RPCs do not implement `debug_traceCall`, so no compliant bundler can run.
   Maren uses EIP-2612 permits with ERC-2771 relaying instead, and the chain accepts
   EIP-7702 type-4 transactions as the upgrade path.
6. **A sizing result worth passing on:** a pooled vault seeded at the protocol minimum
   can never serve a borrow, because MUSD's 1,800 minimum net debt pins the seed below
   its own borrowing floor. The minimum viable pooled vault is larger than the minimum
   trove. We hit this in practice and resolved it by sizing the seed to policy.

## Not done, stated plainly

No mainnet deployment yet: it is gated on an audit, deliberately. No audit yet. The
gasless relayer is built and fully tested but not yet hosted, so today users submit
their own transactions and the app says so on every screen. Nothing in this document
overstates that.

## Reproduce every number

All chain figures above can be re-read in one pass with `cast` and `curl` against
`https://rpc.test.mezo.org` (matsnet) and `https://jsonrpc-mezo.boar.network`
(mainnet). The feasibility appendix carries the full command list; the addresses in
this document are sufficient to verify independently.
