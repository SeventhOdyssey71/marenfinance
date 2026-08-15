import { getAddress, isAddress, parseEther, type Address } from 'viem';
import {
  getChain,
  getMarenAddresses,
  getMusdAddresses,
  isDeployed,
  resolveNetwork,
  type MezoNetwork,
} from '@maren/sdk';
import {
  functionsFor,
  isMarenContractName,
  type MarenContractName,
  type RelayableFunction,
} from './registry.js';
import { POLICY_DEFAULTS, type SponsorshipPolicy } from './policy.js';
import { parseCidr, type Cidr } from './clientip.js';
import { ephemeralIpSalt } from './logger.js';

/**
 * Configuration, resolved once at boot, FAIL CLOSED.
 *
 * R8 — "Gates fail closed. A missing or malformed environment variable must
 * never widen access. Test the unset case."
 *
 * Talise's failure was `if (APP_ACCESS_OPEN !== "false") return true;` — a
 * pass-through whenever the variable was unset. The shape that avoids it is
 * this one: parsing NEVER throws and NEVER guesses. It returns a config plus a
 * list of `problems`. If `problems` is non-empty the service still boots (so
 * `/health` can explain itself and an operator can see what is wrong) but
 * `POST /relay` returns 503 RELAYER_NOT_ACCEPTING and nothing is ever signed or
 * submitted. There is no code path where an absent variable results in relaying.
 *
 * Note the default state of this repo today: `MAREN_ADDRESSES` in @maren/sdk is
 * all zeroes because the contracts are not deployed yet. So an unconfigured
 * relayer is already in the refusing state, which is the correct default.
 */

export interface AllowedTarget {
  readonly name: MarenContractName;
  readonly address: Address;
  /** Selector -> function. Scoped PER TARGET: `pay` is only valid on MarenPay. */
  readonly functions: ReadonlyMap<string, RelayableFunction>;
}

export type StoreKind = 'memory' | 'redis';

export interface RelayerConfig {
  readonly network: MezoNetwork;
  readonly chainId: number;
  /** Ordered RPC endpoints. The transport fails over down this list. */
  readonly rpcUrls: readonly string[];
  readonly forwarder: Address | null;
  readonly musd: Address;
  /** Address -> allowed target. Keys are lowercased for lookup. */
  readonly targets: ReadonlyMap<string, AllowedTarget>;
  readonly policy: SponsorshipPolicy;
  readonly store: StoreKind;
  readonly redis: { readonly url: string; readonly token: string } | null;
  /** Proxies whose `x-forwarded-for` we are willing to read. Empty = trust none. */
  readonly trustedProxies: readonly Cidr[];
  /** An unforgeable platform header carrying the client IP, if the host sets one. */
  readonly clientIpHeader: string | null;
  /** Salt for per-IP rate-limit buckets. */
  readonly ipSalt: string;
  /** True when `ipSalt` was generated per process — unsafe on multi-instance hosts. */
  readonly ipSaltIsEphemeral: boolean;
  readonly key: KeySource | null;
  readonly port: number;
  readonly logLevel: string;
  /** Seconds to wait for in-flight submissions during graceful shutdown. */
  readonly shutdownDrainMs: number;
  /** How long a submitted tx may sit without a receipt before we replace it. */
  readonly stuckTxMs: number;
  /** How often the standalone server sweeps for stuck transactions. */
  readonly sweepIntervalMs: number;
}

export type KeySource =
  | { readonly kind: 'env'; readonly privateKey: `0x${string}` }
  | {
      readonly kind: 'keystore';
      readonly path: string;
      readonly password: string;
    };

export interface LoadedConfig {
  readonly config: RelayerConfig;
  /** Human-readable reasons this relayer will refuse to relay. Empty = healthy. */
  readonly problems: readonly string[];
}

export type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// small parsers — each one reports a problem instead of guessing
// ---------------------------------------------------------------------------

