## Code Review — 2026-10-26

### Scores

- Code Quality: 4/5
- Security: 4/5
- Test Coverage: 5/5
- UX Polish: 4/5
- Overall: 4/5

### Blockers

- The deployed testnet pooled trove is below its 180% borrowing floor because 0.212 BTC is idle in the vault. The UI correctly blocks a transaction that would revert, but reviewers cannot complete a borrow until the keeper moves collateral into the trove.

### Key Improvements

- All public marketing CTAs now use one canonical `/app` destination and the label “Open web app”; no TestFlight CTA remains.
- Browser coverage now follows the current Pay stepper and reconnects explicitly after full reloads.
- Borrowing browser checks now derive open/closed expectations from live `MarenVault` state and prove a blocked borrow never requests a signature.

### Verification

- Repository typecheck: passed (7/7 tasks).
- Repository tests: passed (7/7 tasks; 683 JavaScript/TypeScript tests passed, 6 optional live tests skipped).
- Solidity: 315 passed, 0 failed, 13 fork tests skipped without an explicit fork URL.
- Browser E2E: 103/103 checks passed against Mezo testnet.
- Release configuration attestation and HTTP/recovery gate: passed.

### Status

READY for web deployment. NOT READY for an end-to-end borrowing demonstration until the keeper top-up is signed and the live readiness gate passes.
