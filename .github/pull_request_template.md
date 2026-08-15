# Summary

<!-- What changed and why, in 2-4 sentences. -->

## Scope

- [ ] Contracts (`packages/contracts`)
- [ ] SDK (`packages/sdk`)
- [ ] Web (`apps/web`)
- [ ] iOS (`apps/ios`)
- [ ] Relayer (`apps/relayer`)
- [ ] Docs (`docs/`)

## Mezo impact

<!-- Anything that touches chain config, contract addresses, gas assumptions, or MUSD
     protocol integration. State the network(s) affected: matsnet / mainnet / both. -->

- Networks affected:
- New/changed contract addresses:
- Gas or sponsorship implications:

## Verification

<!-- How you proved this works. Paste command output, not claims. -->

```
# e.g. forge test -vvv output, or the exact pnpm command run
```

- [ ] `forge test` passes (if contracts touched)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes
- [ ] Manually exercised on Mezo testnet (tx hash: `0x...`)

## Risk

<!-- What could break, and the blast radius. Say "none" only if you mean it. -->

## Screenshots / recordings

<!-- Required for any user-facing UI change. -->
