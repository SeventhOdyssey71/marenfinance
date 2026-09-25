#!/usr/bin/env node
/**
 * Liveness monitor for the Mezo testnet deployment: the state that DECAYS.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `release:check`. `release:attest` and
 * `release:check` are acceptance gates — they answer "is what we shipped configured
 * correctly", and their own README says they are "not a liveness monitor". They passed
 * on the morning the pooled trove ran out of borrowing ceiling, because nothing about
 * the deployment's CONFIGURATION was wrong. What had changed was its ECONOMICS, and
 * nothing watched those. A user found it first.
 *
 * Everything below is a quantity that drifts on its own — with the BTC price, with
 * accrued interest, with every user action, with the gas the relayer spends. Each check
 * has a warn and a fail threshold so the answer is a number and an exit code, not an
 * opinion. Read-only: it never signs, submits, or needs a key.
 *
 *   exit 0  ready
 *   exit 1  degraded — works now, will not for long
 *   exit 2  blocked  — a tester cannot complete a core flow right now
 *
 * Usage:
 *   node tools/ops/readiness.mjs
 *   node tools/ops/readiness.mjs --json --out /absolute/path.json
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'https://rpc.test.mezo.org' },
    relayer: { type: 'string', default: 'https://maren-relayer.rolandojude18.workers.dev' },
    web: { type: 'string', default: 'https://www.marenfinance.xyz' },
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const VAULT = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const PRICE_FEED = '0x86bCF0841622a5dAC14A313a15f96A95421b9366';
const RELAYER_SIGNER = '0xd90245ee16B2f58eD8654961BBf2fa835046df89';

const WAD = 10n ** 18n;
const results = [];
const num = (wei, dp = 2) => (Number(wei) / 1e18).toFixed(dp);

/** No hand-written selectors: `cast` derives them from the full signature. */
function cast(args) {
  const r = spawnSync('cast', args, { encoding: 'utf8', timeout: 30_000 });
  if (r.error || r.status !== 0) {
    throw new Error((r.stderr || r.stdout || r.error?.message || 'cast failed').trim().split('\n')[0]);
  }
  return r.stdout.trim().split(/\s+/)[0];
}
const read = (to, sig, ...a) => cast(['call', to, sig, ...a, '--rpc-url', opt.rpc, '--block', block]);

function check({ name, status, detail, value }) {
  results.push({ name, status, detail, value });
}
/** `worse` is the direction of danger: 'low' means small numbers are bad. */
function threshold(name, value, { warn, fail, worse = 'low', fmt = (v) => String(v), detail }) {
  const bad = worse === 'low' ? value < fail : value > fail;
  const meh = worse === 'low' ? value < warn : value > warn;
  check({
    name,
    status: bad ? 'fail' : meh ? 'warn' : 'pass',
    detail: `${fmt(value)}${detail ? ` — ${detail}` : ''}`,
    value,
  });
}

// --- chain identity, pinned to one block so every figure agrees -------------
const chainId = Number(cast(['chain-id', '--rpc-url', opt.rpc]));
if (chainId !== 31611) {
  console.error(`Refusing: expected Mezo testnet 31611, got ${chainId}`);
  process.exit(2);
}
const block = cast(['block-number', '--rpc-url', opt.rpc]);
check({ name: 'chain', status: 'pass', detail: `Mezo testnet 31611 at block ${block}` });

// --- the oracle. Mezo reverts every MUSD path once it is 60s stale ----------
let price = 0n;
try {
  price = BigInt(read(PRICE_FEED, 'fetchPrice()(uint256)'));
  check({ name: 'oracle', status: 'pass', detail: `$${num(price)} / BTC, fresh enough to transact` });
} catch (e) {
  check({
    name: 'oracle',
    status: 'fail',
    detail: `fetchPrice reverted (${String(e.message).slice(0, 60)}) — every borrow, repay, deposit and liquidation path reverts while this is true`,
  });
}

// --- the pooled trove: the thing that ran out last time ---------------------
const troveColl = BigInt(read(TROVE_MANAGER, 'getTroveColl(address)(uint256)', VAULT));
const troveDebt = BigInt(read(TROVE_MANAGER, 'getTroveDebt(address)(uint256)', VAULT));
const ceiling = BigInt(read(TROVE_MANAGER, 'getTroveMaxBorrowingCapacity(address)(uint256)', VAULT));
const minTroveCr = BigInt(read(VAULT, 'MIN_TROVE_CR()(uint256)'));
const reserve = BigInt(read(VAULT, 'reserveMUSD()(uint256)'));
const idle = BigInt(read(VAULT, 'idleCollateral()(uint256)'));
const depositsPaused = read(VAULT, 'depositsPaused()(bool)') === 'true';
const borrowingPaused = read(VAULT, 'borrowingPaused()(bool)') === 'true';

const troveIcr = price > 0n && troveDebt > 0n ? (troveColl * price) / troveDebt : 0n;
const icrPct = Number(troveIcr) / 1e16;
const floorPct = Number(minTroveCr) / 1e16;

