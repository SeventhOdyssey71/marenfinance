# Demo day deck: speaker notes

Notes for `docs/src/deck.md` (built to `docs/build/deck.pdf`). Not rendered into the
deck, and deliberately not built as a PDF: this is a script to read before walking on,
not a handout.

Fifteen slides. Twelve to fourteen minutes at a calm pace, which leaves room in a
fifteen-minute slot for the question that always comes.

**One rule for the whole talk.** Every number on these slides is checkable, and the
strongest thing about this pitch is that it survives being checked. One inflated claim
costs more than every accurate one gains. If you do not know, say you do not know.

---

## 1 · Title

Say the tagline, then stop. Do not read the slide.

"Maren Finance. Spend Bitcoin, never sell it. Built on Mezo."

Then move on. This slide is worth four seconds.

---

## 2 · The gap

**This is the whole pitch. Land it in silence.**

Put the slide up. Say the two numbers, slowly, and then say nothing for a beat longer
than is comfortable.

"Fewer than thirty troves open on Mezo mainnet. More than twenty-nine thousand people
holding MUSD."

Both figures drift daily, so **say them as bounds, not as exact counts**. The slide shows
the exact dated read (27 and 29,360, 16 August 2026); the sentence you say out loud is the
one that is still true on the day.

Let them do the arithmetic themselves. Do not explain it. The next slide explains it.

If someone asks where the numbers come from, before you have got to slide 7: "Both read
from the chain this morning. `getTroveOwnersCount` on the TroveManager, and the token's
holder count. I will show you the addresses in a minute."

The count moves by one or two a day. It was 26 the day before. If it has moved since the
deck was built, **say so out loud** rather than hoping nobody checks. That is the whole
posture of this talk.

---

## 3 · Why

The mechanism, in one sentence: MUSD requires 1,800 MUSD of net debt before you can
borrow anything at all.

"That is not a fee. It is a floor. At a responsible collateral ratio, about 250%, you
have to put up roughly 0.079 BTC, about five thousand dollars, before the protocol will
lend you your first dollar."

Anticipate the objection, because someone will make it: **why 250% and not 110%?** Answer
it before they ask. "You can technically open at 110%. At 110% you are one bad hour from
liquidation. Nobody responsible recommends it, and the number I have used is the one you
would actually tell a friend to use."

---

## 4 · The wedge

"Maren opens the same product at 0.001 BTC."

**Say "roughly eighty times lower." Never say a hundred.** The real figure is 79.3. There
is a test in the SDK that asserts it. If you round it up you have made the first
unverifiable claim of the talk and everything after it is worth less.

If pushed on the arithmetic: 0.079346 divided by 0.001 is 79.346. The price it is
computed against is pinned from a live oracle read, not read at test time. Say that
distinction unprompted if you are talking to an engineer, because it is the kind of thing
they will find and it is better coming from you.

---

## 5 · How

Three sentences, then stop.

"One pooled trove, opened in MUSD's own TroveManager. A per-user ledger inside it. We
liquidate internally at 140%, against the protocol's 110%."

**The question that comes here is custody**, and you should answer it before it is asked:
"Collateral is segregated in accounting, not in custody. That is the honest description,
and the pooled vault is the one component in Maren that could lose user funds through our
own design failure. The 140% gap is the buffer that exists because of it. So is the 180%
borrow floor, the deposit cap, and the insurance buffer. They are mitigations, not
guarantees, and our documents say exactly that."

Do not oversell this. A room of Bitcoin people will trust you more for naming it.

If asked why anyone would use the pooled trove rather than a direct one: they would not,
if they qualify. The interface routes anyone above the threshold to a _direct_ trove,
because that carries no pooling risk, even though pooled volume is better for us. Say
that. It is a costly signal and it is true.

---

## 6 · The other two frictions

Quick. This slide is thirty seconds.

"Gas: you are asking someone to hold the asset they just refused to sell, so they can
spend a loan against it. Wrong shape. ERC-2771 relaying, fee inside the signed payload."

"Spending: payments to handles, requests, links, splits."

**Do not say "zero gas" or "without ever holding gas."** It is not true. `deposit` is
payable and the relay hub refuses any request carrying value, so **the first deposit
costs the user gas**. It is on the slide's footline and it is the first line of the FAQ
on the site. We got this wrong once across the landing page and the iOS app, and fixed
it. If it comes up, that story is a credit, not a wound.