function readInt(
  env: Env,
  name: string,
  fallback: number,
  problems: string[],
  opts: { min?: number; max?: number } = {},
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    problems.push(`${name} is not an integer (got ${JSON.stringify(raw)})`);
    return 0; // malformed -> most restrictive value, never the permissive fallback
  }
  if (opts.min !== undefined && parsed < opts.min) {
    problems.push(`${name} must be >= ${opts.min}`);
    return 0;
  }
  if (opts.max !== undefined && parsed > opts.max) {
    problems.push(`${name} must be <= ${opts.max}`);
    return 0;
  }
  return parsed;
}

function readBigintEther(env: Env, name: string, problems: string[]): bigint | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const wei = parseEther(raw.trim());
    if (wei < 0n) {
      problems.push(`${name} must not be negative`);
      return 0n;
    }
    return wei;
  } catch {
    problems.push(`${name} is not a decimal amount (got ${JSON.stringify(raw)})`);
    return 0n; // malformed -> zero budget -> deny
  }
}

function readAddress(env: Env, name: string, problems: string[]): Address | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = raw.trim();
  if (!isAddress(value)) {
    problems.push(`${name} is not a valid address`);
    return null;
  }
  return getAddress(value);
}

function splitList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ---------------------------------------------------------------------------
// allowlist
// ---------------------------------------------------------------------------

/**
 * Build the target allowlist.
 *
 * Sources, in order:
 *   1. `RELAYER_ALLOWED_TARGETS` — explicit `name:0xaddress` pairs. An operator
 *      needs this between deploying a contract and regenerating the SDK address
 *      book. An unknown contract name is a hard problem, not a silent skip.
 *   2. Otherwise, the non-zero addresses in `@maren/sdk`'s MAREN_ADDRESSES.
 *
 * If both are empty the allowlist is empty and the relayer refuses everything.
 * Falling back to "allow all Maren contracts" would not be a fallback, it would
 * be a hole, because `MAREN_ADDRESSES` is all zeroes until deployment day.
 *
 * `RELAYER_ALLOWED_FUNCTIONS` can only NARROW the code-level registry. There is
 * no syntax for adding a selector that is not already in registry.ts.
 */
function buildTargets(
  env: Env,
  network: MezoNetwork,
  problems: string[],
): Map<string, AllowedTarget> {
  const pairs: Array<{ name: MarenContractName; address: Address }> = [];
  const explicit = splitList(env['RELAYER_ALLOWED_TARGETS']);

  if (explicit.length > 0) {
    for (const entry of explicit) {
      const [rawName, rawAddress, ...rest] = entry.split(':');
      if (rawName === undefined || rawAddress === undefined || rest.length > 0) {
        problems.push(
          `RELAYER_ALLOWED_TARGETS entry ${JSON.stringify(entry)} is not in "name:0xaddress" form`,
        );
        continue;
      }
      const name = rawName.trim();
      const address = rawAddress.trim();
      if (!isMarenContractName(name)) {
        problems.push(`RELAYER_ALLOWED_TARGETS names unknown contract ${JSON.stringify(name)}`);
        continue;
      }
      if (!isAddress(address)) {
        problems.push(`RELAYER_ALLOWED_TARGETS address for ${name} is not a valid address`);
        continue;
      }
      pairs.push({ name, address: getAddress(address) });
    }
  } else {
    const deployed = getMarenAddresses(network);
    for (const name of ['marenPay', 'marenRegistry', 'marenVault', 'marenEarn'] as const) {
      const address = deployed[name];
      if (isDeployed(address)) pairs.push({ name, address: getAddress(address) });
    }
  }

  // Optional narrowing filter on function ids, e.g. "marenPay.pay,marenPay.payTo".
  const allowedIdsRaw = env['RELAYER_ALLOWED_FUNCTIONS'];
  const narrowing = allowedIdsRaw === undefined ? null : new Set(splitList(allowedIdsRaw));
  if (narrowing !== null) {
    const known = new Set(
      pairs.flatMap(({ name }) => functionsFor(name).map((f) => f.id)),
    );
    for (const id of narrowing) {
      if (!known.has(id)) {
        problems.push(
          `RELAYER_ALLOWED_FUNCTIONS names ${JSON.stringify(id)}, which is not a relayable function on any allowed target`,
        );
      }
    }
  }

  const targets = new Map<string, AllowedTarget>();
  for (const { name, address } of pairs) {
    const functions = new Map<string, RelayableFunction>();
    for (const f of functionsFor(name)) {
      if (narrowing !== null && !narrowing.has(f.id)) continue;
      functions.set(f.selector.toLowerCase(), f);
    }
    if (functions.size === 0) {
      // Narrowed out entirely: drop the target rather than keep an address that
      // can never be called. If narrowing empties EVERY target the allowlist is
      // empty, and the caller turns that into a refusal.
      continue;
    }
    const key = address.toLowerCase();
    if (targets.has(key)) {
      problems.push(`address ${address} is listed more than once in RELAYER_ALLOWED_TARGETS`);
      continue;
    }
    targets.set(key, { name, address, functions });
  }
  return targets;
}