/**
 * What a user can ACTUALLY draw, which is the smaller of two unrelated limits, plus the
 * reserve. Mirrors `borrowCeiling` in packages/sdk: the reserve is served without adding
 * trove debt, but the pooled-ICR check still runs afterwards, so it is added to whichever
 * limit binds rather than exempt from them.
 */
const ceilingHeadroom = ceiling > troveDebt ? ceiling - troveDebt : 0n;
const poolDebtAllowed = price > 0n ? (troveColl * price) / minTroveCr : 0n;
const ratioHeadroom = poolDebtAllowed > troveDebt ? poolDebtAllowed - troveDebt : 0n;
const capacity = reserve + (ceilingHeadroom < ratioHeadroom ? ceilingHeadroom : ratioHeadroom);
const binding = ceilingHeadroom < ratioHeadroom ? 'ceiling' : 'trove collateral ratio';

threshold('pool borrow capacity', Number(capacity) / 1e18, {
  warn: 500,
  fail: 100,
  fmt: (v) => `${v.toFixed(2)} MUSD`,
  detail: `limited by ${binding}`,
});
/**
 * BOTH HALVES OF THIS LINE INVERT ONCE THE RATIO CROSSES THE FLOOR, which is exactly
 * when someone is reading it. It used to print "-1.3 points above the 180% floor" —
 * a negative distance above something — next to "a -0.7% BTC fall blocks new
 * borrowing", when in fact no further fall is needed because borrowing is already
 * refused. Below the floor the useful number is the opposite one: how far BTC has to
 * RISE to restore borrowing, and that the keeper can restore it now without waiting
 * for the price at all.
 */
const belowFloor = icrPct < floorPct;
threshold('trove ratio margin', icrPct - floorPct, {
  warn: 20,
  fail: 6,
  fmt: (v) =>
    belowFloor
      ? `${Math.abs(v).toFixed(1)} points BELOW the ${floorPct.toFixed(0)}% floor (ICR ${icrPct.toFixed(1)}%)`
      : `${v.toFixed(1)} points above the ${floorPct.toFixed(0)}% floor (ICR ${icrPct.toFixed(1)}%)`,
  detail: belowFloor
    ? `new borrowing is already refused — needs a ${((floorPct / icrPct - 1) * 100).toFixed(1)}% BTC rise, or a keeper top-up now`
    : `a ${(100 - (floorPct / icrPct) * 100).toFixed(1)}% BTC fall blocks new borrowing`,
});
threshold('ceiling headroom', Number(ceilingHeadroom) / 1e18, {
  warn: 400,
  fail: 100,
  fmt: (v) => `${v.toFixed(2)} MUSD of ${num(ceiling)} — refinance raises it`,
});

/**
 * Idle collateral is real BTC the vault holds but has not pushed into the trove. It backs
 * users' claims either way, but only collateral INSIDE the trove counts toward the pooled
 * ICR the borrow path checks — so a large idle share silently throttles borrowing while
 * every collateral figure looks healthy. `topUpCollateral` is the keeper's lever.
 */
const totalColl = idle + troveColl;
const idlePct = totalColl > 0n ? Number((idle * 10000n) / totalColl) / 100 : 0;
threshold('collateral in the trove', 100 - idlePct, {
  warn: 80,
  fail: 50,
  fmt: (v) => `${v.toFixed(0)}% in trove, ${idlePct.toFixed(0)}% idle (${num(idle, 6)} BTC)`,
  detail: idlePct > 20 ? 'keeper can push idle collateral in to raise capacity' : '',
});

/**
 * REDEMPTION DETECTOR. Redemption on Mezo is permissionless, and the deployed vault
 * predates its own reconciliation (`reconcileRedemption`, `settleRedemption`,
 * `collateralOf` are all absent from its dispatch table). If a redeemer reaches the
 * pooled trove, the trove's debt and collateral fall but no user ledger moves — early
 * withdrawers would take their full pre-redemption entitlement and later ones would hit a
 * reverting withdraw. Nothing anywhere watches for this.
 *
 * It is cheap to detect because the vault's own accounting implies an exact identity:
 * `outstandingDebt()` == trove principal + interest − 200 MUSD gas compensation − reserve.
 * That holds to the wei today. A redemption breaks it, and nothing else does.
 */
try {
  const outstanding = BigInt(read(VAULT, 'outstandingDebt()(uint256)'));
  const GAS_COMPENSATION = 200n * WAD;
  const implied =
    troveDebt > GAS_COMPENSATION + reserve ? troveDebt - GAS_COMPENSATION - reserve : 0n;
  const drift = implied > outstanding ? implied - outstanding : outstanding - implied;
  check({
    name: 'redemption ledger',
    status: drift > WAD ? 'fail' : 'pass',
    detail:
      drift > WAD
        ? `trove and vault accounting disagree by ${num(drift)} MUSD — a redemption has hit the pooled trove and the deployed vault cannot reconcile it. Stop withdrawals.`
        : `intact (trove and vault agree to ${num(drift, 6)} MUSD)`,
  });
} catch (e) {
  check({ name: 'redemption ledger', status: 'warn', detail: `could not verify: ${e.message}` });
}

