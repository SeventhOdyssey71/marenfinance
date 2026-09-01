# @maren/metrics

Honest on-chain pilot metrics for Maren Finance, read live from the deployed Mezo
contracts and their logs. It answers one question: do real users borrow small and then
SPEND it, or just poke the app and leave?

Every number is a live contract read or a decoded log. No third-party tracker, no
fabricated data. An unread value is reported as unavailable, never as zero.

## Run

```bash
# matsnet (testnet, chain 31611) is the default
pnpm --filter @maren/metrics start

# explicit network, or mainnet (which has no Maren deployment yet and will say so)
pnpm --filter @maren/metrics start -- --network testnet

# print the JSON to stdout as well as writing the snapshot
pnpm --filter @maren/metrics start -- --json

# choose the snapshot path
pnpm --filter @maren/metrics start -- --out ./my-snapshot.json
```

It prints a dated human summary and writes a machine-readable JSON snapshot to
`tools/metrics/snapshots/maren-metrics-<network>-<YYYY-MM-DD>.json`, so every metric can be
tracked across the pilot.

The `start` script runs through `tsx` because the tool imports `@maren/sdk`, which the
monorepo consumes as TypeScript source. The scan honours the three log-scan realities the
SDK documents: the 10,000-block `eth_getLogs` window, the deployment-block floor, and the
flaky testnet RPC (each call is timeboxed and retried once, with failover to the drpc
endpoint).

## What it computes

| Metric               | Meaning                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Funded positions     | Distinct addresses with live `collateral(addr) > 0`. The core adoption number.                |
| MUSD borrowed        | Gross MUSD drawn via the vault over all history. The demand-creation number.                  |
| Payments             | Count and MUSD volume of `pay` / `payToHandle`, plus requests created vs settled.             |
| Money links / claims | Links created vs claimed, and claims by addresses brand new to Maren. The growth-loop signal. |
| Handles registered   | Distinct handles on MarenRegistry.                                                            |
| Earn                 | Live TVL (`totalAssets`) and current depositor count.                                         |
| **Spend ratio**      | Of addresses that borrowed, how many then sent a payment. **THE demand-test metric.**         |

### The spend ratio, defined

Of the addresses that appear as `user` on a `Borrowed` event, the fraction that later
appear as `from` on a payment (`Paid` or `PaidToHandle`) at or after their first borrow.

- Ordering is load-bearing: a payment made before the first borrow is not spending borrowed
  money, so it does not count.
- A borrow and a pay batched into one transaction (equal log position) does count, since
  that is exactly the loop the pilot hopes to see.
- With zero borrowers the ratio is `null` ("no data"), never `0%`.

## Tests

```bash
pnpm --filter @maren/metrics test
```

The pure aggregation (`lib/aggregate.mjs`) is unit-tested against fixture logs in
`aggregate.test.mjs`. The tests never touch the network; they prove the derivations, not
that a testnet happened to be up.
