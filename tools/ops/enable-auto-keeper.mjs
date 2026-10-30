#!/usr/bin/env node
/**
 * Make the two borrowing repairs permissionless, and run the first one.
 *
 * WHY. Borrowing stops when the pooled trove's ratio falls under the vault's 180% floor
 * because collateral sits idle beside it, or when Mezo's frozen ceiling fills. Both repairs
 * were KEEPER_ROLE-only on MarenVault, held by one key behind a keystore password, so twice
 * borrowing sat dead until a person was free to type it. MarenAutoKeeper holds that role and
 * exposes exactly those two repairs to anyone, sized and gated on-chain
 * (packages/contracts/src/MarenAutoKeeper.sol). After this runs once, nobody needs the
 * keystore to un-stick borrowing again.
 *
 * WHAT IT SENDS, with --execute (Foundry prompts for the keystore password; this script never
 * reads it):
 *   1. forge script DeployAutoKeeper: deploy MarenAutoKeeper + grant it KEEPER_ROLE, one
 *      broadcast, verified on Blockscout. Skipped if a keeper with the role is already
 *      recorded in deployments/31611.json.
 *   2. cast send MarenAutoKeeper.rebalance(): the first repair, only if the trove needs it.
 *      Separate because it reads Mezo's oracle precompile, which forge cannot simulate.
 *
 * Usage:
 *   node tools/ops/enable-auto-keeper.mjs             # read-only: state, plan, simulation
 *   node tools/ops/enable-auto-keeper.mjs --execute   [--account maren-deployer]
 *     [--password-file <path>] [--rpc <url>] [--no-verify]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'https://rpc.test.mezo.org' },
    account: { type: 'string', default: 'maren-deployer' },
    execute: { type: 'boolean', default: false },
    'password-file': { type: 'string' },
    'no-verify': { type: 'boolean', default: false },
  },
});
const RPC = options.rpc;
const ACCOUNT = options.account;
const PASSWORD_FILE = options['password-file'];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACTS = join(ROOT, 'packages/contracts');
const DEPLOYMENTS = join(CONTRACTS, 'deployments/31611.json');
const BROADCAST = join(CONTRACTS, 'broadcast/DeployAutoKeeper.s.sol/31611/run-latest.json');

const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const PRICE_FEED = '0x86bCF0841622a5dAC14A313a15f96A95421b9366';
const ADMIN = '0x54196397D6f01b48739dB3957257cB33cD341885';
const ZERO = '0x0000000000000000000000000000000000000000';
const DEFAULT_ADMIN_ROLE = '0x' + '0'.repeat(64);
const MARGIN_BPS = 12_500n;

/** Transport blips are retried; answers (reverts, refusals) are not. See topup-collateral.mjs. */
const TRANSIENT = /error sending request|connection (closed|reset)|timed out|timeout|EOF|50[234]/i;
function cast(args, { allowFail = false, retries = 4 } = {}) {
  let detail = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const r = spawnSync('cast', args, { encoding: 'utf8', timeout: 30_000 });
    if (r.error) {
      detail =
        r.error.code === 'ENOENT' ? 'cast not found on PATH — install Foundry' : 'cast timed out';
      if (r.error.code === 'ENOENT') break;
    } else if (r.status === 0) {
      return { value: (r.stdout || '').trim() };
    } else {
      detail = (r.stderr || r.stdout || '').trim().split('\n')[0];
      if (!TRANSIENT.test(detail)) break;
    }
    if (attempt < retries) spawnSync('sleep', [String(0.4 * (attempt + 1))]);
  }
  if (allowFail) return { error: detail };
  throw new Error(`cast ${args.slice(0, 2).join(' ')} failed: ${detail}`);
}
const read = (to, sig, ...a) =>
  cast(['call', to, sig, ...a, '--rpc-url', RPC]).value.split(/\s+/)[0];
const btc = (w) => (Number(w) / 1e18).toFixed(6);
const pct = (w) => `${(Number(w) / 1e16).toFixed(1)}%`;
const line = (l, v) => process.stdout.write(`  ${l.padEnd(30)} ${v}\n`);
const keystoreArgs = () => [
  '--account',
  ACCOUNT,
  ...(PASSWORD_FILE ? ['--password-file', PASSWORD_FILE] : []),
];

