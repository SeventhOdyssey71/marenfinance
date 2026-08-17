# Maren Finance, demo-day narration

Timed to `maren-walkthrough.webm` as recorded on 16 August 2026: **118.6 seconds**, nine
scenes. Timestamps are where each scene begins in that take.

The spoken lines run to about **270 words**. At a normal speaking pace, near 145 words per
minute, that is a little under two minutes and leaves real silence inside the long holds.
The silence is the point. Do not fill it. The drawn-to-scale bar and the shared trove ratio
both need a beat where nobody is talking.

**Three numbers are spoken in the whole script and no others: 1.27 percent, 150.8 percent,
180 percent.** Everything else is legible on screen for as long as it matters, and reading
figures aloud turns a walkthrough into a spreadsheet.

If a re-record comes in at a different length, re-time against the new take rather than
speeding up the delivery. `record.mjs` prints the real start time of every scene under
"what the camera saw", and `DEMO_PACE` in `tools/demo/lib/pacing.mjs` moves the video.

---

### 0:00 Landing

> Maren is Bitcoin credit on Mezo. Deposit Bitcoin, draw dollars against it, and spend them,
> without ever selling the Bitcoin.

### 0:10 The problem

> Mezo already does the hard part. The problem is the door. Opening a position there commits
> you to a fixed debt on day one, whether you wanted to borrow that much or not.

### 0:19 Drawn to scale

> The thesis, drawn at true proportion. Grey is Mezo's minimum. Violet is Maren's floor, at
> one point two seven percent of it.
>
> _(let the bar sit)_
>
> Maren pools deposits into one shared trove, so that minimum is paid once.

### 0:32 Launch and connect

> One trove, with a per-user ledger inside it. This is a real wallet connecting to matsnet.
> Every figure from here is a live contract read.

### 0:48 Portfolio

> Position health, collateral ratio, borrowing capacity, all read live. This account has no
> debt, so there is no liquidation price. Maren leaves it blank rather than inventing one.

### 1:02 Vault

**This beat has two versions, and which one you get is decided by the chain, not by you.**
Maren's pooled trove is shared, so anyone topping it up or drawing on it moves the ratio.
Read the recorder's run log before rehearsing: the `vault` line reports either a
`reason=` and `borrowDisabled=true`, or `borrowDisabled=false`. Take the matching version.
Do not read A over a screen showing B, and never re-point the demo at the wallet that
happens to make A true.

**Version A, the trove is under the floor** (what the 16 August take filmed, at 150.8%):

> Now the part worth watching. The pooled trove is sitting at one hundred and fifty point
> eight percent, under the one hundred and eighty percent floor Maren keeps for itself.
>
> _(pause)_
>
> So borrowing is refused, before any gas is spent. It names the contract check that would
> have reverted, and confirms your own collateral is untouched and still withdrawable.

**Version B, the trove is healthy** (true from 17 August, after the pool was topped up):

> Here is the position, and here is the borrow against it, priced live.
>
> _(pause)_
>
> The pool is above its floor today, so this is offered. When it is not, this control
> switches off and says which contract check would have failed. Maren works the outcome out
> before asking you to pay for it, either way.

_Version A is the stronger demo and it is worth checking the log on the morning, in case the
ratio has drifted back under. It is not worth engineering. Topping the pool down to force a
refusal would be staging the exact thing this walkthrough refuses to stage._

### 1:22 Pay

> Payments resolve a handle to an address on chain, before anything is signed. This wallet
> holds no dollars, so Maren refuses to arm the button. Same reasoning, second screen.

### 1:35 Earn

> Idle dollars go to the Stability Pool. Returns come from liquidations, which are irregular,
> so there is no forward rate here. Only what has actually been paid, which is nothing yet.

### 1:45 Activity, and the explorer

> Every action, read back from contract logs since the block Maren was deployed. And it links
> out. Nothing here is a number you have to take on trust.

---

## Notes for the presenter

- **The Vault refusal is the strongest moment in the demo.** Do not apologise for it and do
  not rush past it. It is a live protocol constraint being enforced correctly, and a
  technical audience reads that as evidence the product is real.
- **Do not say "APY" anywhere.** The Earn screen deliberately does not contain one.
- **Nothing is staged.** No seeded balances, no stubbed responses, no screen skipped for
  being unflattering. The empty Earn result and the wallet holding no dollars are the true
  state of that account.
- The wallet reconnects on its own when the app opens, the way an unlocked wallet does on a
  return visit. The take signs out and back in so the connect flow happens on camera.
- The recording submits no transaction. If asked: the signer is a read-only provider,
  structurally incapable of signing, and the run prints `signatures 0 requested` as proof.
- **Two words to avoid.** "Simply" and "just". Neither is true of anything on screen.
