# Upstream contributions — ready to submit

Prepared 2026-08-15. Everything below is **pushed to Sele's forks but not submitted**.
Nothing has been opened against any upstream repository. Each item is one copy-paste to fire.

Author on every commit: `SeventhOdyssey71 <exorbilabs@gmail.com>`. No `Co-Authored-By` trailers.

**Read the "Findings that did not survive verification" section at the bottom before firing #4** — the
brief's description of the musd issue was inaccurate in one important respect and the framing changed.

---

## Summary

| #   | Target                   | Branch (on Sele's fork)           | Type  | One-line                                                        |
| --- | ------------------------ | --------------------------------- | ----- | --------------------------------------------------------------- |
| 1   | `wevm/viem`              | `fix/mezo-mainnet-rpc-multicall3` | PR    | Mezo mainnet default RPC does not resolve; Multicall3 missing   |
| 2   | `mezo-org/documentation` | `fix/dead-rpc-endpoints`          | PR    | Three non-resolving hosts in copy-pasteable config/snippets     |
| 3   | `mezo-org/documentation` | `fix/subgraph-network-slug`       | PR    | Goldsky slug is `mezo`, not `mezo-mainnet`; links to a 404 repo |
| 4   | `mezo-org/musd`          | —                                 | Issue | Two docs-vs-deployed-bytecode questions (framed as questions)   |

---

## 1 — `wevm/viem`: Mezo mainnet chain definition

- **Fork/branch**: `SeventhOdyssey71/viem` @ `fix/mezo-mainnet-rpc-multicall3` (commit `534a0594`)
- **Base**: `wevm/viem` `main`
- **Files**: `src/chains/definitions/mezo.ts`, `.changeset/mezo-mainnet-rpc-multicall3.md`

### Verification evidence

Default RPC host does not resolve:

```
$ dig +short rpc.mezo.org
(no output)
$ dig rpc.mezo.org | grep HEADER
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 49334
```

Proposed replacement serves real calls (not just `eth_chainId`) — `Multicall3.getCurrentBlockTimestamp()`:

```
$ curl -s -X POST https://mainnet.mezo.public.validationcloud.io \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xcA11bde05977b3631167028862bE2a173976CA11","data":"0x0f28c97d"},"latest"]}'
{"jsonrpc":"2.0","id":1,"result":"0x...6a7feac7"}
```

`eth_getLogs` and `eth_getBlockByNumber` also verified on this endpoint, and it needs no API key.

Multicall3 birth block (confirmed on two independent RPCs):

```
block 351759 -> {"result":"0x"}                     # empty
block 351760 -> {"result":"0x6080604052600436..."}  # code present
```

Blockscout REST base:

```
explorer.mezo.org/api/v2/stats      -> HTTP 404
api.explorer.mezo.org/api/v2/stats  -> HTTP 200
```

### Local checks run

- `tsc` against viem's own `tsconfig.base.json` on `mezo.ts` + `mezoTestnet.ts`: **exit 0, no errors**.
- Negative control: injecting `blockCreated: 'not-a-number'` produced
  `mezo.ts(27,7): error TS2322`, confirming the check actually exercises the file.
- Changeset added per `CONTRIBUTING.md` (`patch`, past-tense summary).

### Ready-to-run

````bash
cd /private/tmp/claude-501/-Users-eromonseleodigie-mezo-talise/0b1de907-3568-41e2-93ba-fff3c3b47ab1/scratchpad/upstream/viem && \
cat > /tmp/pr1.md <<'BODY'
Mezo's chain definition has been in viem for a while and the testnet entry is in good shape — this brings the mainnet entry in line with it.

Two changes:

**1. The default RPC host does not resolve.** `https://rpc.mezo.org` returns NXDOMAIN, so `createPublicClient({ chain: mezo })` fails on the first request:

```
$ dig rpc.mezo.org | grep HEADER
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN
```

Replaced with `https://mainnet.mezo.public.validationcloud.io`, which is listed for chain 31612 in [ethereum-lists/chains](https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-31612.json), needs no API key, and serves real calls rather than just `eth_chainId`:

```
$ curl -s -X POST https://mainnet.mezo.public.validationcloud.io \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xcA11bde05977b3631167028862bE2a173976CA11","data":"0x0f28c97d"},"latest"]}'
{"jsonrpc":"2.0","id":1,"result":"0x000000000000000000000000000000000000000000000000000000006a7feac7"}
```

`eth_getLogs` and `eth_getBlockByNumber` verified on the same endpoint. The matching `wss://` endpoint is also listed and verified, so I added it as `webSocket`.

Other keyless endpoints registered for 31612, in case you would rather list one of them or add a fallback: `https://mezo-mainnet.boar.network` (also `wss://`) and `https://jsonrpc-mezo.boar.network`. I kept the default to a single entry to match the surrounding style.

**2. Multicall3 was missing from the mainnet definition** even though it is deployed at the canonical address — the testnet definition already declares it, so batched reads work on testnet but not mainnet. Birth block confirmed at 351760 on two independent RPCs:

```
eth_getCode(0xcA11...CA11, 351759) -> "0x"
eth_getCode(0xcA11...CA11, 351760) -> "0x6080604052600436..."
```

Also added the block explorer `apiUrl`. Mezo's Blockscout REST API is served from the `api.` subdomain (`https://api.explorer.mezo.org/api` -> 200; the bare host under `/api` -> 404).

Typechecked locally against `tsconfig.base.json`; changeset included.
BODY
gh pr create \
  --repo wevm/viem \
  --base main \
  --head SeventhOdyssey71:fix/mezo-mainnet-rpc-multicall3 \
  --title "fix(chains): update Mezo mainnet RPC URL and add multicall3" \
  --body-file /tmp/pr1.md
````

---

## 2 — `mezo-org/documentation`: non-resolving RPC and explorer hosts

- **Fork/branch**: `SeventhOdyssey71/documentation` @ `fix/dead-rpc-endpoints` (commit `ea2a27c`)
- **Base**: `mezo-org/documentation` `main`
- **Files**: `developers/chains/index.md`, `developers/features/mezo-earn/mezo-earn.md`, `developers/getting-started/mezod.mdx`

### Verification evidence

```
dig rpc.mezo.org             -> NXDOMAIN
dig testnet-rpc.mezo.org     -> NXDOMAIN
dig testnet-explorer.mezo.org-> NXDOMAIN

dig mezo-mainnet.boar.network -> 34.49.193.78     (eth_call / eth_getLogs / eth_getBlockByNumber all OK)
dig rpc.test.mezo.org         -> 172.66.169.66    (chainId 0x7b7b = 31611, eth_call OK)
wss://rpc-ws.test.mezo.org    -> {"result":"0x7b7b"}
```

Replacements are the endpoints **this repo already documents** in `users/getting-started/connect.md` and
`developers/getting-started/configure-environment.md` — nothing invented.

The two Prometheus `targets` entries scrape mezod's metrics port (26660) on an operator's own node, not a
public RPC, so those became explicit placeholders rather than a provider hostname.

### Note on formatting

`chains/index.md` and the other touched files are already not Prettier-clean on `main`. I deliberately did
**not** run `npm run lint-fix`, to keep the diff reviewable. Diff is 12 lines across 3 files.

### Ready-to-run

````bash
cd /private/tmp/claude-501/-Users-eromonseleodigie-mezo-talise/0b1de907-3568-41e2-93ba-fff3c3b47ab1/scratchpad/upstream/docs-repo && \
cat > /tmp/pr2.md <<'BODY'
The RPC tables in `users/getting-started/connect.md` and `developers/getting-started/configure-environment.md` are accurate and were what I used to get running on Mezo. A few older pages point at hostnames that no longer resolve, and because two of them sit inside copy-pasteable snippets they fail at the first line.

Three hosts return NXDOMAIN:

```
$ dig rpc.mezo.org | grep HEADER
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN
$ dig testnet-rpc.mezo.org | grep HEADER
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN
$ dig testnet-explorer.mezo.org | grep HEADER
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN
```

Highest impact are the two `ethers.JsonRpcProvider('https://rpc.mezo.org')` examples in `developers/features/mezo-earn/mezo-earn.md` and `developers/getting-started/mezod.mdx` — copied as-is, they cannot connect.

