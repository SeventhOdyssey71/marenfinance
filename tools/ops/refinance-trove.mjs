#!/usr/bin/env node
/**
 * Raise the pooled trove's borrowing ceiling, and refuse to do it blind.
 *
 * WHY THIS EXISTS. On Mezo, a trove's `maxBorrowingCapacity` is frozen at the BTC price
 * the trove was opened at. Adding collateral does not raise it. `refinance()` is the only
 * thing that does. So a pooled trove held across a BTC rally hits a ceiling that has
 * nothing to do with how well collateralised it is — ours sits at 190% ICR and still
 * cannot lend another dollar. When that happens every borrow reverts, the fail-closed
 * relayer declines to sponsor a call it knows will fail, and from inside the app it looks
 * like the relayer is broken. It is not: the trove is full.
 *
 * `MarenVault.refinancePooledTrove` has been deployed since day one and nothing has ever
 * called it — the only call sites in the repo are two unit tests. This is the keeper step
 * that was missing.
 *
 * THE HINTS ARE NOT OPTIONAL. Both tests pass `address(0), address(0)`, which is harmless
 * against a sorted list with three troves in it. Against the real list — 232 troves when
 * this was written — MUSD walks from the head, and the call costs 1,127,350 gas instead of
 * 424,734. It still succeeds today. The margin between "wasteful" and "out of gas" is just
 * however long that list grows next, which is not a thing we control. The trove's own
 * neighbours are the right hints: a refinance changes its debt only by the refinancing
 * fee, so its place in the ordering barely moves.
 *
 * NO HAND-WRITTEN SELECTORS. The first version of this file carried a table of function
 * selectors typed from memory. Eight of the nine were wrong. Every call below goes through
 * `cast`, which derives the selector from the signature, so a typo is a hard error rather
 * than a call to a function that does not exist.
 *
 * Read-only unless you pass --execute. Diagnostics use one block; chain, keeper role,
 * interest rates and simulation are rechecked at head before sending. These off-chain
 * checks cannot prevent state changing before inclusion. The key stays in Foundry's
 * keystore; this script never reads it or the password file.
 *
 * Usage:
 *   node tools/ops/refinance-trove.mjs                 # diagnose only
 *   node tools/ops/refinance-trove.mjs --execute       # send it
 *     [--account maren-deployer] [--rpc <url>] [--password-file <path>]
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'https://rpc.test.mezo.org' },
    account: { type: 'string', default: 'maren-deployer' },
    execute: { type: 'boolean', default: false },
    'password-file': { type: 'string' },
    'accept-rate-increase': { type: 'boolean', default: false },
  },
});
const RPC = options.rpc;
const ACCOUNT = options.account;
const EXECUTE = options.execute;
const PASSWORD_FILE = options['password-file'];

const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const SORTED_TROVES = '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA';
const KEEPER = '0x54196397D6f01b48739dB3957257cB33cD341885';
const ZERO = '0x0000000000000000000000000000000000000000';

function cast(args, { allowFail = false } = {}) {
  const r = spawnSync('cast', args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error) {
    const detail =
      r.error.code === 'ENOENT'
        ? 'cast not found on PATH — install Foundry'
        : 'cast command timed out or could not start';
    if (allowFail) return { error: detail };
    throw new Error(detail);
  }
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim().split('\n')[0];
    if (allowFail) return { error: detail };
    if (args[0] === 'wallet') throw new Error('Could not unlock the configured keeper keystore.');
    throw new Error(`cast ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
  return { value: (r.stdout || '').trim() };
}

/** One read. `sig` is a full signature, so cast computes the selector — we never type one. */
function read(to, sig, ...params) {
  return cast(['call', to, sig, ...params, '--rpc-url', RPC, '--block', snapshotBlock]).value.split(
    /\s+/,
  )[0];
}

const musd = (wei) => (Number(wei) / 1e18).toFixed(2);
const btc = (wei) => (Number(wei) / 1e18).toFixed(6);
const line = (label, value) => process.stdout.write(`  ${label.padEnd(26)} ${value}\n`);

// --- read the world ---------------------------------------------------------
const chainId = Number(cast(['chain-id', '--rpc-url', RPC]).value);
if (chainId !== 31611)
  throw new Error('Refusing: this keeper tool is for Mezo testnet (31611) only.');
