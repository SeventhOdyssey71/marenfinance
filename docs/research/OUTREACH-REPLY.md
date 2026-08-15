# Draft reply to Judy — Mezo ecosystem team

Not a document to send as a PDF. This is a draft of the message itself, for Sele to edit
into his own voice before sending. Suggested attachments: the Thesis and Technical
Feasibility PDFs, and a link to the repository once it is made public.

---

## Version A — the one to send

> Hi Judy, thanks for the follow-up, and for being straightforward about the terms.
>
> Yes to all three points. A separate deployment is the right call and I'd have argued
> for it anyway — I've built this as a Mezo-native product rather than a port, under a
> new name, **Maren**. Talise stays on Sui; Maren is its own thing, and everything it
> does settles in MUSD and pays gas in BTC on Mezo.
>
> Before replying I spent a while actually reading the chain rather than the docs, and
> the thing that convinced me is this: **Mezo mainnet has 26 troves and MUSD has 29,360
> holders.** The primitive works — people clearly want MUSD. What's capping the borrower
> count is the 1,800 MUSD minimum net debt, which at a responsible collateral ratio means
> roughly 0.079 BTC, about $5,000, before anyone can open a position at all.
>
> Maren is a pooled vault that opens the same product at **0.001 BTC** — roughly eighty
> times lower — plus gasless spending and a payments surface for MUSD. Users above the
> threshold get routed to a direct trove instead, because that carries no pooling risk
> and I'd rather they took the safer path. Every Maren user is a net-new MUSD borrower
> for Mezo rather than one of the existing 26 moving around.
>
> It's built, not proposed. Five contracts — a pooled vault, payments, a handle
> registry, an ERC-4626 earn vault, and an atomic signed-fee relay hub — with 236 tests
> passing plus 8 fork tests against real MUSD on matsnet. A gasless relayer at 210 tests.
> A landing page and an iOS app, both running. The deploy script simulates cleanly
> against matsnet at 15.3M gas; I'm holding the actual broadcast until I can fund the
> deployer, since the faucet pays 0.001 BTC per IP per day and the smallest possible
> trove needs about 0.079 BTC. If you can point testnet BTC at
> `0x54196397D6f01b48739dB3957257cB33cD341885`, that's the fastest path to a live
> deployment you can check yourself.
>
> On exclusivity — happy to discuss it. Maren is a new product built for Mezo, so in
> practical terms it's already exclusive; I'd just want to understand what you need it to
> mean formally.
>
> I've attached two documents: the thesis, and a technical feasibility paper. A few
> things came out of the research that I think are useful to you regardless of what
> happens with the grant:
>
> - The `viem` Mezo chain definition has a default RPC that doesn't resolve, and the
>   mainnet entry is missing `multicall3` even though it's deployed — which silently
>   breaks batched reads for anyone using wagmi. I have the fix ready to send upstream.
> - The subgraph docs tell you to write `network: mezo-mainnet`, but Goldsky's slug is
>   `mezo`, so a manifest copied from the docs fails to deploy.
> - A couple of the RPC hosts in the developer docs are dead (`rpc.mezo.org`,
>   `testnet-rpc.mezo.org`).
> - Two spots where the MUSD docs and the deployed contracts disagree — the borrower
>   redemption-fee waiver doesn't appear to exist in `TroveManager`, and the refinance fee
>   computes to about 0.02% rather than the documented 0.1%. Entirely possible I'm reading
>   it wrong, which is why I'd rather ask than assume.
>
> I've drafted PRs for the first three and can send them whenever — just say the word.
>
> On milestones: I've proposed a schedule in the roadmap doc that ties the 40% to
> verified mainnet deployment and the rest to on-chain outcomes you can check yourself —
> 250 funded positions and $250k borrowed being the main one. That would be a tenfold
> increase in borrowing accounts on Mezo, which felt like the right thing to be measured
> against.
>
> One honest flag: a proper audit of a pooled CDP contract costs more than the whole
> grant. I'm not asking Mezo to cover it. But **an introduction to whoever audited MUSD
> would be worth more to me than the money** — someone already holding the protocol
> context can review a contract sitting on top of it far more cheaply than starting cold.
>
> The other thing I'd genuinely value is fifty people from the Discord on matsnet in
> September. Real users find things tests don't.
>
> Happy to jump on a call whenever suits.
>
> — Sele

---

## Notes on why it's written this way

**It leads with a number they don't have.** The 26-troves-vs-29,360-holders gap is the
whole pitch in one line, and it demonstrates the work was done before the ask was made.

**It gives before it asks.** Four concrete findings, three with fixes already written,
offered unconditionally. This changes the frame from _founder requesting money_ to
_contributor who is already contributing_.

**It names the hard thing.** Volunteering that the audit costs more than the grant is
counter-intuitive but it is the single most credibility-building sentence in the message.
Everyone in that inbox is claiming their plan is fully funded.

**It asks for the non-monetary thing first.** The auditor introduction and the testnet
users are cheap for Mezo and genuinely valuable to Maren. Asking for them signals that
the money is not the only reason for the conversation.

**It answers all three of their points in the first two paragraphs**, because they asked
three direct questions and the reply should not make them hunt for the answers.

## What to check before sending

- Confirm the number of Mezo mainnet troves is still 26 on the day you send — it moves.
  `cast call 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193 "getTroveOwnersCount()(uint256)" --rpc-url https://mezo.drpc.org`
- Decide whether the repository is public before offering a link.
- The upstream PRs are prepared but not submitted — see `docs/research/UPSTREAM-PRS.md`.
  Don't offer them in the message before you have looked at them.
