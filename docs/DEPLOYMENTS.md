# Deployments

## Mezo matsnet (testnet) — chain 31611

**Deployed 15 August 2026. Live, source-verified, and exercised end to end.**

Deployer / admin / keeper / guardian: `0x54196397D6f01b48739dB3957257cB33cD341885`
Explorer: https://explorer.test.mezo.org

### Contracts

| Contract      | Address                                      | Runtime bytes | Deploy tx                                                            |
| ------------- | -------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| MarenRelayHub | `0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C` | 7,934         | `0xc1fdfd7e16a67b6ef7d6cc41cf95795bc17af48ccbca958b6b6ae42a9ea0db74` |
| MarenRegistry | `0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E` | 4,742         | `0x1a48c318fa00ad914b466f6b5fb665bedf9c1ca77ed8b1ac97e45a0c82f4eae4` |
| MarenPay      | `0xe475Ff919D54E055809f516E3bed8a5c7a101836` | 9,264         | `0xa91c3ea4ca9b6186f799ace9d5bfde9e8b3c2c689d0d5c0405f280b3835dc807` |
| MarenVault    | `0x46252B00AB59384518d9dB6D1f210ffF1221645b` | 14,508        | `0x25250742fbd112c08e31611be30a818fbd79bf04a722f672c115dffec901d622` |
| MarenEarn     | `0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826` | 11,396        | `0x47d7aea8ee6f27ad87a45129aed94db45ccd60ea3aa8003ef33feb6f794046c3` |

All five **source-verified on Blockscout** (`Pass - Verified`), via
`--verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api`.

11 transactions, **11,688,063 gas total**. At matsnet's ~261 wei gas price the entire
deployment cost roughly **4 nano-BTC**.

`MarenForwarder` is deliberately **not deployed**. `MarenRelayHub` extends it and is the
single trusted forwarder — confirmed on-chain: `MarenPay.trustedForwarder()` returns the
hub address.

### Exercised on-chain, against real MUSD

| Action                                   | Result                                     | Tx                                                                   |
| ---------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `MarenRegistry.commit`                   | success                                    | `0x91b7d9515e83792c16f173a695205399263afa061b957cc7652cd2bb915cad04` |
| `MarenRegistry.register("sele")`         | success, 119,726 gas                       | `0x048451db7af36cf8a52da611906b256d54cd73f7923c8ad8f4070f88eb666581` |
| `MarenVault.openPooledTrove`             | success, 762,931 gas                       | `0x13ea27a7b5c9499640c48672028c96e3208aa9924fc5802578cc1044314e93f8` |
| `MarenVault.deposit` (0.001 BTC)         | success                                    | `0xda9a536c732db989a7e6fb56d8676fed7e73f3e30fdc4106d20d37577472602b` |
| `MarenVault.borrow` (20 MUSD)            | **reverted, correctly** — see below        | —                                                                    |
| `MarenVault.deleverage` (320 MUSD)       | **succeeded, but was a no-op** — see below | `0x71adc0a5477cb64c95073360f6a984adb4a9c04f5a8fcc5b73d4249e5456c54d` |
| `MarenVault.topUpCollateral` (0.001 BTC) | success                                    | `0xb3b90cc57849ac659404802e36b496006e6f42ea57b8b3210f353dd0e101c7f2` |

`@sele` resolves to the deployer. The pooled trove is **active** in MUSD's own
`TroveManager`: 0.049 BTC collateral, 2,001.8 MUSD debt, **ICR 154.3%** at $63,028/BTC.
The vault holds the 1,800 MUSD it borrowed.

---

## Two findings from running it for real

Both were found by exercising the deployment, not by reading the code. Neither is
visible from the test suite, which is the point of doing this.

### 1. The seed must be sized to Maren's own policy, not to the protocol minimum

`borrow` reverted with `BorrowBelowMinCR(1.511e18, 1.8e18)` — the pooled trove's CR was
151%, below Maren's 180% floor. **This is the safety rail working exactly as designed**,
and it refused the borrow rather than putting users into a thin position.

But it exposes a parameter mistake in how the trove was seeded. Seeding at the protocol
minimum fixes total debt at **2,001.8 MUSD** (1,800 net + 0.1% fee + 200 gas
compensation). Reaching Maren's 180% floor against that debt needs:

```
0.05717 BTC   for 180% CR    <- Maren's user-borrow floor
0.04799 BTC   for 151% CR    <- what we seeded with
```

So **a pooled trove seeded at the protocol minimum with less than ~0.057 BTC can never
let a user borrow.** The seed has to be sized to the 180% policy from the start, or the
vault opens into a state where deposits are accepted and borrowing is permanently
refused. Deployment guidance updated accordingly: seed with **at least 0.06 BTC**, or
size `seedDebt` down — which is impossible here, because 1,800 MUSD is the protocol floor.

That last clause is the real lesson: **MUSD's minimum debt sets a minimum viable pooled
vault**, and it is larger than the minimum trove. This is worth stating to Mezo.

### 2. `deleverage()` reports success when it does nothing

`deleverage(320 MUSD)` returned status `0x1` and emitted `Deleveraged`, while trove debt
and `reserveMUSD` were both **completely unchanged**.

Cause: `_pushRepayment` computes `room = netDebt - MIN_NET_DEBT`. At the protocol floor
that room is **1.8 MUSD**, so almost nothing can be repaid — correct, since MUSD forbids
going below 1,800 net debt. But the function returns `0` silently on the no-room path,
and its `try/catch` swallows a failed `repayMUSD` into `pushed = 0` as well. `deleverage`
then emits and succeeds regardless.

A keeper watching for a successful receipt would believe the position had been
deleveraged during a drawdown when nothing happened. This is precisely the failure mode
`docs/research/SECURITY-LESSONS.md` R15 exists to prevent — _a transaction hash is not
success_ — applied to our own contract rather than to a broadcast.

**Fix:** `deleverage` should revert when `pushed == 0`, or return `pushed` and have the
keeper assert on it. The silent-`catch` should also be distinguished from the no-room
case, since one is an error and the other is a legitimate boundary.

---

## Not yet done on matsnet

- **A gasless meta-transaction through `MarenRelayHub`.** The hub is deployed, verified,
  and wired as `MarenPay`'s trusted forwarder, but no relayed call has been broadcast.
- **A user borrow, and therefore a gasless MUSD payment.** Blocked by finding 1: the
  trove is at 154% and the floor is 180%. It needs roughly 0.008 BTC more collateral.
- **`MarenEarn` deposit into the Stability Pool.**

None of these is blocked by anything unknown. They need ~0.01 BTC more of testnet
collateral, which is one more faucet drip.

## Mainnet (chain 31612)

Not deployed. Gated on a third-party audit — see `docs/src/06-roadmap.md`.
