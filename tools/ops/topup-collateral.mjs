#!/usr/bin/env node
/**
 * Push idle collateral into the pooled trove, and refuse to do it blind.
 *
 * WHY THIS IS SEPARATE FROM THE CEILING. Borrowing stops for two unrelated reasons and
 * they need different levers. `refinance-trove.mjs` raises `maxBorrowingCapacity`, which
 * Mezo freezes at the price the trove opened at. This one fixes the other wall: the
 * pooled ICR that `MarenVault._borrow` checks against MIN_TROVE_CR AFTER the draw, where
 * only collateral INSIDE the trove counts.
 *
 * On 22 September the vault held 0.281 BTC while the trove held 0.069 — 75% of all pool
 * collateral sitting idle — so the trove sat at 183% against its own 180% floor and
 * pool-wide borrowing was capped at ~159 MUSD, with 2,097 MUSD of ceiling headroom going
 * unused. Every collateral figure looked healthy the whole time.
 *
 * THE CAUSE WAS A GAS BUG, NOT A POLICY. `deposit` wraps `addColl` in `_tryPushCollateral`,
 * whose catch holds the BTC idle instead of reverting, so `eth_estimateGas` priced the
 * fallback and every estimate-sized deposit took it. That is fixed in both clients (the
 * limit is now sized from the push path), but the fix only stops idle REBUILDING — it
 * cannot move what has already accumulated. That is what this is for.
 *
 * IT DOES NOT PUSH EVERYTHING BY DEFAULT. `_sendCollateral` spends idle first, so idle is
 * what makes withdrawals cheap and independent of the trove. The default pushes the least
 * that makes the ceiling the binding limit again, times a margin so an ordinary price move
 * does not immediately re-bind, and leaves the rest alone.
 *
 * Read-only unless you pass --execute. The key stays in Foundry's keystore throughout.
 *
 * Usage:
 *   node tools/ops/topup-collateral.mjs                       # diagnose only
 *   node tools/ops/topup-collateral.mjs --execute
 *     [--amount 0.05] [--all] [--margin 1.25]
 *     [--account maren-deployer] [--rpc <url>] [--password-file <path>]
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'https://rpc.test.mezo.org' },
    account: { type: 'string', default: 'maren-deployer' },
    execute: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    amount: { type: 'string' },
    margin: { type: 'string', default: '1.25' },
    'password-file': { type: 'string' },
  },
});
const RPC = options.rpc;
const ACCOUNT = options.account;
const EXECUTE = options.execute;
const PASSWORD_FILE = options['password-file'];

const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const SORTED_TROVES = '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA';
const PRICE_FEED = '0x86bCF0841622a5dAC14A313a15f96A95421b9366';
const KEEPER = '0x54196397D6f01b48739dB3957257cB33cD341885';
const WAD = 10n ** 18n;

/**
 * A TRANSPORT BLIP IS NOT AN ANSWER. Mezo's public RPC drops requests under a rapid
 * sequence of calls — this tool makes about a dozen — and the first two runs of it died on
 * "error sending request for url" while `cast block-number` succeeded three times in a row
 * either side. An ops tool that aborts a keeper repair because one read out of twelve was
 * dropped is not usable, so transport failures are retried with a short backoff.
 *
 * Only transport failures. A revert, a bad status, a missing selector and a refused
 * keystore are all the node or Foundry ANSWERING, and retrying those would just be
 * asking the same question until the wording changes. `send` is never retried here
 * either: it is called once, from the execute path, where a resubmission could double up.
 */
const TRANSIENT =
  /error sending request|connection (closed|reset)|timed out|timeout|EOF|503|502|504/i;

function cast(args, { allowFail = false, retries = 4 } = {}) {
  let lastDetail = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const r = spawnSync('cast', args, { encoding: 'utf8', timeout: 30_000 });
    if (r.error) {
      lastDetail =
        r.error.code === 'ENOENT' ? 'cast not found on PATH — install Foundry' : 'cast timed out';
      if (r.error.code === 'ENOENT') break;
    } else if (r.status === 0) {
      return { value: (r.stdout || '').trim() };
    } else {
      lastDetail = (r.stderr || r.stdout || '').trim().split('\n')[0];
      if (!TRANSIENT.test(lastDetail)) break;
    }
    if (attempt < retries) spawnSync('sleep', [String(0.4 * (attempt + 1))]);
  }
  if (allowFail) return { error: lastDetail };
  if (args[0] === 'wallet') throw new Error('Could not unlock the configured keeper keystore.');
  throw new Error(`cast ${args.slice(0, 2).join(' ')} failed: ${lastDetail}`);
}
let snapshotBlock = 'latest';
/** `sig` is a full signature, so cast derives the selector — we never type one. */
const read = (to, sig, ...a) =>
  cast(['call', to, sig, ...a, '--rpc-url', RPC, '--block', snapshotBlock]).value.split(/\s+/)[0];

