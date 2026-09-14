# Testnet finalization

Date: 2026-09-13. Baseline: `d349a22` plus local working changes.
Goal: finalize a dependable iOS-first testnet release candidate across landing,
native mobile, and backend, with verified integration and reviewable release steps.

## Outcome

Status: local release-candidate goal complete; hosted pilot acceptance remains open.

The backend, web, and native hardening is implemented and locally verified,
including the final native Release simulator build. On 14 September, release
revision `eddce3e` was pushed and the web/backend changes were deployed. The native
upload was attempted but blocked by GitHub billing before any archive was built.
See [the deployment record](docs/TESTNET-DEPLOYMENT-2026-09-14.md). See [the release plan](docs/TESTNET-RELEASE.md) for the deployment order,
acceptance matrix, evidence, and grant handoff; mainnet remains audit-gated.

## Parallel acceptance checklist

| Priority  | Track / owner                        | Status   | Evidence and acceptance                                                                                                                                                                                                                         |
| --------- | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 High   | Backend / backend agent              | Verified | Durable reservations, prepared transaction bytes/hash, nonce floor, refunds and settlement accounting; 327 tests, including 16 fault cases and seven Anvil fork integrations. Six actual local workerd/SQLite restart/alarm checks also passed. |
| P1 High   | Native / mobile agent                | Verified | Wallet restoration, privacy/lifecycle, uncertain outcomes, strict deep links, and persisted claim recovery implemented. 77 simulator tests and final Release simulator build passed. Physical Keychain/device checks remain separate.           |
| P1 High   | Client/deployment alignment / root   | Verified | 15 local configuration and 33 on-chain observations passed at testnet block 15511641; deep hosted relay health passed. Runtime code hashes are observations, not source parity.                                                                 |
| P2 Medium | Landing and claims / landing agent   | Verified | Final beta copy, navigation, accessible/reduced-motion behavior, exact claim verification and explicit native review handoff. 157 tests passed; six optional live tests skipped; production build passed.                                       |
| P2 Medium | Activity / root + mobile             | Verified | Separate subgraph CI codegen/build added and passed locally. Native stale/partial result fallback tested. Index stays unconfigured until deployed event parity is verified.                                                                     |
| P1 High   | Integrated checks / root             | Verified | Fresh workspace typecheck passed; release tools 26 tests passed; SDK 118 and metrics 20 passed. Formatting, copy scan, and actionlint passed.                                                                                                   |
| P1 High   | Hosted CI/TestFlight / account owner | Blocked  | Both latest jobs failed before executing due to account billing/spending-limit annotations. Owner must resolve Billing & plans, then run the release revision.                                                                                  |
| P1 High   | Web/backend rollout / operator       | Verified | Website and durable Worker deployed; ingress restored; post-deployment configuration and recovery gates pass. Native distribution and device acceptance remain blocked/open separately.                                                         |
| P1 High   | Released-device acceptance / testers | Open     | Two physical wallets must complete the matrix on the actual distributed build, including link secret recovery and relay restart. Local simulator/HTTP evidence does not substitute.                                                             |

## Findings

### P0 Critical

No P0 finding established by this bounded pass. This is not an independent audit.

### P1 High

- **Resolved locally: restart loss of relay state.** `apps/relayer/src/recovery.ts`
  and `worker/durable-store.ts` persist accounting and transaction intent together.
  Storage-ACK and RPC-ACK loss tests retain the same signed transaction; real local
  runtime restarts and alarms settled once. Observe the hosted deployment before
  certifying the operational gate. Legacy in-memory records must be drained first.
- **Resolved locally: ambiguous submissions treated as definite refusal.** Web
  `src/lib/chain/relay.ts` and native `Chain/Relayer.swift` retain unknown outcomes,
  expose known hashes, and avoid automatic/self-pay replacement guidance. This
  prevents a retry from becoming a second transfer while the first still settles.
- **Resolved locally: wallet identity and unfinished claim recovery.** Native
  `Chain/Keystore.swift` validates scalars, protects same-wallet restoration and
  stores an unfinished claim bearer key before signing. Claim creation refuses
  devices without the required biometric durable storage. Device behavior still
  needs hardware verification, especially enrollment changes and force-quit.
- **Open: released artifact evidence.** Web/backend versions are deployed and recorded. The distributed iOS binary
  has not received this candidate. Resolve CI billing, publish the native update,
  then attach receipts for the two-wallet acceptance loop.

### P2 Medium

- **Resolved locally: claim URL and index mismatches.** Web uses the native claim
  ID and verifies its key; malformed inputs fail clearly. Native validates scheme,
  host, ID and bearer key, and falls back from stale/partial indexed history.
- **Resolved locally: misleading beta copy and release checks.** Sponsorship
  exceptions, testnet/pre-audit status and iOS entrypoint are explicit. Tests never
  report mere HTTP reachability as transaction or mainnet proof.
- **Resolved locally: native workflow failure reporting.** Export failures cannot
  be masked by a later directory listing; notes use environment variables rather
  than shell interpolation; upload summaries report the actual step outcome.

### P3 Low

- Existing optional Privy/Farcaster and dynamic-import build warnings remain.
- Some workspace lint commands are placeholders; typechecks/tests are the meaningful
  checks for those packages. Do not represent a green lint command as new coverage.
- Baseline tracked formatting discrepancies were corrected without semantic edits;
  generated bindings and user-provided design reference files are excluded. Existing
  locked dependencies were preserved; only the release workspace importer was added.

## Evidence and remaining limits

[TESTNET-RELEASE.md](docs/TESTNET-RELEASE.md) contains counts, links to dated JSON,
reproduction commands, the verified GitHub billing blocker, and owner assignments.
The previous contract result (313 local plus 11 fork tests) is retained as earlier
verification of unchanged contracts. A local runtime test uses the production
journal/adapter with a test DO and a no-op target; it does not prove deployed
forwarder authorization, Cloudflare service behavior, or public-chain settlement.

The pilot remains unfinished until publication, hosted recovery observation, and
physical-device acceptance pass. Those steps are explicit release gates, not
claims hidden behind the local candidate's passing tests.
