# Maren activity subgraph

Indexes Maren's history on Mezo matsnet so the Activity screen is one query instead of a
paged log crawl.

## Why

Mezo's public RPCs cap `eth_getLogs` at 10,000 blocks. Reading history therefore means
paging: four windows across three contracts, twelve requests, and — measured on matsnet —
about **1,074ms per window even when it returns zero logs**. On top of that the client spent
one `eth_getBlockByNumber` (**~445ms**) per distinct block purely to date each row.

This replaces all of it with a single GraphQL query whose rows already carry their timestamp.

## What it indexes

Eleven events across three contracts, from block `14,911,471` — the deployment block, found
by bisecting `eth_getCode`, not guessed.

| Contract | Events |
| --- | --- |
| `MarenVault` | `Deposited`, `Withdrawn`, `Borrowed`, `Repaid` |
| `MarenPay` | `Paid`, `PaidToHandle`, `RequestCreated`, `LinkCreated`, `LinkClaimed` |
| `MarenEarn` | `Deposit`, `Withdraw` |

The ABIs in `abis/` are generated from the Foundry build output rather than hand-written, and
the event signatures in `subgraph.yaml` are derived from those ABIs, so neither can drift from
the deployed contracts.

## One row per participant

A payment has two sides and both parties must find it in their own history. The alternative —
one row with a `participants` array queried by `participants_contains` — works but cannot use
an index, which degrades exactly as the table grows. Duplicating the row per side keeps
`account` a plain indexed equality filter.

So a `Paid` event writes **two** `Activity` rows sharing a `txHash` and `logIndex` and
differing in `account`. That is intended, not a duplicate.

`LinkCreated` is the deliberate exception: only the creator gets a row, because a link has no
recipient until it is claimed and inventing one would put a stranger's row in a history before
they had anything to do with it.

## Deploying

Requires a Goldsky account — this is the one step that cannot be done from the repo.

```bash
cd subgraph
npm install
npx graph codegen && npx graph build     # both already verified to pass

npx goldsky login                        # interactive, opens a browser
npx goldsky subgraph deploy maren-activity/1.0.0 --path .
```

Goldsky prints a query URL. Put it in `apps/ios-native/Maren/Info.plist` under
`MAREN_SUBGRAPH_URL`, then ship a new build.

## Not deploying is a supported state

`MAREN_SUBGRAPH_URL` empty means the client runs the log crawl instead. The crawl is slower
but needs no infrastructure and cannot go stale relative to the chain, which is why shipping
the client change before the indexer exists is safe.

The fast path is deliberately **all-or-nothing**: any failure — unset URL, transport error, or
a GraphQL `errors` array alongside a 200 — returns nil and the crawl runs. A half-populated
history is worse than a slow one, because a missing row reads as "that payment never happened"
rather than as "this is still loading".

## The query the client makes

```graphql
query Activity($account: Bytes!, $first: Int!) {
  activities(
    where: { account: $account }
    orderBy: timestamp
    orderDirection: desc
    first: $first
  ) {
    kind amount counterparty memo outgoing blockNumber timestamp txHash
  }
}
```
