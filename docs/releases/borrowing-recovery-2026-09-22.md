# Borrowing recovery — 22 September 2026

## Incident and diagnosis

The deployed Mezo testnet pool could not draw new MUSD because accrued debt exceeded its fixed borrowing ceiling. At the incident snapshot, debt was approximately 2,749.55 MUSD, the ceiling was 2,749.20 MUSD, and `reserveMUSD()` was zero. Adding collateral alone does not reset that ceiling. The relayer correctly refused to sponsor the reverting borrow.

The existing vault exposes `refinancePooledTrove`. Simulation with its current sorted-list neighbours succeeded at approximately 424,734 gas, versus 1,126,838 using zero hints. The existing and current global interest rates were both 1%; the proposed repair would not increase that rate at observation time.

The keeper refinance is now **confirmed on public testnet** in block **15,695,381**, transaction `0x163e5f3d662c4e5af12432923437502e38e498ea7dbc6e1fa10ee29f964986c7`. The ceiling increased from **2,749.201745 to 5,348.046164 MUSD**, and the rate remained **1%**. A relayed **10 MUSD borrow** then confirmed in block **15,695,456**, followed by full sponsored repayment and withdrawal. The controlled test position ended with **zero debt and zero collateral**.

| Public testnet step               | Confirmed transaction                                                |
| --------------------------------- | -------------------------------------------------------------------- |
| Deposit 0.002 BTC                 | `0x82333290d9c355630f9f67b1f031d2da44e104256907fda9ee1547316bf8e26e` |
| Borrow 10 MUSD, sponsored         | `0x4fe42b829ee2461484b003024521507441feb3d7e6c0b5219c91ac0d6bb3e2f3` |
| Repay all debt, sponsored         | `0xf4cf26ea7ab1fa116c6ae5d73cb2d901d7b4945e3291df7aabd2c0d699082ae4` |
| Withdraw all 0.002 BTC, sponsored | `0xe61cdd56bc3d01928db758c621e8f5c1ff8ddbf81653408945220668d4b82059` |

All unused test funds were returned to the keeper: **0.002000999930370848 BTC** and **0.009999760810117628 MUSD**. The disposable wallet's BTC, MUSD, collateral and debt were all exactly zero afterward. Durable relayer recovery reported zero pending transactions and refunds.

This controlled test exercises the deployed contracts and public relayer. It does not substitute for installing the new TestFlight build on the reviewer's physical device.

The reviewer's screenshot matches the native `SIMULATION_REVERTED` fallback: a pre-broadcast refusal, with no transaction hash expected. That message alone does not identify the underlying revert. The shared pool's exhausted ceiling was independently verified and reproduced.

## Changes

- Reopen the web app and browser launch links; support native `/pay` links as unsigned browser payment drafts.
- Read borrowing capacity from total pool debt, actual MUSD reserve, live origination fee and pool collateral. Apply user and pool collateral limits before signing. Reserve-served borrowing adds no protocol debt or origination fee; fresh draws do.
- Correct the pooled liquidation threshold to 140% in borrower previews; retain the 180% borrowing floor.
- Bind reads to Mezo testnet and refuse unsupported direct-trove writes instead of submitting them to the pooled vault.
- Ensure native repayments obtain the required vault token allowance; the first approval can require self-paid BTC gas.
- Distinguish relayer RPC/transport failures (`502 UPSTREAM_ERROR`) from actual simulated contract reverts (`422 SIMULATION_REVERTED`).
- Harden the keeper repair command with chain, vault, keeper role, signer, current rates and repeated simulation checks. Keystore passwords remain local.
- Stop counting pending redistributions twice. Mezo's first three `getEntireDebtAndColl` values already include them. This is corrected in web/native readers and the Solidity source.

## Contract deployment limitation

The currently deployed immutable vault still uses its previous accounting code. The Solidity pending-redistribution correction and previously prepared redemption reconciliation are **not deployed to that address**. Pending redistribution fields were zero in the incident observation, so they did not cause this borrow failure. Replacing the vault requires an explicit migration plan for existing positions; this release does not switch users into a new empty vault.

## Verification