const musd = (w) => (Number(w) / 1e18).toFixed(2);
const btc = (w) => (Number(w) / 1e18).toFixed(6);
const line = (l, v) => process.stdout.write(`  ${l.padEnd(28)} ${v}\n`);

// --- identity, pinned to one block so every figure agrees -------------------
if (Number(cast(['chain-id', '--rpc-url', RPC]).value) !== 31611)
  throw new Error('Refusing: this keeper tool is for Mezo testnet (31611) only.');
snapshotBlock = cast(['block-number', '--rpc-url', RPC]).value;
if (!/^\d+$/.test(snapshotBlock)) throw new Error('Could not read a block number.');
if (read(VAULT, 'troveManager()(address)').toLowerCase() !== TROVE_MANAGER.toLowerCase())
  throw new Error('Refusing: vault is linked to an unexpected TroveManager.');

const keeperRole = read(VAULT, 'KEEPER_ROLE()(bytes32)');
function assertKeeperRole() {
  if (read(VAULT, 'hasRole(bytes32,address)(bool)', keeperRole, KEEPER) !== 'true')
    throw new Error('Refusing: expected keeper does not have KEEPER_ROLE.');
}
assertKeeperRole();

// --- the two collateral pools, and the wall this is about -------------------
const idle = BigInt(read(VAULT, 'idleCollateral()(uint256)'));
const troveColl = BigInt(read(TROVE_MANAGER, 'getTroveColl(address)(uint256)', VAULT));
const troveDebt = BigInt(read(TROVE_MANAGER, 'getTroveDebt(address)(uint256)', VAULT));
const ceiling = BigInt(
  read(TROVE_MANAGER, 'getTroveMaxBorrowingCapacity(address)(uint256)', VAULT),
);
const minTroveCr = BigInt(read(VAULT, 'MIN_TROVE_CR()(uint256)'));
const reserve = BigInt(read(VAULT, 'reserveMUSD()(uint256)'));
const price = BigInt(read(PRICE_FEED, 'fetchPrice()(uint256)'));
if (price === 0n) throw new Error('Refusing: the oracle returned no price.');
if (!read(SORTED_TROVES, 'contains(address)(bool)', VAULT).startsWith('true'))
  throw new Error('Refusing: the vault is not in the sorted list — the trove is not open.');
const prev = read(SORTED_TROVES, 'getPrev(address)(address)', VAULT);
const next = read(SORTED_TROVES, 'getNext(address)(address)', VAULT);

const icr = troveDebt > 0n ? (troveColl * price) / troveDebt : 0n;
const capacityNow = (limit) => (limit > troveDebt ? limit - troveDebt : 0n);
const ceilingHeadroom = capacityNow(ceiling);
const ratioHeadroom = capacityNow((troveColl * price) / minTroveCr);
const drawNow = reserve + (ceilingHeadroom < ratioHeadroom ? ceilingHeadroom : ratioHeadroom);

process.stdout.write('\nPooled collateral, read live\n');
line('snapshot block', snapshotBlock);
line('in the trove', `${btc(troveColl)} BTC`);
line(
  'idle in the vault',
  `${btc(idle)} BTC  (${Number((idle * 100n) / (idle + troveColl))}% of the pool)`,
);
line(
  'trove ICR',
  `${(Number(icr) / 1e16).toFixed(1)}%  against a ${Number(minTroveCr) / 1e16}% floor`,
);
line(
  'borrow capacity now',
  `${musd(drawNow)} MUSD  (limited by ${ceilingHeadroom < ratioHeadroom ? 'the ceiling' : 'the trove ratio'})`,
);

// --- how much to move ------------------------------------------------------
/**
 * The least that makes the CEILING the binding limit again, times a margin. Below this the
 * trove ratio binds and the ceiling headroom is unreachable; far above it the extra BTC
 * only sits in a place that makes withdrawals more expensive.
 */
const margin = Number(options.margin);
if (!Number.isFinite(margin) || margin < 1)
  throw new Error('Refusing: --margin must be a number >= 1.');
const needed = (ceiling * minTroveCr) / price;
const target = (BigInt(Math.round(margin * 1e6)) * needed) / 1_000_000n;
let push = target > troveColl ? target - troveColl : 0n;
if (push > idle) push = idle;
if (options.all) push = idle;
if (options.amount) {
  const parsed = cast(['to-wei', options.amount, 'ether'], { allowFail: true });
  if (parsed.error) throw new Error(`Refusing: --amount is not a number (${parsed.error}).`);
  push = BigInt(parsed.value);
  if (push > idle)
    throw new Error(`Refusing: --amount exceeds idle collateral (${btc(idle)} BTC).`);
}

process.stdout.write('\nProposed push\n');
if (push === 0n) {
  line('amount', 'none needed — the ceiling already binds');
  process.stdout.write('\nNothing to do.\n\n');
  process.exit(0);
}
const afterColl = troveColl + push;
const afterIcr = troveDebt > 0n ? (afterColl * price) / troveDebt : 0n;
const afterRatioHeadroom = capacityNow((afterColl * price) / minTroveCr);
const afterDraw =
  reserve + (ceilingHeadroom < afterRatioHeadroom ? ceilingHeadroom : afterRatioHeadroom);
