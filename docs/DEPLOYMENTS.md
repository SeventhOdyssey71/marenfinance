# Deployments

Every address, transaction hash and block number in this file is copied from real command
output. Nothing here is predicted, reconstructed, or filled in from a plan — where a step has
not happened, this file says so in those words rather than leaving a plausible-looking blank.

---

## Mezo matsnet — chain 31611

| | |
|---|---|
| Chain ID | `31611` |
| RPC | `https://rpc.test.mezo.org` |
| Explorer | `https://explorer.test.mezo.org` |
| Blockscout API | `https://api.explorer.test.mezo.org/api` |
| Native gas token | BTC, 18 decimals |
| Status | **NOT DEPLOYED — blocked on deployer funding.** See "Blocked" below. |

### Deployer

```
0x54196397D6f01b48739dB3957257cB33cD341885
```

Freshly generated with `cast wallet new` for this deployment and used for nothing else. The
private key is held in a password-protected `cast` keystore named `maren-deployer`, outside the
repository. It has never been written to a tracked file. Balance at the time of writing: `0`.

### Contract addresses

**Not yet deployed.** The dry run below predicts the addresses that *would* result, but they are
a function of the deployer's nonce at broadcast time and are therefore not committed here and
not written into `packages/sdk/src/addresses.ts`. `MAREN_ADDRESSES.testnet` still holds zero
addresses, which is the honest value until a broadcast happens.

| Contract | Address | Tx hash | Block |
|---|---|---|---|
| `MarenRelayHub` | not deployed | — | — |
| `MarenRegistry` | not deployed | — | — |
| `MarenPay` | not deployed | — | — |
| `MarenVault` | not deployed | — | — |
| `MarenEarn` | not deployed | — | — |

### Verification

Not performed — there is nothing deployed to verify.

---

## What has been done

### Environment

The worktree's git submodules were uninitialised. Both are now checked out at exactly the
commits pinned in `packages/contracts/README.md`:

```
77041d2ce690e692d6e03cc812b57d1ddaa4d505  lib/forge-std              (v1.9.7)
c64a1edb67b6e3f4a15cca8909c9482ad33a02b0  lib/openzeppelin-contracts (v5.4.0)
```

foundry `1.4.3-stable` (commit `fa9f934`).

### MUSD protocol addresses, re-verified live

Every address the deploy script depends on was re-checked against matsnet rather than trusted
from the source constants. Read at block ~14,908,690 on 2026-08-15:

| Contract | Address | Live check |
|---|---|---|
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `symbol()` → `"MUSD"`, `decimals()` → `18`, 6,437 B of code |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `minNetDebt()` → `1.8e21`, `musd()` → the MUSD address above |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | `MCR()` → `1.1e18`, `CCR()` → `1.5e18`, `getTroveOwnersCount()` → `229` |
| StabilityPool | `0x1CCA7E410eE41739792eA0A24e00349Dd247680e` | `getTotalMUSDDeposits()` → `8.623e25` (86.2M MUSD) |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | `fetchPrice()` → `62970150000000000000000` ($62,970.15/BTC) |
| SortedTroves | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | `getSize()` → `229` |
| HintHelpers | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` | 1,159 B of code (proxy) |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 B of code |
| Oracle precompile | `0x7b7c000000000000000000000000000000000015` | `latestRoundData()` answers; `decimals()` → `18` |

Note that `PriceFeed.fetchPrice()` **succeeds** against the live chain. It is only under
`forge`'s EVM that the underlying Skip Connect precompile cannot be replayed — see the fork-test
note in `packages/contracts/README.md`.

### Pre-flight

```bash
cd packages/contracts
forge build --sizes
forge test          # MEZO_TESTNET_RPC_URL set, so the fork suite runs too
```

All five deployable contracts are under the 24,576 B EIP-170 limit:

| Contract | Runtime size (B) | Margin (B) |
|---|---|---|
| `MarenVault` | 14,508 | 10,068 |
| `MarenEarn` | 11,396 | 13,180 |
| `MarenPay` | 9,264 | 15,312 |
| `MarenRelayHub` | 7,934 | 16,642 |
| `MarenRegistry` | 4,742 | 19,834 |

```
Ran 10 test suites in 115.06s: 244 tests passed, 0 failed, 0 skipped (244 total tests)
```

That total includes the 8 fork tests executing against **live matsnet** contracts, not mocks:

```
Ran 8 tests for test/fork/MarenVault.fork.t.sol:MarenVaultForkTest
[PASS] test_fork_exitsStayOpenWhileEntriesArePaused()
[PASS] test_fork_fullLifecycle()
[PASS] test_fork_maxBorrowingCapacityIsFrozenUntilRefinance()
[PASS] test_fork_priceFeedReadsTheInjectedOracle()
[PASS] test_fork_protocolParametersAreWhatWeAssume()
[PASS] test_fork_staleOracleSurfacesAsNamedError()
[PASS] test_fork_subMinimumHolderIsRejectedByTheRealProtocol()
[PASS] test_fork_troveDebtIncludesGasCompensation()
Suite result: ok. 8 passed; 0 failed; 0 skipped; finished in 115.05s
```

### Dry run — simulated cleanly

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url mezo_testnet \
  --sender 0x54196397D6f01b48739dB3957257cB33cD341885
```