I replaced them with the endpoints this repo already documents elsewhere, so nothing new is introduced:

- mainnet `https://mezo-mainnet.boar.network` / `wss://mezo-mainnet.boar.network`
- testnet `https://rpc.test.mezo.org` / `wss://rpc-ws.test.mezo.org`
- testnet explorer `https://explorer.test.mezo.org`

Each verified to serve `eth_call`, `eth_getLogs` and `eth_getBlockByNumber`, not just `eth_chainId`:

```
$ curl -s -X POST https://mezo-mainnet.boar.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xcA11bde05977b3631167028862bE2a173976CA11","data":"0x0f28c97d"},"latest"]}'
{"jsonrpc":"2.0","id":1,"result":"0x...6a7fde4e"}
```

One judgement call worth flagging: the two Prometheus `targets` entries scrape mezod's metrics port (26660), which is an operator's own node rather than a public RPC, so I made those explicit placeholders instead of substituting a provider hostname. Happy to change if you would rather they name a specific host.

I did not run `npm run lint-fix` — these files are already not Prettier-clean on `main` and reformatting would have buried a 12-line change. Glad to add it if you prefer.
BODY
gh pr create \
  --repo mezo-org/documentation \
  --base main \
  --head SeventhOdyssey71:fix/dead-rpc-endpoints \
  --title "docs: update RPC and explorer endpoints to resolving hosts" \
  --body-file /tmp/pr2.md
````

---

## 3 — `mezo-org/documentation`: Goldsky network slug and missing repo links

- **Fork/branch**: `SeventhOdyssey71/documentation` @ `fix/subgraph-network-slug` (commit `d76ae80`)
- **Base**: `mezo-org/documentation` `main`
- **Files**: `developers/subgraphs/index.md`, `developers/getting-started/integrations-and-partners.md`

### Verification evidence

```
$ gh repo view mezo-org/subgraphs
GraphQL: Could not resolve to a Repository with the name 'mezo-org/subgraphs'.
$ curl -o /dev/null -w '%{http_code}' https://github.com/mezo-org/subgraphs
404
```

Goldsky's supported-networks page lists the slugs `mezo` (mainnet) and `mezo-testnet` (testnet).
`mezo-mainnet` does not appear anywhere on that page.

### Ready-to-run

````bash
cd /private/tmp/claude-501/-Users-eromonseleodigie-mezo-talise/0b1de907-3568-41e2-93ba-fff3c3b47ab1/scratchpad/upstream/docs-repo && \
cat > /tmp/pr3.md <<'BODY'
The Goldsky page is a genuinely useful starting point — the manifest and deploy walkthrough are most of what you need. Two things tripped me up while following it end to end.

**1. Network slug.** The `subgraph.yaml` and Goldsky JSON examples use `network: mezo-mainnet`. Goldsky's [supported networks](https://docs.goldsky.com/chains/supported-networks) list the slug as `mezo` for mainnet (`mezo-testnet` for testnet); `mezo-mainnet` does not appear on that page, and a manifest copied from here is rejected at deploy time. Updated both examples to `mezo`.

I also updated the Goldsky entry in `integrations-and-partners.md`, which mentioned only testnet, to name both slugs.

**2. Links to `mezo-org/subgraphs`.** The Repository Structure list and the Installation step point at that repo, which currently 404s:

```
$ curl -o /dev/null -w '%{http_code}\n' https://github.com/mezo-org/subgraphs
404
```

Since I could not tell whether it is unpublished or renamed, I did the conservative thing rather than guess at a replacement: turned the five links into plain filenames (the descriptions still stand on their own) and swapped the `git clone` step for `graph init`, so the page no longer depends on a repository that is not published. If that repo is coming, or lives under another name, I am happy to point these back at it instead.
BODY
gh pr create \
  --repo mezo-org/documentation \
  --base main \
  --head SeventhOdyssey71:fix/subgraph-network-slug \
  --title "docs: correct Goldsky network slug and update subgraph repository links" \
  --body-file /tmp/pr3.md
````

