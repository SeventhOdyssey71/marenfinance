# Codebase audit — 15 August 2026

A structural review of `github.com/SeventhOdyssey71/marenfinance` at 274 tracked files,
commissioned because the repo was built fast by many parallel agents in one session and
nobody had stepped back to look at the whole of it.

The brief was structure, consistency, dead weight, and whether the repo tells the truth
about itself — explicitly **not** rewriting working code.

**Summary.** Secret hygiene is genuinely clean; that was verified rather than assumed.
The codebase is unusually free of litter — no `.DS_Store`, no stray build output, no
commented-out blocks, five TODOs that are one cross-referenced work item. What it has
instead are **semantic** problems: two money bugs from the same duplicated arithmetic, a
runtime behaviour change nobody noticed, a test command that runs nothing, a lint step
that cannot fail, and roughly a dozen documents describing a repo that stopped existing
when the contracts were deployed.

---

## 1. The two money bugs

Both come from the same root cause: **the vault borrow arithmetic was implemented
twice**, once in `apps/web/src/lib/vault.ts` and once inline in the iOS vault screen.

### 1.1 iOS over-quoted the maximum borrow — FIXED

`apps/ios/app/(tabs)/vault.tsx` computed its ceiling as:

```ts
maxNetDebtAt(collateralWei, price, MAREN_POLICY.minHealthyCr, BORROWING_RATE) - principalWei;
```

`maxNetDebtAt` sizes a trove being **opened**. Applied to a position that already
exists, it works from net principal and silently drops the interest accrued since.

On the shared 214-day fixture that over-quotes the maximum borrow by **~70 MUSD**, shows
a collateral ratio **1.5 points** too high, and puts the slider's advertised "180% floor"
stop at **179.3%** — below `MarenVault.MIN_BORROW_CR` (`1.8e18`), where the contract
reverts. The screen's own comment claimed "there is no arithmetic in this file that
touches a user's risk."

The web module's docstring names this exact mistake as the thing it exists to prevent.
Nobody had compared the two files.

### 1.2 `maxWithdrawable` breached the same floor on both platforms — FIXED

Found by writing the regression test for 1.1, not by reading. The web module — the copy
being treated as correct — had the identical omission on the withdraw path:

```ts
collateralRequiredFor(position.principalWei, priceWei, minHealthyCr, BORROWING_RATE);
```

That rebuilds total debt from **net** principal by adding the fee and the 200 MUSD gas
compensation, and likewise omits accrued interest. It quoted a maximum withdrawal that
left the position at **179.14%**.

**Fix for both:** the module is now `packages/sdk/src/borrow.ts`, imported by both apps,
against a structural `BorrowPosition` they already satisfy. `maxWithdrawable` reserves
against total debt on both routes — a withdrawal creates no new debt and so incurs no
origination fee on either. `pooledCollateralRequiredFor` is renamed
`collateralRequiredForTotalDebt`, which is what it always was; nothing outside the module
imported it. `apps/web/src/lib/vault.ts` is deleted.

13 tests in `packages/sdk/src/borrow.test.ts`, including one that asserts the naive
formula is _unsafe_ so the shortcut cannot come back quietly.

### 1.3 What was checked and found clean

Every other collateral-ratio, liquidation-price and formatting call site in both apps
imports from `@maren/sdk`. **Every SDK constant agrees with the deployed contracts**, and
that was confirmed against the live chain rather than the source:

```
cast call 0x46252B00AB59384518d9dB6D1f210ffF1221645b "LIQUIDATION_CR()(uint256)" → 1.4e18
cast call … "MIN_BORROW_CR()(uint256)" → 1.8e18
cast call … "MIN_DEPOSIT()(uint256)"   → 1e15
```

Design tokens are byte-identical between `apps/web/src/app/globals.css` and
`apps/ios/src/design/tokens.ts`, and both match `docs/BRAND.md`. No drift.

---

## 2. The deployment silently changed the web app's runtime behaviour

`resolveNetwork()` defaults to `testnet`. `dataMode()` returns `live` when
`isDeployed(getMarenAddresses(network).marenVault)`. Testnet addresses were written into
`packages/sdk/src/addresses.ts` on 15 August.

**Therefore `apps/web` now reads live from chain by default, and has since that commit.**

This is working exactly as designed — `source.ts` says the switch should flip with no
other edit, and it did. But:

- The "Demo data" banner, the pooled/direct account switcher, and the oracle-stall
  control are now unreachable on the default network. `apps/web/README.md` described
  those as the mechanism that keeps the app honest.