let snapshotBlock = cast(['block-number', '--rpc-url', RPC]).value;
if (!/^\d+$/.test(snapshotBlock)) throw new Error('Could not read a block number.');
if (read(VAULT, 'troveManager()(address)').toLowerCase() !== TROVE_MANAGER.toLowerCase()) {
  throw new Error('Refusing: vault is linked to an unexpected TroveManager.');
}
const keeperRole = read(VAULT, 'KEEPER_ROLE()(bytes32)');
function assertKeeperRole() {
  if (read(VAULT, 'hasRole(bytes32,address)(bool)', keeperRole, KEEPER) !== 'true') {
    throw new Error('Refusing: expected keeper does not have KEEPER_ROLE.');
  }
}
assertKeeperRole();
function entireTrove() {
  const entire = cast([
    'call',
    TROVE_MANAGER,
    'getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)',
    VAULT,
    '--rpc-url',
    RPC,
    '--block',
    snapshotBlock,
  ])
    .value.split('\n')
    .map((value) => BigInt(value.trim().split(/\s+/)[0]));
  if (entire.length !== 6) throw new Error('Unexpected entire trove state response.');
  return entire;
}
const [coll, principal, interest] = entireTrove();
const debt = principal + interest;
const ceiling = BigInt(
  read(TROVE_MANAGER, 'getTroveMaxBorrowingCapacity(address)(uint256)', VAULT),
);
const rate = Number(read(TROVE_MANAGER, 'getTroveInterestRate(address)(uint16)', VAULT));
const size = Number(read(SORTED_TROVES, 'getSize()(uint256)'));
const inList = read(SORTED_TROVES, 'contains(address)(bool)', VAULT) === 'true';
const prev = read(SORTED_TROVES, 'getPrev(address)(address)', VAULT);
const next = read(SORTED_TROVES, 'getNext(address)(address)', VAULT);

const headroom = ceiling > debt ? ceiling - debt : 0n;

/** The borrowing fee is grossed up out of the headroom, so the amount a user can actually
 *  ask for is a touch less than the raw gap. Mirrors `borrowCeiling` in packages/sdk. */
const WAD = 10n ** 18n;
const borrowerOperations = read(VAULT, 'borrowerOperations()(address)');
const BORROWING_RATE = BigInt(read(borrowerOperations, 'borrowingRate()(uint256)'));
const borrowable = (headroom * WAD) / (WAD + BORROWING_RATE);
const reserve = BigInt(read(VAULT, 'reserveMUSD()(uint256)'));

process.stdout.write('\nPooled trove, read live\n');
line('snapshot block', snapshotBlock);
line('keeper role', 'verified');
line('collateral', `${btc(coll)} BTC`);
line('debt', `${musd(debt)} MUSD`);
line('maxBorrowingCapacity', `${musd(ceiling)} MUSD`);
line('headroom', `${musd(headroom)} MUSD`);
line('trove draw capacity', `${musd(borrowable)} MUSD`);
line('MUSD reserve', `${musd(reserve)} MUSD`);
line('reserve + trove capacity', `${musd(reserve + borrowable)} MUSD (before collateral limits)`);
line('new draw borrowing fee', `${Number(BORROWING_RATE) / 1e16}% (reserve portion has no fee)`);
line('interest rate', `${rate / 100}%`);
line('sorted list size', `${size} troves`);

if (!inList) {
  console.error(
    '\nThe vault is not in the sorted list — the trove is not open. Nothing to refinance.',
  );
  process.exit(1);
}

/**
 * Refinancing resets the trove's rate to the CURRENT global rate. If that is above the
 * trove's rate, this operation raises the cost of borrowing for every pooled user, which
 * is not a thing to do silently to fix a ceiling.
 */
const irm = read(TROVE_MANAGER, 'interestRateManager()(address)');
const globalRate = Number(read(irm, 'interestRate()(uint16)'));
process.stdout.write('\nRate check (refinance resets the trove to the global rate)\n');
line('trove rate', `${rate / 100}%`);
line('global rate', `${globalRate / 100}%`);
if (globalRate > rate) {
  line('effect on users', `RAISES borrowing cost by ${(globalRate - rate) / 100} points`);
  if (!options['accept-rate-increase']) {
    console.error(
      "\nRefusing: this would raise every pooled user's interest rate. Re-run with\n" +
        '--accept-rate-increase if that is genuinely the intent.\n',
    );
    process.exit(1);
  }
} else {
  line('effect on users', globalRate === rate ? 'none — the rates are identical' : 'lowers it');
}

