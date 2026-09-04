# Deploying the Maren relayer

## Status: nothing is deployed

**The relayer is not running anywhere.** No host has been provisioned, no
account has been created, no key exists, and no BTC has been funded. This
document and the files beside it (`Dockerfile`, `docker-compose.yml`,
`fly.toml`, `.env.relayer.example`) prepare the deployment up to the point where
the owner runs one command. Until that command runs, `apps/web` is correct to
say that no relayer is running, and `RELAYER_AVAILABLE` in
`apps/web/src/lib/chain/write.ts` is correctly `false`.

What was verified while writing this, and what was not:

| Claim                                                                                                                    | Verified?                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| The production dependency set (`pnpm install --prod --filter @maren/relayer...` against the committed lockfile) resolves | Yes, run against this lockfile                                                                            |
| That dependency set boots the server and answers `GET /healthz` with 503 plus its reasons                                | Yes, run locally as `node --import tsx src/server.ts` on a prod-only tree                                 |
| The Docker image builds                                                                                                  | **No.** No Docker daemon was available. The install and start steps inside it are the ones verified above |
| The Fly.io deployment works                                                                                              | **No.** No Fly account was created and nothing was deployed                                               |
| The relayer relays a real transaction on matsnet                                                                         | **No.** That needs a funded key, which is step 3 below                                                    |

## Scope: testnet, standalone. Mainnet is a separate decision

`README.md` records the merged decision: **the standalone server is the only
supported target**, and the serverless (Vercel) path is refused in code because
the stuck-transaction sweeper has no process to run in there. Everything in this
document is about running one process on one host, on **testnet (matsnet, 31611)**.

Mainnet is not covered by that decision and is not enabled by this document. The
[mainnet gates](#mainnet-gates) at the end are the list of things that have to be
true first, and at least one of them (a KMS or HSM signer) is not built.

---

## What you need before you start

- A host: a small VM (1 vCPU, 512 MB is enough) or a Fly.io account.
- `foundry` installed locally, for `cast wallet import`. Nothing else.
- A funded source of testnet BTC to top the hot key up from.
- A hostname with TLS if the web app will call this from a browser. The relayer
  does not terminate TLS and should not be exposed directly.

---

## Step 1: provision

### Option A: a VM with Docker Compose

```bash
# on the VM, as a non-root user in the docker group
git clone https://github.com/SeventhOdyssey71/marenfinance.git
cd marenfinance
cp apps/relayer/.env.relayer.example apps/relayer/.env.relayer
mkdir -p apps/relayer/secrets
```

Nothing starts yet. The key comes first, because a relayer with no key boots
into a refusing state and answers 503 on every endpoint that matters.

### Option B: Fly.io

```bash
# from the repo root
fly launch --no-deploy --config apps/relayer/fly.toml
fly volumes create maren_secrets --size 1 --region iad --config apps/relayer/fly.toml
```

`fly launch` will rename the app; nothing in `fly.toml` depends on the name.
Keep `--no-deploy`: the first deploy should happen after the key is on the
volume, or the machine will fail its health check and roll back.

**One machine, always running.** Both are set in `fly.toml` and both matter. The
nonce queue is in-process, so two machines sharing one hot key allocate the same
nonce twice and the chain keeps one transaction. And the stuck-transaction sweep
is what reconciles a reservation against what a transaction actually cost, so a
machine that suspends between requests leaves the budget permanently
over-reserved. Do not set `auto_stop_machines`, do not `fly scale count 2`, and
do not switch the deploy strategy to `bluegreen` or `canary` (both run two
machines at once).

### Option C: Cloudflare Workers (Durable Object)

This is the one serverless-shaped target that is **not** refused, and the reason
is the whole of why Vercel was. The two mechanisms the standalone server owns —
the stuck-transaction sweep (settlement reconciliation + deferred-refund drain)
and a single authoritative nonce sequence — are given real homes here instead of
being dropped:

- The relayer runs inside **one Durable Object**, addressed by a fixed name, so
  every request and the sweep hit the same instance. That is the single-instance
  guarantee `fly.toml`'s "one machine" gives, enforced by the platform rather
  than by remembering not to scale. `VERCEL` is never set, so the multi-instance
  refusal in `create.ts` correctly stays off.
- The sweep runs on the DO's **self-rescheduling alarm**, backed by a **Cron
  Trigger** every two minutes. The alarm is the process that outlives a request;
  the cron revives it if an idle instance ever has none armed. This is exactly
  the "durable trigger" `create.ts` said was missing on serverless.
- Counters (the daily BTC cap, the free-action allowance) live in **Durable
  Object storage** (`worker/durable-store.ts`), so a cold start cannot reset an
  attacker's quota the way the in-memory store would. `/healthz` reports
  `store: "durable"`.

Files: `wrangler.jsonc`, `worker/index.ts` (front door → single DO),
`worker/relayer-do.ts` (boots `createRelayer` with `startWatcher: false`), and
`worker/durable-store.ts`. The relayer's own code is unchanged.

```bash
cd apps/relayer
wrangler login                              # interactive; a browser opens
# Containers/DO need the Workers Paid plan ($5/mo). Enable it in the dashboard.
wrangler secret put RELAYER_PRIVATE_KEY     # paste the testnet hot key
pnpm cf:deploy                              # wrangler deploy
```

Local dev needs no account: `pnpm cf:dev` runs the whole worker in miniflare,
reading the key from a gitignored `.dev.vars` (`RELAYER_PRIVATE_KEY=0x…`).

| Claim                                                                              | Verified?                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The worker bundles and boots (`createRelayer`, pino, viem, the DO, `DurableStore`) | Yes, `pnpm cf:dev` in miniflare                                                                    |
| It answers `/health` + `/healthz` with `accepting: true`, `store: "durable"`       | Yes, locally                                                                                       |
| It reads the signer's real balance and nonce from Mezo testnet through the worker  | Yes — `/health` returned the on-chain balance and nonce (viem `http()` transport works on Workers) |
| The 296 unit tests, `worker/tsconfig` typecheck, and `src` build all pass          | Yes                                                                                                |
| The alarm/cron sweep fires on Cloudflare's schedule                                | **No.** Verified wired; not observed on a real deployment (crons don't auto-fire in local dev)     |
| An actual `wrangler deploy` to Cloudflare                                          | **No.** Needs `wrangler login` (interactive) and the Workers Paid plan — both owner-only           |