```
Script ran successfully.

== Logs ==
  {"admin":"0x54196397D6f01b48739dB3957257cB33cD341885","chainId":31611,
   "guardian":"0x54196397D6f01b48739dB3957257cB33cD341885",
   "keeper":"0x54196397D6f01b48739dB3957257cB33cD341885",
   "marenEarn":"0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826",
   "marenPay":"0xe475Ff919D54E055809f516E3bed8a5c7a101836",
   "marenRegistry":"0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E",
   "marenRelayHub":"0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C",
   "marenVault":"0x46252B00AB59384518d9dB6D1f210ffF1221645b"}

Chain 31611
Estimated gas price: 0.000000261 gwei
Estimated total gas used for script: 15282232
Estimated amount required: 0.000000003988662552 ETH

SIMULATION COMPLETE.
```

Those addresses are **simulation output, not deployments.** They hold only if the deployer
broadcasts from nonce 0. They are recorded here as evidence the script runs, and must be
replaced with observed addresses after a real broadcast.

Because `MAREN_ADMIN` / `MAREN_KEEPER` / `MAREN_GUARDIAN` were left unset, all three defaulted
to the broadcaster, which puts the script on its `admin == broadcaster` branch — so a real run
would also grant `KEEPER_ROLE` and `GUARDIAN_ROLE` and seed the relay allowlist in the same
transaction batch. That is the intended testnet shape. It is **not** acceptable for mainnet,
where `MAREN_ADMIN` must be a multisig.

**Gas is the one thing that is not a constraint here.** The estimate is
`0.000000003988662552 BTC` — about 4 nano-BTC — because matsnet's gas price is 146 wei
(base fee 130 wei). A single 0.001 BTC faucet drip covers the entire five-contract deployment
roughly 250,000 times over.

---

## Blocked

### 1. Deployer funding — blocks the deployment itself

The deployer holds `0` BTC and the matsnet faucet cannot be driven from here.

The faucet is `https://faucet.test.mezo.org/`. Its source is public, in `mezo-org/mezod` under
`infrastructure/cloudflare/faucet/`, so this is read off the implementation rather than inferred
from behaviour. It is a Cloudflare Worker with exactly two routes:

- `POST /` — the public one. `multipart/form-data` with `address`, `token`, and
  `cf-turnstile-response`. The worker forwards that token to Cloudflare's
  `siteverify` endpoint together with its own secret and the caller's IP, and refuses the
  request if it does not pass. **A CAPTCHA verified server-side cannot be satisfied by a
  scripted client.** There is no wallet-connect and no social login — the captcha is the whole
  gate.