- Actual deployed-bytecode fork pinned at testnet block **15,688,608**: deposit, reproduce borrow rejection, impersonate keeper refinance, borrow 10 MUSD, repay and withdraw all — **1 passed, 0 skipped**. The fork supplies the observed oracle price (86,532.56352 USD/BTC) to the consensus precompile and locally funds the test borrower/repayment fee. It sends no public transactions.
- Solidity local suite: **315 passed**, plus the separate incident fork above.
- Relayer: **335 passed**, including seven Anvil integration tests, plus six Durable Object runtime checks.
- Web: **175 passed**, six opt-in tests skipped; production build and types passed.
- Shared SDK: **126 passed**, types passed. Native: **86 passed**, including direct-trove write guards; final Release simulator build passed, including repayment allowance handling.
- Fresh Chrome smoke: six anonymous desktop/mobile routes passed without client exceptions or horizontal overflow; first-run onboarding, wallet menu and payment-link redirect verified. This is not a signed wallet transaction test.
- Release-check regressions: eight HTTP tests and 18 configuration-attestation tests passed.
- Keeper command: nine safety regression tests passed. Pinned Foundry 1.4.3 formatting and 308-test gas snapshot check passed; workflow lint passed.
- Actual public gas sponsorship: registry commitment from a disposable wallet with zero BTC, confirmed in block **15,688,497**, transaction `0x85694af9be88852057aa7f30be78aaa92804e44e838badcf4227faf470f86266`. This proves sponsorship, **not borrowing**. Evidence: `apps/relayer/evidence/relay-smoke-2026-09-22.json`.

## Keeper maintenance procedure

The repair above has completed. For future incidents, begin with the read-only diagnosis on the machine holding the `maren-deployer` Foundry keystore; execution is only needed when another refinance is justified:

```sh
node tools/ops/refinance-trove.mjs
node tools/ops/refinance-trove.mjs --execute
```

The second command prompts locally for the encrypted keystore password. For an existing secure password file, add `--password-file /absolute/path`. Do not paste a password or private key into chat, a command argument, or release evidence. The tool refuses a changed chain, wrong signer, missing keeper role, failed simulation or rate increase unless explicitly overridden. No rate-increase override is authorized by this release.

For each future repair, verify fresh capacity, a confirmed public borrow, repayment and withdrawal using a controlled test account, and durable relayer settlement with no pending refunds. Preserve the transaction hashes; a simulation or raised ceiling alone is not proof of the full flow.

## Deployment observations

Source revision: `ebd7aac7e9272e4f828c048de4cb05431bcd553a`, pushed to `release/borrowing-recovery-2026-09-22` in the existing private repository.

- Web deployed to **https://www.marenfinance.xyz/app**. Vercel deployment `dpl_2TcFTQRN1D3fNtaGZsMe34Sqmrm9` is Ready with www, apex and canonical Vercel aliases. Eight public HTTP/CORS/recovery checks passed.
- Connected public Finance UI was also checked with a read-only injected test provider and real RPC data: maximum 432.78 MUSD, preview 300.26 MUSD, fee 0.30 MUSD, resulting ratio 250%, and sponsorship after the health probe. No signing or transaction methods were requested; this is not an authenticated physical-wallet test.
- Fresh Chrome against the public deployment: six routes passed on desktop/mobile, no client exceptions or horizontal overflow; onboarding, wallet menu and payment draft redirect verified. Live pool figures rendered. A browser-origin request to the relayer returned accepting=true on chain 31611 with zero pending transactions and refunds.
- Worker deployed as version `aaa0afa9-1585-4119-a2c5-2bfac983f0f5`, tag `testnet-ebd7aac`. Health, CORS, nonce and durable settlement state verified; signer, namespace and secrets preserved.
- Live contract/client configuration attestation passed. Runtime hashes are observations, not proof that deployed Solidity matches the current source.
- **Apple accepted native build 9** from approved native source `ebd7aac` (workflow ref `a3ad572`, identical native code). [Workflow run 35700326753](https://github.com/SeventhOdyssey71/marenfinance/actions/runs/35700326753) completed successfully; Apple reported “UPLOAD SUCCEEDED with no errors” at 07:52:04 UTC. Hosted tests, Release build, signed archive and IPA export passed. Apple processing and tester availability remain unverified. The workflow note was captured in its summary, not published as App Store Connect beta metadata. A separate workflow-only fix now selects future build numbers above existing App Store Connect builds, including Xcode Cloud. The earlier billing block did not prevent this run from starting.
- Keeper refinance confirmed; password file was used locally without exposing its contents. The deployed contract accounting fixes still need a separate migration.

Machine-readable observations: [TestFlight upload](testflight-2026-09-22.json), [connected browser](connected-browser-2026-09-22.json), [public borrowing cycle](borrow-proof-2026-09-22.json), [keeper repair](keeper-repair-2026-09-22.json), [deployment](deployment-2026-09-22.json), [public HTTP](http-2026-09-22.json), [browser](browser-2026-09-22.json), [contract configuration](testnet-configuration-2026-09-22.json), and [Worker rollout](../../apps/relayer/evidence/deployment-2026-09-22.json).
