# Production and grant readiness

Latest hosted status: [14 September deployment report](TESTNET-DEPLOYMENT-2026-09-14.md).
Web/backend changes have been deployed; the new TestFlight upload is blocked by
GitHub billing. The analysis below includes the prior candidate assessment.

Reviewed 13 September 2026 against local source at `d349a22` plus the uncommitted
hardening changes described below. The current release checklist and rollout order
are in [TESTNET-RELEASE.md](TESTNET-RELEASE.md). This is the broader execution checklist;
older dated product plans and internal assessments are historical context.

**The next release is a dependable iOS testnet pilot. Mainnet remains gated on an
independent audit and operational readiness.** Mezo's developer FAQ describes a
live testnet MVP as the starting point for its Founder Program. Application
eligibility and safe custody of mainnet funds are separate gates.
[Mezo developer FAQ](https://testnet.mezo.org/docs/nl/docs/developers/getting-started/faqs/).

## What is actually available

| Area        | Evidence and current limit                                                                                                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts   | Five matsnet addresses in `packages/sdk/src/addresses.ts`; mainnet Maren addresses are zero. Local source contains changes beyond the original deployment, so source tests do not prove deployed bytecode parity.                                                    |
| iOS         | Native SwiftUI, live reads/writes, links, requests, handle registration, Keychain signing, and encoding golden tests. Public TestFlight invite is configured. Fresh installation, restoration, and the current distributed binary still require device verification. |
| Web         | Public `/`, `/docs`, and `/claim` respond. `/app` and its children intentionally return 404 unless `MAREN_WEB_APP_ENABLED=true`. Do not advertise the dashboard as the current public product.                                                                       |
| Relayer     | Cloudflare testnet `/healthz` reports accepting, chain 31611, durable quota store, one instance, and no boot problems. This endpoint reads process/quota state; it does not demonstrate a recent successful chain transaction.                                       |
| Sponsorship | Both clients have relay submission paths. Deposits, approvals when required, and link creation can require user-paid BTC. Do not describe every action as gasless.                                                                                                   |
| Earn        | Stability Pool wrapper, exposure and trailing-yield code exist. Mainnet deposit access, exit behavior, and real swap-router integration need verification before choosing the mainnet backend.                                                                       |
| Activity    | Goldsky subgraph source exists, but `MAREN_SUBGRAPH_URL` is empty in the iOS plist. The RPC log fallback remains active. The subgraph remains outside the pnpm workspace; a separate CI job now generates and builds it.                                             |
| Metrics     | Existing aggregation measures funded positions and whether borrowers subsequently pay. The 7 September figures in the public roadmap are a tiny test cohort, including team accounts; they are not independent demand evidence.                                      |

## Changes and verification

The finalization pass added durable relay intent and quota recovery, safe client
handling for uncertain submissions, stricter wallet/claim/deep-link recovery,
truthful public beta copy, and read-only deployment attestation. The subgraph now
has a separate CI build and native reads reject stale or partially decoded index
results before falling back to RPC logs.

See [the testnet release report](TESTNET-RELEASE.md) for current test counts,
remaining acceptance gates, and exact rollout commands. The earlier contract
verification remains 313 unit/property/invariant passes and 11 matsnet fork
passes. Contracts were not changed in this finalization pass; no new deployed
bytecode parity or audit claim is made.

Local tests are separate from hosted release evidence. The public services still
run the earlier release: the stricter recovery gate correctly fails against that
relay until rollout. GitHub CI and the latest TestFlight job could not start due
to an account billing/spending-limit failure, confirmed through their annotations.

## M0: finish the pilot release

1. Complete the release candidate's local gates in TESTNET-RELEASE.md, including
   durable recovery and cross-client claim handling. Keep one coordination object
   per relay signer. The durable path resends identical signed bytes and retains
   unresolved reservations; it deliberately does not replace pending transactions.
2. Roll out the verified candidate in the documented order. Drain the old relay's
   in-memory transactions/refunds first: a new journal cannot reconstruct them.
   Observe actual Cloudflare alarm/restart recovery before opening the pilot.
3. Exercise the distributed TestFlight build on physical devices using two
   independent wallets. Record build number and public transaction receipts for
   deposit, borrow, pay, claim, request, repay, withdrawal, and Earn exit. Include
   interruptions and errors; never put keys or claim fragments into evidence.
4. Keep the subgraph disabled until index/log parity and freshness are verified.
   The existing RPC history fallback is the testnet default.
5. Assign the operator and verify deep health, pending age, refunds, signer balance,
   budget exhaustion, oracle freshness, and pool ICR monitoring. Rehearse repayment
   and withdrawal while borrowing is paused.

M0 is complete when two independent wallets can complete the core loop on the
released build, outcomes match chain receipts, and interruption/recovery cases pass.

## M1: application evidence and pilot

Use TestFlight as the primary reviewer entrypoint. Package a short phone recording,
the repository, dated release report, exact build number, and a small set of
verified transactions demonstrating deposit → borrow → pay → repay/withdraw.
Show why the pooled vault enables small loans and explain pooled liquidation risk
where borrowing is demonstrated.

Start with five external testers and expand toward the planned fifty-person
community cohort after onboarding issues are fixed. Those are proposed cohort
sizes, not current users or grant terms. Track completed onboarding, funded
positions, borrow-to-payment conversion, settlement failures, time to completion,
and return usage after seven days. Keep team wallets identifiable in the analysis;
an address is not proof of a distinct person and a later payment does not prove
the provenance of the money spent. Preserve the metric's actual definition.

Application acceptance: every traction claim has a dated source; team exercises
are separated from independent usage; deployment and audit limitations are explicit;
grant milestones have objective evidence and owners. Submit the application at this
stage while audit preparation proceeds. Published or merged upstream contributions
can strengthen it, but do not claim drafts are merged or make another maintainer's
merge timing the critical path.

## M2/M3: mainnet gates

| Gate                          | Acceptance evidence                                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit target                  | Freeze source and deployed artifacts, inventory roles/external dependencies, adjudicate every finding in `docs/audit`, and get independent review. Cover all fund-bearing launch components, not just the two highest-risk contracts.                                                          |
| Vault recovery and accounting | Resolve protocol-collateral withdrawal semantics, fully redeemed/frozen trove recovery, shortfall funding, and insurance policy. Prove exits, redemption reconciliation, and keeper failure behavior against mainnet-shaped forks. Do not widen admin withdrawal power as a documentation fix. |
| Relay trust and recovery      | Durable recovery tests above, domain/allowlist attestation, fee-token policy for the paid path, and an implemented mainnet signer model. The current raw Worker secret is explicitly testnet-only; the runbook's KMS/HSM gate is not implemented.                                              |
| Earn backend                  | Verify mainnet Stability Pool deposit and withdrawal behavior with a simulated/forked lifecycle. If unsuitable, assess sMUSD integration as a contract/accounting change requiring tests and audit, not a one-line configuration pivot. Fork-test any real swap adapter and slippage guards.   |
| Operations                    | Multisig/admin and keeper roles explicitly assigned, signing keys separated, replenishment and pause procedures rehearsed, monitoring and incident ownership live.                                                                                                                             |
| Capped launch                 | Agreed caps and seed sizing, source verification, full deployment rehearsal, security disclosures, independent audit findings resolved/retested, and rollback/pause criteria recorded before any mainnet deposit.                                                                              |

Do not enlarge the audit scope with direct-trove signature support, Passport,
passkeys, bank cashout, or a full merchant product before the pilot demonstrates
need. Existing x402 work is an optional demonstrator; it is not the application gate.

## Reproduce the evidence

```bash
CI=true pnpm typecheck
CI=true pnpm test
pnpm release:test
pnpm release:check --require-recovery --out /tmp/maren-release.json
pnpm release:attest --out /tmp/maren-configuration.json
MAREN_REQUIRE_CHAIN_TESTS=1 pnpm --filter @maren/relayer test
forge test --root packages/contracts --summary
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --root packages/contracts --match-path 'test/fork/*' --summary
NEXT_PUBLIC_MEZO_NETWORK=testnet pnpm --filter @maren/web build
npm --prefix subgraph run build
pnpm --filter @maren/metrics start -- --out /tmp/maren-pilot.json
```

The metrics scan and fork suites need working public RPC access; an unavailable
read is not zero usage. Regenerate evidence close to submission. Do not copy test
counts, pool ratios, or market figures from August PDFs into a September application.