- `live.ts` — the read path users now hit — **has never been exercised end to end against
  the deployment.** `docs/DEPLOYMENTS.md` records contract-level calls made with `cast`,
  not app reads.
- Nothing in the deploy diff said any of this. Writing an address into a data file
  changed the product's behaviour.

Documented in `apps/web/README.md`, `source.ts`, and as a deploy-step warning in
`CONTRIBUTING.md`. **Not fixed, because there is nothing to fix** — the behaviour is
intended. The gap is verification, listed in §7.

A related instance of the same class: `apps/relayer/src/config.ts` carried a comment
asserting that an unconfigured relayer is safe _because_ `MAREN_ADDRESSES` is all zeroes.
It is not zero on testnet any more, so `buildTargets` now resolves a real allowlist from
the SDK with no operator input. The relayer still refuses — verified: with no key,
`buildKeySource` pushes to `problems` and `/relay` returns 503 — but for a different
reason than the comment claimed. **A safety property that depends on a data file being
empty is not a safety property** (R8). Comment corrected.

---

## 3. `pnpm contracts:test` ran zero tests and reported success

```
$ CI=true pnpm contracts:test
> pnpm --filter @maren/contracts test
No projects matched the filters in "…"
```

`packages/contracts` has **no `package.json`**, so pnpm cannot see it — the workspace
importers are only `.`, `apps/{ios,relayer,web}`, `packages/sdk`, `tools/pdf`. Both
`contracts:build` and `contracts:test` filtered on a project that does not exist. The
README told contributors to run `pnpm contracts:test`; it did nothing, quietly. Contracts
were only ever tested by the separate Foundry CI job.

This is R15's shape — a green result that did not do the work — applied to a build script.

**Fixed:** both scripts now invoke `forge` with `--root packages/contracts`, joined by
`contracts:fmt`. Verified: 236 tests. A `contracts:snapshot` script was drafted and
**dropped** because `forge snapshot --root` resolves `.gas-snapshot` against the wrong
directory; shipping it broken would have repeated the bug being fixed.

`packages/contracts` is deliberately left as a Foundry project rather than made into a
pnpm workspace — see §6.

---

## 4. What the checks do not check

CI is three well-built jobs and it is green. It is also weaker than it looks:

- **`pnpm lint` cannot fail.** There is no ESLint config anywhere in the repo.
  `apps/ios`, `apps/relayer` and `packages/sdk` define `lint` as `echo … && exit 0`;
  `apps/web` and `tools/pdf` define none at all, so `turbo run lint` skips them. The
  green "Lint" check in CI is structurally incapable of failing.
- **`pnpm test` never touches `apps/web`** — no test script, no test files. The largest
  TypeScript surface in the repo has zero automated coverage and nothing says so.
- **Without `anvil` on `PATH`, the relayer's chain tests skip rather than fail**, so a
  local `pnpm test` can be green having run strictly less than CI.
- **The `web` CI job runs the PDF build** as part of `pnpm build`, needing a Chrome the
  job never installs. It survives on `ubuntu-latest` happening to ship one; on the
  fallback path `tools/pdf/lib/browser.mjs` imports `puppeteer`, which is not a
  dependency (only `puppeteer-core` is). A latent failure, in a job named "Web + SDK".
- `apps/web/scripts/{screenshot,verify-behaviour,verify-contrast}.mjs` require
  `playwright-core`, which **no manifest declares**. Three a11y/contrast verifiers that
  cannot run on a clean install and that nothing invokes.

All documented in `CONTRIBUTING.md` under "What these commands do _not_ check". None
fixed — see §7.

---

## 5. Stale claims corrected

The contracts deployed on 15 August and roughly a dozen places still said otherwise.

