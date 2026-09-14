# Native testnet finalization

Local hardening reviewed on 13 September 2026. This is a simulator-verified candidate,
not a certification of the currently distributed TestFlight binary.

## Implemented

- Wallet management backs up the loaded key after authentication and restores only
  a matching address. Removing a wallet requires an explicit saved-key confirmation.
  Profile reports actual session-only protection and unfinished backups. New session-only
  wallets must save their key before finishing onboarding.
- Private-key validation rejects zero and out-of-range secp256k1 scalars. Sensitive
  clipboard copies remain local to the device and expire after two minutes.
- The app hides content while determining lock state, locks again after backgrounding,
  and shields the entire window, including payment and backup sheets, during inactive
  transitions. Hidden tabs are excluded from accessibility navigation.
- Relay timeouts, lost responses, duplicate in-flight requests, SUBMISSION_FAILED and
  SUBMISSION_UNCERTAIN remain uncertain. Validated backend hashes are reconciled through
  chain receipts. Self-paid transactions derive their real hash before broadcasting, so
  losing an RPC response cannot be misreported as an unsubmitted transaction.
- Concurrent actions from the same wallet are refused while a submission is in flight.
  Send pins the reviewed handle address. Allowance-read failures stop approval attempts.
- One unsaved created claim link per wallet is stored in biometric Keychain before
  signing. Reopening Claimable link resumes it. A restart before hash persistence can
  recover the transaction by the exact creator and unique bearer-key address in
  LinkCreated logs. Unknown outcomes retain recovery material. Explicit saved
  acknowledgement or a definite no-escrow outcome clears it. Devices without usable
  biometric durable storage cannot create a claim escrow.
- Shared links use the verified testnet host, marenfinance.vercel.app; legacy
  maren.finance input remains accepted. Explicit maren://claim?id=N#secret and
  maren://pay?to=recipient&amount=decimal handoffs open input/review flows, never submit.
  There is no universal-link entitlement claim. Claim secrets remain in fragments.
- Activity requires successful _meta indexing and an index at least as recent as the
  chain head read before the query. Malformed or unsupported rows trigger RPC fallback;
  they cannot silently disappear from a partial indexed history.

## Local validation

- Xcode 16.2, iPhone 16 Pro simulator, iOS 18.3: **77 tests passed, zero failures**,
  including 15 finalization regressions. These cover relay uncertainty, URL validation,
  bounded deep-link values, key scalar validity, concurrent wallet submissions,
  index freshness, restart serialization, uncertain claim retention and exact escrow
  event matching.
- Result bundle: `/tmp/maren-testnet-ios/Logs/Test/Test-Maren-2026.09.13_18-24-29-+0100.xcresult`.
- Test log: `/tmp/maren-testnet-ios.log`.
- Final Release simulator compilation **passed**; log: `/tmp/maren-testnet-ios-release.log`.
- `/tmp/maren-testnet-profile-demo.png` is a labelled debug/demo layout capture only.
  A simulator custom-scheme invocation reached the system's Open in Maren confirmation;
  that is not an end-to-end device handoff acceptance result.

Reproduce with an available simulator destination:

```sh
xcodebuild -project apps/ios-native/Maren.xcodeproj -scheme Maren \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
xcodebuild -project apps/ios-native/Maren.xcodeproj -scheme Maren \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Distributed-build acceptance still required

Record the exact TestFlight build and public transaction hashes without copying wallet
keys, claim secrets, signed calldata, or QR payloads into evidence.

1. Create, back up, remove and restore a disposable wallet. Cancel authentication;
   confirm no transaction is signed. Repeat with a missing signing key and a different
   private key, which must be rejected during same-wallet restoration.
2. Background the app with a payment, restore, or backup sheet open. The switcher must
   hide it, and returning must require the app lock before showing wallet content.
3. Complete deposit, small borrow, payment to a second wallet, repayment and withdrawal.
   Check receipts and both balances. Identify approval gas separately from sponsorship.
4. Create a claim link, terminate the process during submission, reopen Claimable link,
   unlock the saved draft, recover its real id, and claim from the second wallet. Repeat
   after a timeout and after confirmation but before saving. Verify saved acknowledgement
   removes the pending copy and no duplicate escrow is created during recovery.
5. Test biometric Keychain denial/storage failure. Creation must stop before escrow.
   Unit serialization tests do not replace this hardware-backed persistence test.
6. Open an explicit web Open in Maren link while locked, while onboarding and while another
   flow is open. Confirm the destination and amount on review and verify no automatic
   payment. New external links must not replace a transaction already being submitted.
7. Interrupt handle commit/reveal, create/fulfil a request, and deposit/exit Earn. Compare
   activity for both wallets with receipts, including subgraph failure/lag fallback.

Claim drafts are device-only recovery copies, not cloud backups. Biometric enrollment
changes, device loss, or removing the app can invalidate protected recovery access.
Save the generated link externally before relying on it across devices. No mainnet
readiness, TestFlight upload, independent-device acceptance, or public value transfer
is asserted by these local checks.
