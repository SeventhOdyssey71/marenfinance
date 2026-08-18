# Contributing to Maren

Maren handles people's Bitcoin. The conventions below exist because getting them wrong
costs somebody money, not because they are tidy.

---

## Before anything: `CI=true`

**Prefix every pnpm command with `CI=true`.**

```bash
CI=true pnpm install --frozen-lockfile
```

Without it, pnpm can stop on an interactive confirmation that never renders in a
non-TTY — a CI runner, a container, an agent, a piped shell. There is no prompt on
screen and no error. The install simply sits there, and **it looks exactly like a
network hang**, so the usual reaction is to kill it and retry on a different network,
which does not help. `CI=true` makes pnpm answer its own prompts and fail loudly
instead of waiting.

The same applies to `pnpm build`, `pnpm test`, and `pnpm docs:pdf`.

---

## Prerequisites

| Tool                             | Version   | Needed for                              |
| -------------------------------- | --------- | --------------------------------------- |
| Node                             | `>=22`    | everything                              |
| pnpm                             | `10.19.0` | everything (pinned in `packageManager`) |
| [Foundry](https://getfoundry.sh) | stable    | contracts, **and the relayer tests**    |
| Chrome / Chromium                | any       | `pnpm docs:pdf`                         |
| Xcode + iOS simulator            | current   | `apps/ios`                              |

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

**Install Foundry even if you never touch Solidity.** `apps/relayer`'s chain tests need
`anvil`. Without it on your `PATH` they _skip silently_, `pnpm test` goes green, and you
have run strictly less than CI does. This is the single most common way to be surprised
by a red build after a green local run.

---

## The workspaces

pnpm workspaces are `apps/*`, `packages/*`, and `tools/*`. `packages/contracts` is a
**Foundry project, not a pnpm workspace** — it has no `package.json` and pnpm cannot see
it. Drive it through the `contracts:*` root scripts.

### `apps/web` — Next.js 15, the landing page and the dApp

```bash
CI=true pnpm --filter @maren/web dev        # :3000
CI=true pnpm --filter @maren/web build
CI=true pnpm --filter @maren/web typecheck
CI=true pnpm --filter @maren/web test       # 36 cases, all offline
```

Path alias `@/*` → `./src/*`. Components are **kebab-case**. The vitest suite is
deliberately narrow: `chain/errors.test.ts` covers the revert decoder,
`chain/preflight.test.ts` covers the rules that decide whether a write is even offered,
and `lib/em-dash.test.ts` guards the copy. Nothing rendered is asserted there. The
behavioural surface is covered instead by `scripts/verify-behaviour.mjs`, which drives a
real build against matsnet; it is not wired into `pnpm test` and will not run unless you
run it. Weigh that when reviewing a change here.

`src/lib/data/source.ts` is the only place chain reads are wired to React, and **it reads
the chain or reports that it cannot — there is no mock**. `src/lib/data/mock.ts` and its
demo-control store were deleted: they seeded handles, amounts and transaction hashes that
Activity rendered as working explorer links. Do not reintroduce a fixture that a screen
can render as though it came from the chain.

### `apps/ios` — Expo

```bash
CI=true pnpm --filter @maren/ios start      # Expo dev server; `i` for the simulator
CI=true pnpm --filter @maren/ios typecheck
CI=true pnpm --filter @maren/ios test
```

Routes live in `app/` (expo-router's convention, outside `src/`). Components are
**PascalCase** and flat in `src/components/`. There is no `@/` alias here, so imports
climb `../../src/...`. Note the script is `start`, not `dev`, so `pnpm dev` at the root
skips this workspace.

### `apps/relayer` — Hono, the gasless meta-transaction relayer

```bash
CI=true pnpm --filter @maren/relayer dev
CI=true pnpm --filter @maren/relayer test   # needs anvil on PATH
```

`"type": "module"` with real Node ESM, so **relative imports carry a `.js` extension**
(`./config.js`) even though the source is `.ts`. That is correct here and wrong in the
other two apps.

The relayer holds a hot key. It never holds user funds, it is never an owner or
approver, and it fails closed: if config is incomplete it still boots so `/health` can
explain itself, but `POST /relay` returns 503 and nothing is signed.

### `packages/sdk` — `@maren/sdk`, the source of truth

```bash
CI=true pnpm --filter @maren/sdk test
```

Consumed **as TypeScript source**, not built — `next.config.ts` transpiles it and Metro
resolves it through symlinks.

**Every collateral ratio, liquidation price, borrow ceiling, and number format lives
here.** If you find yourself writing `(collateral * price) / debt`, or a `toFixed`, or a
`/ 1e18` in an app, stop: import it instead. Two implementations of the same money
figure will drift, and when they drift one of them is lying to a user about their
liquidation risk. This has already happened once — see `src/borrow.ts` and the
regression tests in `src/borrow.test.ts`.

### `packages/contracts` — Foundry

```bash
CI=true pnpm contracts:test          # forge test — 236 passing, 8 skipped
CI=true pnpm contracts:build         # forge build --sizes
CI=true pnpm contracts:fmt           # forge fmt --check
```

Submodules must be present: `git submodule update --init --recursive`.

The eight skipped tests are the fork suite. They run against the real MUSD deployment and
are the only place the protocol assumptions are checked against deployed bytecode rather
than a mock:

```bash
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*' -vv
```

### `tools/pdf` — the document builder

```bash
CI=true pnpm docs:pdf                # docs/src/*.md -> docs/build/*.pdf (eleven)
CI=true pnpm docs:preview
CI=true pnpm docs:stamp              # refresh docs/src/live.json from both chains
```

Needs a real Chrome. Set `MAREN_PDF_CHROME` if it is not on a standard path. The eleven
PDFs are **committed intentionally** so reviewers can read them without a toolchain.

The PDF build is deliberately _not_ wired into `turbo run build`. Its package scripts are
named `docs:pdf` and `docs:preview` rather than `build`, so a root `pnpm build` never
needs a browser and never rebuilds eleven documents to check that TypeScript compiles.

### Numbers that rot

Some documents quote live chain figures: the mainnet trove count and BTC price in
`01-thesis.md`, the matsnet pooled trove's collateral, debt, and ICR in `progress.md`.
`pnpm docs:stamp` reads all of them and writes `docs/src/live.json`, printing what moved
since the last run.

It does **not** rewrite prose, on purpose. "Mezo mainnet carries 27 troves. Not 27
thousand. Twenty-seven." cannot be updated by a regular expression, and an argument built
on a number deserves a human re-reading it when the number moves. The script exists so
checking costs one command rather than six `cast` calls.

Before sending documents to anyone who will verify the figures:

```bash
CI=true pnpm docs:stamp                      # read the chains, see what drifted
# fix any prose the diff shows is now wrong, by hand
DOCS_REQUIRE_FRESH=1 CI=true pnpm docs:pdf   # refuses if live.json is over 24h old
```

`DOCS_REQUIRE_FRESH` is off by default so an offline or air-gapped build never breaks.

---

## The full check, before you push

Run these in order. This is exactly what CI runs. The authoritative copy of the sequence
is the header comment in `.github/workflows/ci.yml`, which is kept in step with it.

```bash
CI=true pnpm install --frozen-lockfile
node tools/copy/em-dash-scan.mjs
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm lint
CI=true pnpm build
CI=true pnpm test              # expect 345 passing
CI=true pnpm contracts:test    # expect 236 passing, 8 skipped
CI=true pnpm docs:pdf          # expect eleven PDFs
```

Inside `packages/contracts`, CI additionally runs the gas snapshot and coverage:

```bash
forge snapshot --check --tolerance 5 \
  --no-match-contract "MarenVaultInvariantTest|MarenVaultForkTest"
forge coverage --report summary --ir-minimum
```

The exclusions are not cosmetic. The fork suite is skipped without an RPC, and foundry
records an invariant run descriptor rather than a gas figure, so `--check` reported a
drift on every run for both. A warning that always fires is a warning nobody reads.

Coverage compiles via-IR with the optimizer off, which is a different pipeline from
`forge test`. It is a real gate, not `|| true`: it has already caught two tests that
passed only under the legacy pipeline because they re-read `block.timestamp` after a
`vm.warp` instead of snapshotting the expected revert payload before it.

`pnpm format` rewrites; `pnpm format:check` only reports.

### What these commands do _not_ check

Be honest with yourself about the gaps rather than trusting a green run:

- **`pnpm lint` is nearly a no-op.** Only `apps/ios` has a real config (`expo lint` over
  `eslint-config-expo`). `packages/sdk` and `apps/relayer` define `lint` as an
  `echo … && exit 0` stub, and `apps/web` defines none at all. A green "Lint" step says
  almost nothing about the web app.
- **`pnpm test` does not run the behavioural suite.** `apps/web`'s 36 vitest cases cover
  revert decoding and the preflight rules offline. The 87 checks in
  `scripts/verify-behaviour.mjs` and the 36 in `scripts/prove-preflight.mjs` need a
  running build and a live chain, and CI does not run either.
- Without `anvil`, the relayer's chain tests skip rather than fail.
- The eight fork tests skip without `MEZO_TESTNET_RPC_URL`. Run them before changing
  anything that touches the MUSD interfaces.

### What the nightly checks instead

Two gates live in `.github/workflows/ci-nightly.yml` rather than on the pull-request
path, and both run on a laptop:

```bash
cd packages/contracts
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*' -vv
forge coverage --report lcov --ir-minimum   # then read src/MarenVault.sol out of lcov.info
```

The fork suite talks to a live public RPC, so putting it on the merge path would let a
Mezo outage block a Maren merge. Not running it at all is worse: Mezo has shipped
divergences between its documentation and its deployed bytecode before, and `MarenVault`
is written against that bytecode. Nightly turns protocol drift into a failure waiting in
the morning instead of a discovery made mid-deployment.

The coverage floor is 88% of lines on `src/MarenVault.sol`, against a measured 90.9%
(399/439). It is nightly because `--ir-minimum` is slow, and the floor sits below the
real figure on purpose: a floor set at today's number goes red on the first refactor that
adds a line, and a gate that fails for a non-reason gets switched off.

A green nightly does **not** prove the fork suite ran. It skips every test when the RPC
is unreachable, which is what stops a flaky night paging anyone. Read the pass/skip
counts in the log before concluding anything from a green tick.

---

## Deploying

Contracts deploy with `packages/contracts/script/Deploy.s.sol`. Never put a key in an
env var or a file:

```bash
cast wallet import maren-deployer --interactive     # once
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.test.mezo.org \
  --account maren-deployer \
  --broadcast --verify \
  --verifier blockscout \
  --verifier-url https://api.explorer.test.mezo.org/api
```

Then, in order:

1. Record addresses, tx hashes, and runtime byte sizes in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).
2. Write the addresses into `packages/sdk/src/addresses.ts`, and the deployment block
   into `MAREN_DEPLOYMENT_BLOCK` beside them — derive it by bisecting `eth_getCode`
   rather than copying it out of a deploy log. **This is a behavioural change, not
   bookkeeping**: `apps/web` starts reading that network, and Activity uses the
   deployment block to decide whether an empty history is a fact or only a recent
   slice. Say so in the PR.
3. Verify each address with `cast` before committing it. Read a constant back off the
   deployed bytecode and check it against the source, rather than trusting the receipt.
4. Commit the `broadcast/` artifacts. They carry the tx hashes and contain no key
   material.

`MarenForwarder` is deliberately not deployed: `MarenRelayHub` extends it and is the
single trusted forwarder. Trusting two forwarders would give an attacker two doors.

**Mainnet requires an audit first**, and the admin/guardian/keeper roles must be a
multisig behind a timelock at deploy time — not "before launch". See R9.

---

## Review conventions

[`docs/research/SECURITY-LESSONS.md`](docs/research/SECURITY-LESSONS.md) is not
background reading. R1–R17 are drawn from an audit of this author's previous product
that found 7 Critical and 13 High issues, and **a pull request that violates one of them
does not merge.** The ones that catch the most PRs:

- **R8 — gates fail closed.** Every flag, pause, and allowlist defaults to denied. A
  missing or malformed env var must never widen access. Test the unset case.
- **R15 — a transaction hash is not success.** Only an on-chain receipt with
  `status === 'success'` is a delivered payment, and that check lives in one shared place.
- **R16 — prefer an explicit typed failure over a silent fallback.** A fallback that
  costs money is opt-in and logged.
- **R17 — build from deployed behaviour, not documentation.** Read chain facts with
  `cast`. Where Mezo's docs and its bytecode disagree, follow the bytecode and record it.

Beyond those:

- **State what you verified, not what you believe.** The PR template asks for pasted
  command output. Paste it. "Should work" is not a verification.
- **Import money math from `@maren/sdk`.** A local reimplementation of a ratio, a
  liquidation price, or a number format is treated as a bug in review, even when the
  numbers currently agree — agreeing today is not the same as agreeing after the next
  parameter change.
- **If you remove something, prove nothing imported it** and put the proof in the PR.
- **Say what is not done.** A component described as finished because the hard part is
  finished is how a half-verified thing reaches production.
- Commits use `type(scope): summary`. No `Co-Authored-By` trailers.
- User-facing UI changes need a screenshot.

Fill in [`.github/pull_request_template.md`](.github/pull_request_template.md) honestly,
including the Risk section. "None" is a valid answer only if you mean it.