For real funds, prefer a keystore over `RELAYER_PRIVATE_KEY` here too — but on
Workers the key is a `wrangler secret`, not a file, so Step 2's keystore-file
mode does not apply; the secret is the whole of the key handling.

---

## Step 2: the signing key

### The preferred mode: a keystore file plus a passphrase file

This is the same pattern the rest of this repo uses for deploy keys. Generate
the key and import it interactively, so neither the key nor the passphrase ever
enters shell history:

```bash
cast wallet new                       # prints a fresh address and private key
cast wallet import maren-relayer --interactive
# paste the private key, then choose a long passphrase
# prints: `maren-relayer` keystore was saved successfully. Address: 0x...
```

Then place both files where the container can read them:

```bash
# VM / Compose
install -m 600 ~/.foundry/keystores/maren-relayer apps/relayer/secrets/keystore.json
printf '%s' 'the-passphrase-you-chose' > apps/relayer/secrets/passphrase
chmod 600 apps/relayer/secrets/passphrase
sudo chown -R 1000:1000 apps/relayer/secrets   # uid 1000 is the image's `node` user
```

```bash
# Fly: upload to the volume instead
fly ssh sftp shell --config apps/relayer/fly.toml
# put apps/relayer/secrets/keystore.json /run/secrets/maren/keystore.json
# put apps/relayer/secrets/passphrase   /run/secrets/maren/passphrase
```

`.env.relayer` and `fly.toml` already point at those two paths:

```
RELAYER_KEYSTORE_PATH=/run/secrets/maren/keystore.json
RELAYER_KEYSTORE_PASSWORD_FILE=/run/secrets/maren/passphrase
```

Two details the relayer will hold you to:

- **Exactly one trailing newline is stripped** from the passphrase file, and
  nothing else. `printf '%s'` writes none, `echo` writes one, and both work. A
  passphrase that genuinely ends in a space is preserved, so a mangled one shows
  up as a keystore MAC mismatch rather than silently.
- **Mode 600.** If either file is group- or world-readable, `/healthz` reports a
  warning naming the file. It is a warning, not a refusal, because a keystore is
  encrypted, but a 644 passphrase file beside it is the whole protection gone.

### The demoted mode: `RELAYER_PRIVATE_KEY`

Still supported, for local development only:

- Every boot logs a `key.dev_mode` **warning** naming it.
- `/healthz` lists it under `warnings` and reports `keySource: "env"`.
- On `RELAYER_NETWORK=mainnet` it is a **boot problem**, not a warning: the
  relayer refuses to relay.

The reason is not theoretical. A raw key in the environment is readable from
`/proc/<pid>/environ`, from `docker inspect`, from a process listing on some
systems, and from anything that serialises the environment into a crash report.
A key file is not.