---

## 4 — `mezo-org/musd`: issue, not a PR

**Filed as an issue, deliberately.** Whether the docs or the contracts should change is the maintainers'
call, and the redemption item may describe intended future behaviour. `mezo-org/musd` has active issues
from outside contributors (e.g. #278), so it is the right venue. No code or docs changed.

### Verification evidence

Redemption fee — `TroveManager` applies the rate unconditionally; there is no borrower check:

```solidity
// solidity/contracts/TroveManager.sol
totals.collateralFee = borrowerOperations.getRedemptionRate(
    totals.totalCollateralDrawn
);

// solidity/contracts/BorrowerOperations.sol
function getRedemptionRate(uint256 _collateralDrawn) external view returns (uint256) {
    uint256 fee = (redemptionRate * _collateralDrawn) / DECIMAL_PRECISION;
```

`isAccountFeeExempt` occurs only in `BorrowerOperations.sol` (3 sites), `GovernableVariables.sol`
(definition) and `IGovernableVariables.sol` — **never** in `TroveManager.sol`. It is also a
governance-managed allowlist (`addFeeExemptAccount` is `onlyGovernance`), not "anyone holding a loan".

Refinance fee — 20% of old net debt, then the 0.1% borrowing fee applied to that:

```solidity
// BorrowerOperations.sol
vars.amount = (refinancingFeePercentage * vars.oldDebt) / 100;
uint256 fee = governableVariables.isAccountFeeExempt(_borrower)
    ? 0
    : _triggerBorrowingFee(musd, vars.amount);
```

Live values read from mainnet `BorrowerOperations` `0x44b1bac67dDA612a41a58AAf779143B181dEe031`:

```
refinancingFeePercentage() -> 20
borrowingRate()           -> 1000000000000000    (0.1%)
redemptionRate()          -> 7500000000000000    (0.75%)
DECIMAL_PRECISION()       -> 1000000000000000000
```

So the effective refinance fee is `0.20 * 0.001 = 0.0002` = **~0.02% of old net debt**.
Sanity check on the same RPC: `TroveManager.getTroveOwnersCount() -> 26`.

### Ready-to-run

````bash
cat > /tmp/issue4.md <<'BODY'
I have been integrating against MUSD on mainnet and the contracts have been a pleasure to read — the separation between `BorrowerOperations` and `TroveManager` made it easy to follow the fee paths. While reconciling the published fee schedule against the deployed bytecode I found two places I could not make line up, and I am not sure whether the docs describe intended future behaviour or I am simply misreading the code. Both are questions rather than reports.

**1. Is the redemption fee waiver for borrowers implemented on-chain yet?**

The docs site states it in two places:

- `users/borrow/fees.md`: "Redemption fee | 0.75% | ... (waived for borrowers)" and "When a user has an outstanding loan, the redemption fee is zero. Users who do not have an outstanding MUSD loan must pay the 0.75% redemption fee."
- `users/borrow/index.md`: "Users with an open loan can do this at no additional cost. Those without a loan pay a 0.75% redemption fee."

In the deployed code I only see the rate applied unconditionally:

```solidity
// TroveManager.sol
totals.collateralFee = borrowerOperations.getRedemptionRate(
    totals.totalCollateralDrawn
);
```

`getRedemptionRate` is a flat `redemptionRate * _collateralDrawn / DECIMAL_PRECISION` with no reference to the caller, and `isAccountFeeExempt` appears in `BorrowerOperations.sol`, `GovernableVariables.sol` and `IGovernableVariables.sol` but not in `TroveManager.sol` — and it reads as a governance-managed allowlist (`addFeeExemptAccount` is `onlyGovernance`) rather than "has an open trove".

Is the waiver planned rather than live, or is it applied somewhere I have missed?

**2. Should the refinance fee read as ~0.02% of old net debt?**

The docs site lists the refinance fee as a flat 0.1%. `BorrowerOperations.refinance` looks like it composes two rates:

```solidity
vars.amount = (refinancingFeePercentage * vars.oldDebt) / 100;
uint256 fee = ... : _triggerBorrowingFee(musd, vars.amount);
```

Reading the live values from mainnet `BorrowerOperations` (`0x44b1bac67dDA612a41a58AAf779143B181dEe031`):

```
refinancingFeePercentage() -> 20
borrowingRate()            -> 1000000000000000     (0.1%)
DECIMAL_PRECISION()        -> 1000000000000000000
```

That gives `0.20 * 0.001 = 0.0002`, i.e. ~0.02% of old net debt rather than 0.1%.

Notably this repo's own `docs/README.md` already describes it the compositional way — "a configurable percentage of the issuance fee" — which matches the code; it is the fee table on the docs site that reads as a flat 0.1%. So this may just be a docs-site wording fix.

Happy to open a PR against whichever side you would like changed, or to leave both alone if they are describing where the protocol is heading.
BODY
gh issue create \
  --repo mezo-org/musd \
  --title "Question: redemption fee exemption and refinance fee — docs vs deployed contracts" \
  --body-file /tmp/issue4.md
````

---

## Findings that did NOT survive re-verification

**a) `mezo.drpc.org` — do not cite it as limited.** An early probe (and the coordinator's) showed it
returning `-32601 method not available` for `eth_getCode`, `eth_getLogs` and `eth_blockNumber`. On
re-test it served `eth_call`, `eth_getLogs` and `eth_getBlockByNumber` correctly **20/20 times**. The
earlier failures were transient, not a fixed capability limit. It is therefore _not_ defensible to claim
publicly that it is chain-id-only, and no PR body makes any claim about it. It is simply not proposed as
viem's default. **The coordinator's suggested PR-2 addition about dRPC being "effectively chain-id-only"
was dropped for this reason** — it is not currently reproducible, and publishing it would have been the
same category of error we were trying to avoid, pointed the other way.

**b) Explorer API base URL is not a docs defect.** `https://explorer.mezo.org/api/v2/...` does 404 while
`https://api.explorer.mezo.org/api/v2/...` returns 200 — that part is real. But `explorer.mezo.org/api`
appears **zero times** in `mezo-org/documentation`; the docs never publish an API base URL at all. So
there was nothing to correct there. The finding was still useful: it became the `apiUrl` addition in the
viem PR, where the field was genuinely absent.