check({
  name: 'vault switches',
  status: depositsPaused || borrowingPaused ? 'fail' : 'pass',
  detail: `deposits ${depositsPaused ? 'PAUSED' : 'open'}, borrowing ${borrowingPaused ? 'PAUSED' : 'open'}`,
});

// --- the relayer: everything gasless depends on it staying funded ----------
let health;
try {
  const res = await fetch(`${opt.relayer}/healthz`, { signal: AbortSignal.timeout(20_000) });
  health = await res.json();
} catch (e) {
  check({ name: 'relayer', status: 'fail', detail: `unreachable: ${e.message}` });
}
if (health) {
  const blocked = !health.accepting || health.budget?.halted || health.problems?.length;
  check({
    name: 'relayer',
    status: blocked ? 'fail' : 'pass',
    detail: `accepting=${health.accepting}, halted=${health.budget?.halted}, pending=${health.recovery?.pending}, store=${health.store}${health.problems?.length ? `, problems: ${health.problems.join('; ')}` : ''}`,
  });
  const remaining = Number(health.budget?.remainingWei ?? 0) / 1e18;
  const limit = Number(health.budget?.limitWei ?? 1) / 1e18;
  /**
   * Cost per sponsored action, MEASURED not assumed: the 10 MUSD borrow in block
   * 15,695,456 settled 479,592 gas at 146 wei = 7.0e-8 BTC. The BTC budget is therefore
   * ~5 orders of magnitude larger than a test window needs, and is NOT the limit that
   * binds. Reservations are held at roughly 1.7e8 wei each, which is the number that
   * actually caps concurrency, so it is what this divides by.
   */
  const RESERVATION_BTC = 1.7e8 / 1e18;
  threshold('relayer daily budget', (remaining / limit) * 100, {
    warn: 40,
    fail: 10,
    fmt: (v) => `${v.toFixed(0)}% left (${remaining.toFixed(5)} of ${limit} BTC)`,
    detail: `~${Math.floor(remaining / RESERVATION_BTC).toLocaleString()} more sponsored actions — not the binding limit`,
  });

  /**
   * The limit that DOES bind. Sponsorship is capped per address for the lifetime of the
   * deployment, with no reset and no paid tier configured, so a tester simply stops being
   * sponsored partway through a session and is told only at the moment it happens.
   * Onboarding alone spends two (commit + register).
   */
  try {
    const q = await (
      await fetch(`${opt.relayer}/quota/0x0000000000000000000000000000000000000001`, {
        signal: AbortSignal.timeout(20_000),
      })
    ).json();
    threshold('free actions per tester', q.freeActionsPerAddress ?? 0, {
      warn: 100,
      fail: 30,
      fmt: (v) => `${v} for the lifetime of the deployment`,
      detail: q.feeAfterFreeTierMusdWei
        ? 'a paid tier takes over afterwards'
        : 'no paid tier configured — action 26 is refused outright',
    });
  } catch {
    check({ name: 'free actions per tester', status: 'warn', detail: 'quota endpoint unreadable' });
  }
}
const signerBtc = Number(cast(['balance', RELAYER_SIGNER, '--rpc-url', opt.rpc])) / 1e18;
threshold('relayer signer balance', signerBtc, {
  warn: 0.008,
  fail: 0.003,
  fmt: (v) => `${v.toFixed(6)} BTC`,
  detail: 'funds the daily budget; when this empties nothing is sponsored',
});

// --- public surfaces a tester or reviewer actually opens -------------------
for (const path of ['/', '/app', '/docs']) {
  try {
    const res = await fetch(`${opt.web}${path}`, { signal: AbortSignal.timeout(20_000) });
    check({
      name: `web ${path}`,
      status: res.ok ? 'pass' : 'fail',
      detail: `HTTP ${res.status}`,
    });
  } catch (e) {
    check({ name: `web ${path}`, status: 'fail', detail: e.message });
  }
}

// --- report ---------------------------------------------------------------
const fails = results.filter((r) => r.status === 'fail');
const warns = results.filter((r) => r.status === 'warn');
const verdict = fails.length ? 'BLOCKED' : warns.length ? 'DEGRADED' : 'READY';

if (opt.json || opt.out) {
  const payload = { verdict, chainId, block, checkedAt: new Date().toISOString(), results };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (opt.out) writeFileSync(opt.out, text);
  if (opt.json) process.stdout.write(text);
} else {
  const mark = { pass: '  ok  ', warn: ' warn ', fail: ' FAIL ' };
  process.stdout.write(`\nMaren testnet readiness — block ${block}\n\n`);
  for (const r of results) {
    process.stdout.write(`${mark[r.status]} ${r.name.padEnd(24)} ${r.detail}\n`);
  }
  process.stdout.write(`\n${verdict}`);
  if (fails.length) process.stdout.write(` — ${fails.length} blocking: ${fails.map((f) => f.name).join(', ')}`);
  else if (warns.length) process.stdout.write(` — ${warns.length} degrading: ${warns.map((w) => w.name).join(', ')}`);
  process.stdout.write('\n\n');
}
process.exit(fails.length ? 2 : warns.length ? 1 : 0);
