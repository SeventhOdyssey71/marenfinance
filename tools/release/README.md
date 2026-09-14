# Testnet release checks

All commands are read-only. They never request a key, sign, submit a transaction,
or write to a hosted service.

```bash
pnpm release:test
pnpm release:attest --local
pnpm release:attest --out /tmp/maren-configuration.json
pnpm release:check --out /tmp/maren-http.json
pnpm release:check --require-recovery --out /tmp/maren-rollout.json
```

`release:attest` compares native and Worker testnet configuration to the SDK. In
online mode it pins contract reads to one block, checks chain identity, deployed
code presence, the forwarder domain, target trust and relay selectors, and reads
deep relayer health. Code hashes are observations, not source verification.
`--rpc URL` and `--relayer URL` select explicit testnet endpoints. Prefer absolute
output paths: this workspace command runs from `tools/release`.

`release:check` checks public HTML, the intended `/app` 404 gate, CORS, and shallow
relay health. Use `--web-app` only for a release that deliberately enables the
dashboard. `--require-recovery` additionally requires the new durable journal to
be present, unblocked, and drained. An older healthy relay fails this final rollout
gate. Normal operation may have pending transactions; this is a release acceptance
check, not a liveness monitor. `--web URL` and `--relayer URL` override defaults.

Failures exit nonzero and are retained in JSON. Reports distinguish local revision
and working changes from remote observations. Neither command certifies the
deployed web/iOS/Worker revision, a successful user transaction, a security audit,
or mainnet readiness.