line('amount', `${btc(push)} BTC of ${btc(idle)} idle`);
line('left idle for withdrawals', `${btc(idle - push)} BTC`);
line(
  'trove ICR after',
  `${(Number(icr) / 1e16).toFixed(0)}% -> ${(Number(afterIcr) / 1e16).toFixed(0)}%`,
);
line('borrow capacity after', `${musd(drawNow)} -> ${musd(afterDraw)} MUSD`);

// --- simulate --------------------------------------------------------------
const estimate = () => {
  const r = cast(
    [
      'estimate',
      VAULT,
      'topUpCollateral(uint256,address,address)',
      String(push),
      prev,
      next,
      '--from',
      KEEPER,
      '--rpc-url',
      RPC,
    ],
    { allowFail: true },
  );
  if (r.error) return { error: r.error };
  const gas = Number(r.value.split(/\s+/)[0]);
  return Number.isSafeInteger(gas) && gas > 0 ? { gas } : { error: 'invalid gas estimate' };
};
const sim = estimate();
process.stdout.write('\nSimulated against chain head\n');
line('gas', sim.error ? `FAILED — ${sim.error}` : sim.gas.toLocaleString());
if (sim.error) {
  console.error('\nRefusing: the simulation did not succeed, so nothing was submitted.');
  console.error('Check oracle freshness (Mezo reverts past 60s) and Recovery Mode.\n');
  process.exit(1);
}
let gasLimit = Math.ceil(sim.gas * 1.5);

if (!EXECUTE) {
  process.stdout.write('\nRead-only. Re-run with --execute to repeat every check and send:\n\n');
  process.stdout.write(`  node tools/ops/topup-collateral.mjs --execute\n\n`);
  process.stdout.write('Foundry prompts for the keystore password; this script never reads it.\n');
  process.stdout.write('Use --password-file <path> for an existing password file, --all to push\n');
  process.stdout.write('every idle satoshi, or --amount 0.05 to choose the size yourself.\n\n');
  process.exit(0);
}

// --- send ------------------------------------------------------------------
if (PASSWORD_FILE) {
  const signer = cast([
    'wallet',
    'address',
    '--account',
    ACCOUNT,
    '--password-file',
    PASSWORD_FILE,
  ]).value;
  if (signer.toLowerCase() !== KEEPER.toLowerCase())
    throw new Error('Refusing: keystore is not the expected testnet keeper.');
}
// Unlocking can take time; recheck mutable state at current head before sending.
if (Number(cast(['chain-id', '--rpc-url', RPC]).value) !== 31611)
  throw new Error('Refusing: RPC chain changed.');
snapshotBlock = 'latest';
assertKeeperRole();
if (BigInt(read(VAULT, 'idleCollateral()(uint256)')) < push)
  throw new Error('Refusing: idle collateral fell below the push amount before sending.');
const finalSim = estimate();
if (finalSim.error) throw new Error('Refusing: final simulation failed; nothing submitted.');
gasLimit = Math.ceil(finalSim.gas * 1.5);

process.stdout.write('\nSending once through the Foundry keystore\n\n');
const sent = spawnSync(
  'cast',
  [
    'send',
    VAULT,
    'topUpCollateral(uint256,address,address)',
    String(push),
    prev,
    next,
    '--account',
    ACCOUNT,
    '--from',
    KEEPER,
    ...(PASSWORD_FILE ? ['--password-file', PASSWORD_FILE] : []),
    '--rpc-url',
    RPC,
    '--gas-limit',
    String(gasLimit),
  ],
  { stdio: 'inherit' },
);
if (sent.status !== 0) {
  console.error(
    '\ncast send did not return success. Submission may still have occurred; check the keeper nonce and a receipt before retrying.',
  );
  process.exit(sent.status ?? 1);
}

const newTroveColl = BigInt(read(TROVE_MANAGER, 'getTroveColl(address)(uint256)', VAULT));
const newIdle = BigInt(read(VAULT, 'idleCollateral()(uint256)'));
const newDebt = BigInt(read(TROVE_MANAGER, 'getTroveDebt(address)(uint256)', VAULT));
const newIcr = newDebt > 0n ? (newTroveColl * price) / newDebt : 0n;
process.stdout.write('\nAfter\n');
line('in the trove', `${btc(troveColl)} -> ${btc(newTroveColl)} BTC`);
line('idle', `${btc(idle)} -> ${btc(newIdle)} BTC`);
line('trove ICR', `${(Number(icr) / 1e16).toFixed(0)}% -> ${(Number(newIcr) / 1e16).toFixed(0)}%`);
if (newTroveColl <= troveColl) {
  console.error('\nTrove collateral did not rise. Check the CollateralPushedToTrove event.\n');
  process.exit(1);
}
process.stdout.write(
  '\nRun tools/ops/readiness.mjs to confirm the borrowing limits moved with it.\n\n',
);
