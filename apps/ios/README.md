# `@maren/ios` — Maren Finance for iOS

A Bitcoin-backed account on Mezo Chain. Deposit BTC, draw MUSD against it without
selling, spend MUSD without paying gas, earn on the idle balance.

**One caveat, stated first because the interface states it first:** the opening deposit
is not gasless. `MarenVault.deposit()` is `payable`, and `MarenRelayHub.execute` reverts
`ValueNotRelayable` on any request carrying value — so that one transaction is signed and
paid for by the user. Everything after it is relayed. See [Gas](#gas).

Expo (React Native) + TypeScript strict, `expo-router`, sharing `@maren/sdk` from the
workspace. Bundle identifier `finance.maren.app`.

---

## Setup

Requires Node 22+, pnpm 10, Xcode with an iOS simulator.

```bash
# from the repo root
CI=true pnpm install
```

> `CI=true` is not optional on a machine without a TTY. pnpm aborts with a silent
> exit code 144 (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) when it wants to
> recreate `node_modules` and has nowhere to prompt. It looks exactly like a network
> failure and is not one.

## Run

```bash
cd apps/ios
npx expo start --ios          # boots the simulator and opens the app in Expo Go
npx expo start                # then press `i`
```

The app runs in **Expo Go** — every native module it uses (`expo-secure-store`,
`expo-local-authentication`, `expo-camera`, `react-native-svg`) ships inside the Expo Go
binary, so no custom dev client is needed to exercise any screen.

```bash
npx tsc --noEmit              # typecheck
npx vitest run                # the security test suite
```

### Face ID in the simulator

`expo-secure-store` with `requireAuthentication: true` needs an enrolled biometric. In
the simulator: **Features → Face ID → Enrolled**, then **Features → Face ID → Matching
Face** to satisfy a prompt.

Without enrolment the app does **not** silently fall back to an unprotected Keychain
item — see "Key protection" below. It keeps the key in memory for the session and says
so on screen.

---

## What is live and what is mocked

The split is deliberate: everything that decides what a user *believes about their
money* is real, and only the transport is stubbed.

### Real — not mocked

| Thing | Where |
|---|---|
| All position math — CR, liquidation price, drop-to-liquidation, health bands, max borrowable at a target CR, total debt including fee + gas compensation | `@maren/sdk` `position.ts`, called directly. No arithmetic is reimplemented in this app. |
| All number formatting — BTC 6dp trimmed, MUSD 2dp grouped, CR rounded **down**, USD, price drop | `@maren/sdk` `format.ts` |
| Protocol constants — MCR 110%, CCR 150%, min net debt 1,800 MUSD, 200 MUSD gas compensation, 0.1% origination, 1.00% APR, 60s oracle limit, Maren's 140/160/180/250 policy bands | `@maren/sdk` `constants.ts` |
| Chain config, contract addresses, explorer URLs, chain IDs 31612 / 31611 | `@maren/sdk` `chains.ts`, `addresses.ts` |
| Key generation and address derivation — secp256k1 via viem/`@noble/curves` | `src/wallet/keystore.ts` |
| Keychain storage with biometric access control | `src/wallet/keystore.ts` (`expo-secure-store`) |
| Face ID / Touch ID capability detection and prompting | `src/wallet/keystore.ts` (`expo-local-authentication`) |
| QR scanning and strict payload parsing | `app/scan.tsx`, `src/lib/payment.ts` (`expo-camera`) |
| The R12 auth flow — redirect assertions, CSRF generation and constant-time comparison, callback validation | `src/auth/webAuth.ts` |
| The R15 receipt check | `src/chain/receipt.ts` |
| Oracle staleness classification and the borrow gate | `src/chain/price.ts` |

### Mocked

| Thing | Where | What replacing it looks like |
|---|---|---|
| Chain **reads** — price observation, position, balances, Earn position, activity | `src/data/mock.ts` | Each function is already `async` and already returns the exact type in `src/data/types.ts`. Swap the body for a viem `readContract` / `multicall`. Nothing downstream changes. |
| Transaction **submission** and the receipt source | `src/chain/actions.ts` (`submitMock`, `mockClient`) | `mockClient` is typed as the narrow `Pick<PublicClient, 'waitForTransactionReceipt'>` that `confirmTransaction` accepts — drop in a real `PublicClient` and point `submitMock` at `walletClient.writeContract` or the relayer's `POST /relay`. |
| Handle resolution (`@sele` → address) | `src/data/mock.ts` | `MarenRegistry` forward/reverse resolver. |
| The auth **backend** | — | `src/auth/webAuth.ts` is fully implemented, but no `https://maren.finance/auth/authorize` endpoint exists yet, and the universal link needs an `apple-app-site-association` file published for `applinks:maren.finance`. Until both exist the flow fails closed with a typed error. It does **not** fall back to a custom scheme. |
| Maren's own contract addresses | `@maren/sdk` `addresses.ts` | All zero. The contracts now exist in `packages/contracts` (`MarenVault`, `MarenPay`, `MarenRegistry`, `MarenEarn`, `MarenRelayHub`, `MarenForwarder`) and their tests pass, but nothing is **deployed**. `isDeployed()` exists to check. |

Where the mock meets the real contracts, the shapes are aligned rather than invented: the
one behaviour the interface asserts about `packages/contracts` — that `deposit` is
`payable` and therefore cannot be relayed — is read off the source and enforced by
`src/chain/sponsorship.ts`, not assumed. The remaining read shapes in `src/data/types.ts`
are the app's own view model; swapping them for `readContract` results is the work
described in the table above and has not been done.

The mock numbers were chosen to exercise the interesting states rather than to flatter
the product: the demo position sits at ~260% CR (healthy, but one bad week from
`caution`), the activity list contains a **failed** transaction, and the Earn window
contains only three liquidation events in ninety days.

---

## Security model

Every rule below is a specific finding from `docs/research/SECURITY-LESSONS.md`,
implemented as code rather than as a policy note. The three the brief names are covered
by `src/security.test.ts` (29 tests).

### Key protection

The signing key is generated on device and written to the **iOS Keychain** via
`expo-secure-store` with `requireAuthentication: true`, which creates the item behind a
`SecAccessControl` biometry gate, plus `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so it is
excluded from iCloud Keychain and from encrypted backups.

- The key is **never** held in module scope, Zustand, or React state. It is read for the
  duration of one signature and dropped. Every read costs a biometric prompt — that is
  how "Face ID on every signing action" is guaranteed rather than merely intended.
- The app store (`src/state/store.ts`) records the address and the *protection mode*,
  and has no field capable of holding a key.
- **No silent downgrade.** If no biometric is enrolled, the app does not write an
  unprotected Keychain item while telling the user it is protected — that would be
  exactly the R13 failure (claiming a control you did not implement). It keeps the key
  in memory for the session, does not persist it, and says so on the setup screen, on
  the created-key screen, and in Settings.

### R12 — authentication uses no custom URL scheme

Talise (M1) delivered its mobile bearer token over an unverified `talise://` scheme,
claimable by any other app on the device.

Maren uses `ASWebAuthenticationSession` (`WebBrowser.openAuthSessionAsync`) with a
**verified universal link**, `https://maren.finance/auth/callback`. Enforced by:

1. `assertVerifiableRedirect` throws `InsecureRedirectError` on anything that is not
   `https` on the allowlisted origin. `maren://auth/callback` throws.
   `https://maren.finance.evil.com/...` throws. It is called on both the authorize URL
   and the redirect URI, before the session opens.
2. A 256-bit CSRF `state` per attempt, compared with `timingSafeEqualString` — the
   accumulate-XOR-over-all-bytes construction, since Hermes has no
   `crypto.timingSafeEqual`.
3. `parseCallback` re-validates the origin **before reading any parameter**, then checks
   the state **before returning the code**.

The app does declare a `maren` scheme, because the Expo dev client needs one. It is
structurally unable to reach the auth path: the assertion rejects it, and there is no
code path that skips the assertion.

The same reasoning is applied to payment QR codes — `src/lib/payment.ts` accepts only
`https://maren.finance/pay?...` or a bare `0x` address, never a custom scheme.

### R15 — a transaction hash is not a success

`src/chain/receipt.ts` is the only place in the app where a transaction is judged.

```ts
if (receipt.status !== 'success') return { kind: 'reverted', ... };
```

The `Delivered` type carries a `unique symbol` brand, so a value of that type **cannot
be constructed outside that module**. A screen cannot render a payment as delivered
without having gone through the receipt check — this is enforced by the type system, not
by reviewer vigilance.

The outcome is a four-way discriminated union, and `timeout` / `unreachable` are
deliberately distinct from `reverted`. Telling a user a payment failed when it may still
land is how people double-spend, so those states say plainly that the transaction may
still be included and to check Activity before retrying.

### The oracle staleness rule

Mezo's `PriceFeed.fetchPrice()` **reverts** if the observation is older than 60 seconds
(`ORACLE_MAX_PRICE_DELAY_SECONDS`, read from the deployed contract). So:

- `PriceFeed` is a discriminated union and **only the `live` case carries a number**.
  There is no field on a stale price for a screen to read, so displaying a stale price
  as live is not a mistake this codebase can make.
- `priceGate()` fails closed on every non-live state, including an unknown one (R8), and
  always returns a reason so the UI explains itself rather than showing a dead button.
- `useHealth()` returns `null` without a live price. The home screen shows the explicit
  "price feed unavailable" state instead of a last-known ratio.
- The borrow slider is disabled, with the reason stated above it.

Exercise this: **Settings → Developer → Simulate a stale price feed**.

### Other rules carried in

- **R8, gates fail closed** — `priceGate`'s `default` branch denies; the network default
  is `testnet`; a missing biometric denies persistence rather than widening it.
- **R13, do not claim an unimplemented control** — Settings states "App Attest: not
  used" rather than implying an attestation that does not exist.
- **R16, explicit typed failure over silent fallback** — `confirmTransaction` returns a
  union rather than throwing; `accessKey` returns `denied` / `missing` distinctly.
- **Honest gas claims** — see [Gas](#gas). The rule lives in one dependency-free module
  and the wording in one copy object, so no screen can drift into promising terms the
  relayer will refuse. Gas is shown in **sats**, never a raw BTC decimal.
- **Pooled-trove risk disclosure** — stated on the last onboarding panel, before setup,
  per `ARCHITECTURE.md` §3.4.
- **No fixed APY on Earn** — the Stability Pool has no token emissions, so the screen
  shows trailing *realised* MUSD over an observed window with the liquidation-event
  count, labelled backward-looking, and explains why no APY is shown.

---

## What leaves this machine (R14)

> Talise's Critical **C2** was a process failure, not a code one: production database
> dumps and Apple signing keys were uploaded to a third-party build service on **every**
> mobile build. R14 requires this enumeration *before* the first EAS build. `eas.json`
> and `.easignore` exist; **no EAS build has been run.**

### What an `eas build` would upload

EAS tars the project directory and uploads it to Expo's build servers. From this
project that is:

| Uploaded | Notes |
|---|---|
| `app/`, `src/`, `assets/` | Application source, icons, and the six bundled font files. |
| `package.json`, `pnpm-lock.yaml`, `app.json`, `eas.json`, `babel.config.js`, `metro.config.js` | Build configuration. |
| `packages/sdk/src/` | Pulled in as a workspace dependency. Public chain addresses and math — no secrets. |
| The `env` blocks in `eas.json` | `MAREN_NETWORK` only, which is `testnet` or `mainnet`. Not a secret. |

### What is excluded, and how

`.easignore` is the control. **When `.easignore` exists, `.gitignore` is not consulted**,
so it restates every exclusion in full rather than relying on inheritance:

- `.env`, `.env.*`, `*.pem`, `*.key`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.jks`,
  `*.keystore`, `secrets.json`
- `*.sql`, `*.dump`, `*.sqlite`, `*.db`, `/fixtures/`, `/dumps/` — the C2 shape,
  excluded by pattern whether or not such a file ever exists here
- `.screenshots/`, `.expo/`, `dist/`, `coverage/`, `node_modules/`, `*.log`

### Signing credentials

Apple signing keys and provisioning profiles are **not** in this repo and must never be.
Two acceptable configurations:

1. `eas credentials` with EAS-managed signing — keys are generated and held in Expo's
   credential store, never on a developer machine and never in the repo.
2. **Local credentials** (`--local` builds) with keys in the operator's own Keychain.

Either way the repo contains no `*.p8`, `*.p12`, or `*.mobileprovision`, `.easignore`
excludes those patterns, and the root `.gitignore` already excludes `*.pem`/`*.key`.

### CI

The repo's `.github/workflows/ci.yml` runs typecheck, lint, build and tests. It uploads
**one** artifact — `docs/build/*.pdf` from the docs job. It does not upload build
directories, `node_modules`, environment files, or database dumps, and it does not run
an EAS build. Before any mobile build is added to CI, this section must be revisited and
the artifact list re-enumerated.

### Runtime egress

Only two hosts, both declared:

- Mezo RPC (`mezo.drpc.org` / `rpc.test.mezo.org`) and `explorer.mezo.org` for receipts
  and explorer links.
- `https://maren.finance` for auth and universal links.

No analytics SDK, no crash reporter, no telemetry. `EXPO_NO_TELEMETRY=1` is set in the
EAS base profile. The camera decodes frames on device and discards them — nothing is
recorded or uploaded.

---

## Gas

Mezo settles gas in BTC. Maren's relayer pays it — with exactly one exception, and the
exception is structural rather than a policy choice.

```solidity
// packages/contracts/src/MarenVault.sol:312
function deposit(address upperHint, address lowerHint) external payable nonReentrant {

// packages/contracts/src/MarenRelayHub.sol:236
if (msg.value != 0 || request.value != 0) revert ValueNotRelayable();
```

A deposit *sends Bitcoin*. An ERC-2771 forwarder cannot carry the caller's BTC, and if it
tried, `msg.value` would come from the relayer's own key — which is precisely the funding
confusion **R1** exists to prevent ("the shielded relayer could be induced to fund an
attacker's deposit, draining the relayer"). So `MarenRelayHub` refuses value
unconditionally, and the opening deposit is an ordinary transaction the user signs and
pays for.

| Action | Relayed | Why |
|---|---|---|
| `deposit` | **no** | `payable`; carries BTC, so it cannot be forwarded |
| `borrow`, `repay`, `withdraw`, `closePosition` | yes | no value, routed through `MarenForwarder` |
| all of Pay — send, request, link, split | yes | no value |
| Earn deposit / withdraw | yes | no value |

**The app does not ship the sentence "no gas, ever."** It is not true, and R13's lesson
generalises from attestations to fee claims: a promise that exists in the interface and
not in the contracts is worse than no promise, because it stops people looking.

Three things enforce that:

- `src/chain/sponsorship.ts` — the rule, as a pure function over an action type. It has
  no imports, so it is testable without the Keychain. Every "gasless" affordance in the
  UI derives from it; none is hard-coded per screen.
- `src/lib/copy.ts` `gasCopy` — the wording, written once and reused by onboarding, Pay,
  Vault and Home.
- `src/security.test.ts` — asserts the rule, and asserts that no string in `gasCopy`
  matches `/no gas,? ever/i`, `/zero gas/i`, `/never pay gas/i` or
  `/without ever holding gas/i`.

Scrolling to the bottom of Activity is the clearest statement of the product the app
makes: one gas line, on the deposit that opened the position, and "no gas paid" on
everything since.

> **Note for `apps/web`.** The landing page currently makes the unconditional version of
> this claim — "Bitcoin-backed liquidity with zero gas" (`src/app/layout.tsx:8`),
> "without ever holding gas" (`cta-band.tsx:23`), "No transaction, no gas, no BTC balance
> required" (`visuals/gasless-flow.tsx:7`). Those predate this branch and are not changed
> here, but they contradict the contracts and should be reconciled before launch.

---

## Screens

| Route | Screen |
|---|---|
| `app/onboarding.tsx` | Three panels — Deposit Bitcoin · Draw MUSD · Spend without gas — plus the pooled-trove risk disclosure. Panel three names the first-deposit exception rather than claiming gas never applies. |
| `app/wallet-setup/` | Create or import. Leads with how the key will be held. |
| `app/(tabs)/index.tsx` | Home / Portfolio. Position health is the hero: CR, liquidation price, room to fall, threshold scale. |
| `app/(tabs)/vault.tsx` | Deposit / borrow / repay / withdraw. Borrow slider with live CR + liquidation price, hard-capped at the 180% floor. |
| `app/(tabs)/pay.tsx` | Send to `@handle` or address, request with QR. Every payment is relayed, so "you pay no BTC" is unconditional *here* and is stated so. |
| `app/(tabs)/earn.tsx` | Trailing realised yield, backward-looking, no APY. |
| `app/(tabs)/activity.tsx` | History with status, memo, explorer link. |
| `app/settings/index.tsx` | Network switcher, security state, address, sign out, stale-feed simulator. |
| `app/scan.tsx` | QR scan-to-pay. |

## Design

`docs/BRAND.md`, transcribed into `src/design/tokens.ts` and `src/design/type.ts`.

- Canvas `#08080A`, cards `#101013`, hairline `rgba(255,255,255,0.08)` borders, 16px card
  radius, pill buttons, 44pt minimum touch targets.
- Violet `#5B3DF5` is the only saturated colour on a default screen. BTC orange
  `#F7931A` appears **only** on BTC-denominated values; MUSD green `#3ECF8E` only on
  MUSD values. The colour is attached to the component that knows the denomination
  (`src/components/Money.tsx`), so a BTC figure cannot be rendered green by accident.
- Health colours appear only when they carry meaning. `caution` renders neutral, because
  a position between 180% and 250% is doing what it is supposed to.
- Satoshi (400/500/700/900) for UI, Geist Mono for every numeral, address and hash, with
  `fontVariant: ['tabular-nums']` throughout. Fonts are bundled, not fetched. The
  fallback chain is Satoshi → Geist → system; Inter is never named, per BRAND.md §3.
- **No shaders.** BRAND.md §5 forbids mounting one above the fold on iOS, so the hero and
  CTA washes are static `expo-linear-gradient` ramps using the same violet → violet-900 →
  bg stops the web `MeshGradient` uses.
- Cards get their elevation from the hairline plus a 1px inner top highlight, never a
  drop shadow — there is no `shadow*` or `elevation` prop in `Card.tsx`.

### Accessibility

- Every interactive element has an `accessibilityRole`, an `accessibilityLabel`, and a
  hint where the action is consequential. Label/value pairs are grouped into a single
  VoiceOver stop so a row reads "Collateral ratio, 254.1 percent".
- The custom slider is `accessibilityRole="adjustable"`, publishes `accessibilityValue`
  in real units ("4,200.00 MUSD"), and implements increment/decrement so VoiceOver's
  swipe gestures move it in ten steps.
- Dynamic Type is left enabled (`allowFontScaling` default). Layouts use flex and
  wrapping rather than fixed heights.
- The health scale bar is `accessibilityElementsHidden` — it repeats information already
  stated exactly in the numerals beside it, so VoiceOver reads the numbers instead of
  describing a shape.
- Reduce Motion is read via `useReducedMotion()` and renders final state rather than
  shortening durations.
- **Contrast.** `text-subtle` (`#6B6B75`) fails WCAG AA on all four Maren surfaces —
  3.80:1 on `#08080A`, 3.60:1 on `#101013`, 3.71:1 on `#0C0C0F`, 3.39:1 on `#17171B`. The
  palette is unchanged, but informational captions and `Label` default to `text-muted`
  (`#A1A1AA`, 6.97–7.81:1), and `subtle` is reserved for text that is decorative or
  duplicated by an adjacent accessible label. BRAND.md's preamble settles the conflict:
  "legible before it is decorative." Worth a decision from whoever owns the palette —
  either `text-subtle` is for non-text ornament, or its hex should rise to about
  `#80808B`, which is the darkest grey that clears 4.5:1 on `#17171B`.
- Errors and blocked states use `accessibilityRole="alert"`.

### Simulator verification

Every screen below was navigated and screenshotted on **iPhone 16 Pro, iOS 18.3**, via
Expo Go against a local Metro bundler. Screenshots land in `apps/ios/.screenshots/`,
which is gitignored — they are verification evidence, not source.

| Shot | What it proves |
|---|---|
| `00`–`02` onboarding | The three panels; panel three states the first-deposit gas exception; pooled-trove risk shown before setup |
| `03` wallet setup | Key handling explained before the choice is offered |
| `04` key created | Honest degradation — Expo Go cannot declare `NSFaceIDUsageDescription`, so the app reports "held in memory for this session only" rather than silently writing an unprotected key |
| `10`–`11` home | Position health hero, balances, quick actions, the corrected gas card |
| `20`–`21` vault | Collateral/debt/limit rows, borrow slider capped at the 180% floor |
| `30`–`31` pay | Send with the relayed-payment banner and the 80-byte memo counter; request with QR |
| `40` earn | Trailing realised MUSD, backward-looking, no APY |
| `50`–`51` activity | The failed send reading "Failed — no funds moved" with the amount struck through; one gas line in the whole ledger |
| `60`–`61` settings | Network, key state, the R12 and R13 disclosures, the stale-feed simulator |
| `70` home, stale feed | The health block is **replaced** by "Price feed unavailable"; the USD valuation disappears rather than being computed from a stale price |
| `71` vault, stale feed | Borrow pinned to 0.00, slider disabled, CTA inert, with the reason: "Price feed is 90s old. Mezo's oracle rejects anything over 60s, so this would revert on-chain." |

The blue gear floating over the right edge of every shot is **Expo Go's own dev-menu
launcher**, not Maren UI. It disappears in a development or release build.

Two things this does *not* prove, and they are the same two the mocked table names: no
screenshot here involved a chain read or a broadcast transaction, and no EAS build has
been run.


---

## Known gaps

- No live chain calls (see the mocked table). Chain reads and submission are stubs; all
  math, formatting and constants around them are real.
- The auth backend and the `apple-app-site-association` file for
  `applinks:maren.finance` do not exist yet, so the R12 flow is implemented but not
  end-to-end exercisable. It fails closed.
- Maren's own contracts are not deployed; `MAREN_ADDRESSES` is all zeros.
- Amount entry on Vault deposit/repay/withdraw uses presets rather than a numeric
  keypad. Borrow — the flow with real risk consequences — has the full slider.
- No EAS build has been run. `eas.json` and `.easignore` are configured and the R14
  enumeration above is complete, which is the prerequisite, not the build itself.