// --- hints, and what they are worth ----------------------------------------
process.stdout.write("\nHints (the trove's own neighbours)\n");
line('upperHint (prev)', prev);
line('lowerHint (next)', next);

const estimate = (upper, lower) => {
  const r = cast(
    [
      'estimate',
      VAULT,
      'refinancePooledTrove(address,address)',
      upper,
      lower,
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

const hinted = estimate(prev, next);
const blind = estimate(ZERO, ZERO);

process.stdout.write('\nGas, simulated against chain head\n');
line(
  'with hints',
  hinted.error ? `FAILED — ${hinted.error}` : `${hinted.gas.toLocaleString()} gas`,
);
line(
  'with zero hints',
  blind.error ? `FAILED — ${blind.error}` : `${blind.gas.toLocaleString()} gas`,
);
if (!hinted.error && !blind.error) {
  line('hints save', `${(100 - (hinted.gas / blind.gas) * 100).toFixed(0)}%`);
}

if (hinted.error) {
  console.error('\nRefusing to continue: the refinance simulation did not succeed.');
  console.error(
    'No transaction was submitted. Check the RPC response, oracle freshness and Recovery Mode.',
  );
  process.exit(1);
}

let gasLimit = Math.ceil(hinted.gas * 1.5);

if (!EXECUTE) {
  process.stdout.write(
    '\nRead-only. Re-run this command with --execute to repeat the safety checks before sending.\n',
  );
  process.stdout.write(
    'Use --password-file <path> for an existing Foundry password file; its contents are never read by this script.\n',
  );
  process.exit(0);
}

// --- send -------------------------------------------------------------------
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
// Unlocking can take time. Recheck mutable authorization and rates at current head.
if (Number(cast(['chain-id', '--rpc-url', RPC]).value) !== 31611)
  throw new Error('Refusing: RPC chain changed.');
snapshotBlock = 'latest';
assertKeeperRole();
const currentIrm = read(TROVE_MANAGER, 'interestRateManager()(address)');
const sendRate = Number(read(currentIrm, 'interestRate()(uint16)'));
const currentRate = Number(read(TROVE_MANAGER, 'getTroveInterestRate(address)(uint16)', VAULT));
if (sendRate > currentRate && !options['accept-rate-increase'])
  throw new Error('Refusing: global rate increased before sending.');
const finalEstimate = estimate(prev, next);
if (finalEstimate.error)
  throw new Error('Refusing: final simulation failed; no transaction submitted.');
gasLimit = Math.ceil(finalEstimate.gas * 1.5);
process.stdout.write('\nSending once through the Foundry keystore\n\n');
const sent = spawnSync(
  'cast',
  [
    'send',
    VAULT,
    'refinancePooledTrove(address,address)',
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
    '\ncast send did not return success. Submission may still have occurred; check the keeper nonce and receipt before retrying.',
  );
  process.exit(sent.status ?? 1);
}

const afterCeiling = BigInt(
  read(TROVE_MANAGER, 'getTroveMaxBorrowingCapacity(address)(uint256)', VAULT),
);
const [, afterPrincipal, afterInterest] = entireTrove();
const afterDebt = afterPrincipal + afterInterest;
const afterHeadroom = afterCeiling > afterDebt ? afterCeiling - afterDebt : 0n;

process.stdout.write('\nAfter\n');
line('maxBorrowingCapacity', `${musd(ceiling)} -> ${musd(afterCeiling)} MUSD`);
line('debt', `${musd(debt)} -> ${musd(afterDebt)} MUSD`);
line('headroom', `${musd(headroom)} -> ${musd(afterHeadroom)} MUSD`);
line('trove draw capacity', `${musd((afterHeadroom * WAD) / (WAD + BORROWING_RATE))} MUSD`);

if (afterHeadroom <= headroom) {
  console.error(
    '\nThe ceiling did not rise. Check the Refinanced event and the current BTC price.',
  );
  process.exit(1);
}
process.stdout.write(
  '\nThe trove ceiling increased. Verify user/pool collateral limits and a confirmed borrow before declaring the borrowing flow recovered.\n\n',
);
