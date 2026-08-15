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
```

Path alias `@/*` → `./src/*`. Components are **kebab-case**. There is **no test suite**
— the largest TypeScript surface in the repo has no automated coverage, and `pnpm test`
will not tell you so. Weigh that when reviewing a change here.

`src/lib/data/source.ts` is the only place the mock/live decision is made. It flips on
`isDeployed(marenVault)` for the configured network, so **matsnet now runs live by
default** and mainnet still runs on mock data.

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
CI=true pnpm contracts:test          # forge test — 236 tests
CI=true pnpm contracts:build         # forge build --sizes
CI=true pnpm contracts:fmt           # forge fmt --check
```

Submodules must be present: `git submodule update --init --recursive`.

### `tools/pdf` — the document builder

```bash
CI=true pnpm docs:pdf                # docs/src/*.md -> docs/build/*.pdf (seven)
CI=true pnpm docs:preview
```

Needs a real Chrome. Set `MAREN_PDF_CHROME` if it is not on a standard path. The seven
PDFs are **committed intentionally** so reviewers can read them without a toolchain.

---

## The full check, before you push

Run these in order. This is exactly what CI runs, plus the contract suite.

```bash
CI=true pnpm install --frozen-lockfile
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm lint
CI=true pnpm build
CI=true pnpm test
CI=true pnpm contracts:test    # expect 236 passing
CI=true pnpm docs:pdf          # expect seven PDFs
```

`pnpm format` rewrites; `pnpm format:check` only reports.

### What these commands do _not_ check

Be honest with yourself about the gaps rather than trusting a green run:

- **`pnpm lint` cannot fail.** There is no ESLint config in the repo. Three workspaces
  define `lint` as an `echo … && exit 0` stub and two define none at all, so
  `turbo run lint` is a no-op everywhere. A green "Lint" step means nothing.
- **`pnpm test` does not touch `apps/web`.** No test script, no tests.
- **`pnpm build` runs the PDF build**, which needs Chrome. In CI this works only because
  the runner image happens to ship one.
- Without `anvil`, the relayer's chain tests skip rather than fail.

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
2. Write the addresses into `packages/sdk/src/addresses.ts`. **This is a behavioural
   change, not bookkeeping** — `apps/web` switches from mock data to live reads the
   moment `isDeployed()` turns true for a network. Say so in the PR.
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