---

## 7 · It is built

Let the addresses sit there. Do not read them aloud, obviously.

"Five contracts, live on matsnet, all five source-verified on Blockscout. You can paste
any of those into the explorer while I keep talking."

**Actively invite them to check during the talk.** That is the point of putting the
addresses on the slide rather than saying "deployed".

---

## 8 · It is exercised

The distinction that matters, and most demos cannot make it:

"Deployed is not the same as working. The pooled trove is open and **active in MUSD's own
TroveManager**, not in a mock. And a real user deposited 0.001 BTC into it from their own
wallet, not the deployer's."

The tx hash is on the footline. If anyone wants it, it is
`0x3b34e664140c594c3b10f4b500e4ea2e582f00002086485b93c972f1695e8dd2`.

**Be ready for: "can a user borrow yet?"** The answer is yes, and the route it took there
is the useful part, so volunteer that too:

"Yes. It did not work at first, and the reason is the interesting bit. We seeded the trove
at the protocol minimum, which pins debt at 2,001.8 MUSD, and clearing our own 180% borrow
floor against that debt needs about 0.057 BTC. We had seeded with less, so the first
borrow reverted, correctly, with our own safety rail refusing it rather than putting
someone into a thin position. We resolved it by sizing the seed to Maren's policy instead
of the protocol's: a protocol-owned top-up on 17 August took the trove to 220% collateral
ratio. A 30 MUSD borrow now simulates clean from the test wallet, and 40 MUSD is still
correctly refused at the 180% floor."

Then give them the general lesson, which is the thing worth writing down: **MUSD's minimum
debt sets a minimum viable pooled vault, and it is larger than the minimum trove.** Seeding
any pooled vault at the protocol floor opens it into a state where deposits are accepted
and borrowing is permanently refused.

**Do not describe the trove as under its floor or borrowing as blocked.** That was true on
16 August and it is not true now. If you are reading an older draft of anything, this
paragraph is the correct state.

That answer turns what looked like the weakest fact in the deck into the most useful thing
you say.

---

## 9 · What we found in the chain

Two figures on the slide and a third finding in the footline. Do not narrate all three;
pick the room.

- **Engineering room:** lead with the zero. "ERC-4337's EntryPoint is deployed on Mezo,
  byte-identical to L1, and has processed exactly zero UserOperations. The reason is one
  row: the RPCs do not implement `debug_traceCall`, so no ERC-7562-compliant bundler can
  validate against the chain. It is not unfinished, it is structurally blocked. A team
  picking 4337 off an architecture diagram loses weeks to that."
- **Business room:** lead with the gas. "Ninety-two hundredths of a cent per hundred
  thousand gas. Sponsoring a million user actions costs about nine thousand dollars.
  Gasless is affordable here in a way it is not anywhere else."

**Do not attach the words "base fee" to $0.0092.** They are two different numbers and our
own documents paired the wrong label with the wrong figure for a while. The base fee is
1,300,000 wei, which works out at about $0.0082. The $0.0092 comes from the gas *price*,
1,462,500 wei. A sponsor pays gas price, so $0.0092 is the correct number for what
relaying actually costs us; it is simply not the base fee. If someone asks for the base
fee, give them 1.3 million wei and say the sponsor figure is the higher one.

Either way, close with 7702: "and Mezo mainnet accepts EIP-7702 type-4 transactions, so
the upgrade path exists without 4337."

**Say it exactly that way.** What was verified is that the node accepts a type-4
transaction: a signed one came back rejected for insufficient funds, not for an
unsupported type. No fork marker is visible in the block header and no delegated account
was found, so **do not say "live since block 9,275,000"** even though our earlier drafts
did. The weaker claim is the one that survives being checked.

Same discipline on the zero: it comes from the Mezo block explorer's index, not from an
exhaustive sweep of 11.17 million blocks. Say "zero according to the explorer index". If
challenged on whether the indexer simply misses them, the control is that MUSD shows
104,681 transactions through the same endpoints, so the index is working.

---

## 10 · What we are giving back

"None of these four are about Maren. They are things we hit and wrote up."

The viem one is the highest-value: its bundled Mezo mainnet chain definition has a
default RPC that does not resolve and omits `multicall3`, so **every batched read for
every wagmi user on the chain silently degrades** rather than failing loudly.

Honest framing: these are **written and pushed, awaiting one command each**, not merged.
Say "ready to file", not "contributed". If they are filed by the time you present, update
the slide.

