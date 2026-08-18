# The social-vault clip

A 40 to 60 second clip focused on one thing, because Judy asked for exactly this: the
social vault, spoken over the screens that show it. Record against the live app
(`CI=true pnpm --filter @maren/web dev`, connect the test wallet). Every number on
screen is a live contract read; say nothing the screen does not show.

Numbers drift. Where this script says "two hundred and twenty three percent", read
whatever the panel actually says at record time, rounded down.

## Beats

### 0:00 Vault screen, panel in view

> This is the social vault. One trove on MUSD, shared by everyone in it.
>
> Mezo's minimum position is about five thousand dollars of Bitcoin. Pooling changes
> that to 0.001. That's the whole idea.

### 0:12 Hover the health scale

> The vault's health is public, on the same scale as any position: two hundred and
> twenty three percent right now, against the hundred and eighty floor Maren enforces
> and the two-fifty it targets. If it ever falls to the floor, borrowing closes before
> withdrawals do. Exits stay open when entries shut.

### 0:26 Capacity bar, then "your collateral in it"

> It's capped. Five Bitcoin for now, raised only as the position proves out. And your
> slice is your slice: this account's collateral, and its debt, which is yours alone,
> not the vault's.

### 0:37 Scroll to the risk sentence, let it sit

> And the risk is stated where you decide, not in a footnote: everyone here shares one
> trove. Your Bitcoin is segregated in accounting, not custody. A crash faster than
> the keeper could socialise losses.
>
> _(beat)_

### 0:47 Switch to Borrow tab, slider enabled

> Borrowing against it is live. The slider is bounded by what the contract will
> actually accept, computed before you sign anything. This account borrowed real MUSD
> from this vault, on-chain, in one transaction.

### 0:56 End on the panel

> That's the social vault. The door into Mezo for everyone under the minimum.

## Rules

- No em dashes anywhere in captions or titles.
- Never "zero gas". If gas comes up, the truth: the user pays it today, about a cent.
- Read ratios DOWN. If the panel says 223.7, say two twenty three.
- If the pool state changed and borrowing is refused at record time, film the refusal
  and read the alternate line: "Right now it's refusing new borrowing, and saying
  exactly which contract check would fail. That's the point." Do not top up the pool
  to force the pretty take.
