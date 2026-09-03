# Archive

Code that is no longer part of the active build but is kept for reference and
recovery. Nothing in here is a pnpm workspace member (the workspace globs only
cover `apps/*`, `packages/*`, `tools/*`), so it is not installed, built, or
tested by `turbo`.

## `ios/` — the original Expo / React Native app

Superseded by the native SwiftUI app in `apps/ios-native`. Archived on
2026-09-03 once the Swift port reached feature parity (Finance, Pay, Activity,
Profile, Scan) with a golden-tested chain layer.

It is retained until the native app has been exercised end-to-end against a
hosted relayer on testnet. If that path proves out, this can be deleted — the
git history preserves it either way.

### To restore it

```sh
git mv _archive/ios apps/ios
pnpm install   # re-adds it to the workspace
```
