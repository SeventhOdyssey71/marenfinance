# Testnet deployment: 14 September 2026

The website and backend changes are deployed. The native TestFlight upload was
attempted but blocked before building by GitHub billing. This is a partial release;
it does not certify the two-wallet physical-device acceptance loop.

## Source and deployments

Release branch: `release/testnet-2026-09-14`.
Web and application source: `eddce3e2de891788fd4732647d40ab21f72d30bd`.
The backend also received one configuration change: allow browser relay requests
from the verified existing website domain `https://www.marenfinance.xyz`.

| Component   | Outcome                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Website     | Vercel production deployment `dpl_Fcb43TS1JJMSkLSVdNYHREnm9FNH`, Ready.                                                                         |
| Public URLs | `https://www.marenfinance.xyz` and `https://marenfinance.vercel.app` serve the release; `https://marenfinance.xyz` redirects to www.            |
| Backend     | Existing `maren-relayer` Cloudflare Worker updated with durable recovery; same signer, chain, forwarder, and Durable Object namespace retained. |
| Native      | TestFlight run `34812345618`, build attempt 7, failed before simulator tests; archive/upload skipped. No new IPA or Apple processing.           |
| Hosted CI   | Run `34812333422` failed before tests for the same billing reason. Earlier local validation remains recorded separately.                        |

[Vercel deployment](https://vercel.com/suilance-s-projects/marenfinance/Fcb43TS1JJMSkLSVdNYHREnm9FNH),
[TestFlight attempt](https://github.com/SeventhOdyssey71/marenfinance/actions/runs/34812345618),
[CI attempt](https://github.com/SeventhOdyssey71/marenfinance/actions/runs/34812333422).

## Backend rollout

A temporary read-only observer bound to the existing Durable Object allowed health
checks while public ingress was paused through the Workers subdomain API. This
paused new requests without first replacing the old Worker code or losing its
in-memory transaction tracking. After at least 30 seconds, watching, in-flight,
queued, and refund counts remained zero; reserved and committed spend matched.
Both testnet RPCs reported latest and pending signer nonce 32.

The recovery implementation was then deployed, ingress restored, and public deep
health and recovery fields verified. The initial durable-code version was
`496e7254-497d-416b-954d-aa8536936e1e`; a subsequent origin-only configuration update
enabled the verified www domain. Final version: `52bce9af-73f4-4d20-b613-c9cd9355a162`,
tag `testnet-eddce3e-www`. The observer was deleted after verification. Deployed
Worker tail observed successful alarm events at 06:20:16 and 06:20:26 UTC, with no
exceptions; this proves alarms ran with empty recovery state, not an interrupted
public transaction test. See the
[backend deployment evidence](../apps/relayer/evidence/deployment-2026-09-14.json).

No contracts were published or upgraded, no signing keys or storage were replaced,
and no public-chain transactions were sent during this deployment pass.

## Live verification

- [Canonical website, CORS, and durable recovery](evidence/testnet-http-2026-09-14.json): passed all eight checks. The `/app` dashboard remains intentionally 404.
- [Custom-domain website and relay CORS](evidence/testnet-custom-domain-2026-09-14.json): passed all eight checks.
- [Contract/client configuration and deep relay health](evidence/testnet-configuration-2026-09-14.json): passed. Contract code hashes are observations, not independent source verification.
- [New rendered website copy](evidence/testnet-web-2026-09-14.json): passed for landing, docs, and claim page.
- [Hosted build failure evidence](evidence/testnet-hosted-builds-2026-09-14.json): records the actual attempted source revision and billing failure.

These are live HTTP/configuration observations. They do not prove a user payment,
claim, repayment, withdrawal, or hosted recovery of a deliberately interrupted
transaction. The previous local tests and runtime recovery checks are recorded in
[TESTNET-RELEASE.md](TESTNET-RELEASE.md).

## Remaining native release gate

GitHub rejected both new workflows because recent account payments failed or the
spending limit must be increased. The account owner must resolve **Billing & plans**,
then rerun the TestFlight workflow with upload enabled against the release branch.
All six required signing-secret names were present; their values were not inspected.
This Mac only has Xcode 16.2 / iOS 18.2 SDK, so it cannot substitute for the workflow's
required iOS 26-or-later upload toolchain.

The currently distributed iOS build therefore lacks the new uncertain-submission,
privacy, and persisted claim-secret fixes. It can still misclassify uncertain relay
responses as definite refusals. The deployed backend does not install those client
fixes. Publish the updated native build before final pilot acceptance, then execute
the device matrix in the release plan and record build number and public receipts.

Existing TestFlight availability, HTTP success, and backend health must not be
represented as proof that the new native release is distributed or that the entire
testnet pilot is finalized. Mainnet remains outside this deployment.
