<div align="center">

# Maren Finance

**Spend Bitcoin. Never sell it.**

Built on [Mezo Chain](https://mezo.org).

</div>

---

## What this is

Maren is a consumer layer over Mezo's MUSD protocol, which lets Bitcoin holders borrow a
dollar stablecoin against BTC without selling it. It does three things the underlying
protocol does not: it pools collateral so the entry point is 0.001 BTC instead of the
0.079 BTC a solo trove needs, it pays BTC gas on the user's behalf so nobody has to hold
the asset they refused to sell, and it gives MUSD somewhere to be spent through payments
addressed to a `@handle` rather than a hex address.

Maren is pre-audit and deployed only to testnet. Do not use it with funds you cannot
afford to lose.

## Repository map

| Path                 | What it is               | Contents                                                                   |
| -------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `packages/contracts` | Foundry, Solidity 0.8.28 | `MarenVault`, `MarenPay`, `MarenRelayHub`, `MarenRegistry`, `MarenEarn`    |
| `packages/sdk`       | `@maren/sdk`, TypeScript | Chain config, verified addresses, position and borrow math, number formats |
| `apps/web`           | Next.js 15               | Landing page and the dApp. Reads live from matsnet                         |
| `apps/ios`           | Expo, expo-router        | iOS app. Runs on mock data, behind the interfaces the live reads will use  |
| `apps/relayer`       | Hono                     | ERC-2771 meta-transaction relayer that pays BTC gas                        |
| `tools/pdf`          | Node, puppeteer-core     | Builds `docs/src/*.md` into the branded PDFs in `docs/build`               |
| `tools/copy`         | Node                     | The em dash scanner that both app test suites and CI share                 |
| `tools/demo`         | Node, playwright-core    | Screen-records a walkthrough of the web app                                |

`packages/contracts` is a Foundry project rather than a pnpm workspace. It has no
`package.json`, so drive it with `forge` directly or with the `contracts:*` root scripts.

## Deployed on Mezo matsnet

Chain 31611. All five contracts are source-verified on Blockscout and have been exercised
on-chain against real MUSD. Deploy transactions, gas figures, and the two findings that
came out of running it are in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

| Contract        | Address                                      |
| --------------- | -------------------------------------------- |
| `MarenVault`    | `0x46252B00AB59384518d9dB6D1f210ffF1221645b` |
| `MarenPay`      | `0xe475Ff919D54E055809f516E3bed8a5c7a101836` |
| `MarenRelayHub` | `0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C` |
| `MarenRegistry` | `0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E` |
| `MarenEarn`     | `0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826` |

Those five are the authoritative copy in
[`packages/sdk/src/addresses.ts`](packages/sdk/src/addresses.ts), which is also where the
15 MUSD protocol addresses and the Mezo precompiles live. `MarenRelayHub` extends
`MarenForwarder` and is the single trusted forwarder, so the standalone `MarenForwarder`
is deliberately not deployed.

First Maren block on matsnet is `14,911,471`, derived by bisecting `eth_getCode` rather
than read off a deploy log. It is the floor for every log scan, which is what lets the
Activity view say "you have done nothing yet" without implying "we only looked at the
last few hours".

**Mainnet is not deployed.** The mainnet entries in `addresses.ts` are all zeroes and the
deployment block is `null`, which callers must handle as unavailable rather than empty.

### What is not done

- `apps/relayer` is not deployed to any host. `MarenRelayHub` is on matsnet and the other
  contracts trust it, but no service is submitting for it, so every action in the web app
  is paid for by the user's own wallet in BTC gas. The UI says so per action rather than
  claiming a sponsorship that is not running.
- No gasless meta-transaction has been sent through `MarenRelayHub` on chain.
- No user borrow has succeeded. The seeded pooled trove sits at 154% against a 180%
  floor, which is a parameter mistake in how it was seeded rather than a contract fault.
  `docs/DEPLOYMENTS.md` has the arithmetic.
- No `MarenEarn` Stability Pool deposit has been made.
- `apps/ios` is on mock data throughout.

## Networks

|                   | Chain ID | RPC                                 | Explorer                                                 |
| ----------------- | -------- | ----------------------------------- | -------------------------------------------------------- |
| Mainnet           | `31612`  | `https://jsonrpc-mezo.boar.network` | [explorer.mezo.org](https://explorer.mezo.org)           |
| Matsnet (testnet) | `31611`  | `https://rpc.test.mezo.org`         | [explorer.test.mezo.org](https://explorer.test.mezo.org) |

Native gas token is BTC with 18 decimals, because Mezo is an EVM chain and BTC is its gas
token.

Several official Mezo doc pages list RPC hosts that do not resolve (`rpc.mezo.org`,
`testnet-rpc.mezo.org`). The endpoints above were verified live with `cast chain-id`.
Re-verify before changing them.

## Running it

Requires Node >= 22, pnpm 10, and [Foundry](https://getfoundry.sh) for contract work.
Chrome is needed only for the document build.

```bash
git submodule update --init --recursive   # forge-std and openzeppelin-contracts
CI=true pnpm install --frozen-lockfile
cp .env.example .env                      # then fill in the values
```

**Always prefix pnpm with `CI=true`.** Without it pnpm can stop on an interactive prompt
that never renders in a non-TTY, and it looks exactly like a network hang.

| Part       | Command                                                          |
| ---------- | ---------------------------------------------------------------- |
| Everything | `CI=true pnpm dev`                                               |
| Web        | `CI=true pnpm --filter @maren/web dev` on `:3000`                |
| iOS        | `CI=true pnpm --filter @maren/ios start`, then `i` for Simulator |
| Relayer    | `CI=true pnpm --filter @maren/relayer dev`                       |
| Contracts  | `forge build --sizes` inside `packages/contracts`                |
| Documents  | `CI=true pnpm docs:pdf` builds eleven PDFs into `docs/build`     |

The iOS app runs `start`, not `dev`, so a root `pnpm dev` does not launch Expo.

## Tests

```bash
CI=true pnpm test                        # 345 tests across the four TypeScript workspaces
CI=true pnpm --filter @maren/sdk test    #  62  position, borrow and format math
CI=true pnpm --filter @maren/web test    #  36  revert decoding, preflight, em dash guard
CI=true pnpm --filter @maren/ios test    #  33  keystore security, em dash guard
CI=true pnpm --filter @maren/relayer test #  214 signature, policy, budget, nonce, RPC

CI=true pnpm contracts:test              # 236 passed, 8 skipped
node tools/copy/em-dash-scan.mjs         # no em dash in any user-visible string
```

The 8 skipped contract tests are the fork suite in `test/fork/`. They skip rather than
fail when no RPC is configured, because a flaky public testnet should not be able to break
the build. Run them deliberately, from `packages/contracts`:

```bash
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*' -vv
```

That suite is where the assumptions a mock can get wrong are settled against deployed
bytecode: the exact borrowing fee, whether trove debt includes gas compensation, and
whether a contract is allowed to own a trove at all.

The relayer's chain tests need `anvil` on `PATH`. Without it they skip silently, and a
silent skip reads exactly like a pass, which is why the expected count is written down
above.

Three suites are not part of `pnpm test` because they need a running build and a live
chain. They live in `apps/web/scripts` and are documented in
[`apps/web/README.md`](apps/web/README.md):

```bash
node scripts/verify-behaviour.mjs   # 87 checks: accessibility, empty states, preflight, 390px overflow
node scripts/prove-preflight.mjs    # 36 checks: the disabled borrow, against the live chain
node scripts/verify-contrast.mjs    # worst-case contrast against what is actually painted
```

The full sequence CI runs, and how to run each gate locally, is documented in the header
of [`.github/workflows/ci.yml`](.github/workflows/ci.yml). On a pull request only the
areas that changed are exercised; every push to `main` runs all of it.

Two slower gates run nightly instead, in
[`.github/workflows/ci-nightly.yml`](.github/workflows/ci-nightly.yml): the fork suite
against live matsnet, so a change to Mezo's deployed bytecode surfaces as a morning
failure rather than as a surprise during a deployment, and an 88% line-coverage floor on
`MarenVault`.

## How this repository treats facts

**Every number a user sees is read from the chain.** There is no mock mode in the web app
and no fixture behind a figure that claims to be live. Collateral ratios, liquidation
prices, borrow ceilings, and balances are computed in `@maren/sdk` from values fetched at
render time. If a read fails, the UI says so rather than showing a stale or invented
number, and the Activity view distinguishes "still scanning" from "nothing here" from
"not connected".

**Nothing that cannot succeed is ever offered, and nothing doomed is ever signed.** Two
defences, and they are not redundant. `lib/chain/preflight.ts` re-evaluates every
condition the contract will check, in the contract's order, against state read at render,
and each check names the line of `MarenVault.sol` it stands in for. Where one fails the
control is disabled and the reason is stated beside it, built from the arguments the
revert itself would have carried. Then `simulateThenSign()` in `lib/chain/write.ts` runs
`simulateContract` at the moment of the press, so a call that would revert against current
state throws before the wallet ever opens.

That module exists because of one transaction: a borrow was offered, signed, and paid for
against a pool that could not have served it at any amount, and the app had already read
and rendered the number that made it impossible. `prove-preflight.mjs` measures the fix
rather than asserting it. It installs a signer that records every signing attempt and
throws, then reads the account nonce from the chain before and after the run to show
nothing was submitted.

**Chain constants are read from bytecode, not from documentation.** Chain IDs, contract
addresses, and protocol parameters here were read live from Mezo RPCs and cross-checked
against the `mezo-org/musd` deployment artifacts and the OpenZeppelin proxy manifest.
Where Mezo's published docs contradict the deployed bytecode, this repository follows the
bytecode and records the discrepancy in
[`packages/sdk/src/constants.ts`](packages/sdk/src/constants.ts).

Do not add an address to this repository that you have not verified with `cast`.

## Documentation

| Document                                                                 | What it covers                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                     | Each workspace, the full check sequence, deploying    |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                           | The technical case, contract by contract              |
| [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)                             | Live addresses, tx hashes, findings from the run      |
| [`docs/BRAND.md`](docs/BRAND.md)                                         | Design system, the source of truth for both apps      |
| [`docs/research/SECURITY-LESSONS.md`](docs/research/SECURITY-LESSONS.md) | R1 to R17, the review criteria a PR must satisfy      |
| [`docs/research/CODEBASE-AUDIT.md`](docs/research/CODEBASE-AUDIT.md)     | Structural audit: what is clean, what is not          |
| `docs/src/*.md`                                                          | The eleven documents that build to `docs/build/*.pdf` |

The PDFs in `docs/build` are committed so they can be read without a local toolchain.

## Security

`MarenVault` and `MarenRelayHub` carry the protocol's risk and are the audit scope.

The relayer key is a liveness dependency, not a custody one. Whoever holds it can censor
or reorder Maren meta-transactions and can waste its own BTC. It cannot move user funds,
because every value transfer downstream is a `transferFrom` under the user's own
authorisation.

Report vulnerabilities privately, not through a public issue. [`SECURITY.md`](SECURITY.md)
has the contact address, what is in scope, and what response times to expect. It also
states plainly which contracts hold user funds and are unaudited.

## Licence

MIT, as it has been since the first commit. See [`LICENSE`](LICENSE). Every contract
carries a matching `SPDX-License-Identifier: MIT` header, and the deployed sources are
publicly verified on Blockscout under the same terms.