// --- identity ----------------------------------------------------------------
if (Number(cast(['chain-id', '--rpc-url', RPC]).value) !== 31611)
  throw new Error('Refusing: this tool is for Mezo testnet (31611) only.');
if (read(VAULT, 'troveManager()(address)').toLowerCase() !== TROVE_MANAGER.toLowerCase())
  throw new Error('Refusing: vault is linked to an unexpected TroveManager.');
if (read(VAULT, 'hasRole(bytes32,address)(bool)', DEFAULT_ADMIN_ROLE, ADMIN) !== 'true')
  throw new Error('Refusing: the expected admin no longer holds DEFAULT_ADMIN_ROLE.');
const keeperRole = read(VAULT, 'KEEPER_ROLE()(bytes32)');

function recordedKeeper() {
  if (!existsSync(DEPLOYMENTS)) return null;
  const a = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')).marenAutoKeeper;
  if (!a) return null;
  return read(VAULT, 'hasRole(bytes32,address)(bool)', keeperRole, a) === 'true' ? a : null;
}

// --- state ---------------------------------------------------------------------
function state() {
  const price = BigInt(read(PRICE_FEED, 'fetchPrice()(uint256)'));
  const coll = BigInt(read(TROVE_MANAGER, 'getTroveColl(address)(uint256)', VAULT));
  const debt = BigInt(read(TROVE_MANAGER, 'getTroveDebt(address)(uint256)', VAULT));
  const ceiling = BigInt(
    read(TROVE_MANAGER, 'getTroveMaxBorrowingCapacity(address)(uint256)', VAULT),
  );
  const idle = BigInt(read(VAULT, 'idleCollateral()(uint256)'));
  const floor = BigInt(read(VAULT, 'MIN_TROVE_CR()(uint256)'));
  // The contract's own sizing, mirrored so the plan can be shown before it exists.
  const target = (((ceiling * floor) / price) * MARGIN_BPS) / 10_000n;
  const need = target > coll ? target - coll : 0n;
  const push = need < idle ? need : idle;
  return { price, coll, debt, ceiling, idle, floor, push, icr: (coll * price) / debt };
}

let keeper = recordedKeeper();
const before = state();
process.stdout.write('\nPooled trove, read live\n');
line('trove ICR', `${pct(before.icr)}  against a ${pct(before.floor)} floor`);
line('collateral in the trove', `${btc(before.coll)} BTC`);
line('idle in the vault', `${btc(before.idle)} BTC`);
line('ceiling used', `${((Number(before.debt) / Number(before.ceiling)) * 100).toFixed(1)}%`);
line('MarenAutoKeeper', keeper ?? 'not deployed');

process.stdout.write('\nPlan\n');
if (!keeper) line('1. deploy + grant KEEPER_ROLE', 'forge script DeployAutoKeeper (one prompt)');
line(
  `${keeper ? '1' : '2'}. first rebalance`,
  before.push > 0n
    ? `push ${btc(before.push)} BTC -> ICR ${pct(((before.coll + before.push) * before.price) / before.debt)} (one prompt)`
    : 'nothing to push',
);

if (!options.execute) {
  process.stdout.write('\nRead-only. Re-run with --execute to send:\n\n');
  process.stdout.write('  node tools/ops/enable-auto-keeper.mjs --execute\n\n');
  process.stdout.write(
    'Foundry prompts for the keystore password; this script never reads it.\n\n',
  );
  process.exit(0);
}