### Rotation

1. Import a new key and write the new keystore and passphrase files.
2. Restart the relayer (`docker compose up -d` or `fly deploy .`).
3. Confirm `/healthz` reports the new `relayer` address.
4. Sweep the BTC out of the old key.

There is no on-chain step. The relayer holds no role on any Maren contract,
which is the same property that keeps a key compromise cheap (see the threat
model in `README.md`).

---

## Step 3: fund the hot wallet

The address is in `cast wallet import`'s output, and on `/healthz` as `relayer`
once the service is up.

Send **days of float, not months**. At Mezo's gas price a 100,000 gas sponsored
action costs roughly $0.0092, so 0.001 BTC covers thousands of relays at the
time of writing. The daily cap (`RELAYER_MAX_DAILY_SPONSORED_BTC`, no default)
bounds the loss per day; the balance bounds it in total. Both are deliberate:
the cap stops a bad day, the balance stops a bad week.

The relayer stops accepting work below `MIN_BALANCE_WEI` (0.00001 BTC) rather
than starting requests it cannot finish, and `/health` says so.

---

## Step 4: start it

```bash
# VM
docker compose -f apps/relayer/docker-compose.yml up -d --build

# Fly, from the repo root
fly deploy . --config apps/relayer/fly.toml
```

---

## Step 5: smoke test

```bash
BASE=http://127.0.0.1:8787        # or https://your-app.fly.dev

# 1. Is it alive and does it consider itself healthy?
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/healthz"     # expect 200
curl -s "$BASE/healthz" | jq

# 2. Does it agree with you about which key it is holding, and how it got it?
curl -s "$BASE/healthz" | jq '{relayer, chainId, keySource, warnings, problems}'
# expect: keySource "keystore-file", warnings [], problems []

# 3. Is the hot key funded, and is the budget where you set it?
curl -s "$BASE/health" | jq '{balanceBtc, accepting, problems}'
curl -s "$BASE/healthz" | jq '.budget'

# 4. Does an unknown address get a free tier?
curl -s "$BASE/quota/0x0000000000000000000000000000000000000001" | jq

# 5. Does it reject junk rather than accept it?
curl -s -X POST "$BASE/relay" -H 'content-type: application/json' -d '{}' | jq
# expect 400 MALFORMED_REQUEST

curl -s -X POST "$BASE/relay" -H 'content-type: application/json' \
  -d '{"from":"0x0000000000000000000000000000000000000001","to":"0x0000000000000000000000000000000000000002","value":"0","gas":"200000","nonce":"0","deadline":"1","data":"0x","signature":"0x00","payer":"0x0000000000000000000000000000000000000003"}' | jq
# expect 400. A body field naming a funding source is refused by name (R1).
```

A `503` on step 1 is not a failed deploy on its own. Read `problems`: it names
every unresolved gate, and a fresh host with no budget or no key is supposed to
answer exactly that.

The one thing a smoke test cannot do from `curl` alone is a real relay, because
that needs an EIP-712 signature from a user key over a live forwarder nonce. The
first genuine relay is the first sponsored action from the app.

---

## Step 6: point the web app at it

```
NEXT_PUBLIC_RELAYER_URL=https://your-relayer-hostname
```

**That is the whole configuration.** There is no second flag to flip. The
hand-edited `RELAYER_AVAILABLE` this section used to describe is gone: it
recorded an intention rather than a fact, which is why this document had to warn
you not to set it early. The web app now decides per action, from three things
it can check:

1. `NEXT_PUBLIC_RELAYER_URL` is set. Read at build time, so it is the same on
   the server and in the browser.
2. `GET /healthz` answers 200 with `accepting: true`. Probed from the browser,
   cached for 30 seconds, and treated as "no" on any timeout, parse failure or
   unreachable host.
3. `MarenRelayHub` will forward that exact call. Mirrored from
   `script/Deploy.s.sol` in `apps/web/src/lib/chain/relay.ts`.

All three, or the user's own wallet submits and the interface says so before
they press anything. A relayer that is configured but refusing work does not
produce a hanging button; it produces a screen that says you are paying.

**CORS.** The relayer still sets no CORS headers, so a browser on another origin
cannot call it. Put it behind the same hostname as the web app — a path prefix
on your proxy, forwarding `/relay`, `/status`, `/quota`, `/health` and
`/healthz` — and set `NEXT_PUBLIC_RELAYER_URL` to that path. Do not add a
wildcard origin. The health probe fails closed, so an origin the browser blocks
shows up as "the relayer is not taking work" rather than as a broken action, but
it is still a misconfiguration and `/healthz` from `curl` on the host will
disagree with what the app reports.