// ---------------------------------------------------------------------------
// RPC endpoints
// ---------------------------------------------------------------------------

/**
 * Resolve an ORDERED list of RPC endpoints, for failover.
 *
 * Sources, in order:
 *   1. `RELAYER_RPC_URLS` (comma-separated) or the singular `RELAYER_RPC_URL`
 *   2. `MEZO_{MAINNET,TESTNET}_RPC_URL`, which the repo's .env.example already has
 *   3. `@maren/sdk`'s chain definition, which lists every known endpoint ordered
 *      by observed stability
 *
 * NO endpoint is filtered here. An earlier revision carried a host denylist
 * built from a single probe sweep; the finding did not reproduce — the provider
 * served every method 10/10 an hour later, and what had been measured was a
 * degraded backend reporting -32601 instead of unavailability. A static block
 * against a working provider is a bug, and R13 ("do not claim what you have not
 * substantiated") cuts both ways.
 *
 * Endpoint health is decided at boot by the capability preflight in rpc.ts,
 * which repeat-probes and drops only what is failing right now. That handles
 * the real hazard — transient per-endpoint failures — which a denylist cannot.
 */
function resolveRpcUrls(
  env: Env,
  network: MezoNetwork,
  chainDefaults: readonly string[],
  problems: string[],
): string[] {
  const explicit = [
    ...splitList(env['RELAYER_RPC_URLS']),
    ...(env['RELAYER_RPC_URL']?.trim() ? [env['RELAYER_RPC_URL'].trim()] : []),
  ];
  const perNetwork = (
    network === 'mainnet' ? env['MEZO_MAINNET_RPC_URL'] : env['MEZO_TESTNET_RPC_URL']
  )?.trim();

  const candidates =
    explicit.length > 0 ? explicit : perNetwork ? [perNetwork] : [...chainDefaults];

  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const candidate of candidates) {
    const url = candidate.replace(/\/+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    resolved.push(url);
  }

  if (resolved.length === 0) {
    problems.push('no usable RPC endpoint configured for this network');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// key source
// ---------------------------------------------------------------------------

function buildKeySource(env: Env, problems: string[]): KeySource | null {
  const privateKey = env['RELAYER_PRIVATE_KEY']?.trim();
  const keystorePath = env['RELAYER_KEYSTORE_PATH']?.trim();
  const keystorePassword = env['RELAYER_KEYSTORE_PASSWORD'];

  if (privateKey !== undefined && privateKey !== '' && keystorePath !== undefined && keystorePath !== '') {
    problems.push(
      'RELAYER_PRIVATE_KEY and RELAYER_KEYSTORE_PATH are both set; set exactly one so there is no ambiguity about which key signs',
    );
    return null;
  }
  if (privateKey !== undefined && privateKey !== '') {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      // Deliberately does not echo the value.
      problems.push('RELAYER_PRIVATE_KEY is not a 32-byte 0x-prefixed hex string');
      return null;
    }
    return { kind: 'env', privateKey: privateKey as `0x${string}` };
  }
  if (keystorePath !== undefined && keystorePath !== '') {
    if (keystorePassword === undefined) {
      problems.push('RELAYER_KEYSTORE_PATH is set but RELAYER_KEYSTORE_PASSWORD is not');
      return null;
    }
    return { kind: 'keystore', path: keystorePath, password: keystorePassword };
  }
  problems.push(
    'no signing key configured: set RELAYER_PRIVATE_KEY, or RELAYER_KEYSTORE_PATH + RELAYER_KEYSTORE_PASSWORD for a `cast wallet` keystore',
  );
  return null;
}

// ---------------------------------------------------------------------------

export function loadConfig(env: Env): LoadedConfig {
  const problems: string[] = [];

  const network = resolveNetwork(env['RELAYER_NETWORK'] ?? env['NEXT_PUBLIC_MEZO_NETWORK']);
  const chain = getChain(network);
  const rpcUrls = resolveRpcUrls(env, network, chain.rpcUrls.default.http, problems);

  const forwarderFromEnv = readAddress(env, 'RELAYER_FORWARDER_ADDRESS', problems);
  const forwarderFromSdk = getMarenAddresses(network).marenForwarder;
  const forwarder =
    forwarderFromEnv ?? (isDeployed(forwarderFromSdk) ? getAddress(forwarderFromSdk) : null);
  if (forwarder === null) {
    problems.push(
      'no MarenForwarder address: set RELAYER_FORWARDER_ADDRESS (MAREN_ADDRESSES in @maren/sdk is still the zero address on this network)',
    );
  }

  const targets = buildTargets(env, network, problems);
  if (targets.size === 0) {
    problems.push(
      'target allowlist is empty: set RELAYER_ALLOWED_TARGETS as "marenPay:0x...,marenRegistry:0x..." — the relayer will not relay to an unlisted contract',
    );
  }

  const maxDailySpendWei = readBigintEther(env, 'RELAYER_MAX_DAILY_SPONSORED_BTC', problems);
  if (maxDailySpendWei === null) {
    problems.push(
      'RELAYER_MAX_DAILY_SPONSORED_BTC is not set; without a stated daily BTC cap the relayer will not sponsor anything',
    );
  } else if (maxDailySpendWei === 0n) {
    problems.push('RELAYER_MAX_DAILY_SPONSORED_BTC is zero, so no request can be sponsored');
  }

  // A missing fee is NOT zero. It means the paid tier is closed (see policy.ts).
  const feeMusdWei = readBigintEther(env, 'RELAYER_FEE_MUSD', problems);

  const policy: SponsorshipPolicy = {
    freeActionsPerAddress: readInt(
      env,
      'RELAYER_FREE_ACTIONS_PER_ADDRESS',
      POLICY_DEFAULTS.freeActionsPerAddress,
      problems,
      { min: 0 },
    ),
    feeMusdWei,
    maxDailySpendWei: maxDailySpendWei ?? 0n,
    maxActionsPerAddressPerDay: readInt(
      env,
      'RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY',
      POLICY_DEFAULTS.maxActionsPerAddressPerDay,
      problems,
      { min: 0 },
    ),
    maxActionsPerIpPerDay: readInt(
      env,
      'RELAYER_MAX_ACTIONS_PER_IP_DAY',
      POLICY_DEFAULTS.maxActionsPerIpPerDay,
      problems,
      { min: 0 },
    ),
    maxGasPerRequest: BigInt(
      readInt(env, 'RELAYER_MAX_GAS_PER_REQUEST', Number(POLICY_DEFAULTS.maxGasPerRequest), problems, {
        min: 0,
      }),
    ),
    // Never above the general cap: a looser contract-signer ceiling would defeat
    // the point of having one.
    maxGasContractSigner: (() => {
      const configured = BigInt(
        readInt(
          env,
          'RELAYER_MAX_GAS_CONTRACT_SIGNER',
          Number(POLICY_DEFAULTS.maxGasContractSigner),
          problems,
          { min: 0 },
        ),
      );
      const general = BigInt(
        readInt(env, 'RELAYER_MAX_GAS_PER_REQUEST', Number(POLICY_DEFAULTS.maxGasPerRequest), [], {
          min: 0,
        }),
      );
      return configured < general ? configured : general;
    })(),
    maxDeadlineSeconds: readInt(
      env,
      'RELAYER_MAX_DEADLINE_SECONDS',
      POLICY_DEFAULTS.maxDeadlineSeconds,
      problems,
      { min: 0 },
    ),
  };

  const storeRaw = env['RELAYER_STORE']?.trim() ?? 'memory';
  let store: StoreKind = 'memory';
  if (storeRaw === 'memory' || storeRaw === 'redis') {
    store = storeRaw;
  } else {
    problems.push(`RELAYER_STORE must be "memory" or "redis" (got ${JSON.stringify(storeRaw)})`);
  }

  let redis: RelayerConfig['redis'] = null;
  if (store === 'redis') {
    const url = env['UPSTASH_REDIS_REST_URL']?.trim();
    const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim();
    if (!url || !token) {
      problems.push(
        'RELAYER_STORE=redis requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
      );
    } else {
      redis = { url: url.replace(/\/+$/, ''), token };
    }
  }

  // Trusted proxies. A malformed entry is a problem, never a silently-trusted
  // one — the whole point is that this list is the only reason we would believe
  // an `x-forwarded-for` header at all.
  const trustedProxies: Cidr[] = [];
  for (const entry of splitList(env['RELAYER_TRUSTED_PROXIES'])) {
    const cidr = parseCidr(entry);
    if (cidr === null) {
      problems.push(
        `RELAYER_TRUSTED_PROXIES entry ${JSON.stringify(entry)} is not an IP or CIDR`,
      );
      continue;
    }
    trustedProxies.push(cidr);
  }

  // On Vercel the edge overwrites `x-vercel-forwarded-for`, so it cannot be
  // forged by a client and is the correct source. Elsewhere an operator names
  // their own platform header explicitly or we fall back to the socket.
  const clientIpHeader =
    env['RELAYER_CLIENT_IP_HEADER']?.trim().toLowerCase() ||
    (env['VERCEL'] !== undefined ? 'x-vercel-forwarded-for' : null);

  const configuredIpSalt = env['RELAYER_IP_SALT']?.trim() || null;

  const key = buildKeySource(env, problems);

  const config: RelayerConfig = {
    network,
    chainId: chain.id,
    rpcUrls,
    forwarder,
    musd: getAddress(getMusdAddresses(network).musd),
    targets,
    policy,
    store,
    redis,
    trustedProxies,
    clientIpHeader,
    ipSalt: configuredIpSalt ?? ephemeralIpSalt(),
    ipSaltIsEphemeral: configuredIpSalt === null,
    key,
    port: readInt(env, 'PORT', 8787, problems, { min: 1, max: 65535 }),
    logLevel: env['LOG_LEVEL']?.trim() || 'info',
    shutdownDrainMs: readInt(env, 'RELAYER_SHUTDOWN_DRAIN_MS', 20_000, problems, { min: 0 }),
    stuckTxMs: readInt(env, 'RELAYER_STUCK_TX_MS', 45_000, problems, { min: 1000 }),
    sweepIntervalMs: readInt(env, 'RELAYER_SWEEP_INTERVAL_MS', 10_000, problems, { min: 1000 }),
  };

  return { config, problems };
}