// --- 1. deploy -------------------------------------------------------------------
if (!keeper) {
  process.stdout.write('\nDeploying MarenAutoKeeper\n\n');
  const args = [
    'script',
    'script/DeployAutoKeeper.s.sol',
    '--rpc-url',
    RPC,
    '--broadcast',
    ...keystoreArgs(),
    '--sender',
    ADMIN,
    ...(options['no-verify']
      ? []
      : [
          '--verify',
          '--verifier',
          'blockscout',
          '--verifier-url',
          'https://api.explorer.test.mezo.org/api',
        ]),
  ];
  // forge writes run-latest.json (and a timestamped copy) with the PLANNED transactions
  // BEFORE it asks for the keystore password, so an unsigned attempt looks exactly like a
  // deployment. Clear the latest record first, and below trust only receipts plus code
  // actually on chain. A first run reported "Deployed 0x13C9..." this way after Foundry had
  // rejected the password and sent nothing.
  rmSync(BROADCAST, { force: true });
  const r = spawnSync('forge', args, { cwd: CONTRACTS, stdio: 'inherit' });
  const run = existsSync(BROADCAST) ? JSON.parse(readFileSync(BROADCAST, 'utf8')) : null;
  const created = run?.transactions?.find(
    (t) => t.transactionType === 'CREATE' && t.contractName === 'MarenAutoKeeper',
  );
  const landed =
    (run?.receipts?.length ?? 0) > 0 &&
    Boolean(created?.contractAddress) &&
    cast(['code', created.contractAddress, '--rpc-url', RPC]).value !== '0x';
  if (!landed) {
    // Real broadcast records are committed (they carry tx hashes); an unsigned one would be
    // a false record, so remove every record of this attempt that holds no receipts.
    const dir = dirname(BROADCAST);
    for (const f of existsSync(dir) ? readdirSync(dir) : []) {
      if (!/^run-.*\.json$/.test(f)) continue;
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if ((rec.receipts?.length ?? 0) === 0) rmSync(join(dir, f));
    }
    console.error(
      `\nNothing was deployed (forge exited ${r.status}). If Foundry said "incorrect password",` +
        '\nno transaction was signed or sent. Re-run and type the maren-deployer keystore password.\n',
    );
    process.exit(r.status || 1);
  }
  // A failed Blockscout verification exits non-zero AFTER the broadcast landed, so the
  // receipts decide what happened, not the exit code.
  const address = cast(['to-check-sum-address', created.contractAddress]).value;
  if (read(VAULT, 'hasRole(bytes32,address)(bool)', keeperRole, address) !== 'true')
    throw new Error(`Deployed ${address}, but it does not hold KEEPER_ROLE. Check the grant tx.`);
  const json = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8'));
  json.marenAutoKeeper = address;
  writeFileSync(DEPLOYMENTS, JSON.stringify(json, null, 2) + '\n');
  keeper = address;
  if (r.status !== 0)
    process.stdout.write(
      '\nDeployed and granted; Blockscout verification did not finish. Re-run\n' +
        `  forge verify-contract ${address} src/MarenAutoKeeper.sol:MarenAutoKeeper --verifier blockscout ...\n`,
    );
  line('MarenAutoKeeper', `${address}  (recorded in deployments/31611.json)`);
}

// --- 2. first rebalance ----------------------------------------------------------
const now = state();
if (now.push === 0n) {
  process.stdout.write('\nNothing to push; the trove already holds enough. Done.\n\n');
  process.exit(0);
}
const est = cast(
  ['estimate', keeper, 'rebalance(address,address)', ZERO, ZERO, '--from', ADMIN, '--rpc-url', RPC],
  {
    allowFail: true,
  },
);
if (est.error) {
  console.error(`\nSimulation of rebalance() failed: ${est.error}`);
  console.error('Usually a stale oracle (Mezo reverts past 60s). Anyone can retry later:');
  console.error(
    `  cast send ${keeper} 'rebalance(address,address)' ${ZERO} ${ZERO} --account <any funded key>\n`,
  );
  process.exit(1);
}
const gasLimit = Math.ceil(Number(est.value) * 1.5);
process.stdout.write('\nSending the first rebalance()\n\n');
const sent = spawnSync(
  'cast',
  [
    'send',
    keeper,
    'rebalance(address,address)',
    ZERO,
    ZERO,
    ...keystoreArgs(),
    '--from',
    ADMIN,
    '--rpc-url',
    RPC,
    '--gas-limit',
    String(gasLimit),
  ],
  { stdio: 'inherit' },
);
if (sent.status !== 0) {
  console.error('\ncast send did not return success. Check a receipt before retrying.');
  process.exit(sent.status ?? 1);
}

const after = state();
process.stdout.write('\nAfter\n');
line('trove ICR', `${pct(before.icr)} -> ${pct(after.icr)}`);
line('idle in the vault', `${btc(before.idle)} -> ${btc(after.idle)} BTC`);
process.stdout.write(
  `\nFrom now on anyone can run the repair:  cast send ${keeper} 'rebalance(address,address)' ${ZERO} ${ZERO}\n` +
    'Run tools/ops/readiness.mjs to confirm borrowing limits moved.\n\n',
);
