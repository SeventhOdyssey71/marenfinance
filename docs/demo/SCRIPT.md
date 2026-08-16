# Maren Finance, demo-day narration

Timed to `maren-walkthrough.webm` as recorded on 16 August 2026: **118.6 seconds**, nine
scenes. Timestamps are where each scene begins in that take.

Read at a normal speaking pace, around 145 words per minute. The spoken lines run to about
280 words, which leaves silence inside the long holds. The silence is deliberate. Let the
shared trove ratio and the drawn-to-scale bar sit on screen without talking over them.

**Three numbers are spoken in the whole script and no others: 1.27 percent, 150.8 percent,
180 percent.** Every other figure is legible on screen for as long as it matters, and
reading them aloud turns a walkthrough into a spreadsheet.

If a re-record comes in at a different length, re-time this script against the new take
rather than speeding up the delivery. The run log prints the real start time of every scene
under "what the camera saw". `DEMO_PACE` in `tools/demo/lib/pacing.mjs` moves the video and
this file follows it.

---

### 0:00 Landing

> Maren is Bitcoin credit on Mezo.
>
> Deposit Bitcoin, draw dollars against it, and spend them. Without selling the Bitcoin.

### 0:10 The problem

> Mezo already does the hard part. Borrowing against Bitcoin without selling it works today.
>
> The problem is the door. Opening a position on Mezo commits you to a fixed debt on day
> one, whether or not you wanted to borrow that much. Most people never arrive with it.
>
> The troves that are open are not weak demand. They are the few who could pay the entrance
> fee.

### 0:19 Drawn to scale

> This is the whole thesis, drawn at true proportion.
>
> The grey bar is Mezo's minimum. The violet one is Maren's floor, at one point two seven
> percent of it.
>
> *(pause, let the bar sit)*
>
> Maren pools deposits into one shared trove, so the minimum is paid once, by the pool,
> instead of by every person who wants in. Everyone in that gap is being turned away right
> now.

### 0:32 Launch and connect

> One pooled trove, with a per-user ledger inside it.
>
> This is a real wallet connecting to matsnet. Every figure from here is a contract read you
> can check yourself.

### 0:48 Portfolio

> Position health, collateral ratio, borrowing capacity. All read live.
>
> This account has no debt, so there is no liquidation price to show. The app leaves it
> blank rather than inventing one. The price carries the age of the oracle read behind it.

### 1:02 Vault, and a refusal

> Here is the part I want you to see.
>
> The pooled trove is sitting at one hundred and fifty point eight percent, under the one
> hundred and eighty percent floor Maren keeps for itself. So borrowing is refused. Not
> warned about. Refused, before any gas is spent.
>
> *(pause)*
>
> It names the contract check that would have reverted, and it says plainly that your own
> collateral is untouched and still withdrawable. A demo where I clicked Borrow and it
> worked would tell you less than this does.

### 1:22 Pay

> Payments resolve a handle to an address on chain, before anything is signed.
>
> This wallet holds no dollars, so Maren says so and refuses to arm the button. Same
> reasoning, second screen.

### 1:35 Earn

> Idle dollars go to the Stability Pool. Returns come from liquidations, which are
> irregular, so there is no forward rate anywhere on this screen. Only what has actually
> been paid, which here is nothing yet.

### 1:45 Activity, and the explorer

> Every action, read back from contract logs. The complete history, from the block Maren was
> deployed.
>
> And it links out. Nothing in this video is a figure you have to take my word for.

### 1:58 End

> Bitcoin credit at a thousandth of a Bitcoin. Built on Mezo, live on matsnet today.

---

## Notes for the presenter

- **The Vault refusal is the strongest moment in the demo.** Do not apologise for it and do
  not rush past it. It is a live protocol constraint being enforced correctly, and a
  technical audience reads that as evidence the thing is real.
- **Do not say "APY" anywhere.** The Earn screen deliberately does not contain one.
- **Nothing is staged.** No seeded balances, no stubbed responses, and no screen skipped for
  being unflattering. The empty Earn result and the wallet holding no dollars are the real
  state of that account.
- The wallet reconnects on its own when the app opens, the way an unlocked wallet does on a
  return visit. The take signs out and back in so the connect flow is visible on camera.
- The recording submits no transaction. If asked: the signer used for the take is a
  read-only provider, structurally incapable of signing, and the run prints
  `signatures 0 requested` as proof.
- **Two words to avoid.** "Simply" and "just". Neither is true of anything on screen.
