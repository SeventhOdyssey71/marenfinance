# Ship Maren iOS to TestFlight

The whole point of this file: once the placeholders are filled, getting a build onto
TestFlight is two commands. Everything above those two commands is one-time setup.

This lane builds and submits with **EAS** (Expo Application Services). The build runs on
Expo's macOS machines in the cloud, so you do not need Xcode or a Mac to produce the
`.ipa`. You do need a paid Apple Developer account to sign it and to reach TestFlight.

## What the build ships

- **Network: matsnet** (Mezo testnet, chain 31611). This is deliberate and not a
  placeholder. Maren's contracts are deployed to matsnet only; the mainnet addresses in
  `@maren/sdk` are all zeroes because Maren is not on Mezo mainnet yet. A build pointed at
  mainnet would read empty contracts and render as an empty account. Every profile in
  `eas.json` therefore sets `MAREN_NETWORK` to `testnet`. When Maren deploys to mainnet,
  flip that one value in the `production` profile and rebuild.
- **Live data, not mock.** The data source compiles to `live` by default (see
  `src/data/source.ts`). Testers see real matsnet reads. The mock source stays reachable
  only from Settings, Developer, and every screen it feeds is labelled.

## What is free and what needs the paid Apple account

| Step | Cost |
| --- | --- |
| Install EAS CLI, `eas login`, `eas build:configure` | Free (needs a free Expo account) |
| `eas build --profile development` (simulator build) | Free of Apple; runs on EAS |
| Apple Developer Program enrolment | **Paid: 99 USD per year** |
| `eas build --profile production` (signed, real device) | Needs the paid Apple account |
| `eas submit --profile production` (upload to TestFlight) | Needs the paid Apple account |
| Adding testers in TestFlight | Free once enrolled |

The Apple Developer Program is the only paid piece. Everything on the Expo side is free
for the volume a handful of TestFlight testers needs.

## One-time setup

1. **Enrol in the Apple Developer Program** at <https://developer.apple.com/programs/>.
   This is the paid step (99 USD per year) and can take a day or two for Apple to approve.
   You cannot sign a device build or reach TestFlight without it.

2. **Install the EAS CLI and log in** (free Expo account):

   ```sh
   npm install -g eas-cli
   eas login
   ```

3. **Link the project to EAS.** From `apps/ios`:

   ```sh
   eas build:configure
   ```

   This writes the EAS project id into the app config. Accept iOS when prompted. It does
   not overwrite the profiles already in `eas.json`.

4. **Fill the three placeholders.** They are the only fabricated-looking values in the
   repo, and they are marked so you cannot miss them:

   - **`ios.bundleIdentifier`** in `app.json` is `finance.maren.app`. Register this exact
     identifier as an App ID in the Apple Developer portal (or let `eas build` create it
     for you the first time it signs). If you want a different id, change it here first.
   - **`submit.production.ios.appleTeamId`** in `eas.json` is
     `REPLACE_BEFORE_FIRST_SUBMIT`. Your Team ID is the 10-character string in the Apple
     Developer portal under Membership.
   - **`submit.production.ios.ascAppId`** in `eas.json` is `REPLACE_BEFORE_FIRST_SUBMIT`.
     Create the app record once in App Store Connect (<https://appstoreconnect.apple.com>)
     with the bundle id above, then copy its Apple ID (a numeric App Store Connect id)
     here.

   Do not invent these. Read them from your own Apple account.

## The two commands

`eas.json` has `requireCommit: true`, so commit your working tree first. Then, from
`apps/ios`:

```sh
eas build --profile production
eas submit --profile production --latest
```

The first command signs and builds the `.ipa` on EAS. The first time it runs it will ask
to create signing credentials (distribution certificate and provisioning profile) and can
manage them for you. The second command uploads that build to App Store Connect. Build
numbers auto-increment on EAS (`appVersionSource: "remote"` plus `autoIncrement` on the
production profile), so you never hand-edit `buildNumber`.

## After the upload: TestFlight internal testing

1. Open your app in **App Store Connect, TestFlight**. The build appears after Apple
   finishes processing it (usually 5 to 30 minutes).
2. If it asks about export compliance, the answer is already declared: the app sets
   `ITSAppUsesNonExemptEncryption: false` (it uses only standard HTTPS and the OS
   keychain), so there is nothing to file.
3. Create an **Internal Testing** group and add testers by their Apple ID email. Internal
   testers (up to 100, all on your team) get the build immediately, with no Apple review.
   This is the path for Judy's testers: add their Apple IDs to the internal group.
4. Testers install **TestFlight** from the App Store and accept the invite. Done.

## Before you ship the first time

- **Development / smoke test, no Apple account needed:**
  `eas build --profile development` produces a simulator build you can drag onto the iOS
  Simulator. Good for confirming the cloud build compiles before you pay Apple.
- **Preview, needs the paid account:** `eas build --profile preview` produces an internal
  distribution build for a registered real device (ad hoc), a step between simulator and
  TestFlight.

## What was verified locally and what only Apple can confirm

Verified here, no Apple account required:

- `CI=true pnpm --filter @maren/ios test` (117 tests pass)
- `CI=true pnpm typecheck` passes
- `npx expo config` resolves the full app config, icon, splash, permissions, bundle id,
  build number
- `npx expo lint` passes clean
- `eas.json` and `app.json` are valid JSON and pass the Expo config schema check

Only the paid Apple account can confirm:

- Code signing (distribution certificate, provisioning profile)
- The cloud production build finishing and producing a signed `.ipa`
- Upload to App Store Connect and TestFlight processing
- Adding and inviting testers

`expo-doctor` still reports three non-blocking warnings unrelated to this lane: a Metro
symlink override needed by the pnpm monorepo, a duplicate `react` pulled in by
`react-dom`, and a set of Expo SDK 57 patch-version mismatches. None of them stop an EAS
build. If you want them clean, run `npx expo install --check` from `apps/ios`.