One story worth telling if there is time, and only if the room is technical: we nearly
shipped a fifth claiming a provider's RPC was chain-id-only. It was a transient outage.
Re-probing gave ten out of ten successful calls. We caught it before filing, which would
otherwise have meant proposing a broken RPC as a fix for a broken RPC, to the people
deciding this grant.

---

## 11 · Honest status

**Do not rush this slide and do not apologise through it.** Deliver it flat and
unhurried. It is the most persuasive slide in the deck in this particular room.

"Not audited. Not on mainnet, and mainnet is deliberately gated on the audit. The relayer
is implemented and tested and running nowhere."

Then: "I would rather you heard that from me in minute nine than found it in week three."

If someone asks what else is not true yet: the dApp cannot transact, writes are being
wired now; MarenEarn's swap path now has real venues: Mezo has a BTC/MUSD volatile AMM and a MUSD/mUSDT stable AMM on-chain.
Have those ready. Volunteering the second item when only the first was asked is the move.

---

## 12 · The ask

Say the number and stop talking.

"Fifteen thousand MUSD. Forty percent on mainnet deployment."

**Do not fill the silence.** The next slide is the one you actually care about.

---

## 13 · The two non-monetary asks

"These two are worth more to us than the money, and neither costs Mezo a dollar."

**Lead with the audit introduction. The audit is the real constraint, not the cash.** A
competent audit of a pooled CDP costs more than this entire grant. An auditor already
holding MUSD context can review a contract sitting on top of it far more cheaply than one
starting cold.

Fifty testnet users second. Real people find what tests do not.

If they ask about **exclusivity**: it is unresolved and you should not resolve it
standing up. "Maren is a new product built for Mezo, so in practice it is already
exclusive. What I would want to understand is what you need it to mean formally." **Do
not concede a definition before hearing theirs.**

---

## 14 · Milestones

Read the four lines, do not elaborate on any of them.

The point to make is structural, not per-milestone: "Every acceptance criterion is
checkable on-chain by someone who does not trust us. That is deliberate. You should not
have to take my word for whether a milestone was hit."

If asked about M3's numbers: 250 funded positions and $250,000 MUSD borrowed. Say
plainly that those are targets, not forecasts, and that if they slip we say so publicly
rather than quietly relaxing the definition.

---

## 15 · Close

"Spend Bitcoin. Never sell it. Everything I put on a slide today is readable from the
chain. Please go and check it."

Then stop and take questions.

---

## Questions you should expect, with the honest answer

**"Is there a token?"**
No. Revenue is spread on real usage. For a Bitcoin-native audience, not printing a token
is a feature, and we would rather say that than leave it ambiguous.

**"What is your APY on Earn?"**
We do not quote one. MUSD's Stability Pool has no emissions; returns are lumpy
liquidation gains. A forward APY would be invented. The screen shows trailing realised
yield, labelled backward-looking. A less honest screen would raise more deposits and
attract exactly the capital that leaves for the next number.

**"What happens if the vault has to pause?"**
Borrowing pauses before withdrawal does. Entries close, exits stay open, a user is never
trapped. There is a dedicated test for it.

**"You built this on Sui first. Why should we believe the Mezo version?"**
Because it is the second attempt and it is informed by a specific list of what went
wrong. The first one has a published audit that found 7 Critical and 13 High. That is a
credibility asset, not a liability: we know exactly what to avoid, and the security
lessons from it are written down as rules the new codebase is checked against.

**"What went wrong in this build?"**
Answer it fully; the list is short and it is a strength. Fabricated activity rows with
invented tx hashes rendered as explorer links, since deleted. "Zero gas" copy we had
explicitly forbidden. A lint gate cited as a quality signal for hours while no ESLint
config existed. A contracts test command that ran zero tests and reported success. Two
money bugs from duplicated borrow arithmetic, found by an independent audit and fixed in
one shared module. **The pattern worth naming: every one was caught by verification, not
by review of intent.**

**"How long to mainnet?"**
Gated on the audit, not on engineering. Which is why the introduction is the ask.

---

## Before you walk on

- Re-read slide 2's two numbers against the chain that morning. They move.
- Have the explorer open on a second screen with the vault address already pasted.
- Know the deposit tx hash, or have it one keystroke away.
- Do not use the word "revolutionary". Do not use the word "just".
