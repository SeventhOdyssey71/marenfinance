# Borrowing recovery — 22 September 2026

## Incident and diagnosis

The deployed Mezo testnet pool cannot draw new MUSD because accrued debt exceeds its fixed borrowing ceiling. At the incident snapshot, debt was approximately 2,749.55 MUSD, the ceiling was 2,749.20 MUSD, and `reserveMUSD()` was zero. Adding collateral alone does not reset that ceiling. The relayer correctly refused to sponsor the reverting borrow.

The existing vault exposes `refinancePooledTrove`. Simulation with its current sorted-list neighbours succeeded at approximately 424,734 gas, versus 1,126,838 using zero hints. The existing and current global interest rates were both 1%; the proposed repair would not increase that rate at observation time.

This is a diagnosis and tested repair procedure, **not evidence that public borrowing has recovered**. The keeper transaction has not been signed. Public borrower receipts are still required afterward.

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

## Remaining live repair

Run from the repository on the machine with the `maren-deployer` Foundry keystore:

```sh
node tools/ops/refinance-trove.mjs
node tools/ops/refinance-trove.mjs --execute
```

The second command prompts locally for the encrypted keystore password. For an existing secure password file, add `--password-file /absolute/path`. Do not paste a password or private key into chat, a command argument, or release evidence. The tool refuses a changed chain, wrong signer, missing keeper role, failed simulation or rate increase unless explicitly overridden. No rate-increase override is authorized by this release.

After the receipt succeeds, verify fresh capacity, a confirmed public borrow, repayment and withdrawal using a controlled test account, and durable relayer settlement with no pending refunds. Record each transaction hash. Until then, do not tell reviewers that borrowing is fully restored.

## Deployment observations

Source revision: `ebd7aac7e9272e4f828c048de4cb05431bcd553a`, pushed to `release/borrowing-recovery-2026-09-22` in the existing private repository.

- Web deployed to **https://www.marenfinance.xyz/app**. Vercel deployment `dpl_2TcFTQRN1D3fNtaGZsMe34Sqmrm9` is Ready with www, apex and canonical Vercel aliases. Eight public HTTP/CORS/recovery checks passed.
- Fresh Chrome against the public deployment: six routes passed on desktop/mobile, no client exceptions or horizontal overflow; onboarding, wallet menu and payment draft redirect verified. Live pool figures rendered. A browser-origin request to the relayer returned accepting=true on chain 31611 with zero pending transactions and refunds.
- Worker deployed as version `aaa0afa9-1585-4119-a2c5-2bfac983f0f5`, tag `testnet-ebd7aac`. Health, CORS, nonce and durable settlement state verified; signer, namespace and secrets preserved.
- Live contract/client configuration attestation passed. Runtime hashes are observations, not proof that deployed Solidity matches the current source.
- Native Release simulator build passed. **No new TestFlight build uploaded**: automatic approval review blocked signed distribution pending explicit approval for this build and existing TestFlight destination. The approval request is pending; GitHub billing was not retested because no workflow was dispatched.
- **No public keeper refinance submitted.** The existing keeper keystore needs local unlocking. The deployed contract accounting fixes still need a separate migration.

Machine-readable observations: [deployment](deployment-2026-09-22.json), [public HTTP](http-2026-09-22.json), [browser](browser-2026-09-22.json), [contract configuration](testnet-configuration-2026-09-22.json), and [Worker rollout](../../apps/relayer/evidence/deployment-2026-09-22.json).