---

## Operating it

`/healthz` is the runtime tripwire, and the budget block is there because of a
measured defect: adversarial round 2 found concurrent requests overshooting the
daily cap by 52x, and nothing in a running service would have shown it.

```jsonc
{
  "budget": {
    "day": "2026-08-18",
    "limitWei": "2000000000000000",
    "committedWei": "...", // broadcast and never refunded. Only this can halt the day
    "reservedWei": "...", // committed plus in-flight. What the cap is enforced against
    "inFlightWei": "...", // the gap between them. Should return to 0 when idle
    "remainingWei": "...",
    "committedPct": 12.5,
    "reservedPct": 12.5,
    "halted": false,
    "pendingRefunds": 0,
  },
  "nonce": { "next": 42, "inFlight": 0, "queued": 0, "resyncs": 0 },
}
```

What to watch, and what it means:

| Signal                                        | Meaning                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `inFlightWei` non-zero with nothing in flight | Leaked reservations. Compare with `pendingRefunds`; a persistent gap is budget the relayer thinks is spent and is not.               |
| `reservedPct` far above `committedPct`        | Same thing, as a ratio. Transient during a burst, permanent means a leak.                                                            |
| `nonce.queued` climbing                       | Submissions are serialised behind one slow broadcast. Check RPC health.                                                              |
| `nonce.resyncs` climbing                      | Broadcasts are failing and the cached nonce keeps being discarded. One or two is noise, a rising count is an RPC or mempool problem. |
| Log `quota.near_limit`                        | An address or IP has crossed 80% of its daily cap. Logged once per crossing, on admitted requests only.                              |
| Log `budget.near_limit`                       | 80% of the daily BTC budget is reserved.                                                                                             |
| Log `relay.budget_halt`                       | The day's budget is genuinely committed. Relaying stops until 00:00 UTC.                                                             |
| `problems` non-empty                          | The relayer is refusing. Each entry says why.                                                                                        |

`README.md` has the full alert table, including stuck transactions and RPC
capability failures.

### Logs

```bash
docker compose -f apps/relayer/docker-compose.yml logs -f relayer
fly logs --config apps/relayer/fly.toml
```

Logs are JSON. Signatures, private keys, passphrases and raw bodies never reach
the logger, and client IPs are logged as a salted hash.

### Stopping and rolling back

```bash
docker compose -f apps/relayer/docker-compose.yml down          # drains, then stops
fly deploy . --config apps/relayer/fly.toml --image <previous>  # or `fly releases`
```

Shutdown drains in-flight broadcasts for up to `RELAYER_SHUTDOWN_DRAIN_MS`
(20s). The stop grace period in both `docker-compose.yml` (30s) and `fly.toml`
(`kill_timeout = "30s"`) is longer than that on purpose: a SIGKILL between
"nonce allocated" and "broadcast returned" leaves a nonce gap that stalls every
later transaction until it is filled.

---

## Mainnet gates

None of these are satisfied today. This is a list, not a plan with dates.

1. **A KMS or HSM signer. Not implemented.** The best key mode this service has
   is an encrypted file that the process decrypts into memory at boot. That is
   appropriate for a testnet float of a few thousand sats; it is not appropriate
   for a mainnet hot key, because the plaintext key exists in the process and an
   operator with host access can take it. Closing this means a signer interface
   backed by a KMS (sign requests leave the key inside the KMS), which is a code
   change in `chain.ts` and `config.ts`, not a configuration change.
2. **`RELAYER_MAX_DAILY_SPONSORED_BTC` set from a real number**, agreed by
   whoever owns the money, not carried over from testnet.
3. **`MarenRelayHub` shipped**, or the paid tier stays closed and the relayer is
   a pure subsidy bounded only by the free tier and the daily cap.
4. **`MAREN_ADDRESSES` non-zero on mainnet.** It is still the zero address
   there, so the relayer cannot even resolve a forwarder.
5. **A trusted-proxy configuration that matches the real edge.** Without
   `RELAYER_TRUSTED_PROXIES` or a platform header, every client behind the proxy
   shares one per-IP bucket.
6. **Alerting on the signals above**, not a person remembering to curl
   `/healthz`.
7. **A decision on the single-instance constraint.** One process holds the key,
   so a host failure is an outage. Multi-instance needs a shared nonce lease and
   a shared duplicate-request guard, neither of which is built.

`RELAYER_PRIVATE_KEY` being a boot problem on mainnet enforces gate 1's weakest
form (do not run mainnet from an env var) in code. The rest are enforced by
whoever reads this list.
