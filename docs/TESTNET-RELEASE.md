# Testnet release candidate

Date: 13 September 2026. Baseline `d349a22` plus local uncommitted changes.
Owner: engineering, with separate backend, native, and web implementation tracks.

**The candidate passed local verification. It has not been deployed or uploaded
to TestFlight. Final pilot acceptance requires the released build on two physical
devices and observed Cloudflare recovery.** The public entrypoint remains the
[iOS beta](https://testflight.apple.com/join/uhmv9YPE); the website serves landing,
docs, and claim links. The `/app` dashboard gate stays disabled.

## Implemented

- Backend: persist reserved/prepared transaction intent and quota accounting in
  the existing Durable Object. Persist signed bytes before broadcasting, restore
  the nonce floor, resend only the same transaction, and settle/refund atomically.
  Report blocked recovery, pending counts, oldest pending time, and budget state.
- Both clients: treat lost responses, duplicate pending requests, and ambiguous
  relay errors as uncertain. Preserve known transaction hashes for reconciliation;
  do not label an uncertain payment as definitely unsubmitted or recommend a
  self-paid replacement.
- Native: protect background/sheet content, validate signing keys and wallet
  restoration, handle missing keys, validate relay endpoints, detect stale or
  partial index data, and validate incoming links before presenting review.
- Web: complete beta CTAs and honest testnet/sponsorship copy, keyboard/mobile
  navigation and reduced motion; remove dead links/search and unused remote fonts.
  Claim URLs now select and verify the exact escrow. Explicit native handoff opens
  review and never signs automatically.
- Release tooling: attest chain/domain/allowlists/client configuration, preserve
  dated JSON evidence, and check the new recovery gate after rollout. CI includes
  Worker typechecks, mandatory Anvil tests, configuration checks, and a separate
  subgraph build; nightly checks read deployed configuration and HTTP availability.

## Validation record

| Check                       | Result / scope                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend                     | 327 passed, including 16 recovery fault tests and seven local Anvil fork tests. No public-chain broadcasts.                                                                                                         |
| Web                         | 157 passed; six opt-in live tests skipped. Production build passed, including 26 static pages and MDX.                                                                                                              |
| SDK / metrics               | 118 / 20 passed on the frozen dependency versions.                                                                                                                                                                  |
| Release tools               | Eight HTTP checker tests and 18 attestation tests passed.                                                                                                                                                           |
| Workspace types             | Passed, including Cloudflare Worker and release tooling.                                                                                                                                                            |
| Workspace lint              | Command passed; SDK, metrics, and backend currently have placeholder lint scripts, so this is not independent lint coverage.                                                                                        |
| Actual local Worker runtime | Six scenarios passed using workerd, SQLite Durable Object storage, and disposable unforked Anvil: restart refunds, prepared persistence, alarm settlement, duplicate alarms, lost response, and persisted counters. |
| Workflow validation         | actionlint passed all three workflows. Native export failure masking, unsafe notes interpolation, and upload-summary reporting corrected.                                                                           |
| Worker bundle               | Dry-run passed, about 1,241 KiB raw / 240 KiB gzip.                                                                                                                                                                 |
| Subgraph                    | Code generation and mapping/manifest build passed. No deployed index-parity claim.                                                                                                                                  |
| Native                      | 77 simulator tests and final Release simulator build passed. Seven prohibited demo markers were absent from the Release binary; see the native report below.                                                        |
| Contracts                   | Unchanged during finalization. Earlier readiness pass: 313 local tests and 11 matsnet fork tests passed.                                                                                                            |
| Public surface              | Existing `/`, `/docs`, `/claim` return 200; `/app` remains intentionally 404. Twenty internal web links checked locally.                                                                                            |
| Deployed configuration      | Read-only contract/client/deep-health attestation passed; code hashes do not establish source parity.                                                                                                               |

The [native report](../apps/ios-native/TESTNET-FINALIZATION.md) records the simulator,
result-bundle path, Release build, and hardware acceptance steps. Claim creation
now persists one unsaved bearer key per wallet in biometric Keychain before
signing, resumes it after restart, and refuses creation without durable biometric
storage. These are device-only recovery copies, not cloud backups.

Local runtime tests exercise the production journal/adapter with a test DO and
no-op local target, not the full hosted Worker and deployed forwarder. Existing
optional Privy/Farcaster, dynamic-import, AVFoundation concurrency and deprecated
Keychain API warnings remain. A real browser/device visual walkthrough has not
been certified by HTTP or simulator unit tests.

Evidence:

- [Contract/client configuration](evidence/testnet-configuration-2026-09-13.json).
- [Pre-rollout HTTP/recovery gate](evidence/testnet-pre-rollout-2026-09-13.json).
  This report deliberately fails recovery against the older hosted relay. It is
  evidence that rollout remains outstanding, not a failed local implementation.
- [Original HTTP baseline](evidence/release-2026-09-13.json).

## Hosted release blocker

Read-only GitHub inspection found that the latest
[CI run](https://github.com/SeventhOdyssey71/marenfinance/actions/runs/34595486602)
and [TestFlight run](https://github.com/SeventhOdyssey71/marenfinance/actions/runs/34485998757)
did not start their jobs. Both annotations say recent account payments failed or
the spending limit must be increased. The repository/account owner must resolve
GitHub Billing & plans, then rerun the release commit. This is separate from the
local test results. The older successful TestFlight run does not contain this
candidate.

Vercel and Cloudflare CLI authentication were verified without reading secrets.
The Vercel project is `marenfinance`, with root directory `apps/web`. Local Xcode
is 16.2; the existing TestFlight workflow requires an iOS 26-or-later SDK for its
archive/upload lane. No signing secret values were inspected or modified.

## Rollout sequence

1. Keep the local candidate checks green, review the candidate diff, and record its
   release commit. Fix the GitHub billing block and run CI plus the native test
   lane against that exact revision. Keep all deployment/build IDs in the release
   evidence. Do not treat the baseline commit in today's dirty-tree report as a
   deployed candidate revision.
2. Deploy the web error-handling and claim improvements. Confirm the existing
   Vercel project/root settings and preserve `MAREN_WEB_APP_ENABLED` as unset/false.
   From the linked repository root, the publication command is `vercel --prod`.
   Verify the new native scheme only with an app build that supports it; the web
   claim path remains available.
3. Before replacing the relay, stop new submissions at ingress while leaving the
   old Durable Object available to settle its in-memory queue. Observe pending
   transactions/refunds reaching zero and retain their hashes and budget totals.
   Do not use a Worker redeploy as the initial pause: that may evict the very state
   being drained. If old pending state cannot be established, investigate before
   rollout. Existing in-memory intents cannot be recovered by the new journal.
4. Deploy the existing named Worker/DO with `pnpm --filter @maren/relayer cf:deploy`.
   Retain the signer, namespace, chain, and forwarder. Do not recreate storage or
   rotate the signer to clear pending state. Confirm the new version ID and inspect
   deep health and `recovery` fields before reopening ingress.
5. Run both read-only checks below, then observe a small test transaction through
   receipt settlement and a controlled restart/alarm recovery exercise. Publish
   no private keys, raw signed transactions, or claim-link fragments in evidence.
6. Run the native TestFlight workflow on the release revision. Use archive-only
   first if signing assets need verification; upload the tested archive and record
   App Store Connect processing plus the actual distributed version/build.
7. Complete the device matrix, retain transaction receipts, and produce a short
   reviewer demonstration. Only then mark the pilot finalized.

```bash
pnpm release:attest --out /tmp/maren-post-rollout-configuration.json
pnpm release:check --require-recovery --out /tmp/maren-post-rollout-http.json
```

Publication commands are prepared, not executed. The [backend runbook](../apps/relayer/DEPLOY.md)
contains recovery semantics and operator limitations. Do not roll back to the
legacy in-memory implementation while the durable journal has unsettled records.

## Device and operator acceptance

Use testnet-only assets, two separately controlled wallets, and the exact
distributed build. Retain expected/actual outcomes and public transaction hashes.
Never record bearer secrets, backup keys, or raw transactions in the checklist.

| Exercise                       | Pass condition                                                                                                                                 | Owner                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Fresh install, backup, restore | Same address returns; wrong key cannot silently replace an active wallet; biometric cancel and missing-key states are recoverable.             | Mobile / tester        |
| Privacy and interruption       | Background, lock/unlock, presented sheets, and interrupted signing protect sensitive content and reconcile pending outcomes.                   | Mobile / tester        |
| Fund, borrow, pay              | BTC deposit, small MUSD borrow, and second-wallet payment settle; balances, receipts, counterparty history and gas payer agree.                | Two testers            |
| Link create and claim          | Canonical URL and native/web review select the same escrow; creation survives force-quit; invalid, expired, or consumed links fail clearly.    | Mobile + web / testers |
| Request and handle             | Request fulfillment and interrupted handle commit/reveal recover without duplicate payment or lost identity state.                             | Mobile / tester        |
| Repay, withdraw, Earn exit     | Position accounting and exits match receipts, including allowance requirements and paused-borrowing conditions.                                | Tester / operator      |
| Relay refusal and uncertainty  | Definite refusal is distinct from timeout/duplicate/unknown; existing hash is reconciled before replacement.                                   | All tracks             |
| Durable recovery               | Real Worker restart and alarm reconcile the same transaction and budget once; pending age and failed refunds are visible.                      | Backend / operator     |
| Index history                  | RPC fallback works with missing, stale, malformed, and unavailable index results. Enable the subgraph only after event/log parity is recorded. | Backend + mobile       |
| Reviewer access                | Public URLs and TestFlight installation work on physical devices; screenshots/copy match the released build.                                   | Product / tester       |

The grant package should include the release revision, distributed build number,
dated checks, a short device recording, verified core-loop receipts, and measured
external pilot use. Current team exercises must not be represented as independent
traction. Mainnet still requires the audit and operational gates in
[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md).