- `POST /internal` — takes `Authorization: Basic <API_KEY>` and a JSON body. `API_KEY` is a
  Mezo-held Cloudflare Worker secret. There is no public way to obtain it.

Dispense rate, from the committed `wrangler.toml`: `AMOUNT_BTC = "0.001"`,
`REQUEST_DELAY_SECONDS = "86400"`. The rate-limit key is `rate-limiter:${ip}:${token}` — keyed
on **client IP, not destination address**, so generating fresh addresses does not reset it.

**What is needed:** a human sends testnet BTC to
`0x54196397D6f01b48739dB3957257cB33cD341885`, either through the faucet in a browser or from an
existing funded matsnet account.

### 2. Pooled trove seeding — blocked independently, and not by anything fixable here

This one does not go away by asking the faucet more times. It is arithmetic.

`BorrowerOperations.minNetDebt()` is `1800e18`, and the protocol adds 200 MUSD of gas
compensation, so the smallest possible trove carries 2,000 MUSD of debt. At the live
`fetchPrice()` of $62,970.15/BTC:

| Collateral ratio | BTC required | Faucet drips (0.001 BTC/day) |
|---|---|---|
| 110% (protocol floor — would be liquidated immediately) | ~0.0349 BTC | ~35 |
| 180% (Maren's own borrow floor) | ~0.0572 BTC | ~58 |
| 250% (responsible, per the README) | ~0.0794 BTC | ~80 |

So opening the pooled trove needs on the order of **0.08 BTC**, which is roughly **80 days** of
faucet output from a single IP.

There is no alternative source of testnet MUSD. Mezo's own x402 quickstart states it plainly:
MUSD on testnet is *"minted, not faucet-dispensed, you borrow it against testnet BTC."* So MUSD
is downstream of the same BTC constraint.

**Consequence for the end-to-end cycle.** With funding at the 0.001–0.01 BTC scale, these steps
are reachable and these are not:

Reachable:
- `MarenRegistry` `commit` → `register` (a handle costs only gas)
- `MarenVault.deposit()` — deliberately does not require an open trove; collateral is credited
  and held as `idleCollateral`. Needs `MIN_DEPOSIT` = exactly 0.001 BTC, plus gas
- `MarenVault.withdraw()`
- A genuinely gasless meta-transaction through `MarenRelayHub.execute` — relaying an
  allowlisted `MarenRegistry` call, signed by a user holding zero BTC. This exercises the
  ERC-2771 path, the allowlist, and `_msgSender()` recovery for real

Not reachable without ~0.08 BTC:
- `openPooledTrove` — needs 2,000 MUSD of debt
- `borrow` — reverts with `TroveNotOpen()` until the above happens
- A gasless **MUSD payment** through `MarenPay` — needs MUSD, which needs the borrow
- `repay`

---

## Reproducing this

```bash
git submodule update --init --recursive

cd packages/contracts
cp .env.example .env      # then set MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org

forge build --sizes
forge test

# Dry run — no key needed
forge script script/Deploy.s.sol --rpc-url mezo_testnet --sender <deployer>

# Broadcast. Note there is deliberately NO [etherscan] table in foundry.toml:
# foundry 1.4.3 resolves it against a built-in chain list that does not contain Mezo, and
# ANY entry naming 31611/31612 makes `forge script` fail with "Chain 31611 not supported"
# before it does anything. The verifier goes on the command line instead.
cast wallet import maren-deployer --interactive

forge script script/Deploy.s.sol \
  --rpc-url mezo_testnet --broadcast --account maren-deployer \
  --verify --verifier blockscout \
  --verifier-url https://api.explorer.test.mezo.org/api
```

Note the `api.` subdomain on the verifier URL — `explorer.test.mezo.org/api` without it 404s.