**c) The musd redemption/refinance claims are not in `mezo-org/musd`.** The brief said `docs/README.md`
states the borrower waiver "twice". It does not state it at all — the closest line says the opposite
("Any account with an MUSD token balance may redeem them, regardless of whether they are a borrower").
Both claims live in **`mezo-org/documentation`** (`users/borrow/fees.md`, `users/borrow/index.md`).
The underlying code observations are accurate; only the location was wrong. The issue text was rewritten
to quote the correct files.

**d) `isAccountFeeExempt` is not a borrower mechanism.** It is a governance allowlist
(`addFeeExemptAccount` is `onlyGovernance`), so "borrowers are exempt" and "fee-exempt accounts" are two
different things. The issue is worded accordingly rather than implying the docs describe this function.

---

## Deliberately deferred (not submitted — for Sele to decide)

**Cosmos chain-id.** `developers/chains/index.md` and `mezo-nodes/validator-kit.mdx` use
`--chain-id mezo-mainnet` / `mezo-testnet`. These are Cosmos chain-ids (mezod is a Cosmos SDK chain), so
they are a _different_ thing from EVM chain id 31612 and must **not** be "fixed" to the Goldsky slug.
The real value, read live from a Mezo node, is different again:

```
$ curl -s http://mezo-node-0.test.mezo.org:26657/status | jq -r .result.node_info.network
mezo_31611-1
```

So testnet is `mezo_31611-1` and mainnet is presumably `mezo_31612-1` — but I could not reach a public
mainnet Comet RPC to confirm the mainnet value, so I left every one of these lines untouched rather than
ship a half-verified change. Worth raising with the team as a question if you want a fourth contribution.

**`developers/chains/index.md` more broadly.** It also describes a `configs/` + `genesis/` layout for
`mezo-org/chains` that does not match that repo. Correcting it properly means rewriting the page, which
is a much larger change than a goodwill PR should carry, and risks reading as criticism. Left alone.