| Where                                                       | Claimed                                                                                         | Reality                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/src/07-work-summary.md`                               | "The contracts are not deployed to any network… the single most important line in the document" | Deployed and verified on matsnet. This builds to a **PDF that goes to Mezo**. Rewritten, v1.0 → v1.1                    |
| `README.md`, `docs/ARCHITECTURE.md`                         | a `packages/ui` workspace                                                                       | Has never existed, on disk or in git                                                                                    |
| `README.md`, `ARCHITECTURE.md`, `packages/sdk/package.json` | `@maren/sdk` holds "ABIs" and "hooks"                                                           | It holds neither                                                                                                        |
| `docs/ARCHITECTURE.md` §5                                   | ABIs come from `@mezo-org/musd-contracts`, "never hand-transcribed"                             | That package is not a dependency and never was. The ABIs are 660 hand-written lines in `apps/web/src/lib/chain/abis.ts` |
| `apps/ios/README.md` ×2                                     | `MAREN_ADDRESSES` is all zeros                                                                  | Live on matsnet                                                                                                         |
| `apps/web/README.md`                                        | app "runs on mock data"                                                                         | Runs live by default                                                                                                    |
| `apps/relayer/README.md`, `src/config.ts`                   | zero address until deployment                                                                   | See §2                                                                                                                  |

The ABI claim is the one worth dwelling on: `ARCHITECTURE.md` cited R17 — _build from
deployed behaviour, not documentation_ — while asserting a provenance the repo does not
have. It is now recorded as a **known R17 deviation** rather than quietly deleted, because
the honest statement is that 660 lines of hand-transcribed ABI are unverified by any test.

`README.md` was rewritten to answer "what is this, what works today, how do I run it" and
links `docs/DEPLOYMENTS.md`. `CONTRIBUTING.md` is new.

---

## 6. Structure: what changed, and what deliberately did not

**Changed.** `docs/OUTREACH-REPLY.md` → `docs/research/` (it is a working draft, not a
peer of `ARCHITECTURE.md`; references updated). `.claude/` fully gitignored — only
`.claude/worktrees/` was, leaving `.claude/settings.local.json` untracked _and_ unignored,
one `git add -A` from being committed. Dead `*.sol` override removed from
`.prettierrc.json`: `sol` is absent from the format glob and no Solidity plugin is
installed, so it could never fire — `forge fmt` does that job. Stale
`scripts/shoot.mjs` reference in `apps/web/.gitignore` corrected to `screenshot.mjs`.

**Deliberately left alone**, with reasons:

- **The top-level layout.** `apps/*`, `packages/*`, `docs/`, `tools/` is already the
  right shape. Rearranging a working monorepo to satisfy an audit is churn.
- **`packages/contracts` as a non-workspace.** Adding a `package.json` would make it
  visible to pnpm and turbo, but it would also add a lockfile importer and put a Foundry
  project under a JS task graph that cannot build it. Fixing the root scripts (§3) gets
  the ergonomics without the fiction.
- **`packages/ui`.** Not created. The two apps need a CSS custom-property sheet and a
  React Native object; a shared package cannot express both without a build step, and the
  values currently agree exactly. `docs/BRAND.md` is the source of truth and
  `ARCHITECTURE.md` now says so.
- **The web/iOS naming split** (kebab-case vs PascalCase, `lib/chain/` vs `chain/`).
  Real inconsistency, but renaming ~30 files across two apps is a large diff with no
  behavioural benefit and a real chance of breaking Metro resolution. Listed in §7.
- **The 30 unused exports.** Several are deliberate documentation-as-code that the repo
  explicitly wants kept — `ERC4337_ENTRYPOINT_V07_INERT` exists, per its own comment,
  "ONLY so nobody rediscovers it and concludes 4337 is a viable path". Blanket removal
  would delete institutional knowledge. Needs a human pass, not a script.
- **`expo-auth-session` and `expo-constants`** in `apps/ios`, both provably unimported.
  Not removed: `pnpm --filter @maren/ios build` is only `tsc --noEmit`, so removal would
  pass CI while potentially breaking an Expo native build, which cannot be verified here.
- **The duplicated `copy.ts`, `price.ts`, and health-scale geometry** between apps. All
  currently agree numerically; none touches a money figure the SDK owns. Worth unifying,
  not worth risking in an audit pass.

---

## 7. Not fixed, in priority order

1. **Exercise `apps/web`'s live path against matsnet.** It is the default for every user
   and has never been run against the deployment. If `live.ts` has a bug, the default
   experience is broken. Highest priority by a distance.
2. **Give `apps/web` a test suite.** It is the biggest TypeScript surface in the repo and
   has zero coverage; `pnpm test` passes without ever loading it.
3. **Make `pnpm lint` capable of failing**, or delete the step and stop implying a check
   that does not exist. A green tick that cannot go red is worse than no tick.
4. **Fix `deleverage()` reporting success when it does nothing** — the live-run finding in
   `docs/DEPLOYMENTS.md`. It should revert when `pushed == 0`. A keeper currently cannot
   distinguish "no room" from "repay failed", and this is R15 in our own contract.
5. **Source ABIs from compiled artifacts** instead of the 660 hand-written lines, or at
   minimum add a test asserting each selector against `forge build` output (§5).
6. **Declare `playwright-core`** in `apps/web`, or delete the three scripts that need it.
   As it stands they are documented in the README and cannot run.
7. **Reconcile the iOS/web `Position` types.** `apps/web/src/lib/data/types.ts` states
   "Where the two differ, that is a bug"; they differ. iOS lacks `vaultMaxBorrowableWei`,
   so its pooled route cannot use `MarenVault.maxBorrowable` — the contract's own answer —
   and falls back to recomputing it.
8. **Unify the health vocabulary.** The same `HealthStatus` from the same `assessHealth`
   renders as amber "Caution" on web and neutral-grey "Adequate" on iOS. Same risk, two
   different signals to the user.
9. **Pin one TypeScript.** `apps/ios` is on `~6.0.3`; every other workspace is on `5.9.3`.
   The SDK is consumed as source, so it is compiled by two different majors.
10. **Give `apps/ios` a `@/` path alias.** 14+ `../../src/...` climbs that need not exist;
    no bundler limitation, just never configured.
11. **Round the drop-to-liquidation figure one way.** Two portfolio screens use
    `Math.floor(bps/100)`; the SDK's `formatPriceDrop` uses `toFixed(0)`. They disagree by
    a point, and `toFixed` rounds in the direction that overstates the buffer.
12. Align `lib` in the tsconfigs (`ES2023` in relayer, `ES2022`+`DOM` in the SDK, which
    has no DOM usage), and add `noUnusedLocals` to `apps/ios` and `packages/sdk`.
13. Add `yml`/`yaml` to the Prettier glob so `ci.yml` is format-checked.

---

## 8. Secret hygiene — verified clean

Checked rather than assumed, across tracked files only.

- **No private key, mnemonic, API key, or `.env` with real values is committed.** No
  `-----BEGIN`, no `AKIA`, no `sk_`/`pk_`, no bearer tokens. Both `.env.example` files
  have every credential slot **empty**.
- `packages/contracts/broadcast/**/run-*.json` contains only public addresses, tx hashes
  and deployment bytecode. Forge broadcast output carries no signing material by design,
  and there is no `privateKey` field in either file.
- `apps/relayer/test/fixtures/cast-wallet-keystore.json` is a real **encrypted** v3
  keystore whose password (`testpassword`) is published in the test beside it. It wraps
  **anvil's account #1** — a universally known key that can never hold funds. Publishing
  the password is correct here; a "secret" password in a public repo would be theatre.
- Every 64-hex-looking string in the tree is an anvil test key, an EIP-712 typehash, a
  mock tx hash, or a sentinel.
- `.claude/worktrees/` — **0 tracked files** (`git ls-files | grep -c '.claude'` → 0), 10
  worktrees present on disk, none deleted. They appear once in history as **gitlinks**
  (mode `160000`, a 20-byte SHA — no file content ever entered the object database) and
  were removed in the very next commit. No history rewrite needed.
- Every rule the gitignores claim was tested with `git check-ignore -v`. All hold. The
  seven committed PDFs in `docs/build/` are **intentionally** tracked through a
  three-layer allowlist, not force-added.
- CI references no `secrets.*` at all.

One operational note, not a leak: `packages/contracts/deployments/31611.json` has admin,
guardian and keeper all set to the deploying EOA. Correct for matsnet; `.env.example`
already flags that mainnet needs a multisig, and R9 requires a timelock at deploy time.

---

## 9. Verification

Baseline captured before any change, and re-run after. Both fully green.

```
CI=true pnpm install --frozen-lockfile   PASS
CI=true pnpm format:check                PASS
CI=true pnpm typecheck                   PASS
CI=true pnpm lint                        PASS  (see §4 — this cannot fail)
CI=true pnpm build                       PASS
CI=true pnpm test                        PASS
CI=true pnpm contracts:test              PASS  236 tests
CI=true pnpm docs:pdf                    PASS  7 PDFs
```

Plus, against live matsnet: `eth_chainId` → `0x7b7b` (31611), `MarenVault` bytecode
present, and the three risk constants read back off the deployed contract matching source.

Two things this audit learned the hard way, both worth keeping:

- **`pnpm test` does not typecheck.** The new SDK test suite passed under vitest while
  `tsc --noEmit` failed on it, because vitest strips types rather than checking them. A
  green `pnpm test` is not evidence the code compiles. Only running the whole sequence
  caught it.
- **One subagent reported the Foundry submodules as uninitialised and `forge` as
  unrunnable.** It was wrong — `git submodule status` showed both present and 236 tests
  had already passed. Every load-bearing claim in this document was re-checked directly
  before being written down, which is R17 applied to the audit itself.
