import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'maren-keeper-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const script = fileURLToPath(new URL('./refinance-trove.mjs', import.meta.url));
const fakeCast = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CAST_TRACE, JSON.stringify(args)+'\\n');
const scenario = process.env.CAST_SCENARIO;
const keeper = '0x54196397D6f01b48739dB3957257cB33cD341885';
const tm = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const zero = '0x0000000000000000000000000000000000000000';
if(args[0]==='chain-id') console.log(scenario==='wrong-chain' ? '1' : '31611');
else if(args[0]==='block-number') console.log('12345');
else if(args[0]==='wallet') console.log(scenario==='wrong-signer' ? zero : keeper);
else if(args[0]==='estimate') {
  const estimates = fs.readFileSync(process.env.CAST_TRACE,'utf8').trim().split('\\n').map(JSON.parse).filter(([command])=>command==='estimate').length;
  if (scenario==='revert' || (scenario==='late-revert' && estimates===3)) { console.error('execution reverted'); process.exit(1); }
  console.log(args[3]===zero ? '900000' : '400000');
} else if(args[0]==='send') {
  if(scenario==='send-uncertain') { console.error('lost RPC response'); process.exit(1); }
  console.log('mock receipt');
} else if(args[0]==='call') {
 const values = {
  'troveManager()(address)': tm,
  'KEEPER_ROLE()(bytes32)': '0x'+'11'.repeat(32),
  'hasRole(bytes32,address)(bool)': scenario==='no-role' ? 'false':'true',
  'getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)': ['1000000000000000000','2000000000000000000000','100000000000000000000','0','0','0'].join('\\n'),
  'getTroveMaxBorrowingCapacity(address)(uint256)': '2200000000000000000000',
  'getTroveInterestRate(address)(uint16)': '100',
  'getSize()(uint256)': '232',
  'contains(address)(bool)': 'true',
  'getPrev(address)(address)': keeper,
  'getNext(address)(address)': tm,
  'borrowerOperations()(address)': keeper,
  'borrowingRate()(uint256)': '10000000000000000',
  'reserveMUSD()(uint256)': '10000000000000000000',
  'interestRateManager()(address)': keeper,
  'interestRate()(uint16)': scenario==='rate-increase' || (scenario==='late-rate-increase' && args.at(-1)==='latest') ? '200':'100',
 };
 if (!(args[2] in values)) { console.error('unknown signature '+args[2]); process.exit(2); }
 console.log(values[args[2]]);
} else { console.error('unexpected command'); process.exit(2); }
`;
writeFileSync(join(dir, 'cast'), fakeCast, { mode: 0o755 });
let seq = 0;
function run(scenario, args = []) {
  const trace = join(dir, `${seq++}.jsonl`);
  const result = spawnSync(process.execPath, [script, ...args], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CAST_SCENARIO: scenario,
      CAST_TRACE: trace,
    },
    encoding: 'utf8',
  });
  const calls = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  return { ...result, calls, output: result.stdout + result.stderr };
}
function noSend(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.filter(([command]) => command === 'send').length, 0);
}

test('wrong chain refuses before any contract call or signer access', () => {
  const result = run('wrong-chain', ['--execute']);
  noSend(result);
  assert.deepEqual(
    result.calls.map(([command]) => command),
    ['chain-id'],
  );
});
test('read-only report uses entire debt, actual fee and reserve without unlocking', () => {
  const result = run('ok');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /2100\.00 MUSD/);
  assert.match(result.output, /99\.01 MUSD/);
  assert.match(result.output, /109\.01 MUSD \(before collateral limits\)/);
  assert.match(result.output, /1% \(reserve portion has no fee\)/);
  assert.equal(
    result.calls.some(([command]) => ['wallet', 'send'].includes(command)),
    false,
  );
  for (const call of result.calls.filter(([command]) => command === 'call')) {
    assert.match(call[2], /^[A-Za-z]\w*\(/, 'full function signature, never hand-written selector');
    assert.equal(call.at(-1), '12345', 'one block for the diagnostic snapshot');
  }
});
test('rate increase refuses without attempting to unlock or send', () => {
  const result = run('rate-increase', ['--execute']);
  noSend(result);
  assert.match(result.output, /raise every pooled user/);
  assert.equal(
    result.calls.some(([command]) => command === 'wallet'),
    false,
  );
});
test('failed simulation refuses before send', () => {
  const result = run('revert', ['--execute']);
  noSend(result);
  assert.match(result.output, /No transaction was submitted/);
});
test('missing keeper role refuses before simulation or signing', () => {
  const result = run('no-role', ['--execute']);
  noSend(result);
  assert.equal(
    result.calls.some(([command]) => ['estimate', 'wallet'].includes(command)),
    false,
  );
});
test('wrong keystore signer refuses without exposing password file contents', () => {
  const passwordPath = join(dir, 'password');
  writeFileSync(passwordPath, 'test-only-password-never-print');
  const result = run('wrong-signer', ['--execute', '--password-file', passwordPath]);
  noSend(result);
  assert.match(result.output, /not the expected testnet keeper/);
  assert.doesNotMatch(result.output, /test-only-password-never-print/);
});
test('lost send response is uncertain and never automatically retried', () => {
  const result = run('send-uncertain', ['--execute', '--password-file', join(dir, 'password')]);
  assert.notEqual(result.status, 0);
  const sends = result.calls.filter(([command]) => command === 'send');
  assert.equal(sends.length, 1);
  assert.match(result.output, /Submission may still have occurred/);
  assert.equal(
    sends[0][sends[0].indexOf('--from') + 1],
    '0x54196397D6f01b48739dB3957257cB33cD341885',
  );
});

test('a rate change while unlocking is caught by the final pre-send check', () => {
  const result = run('late-rate-increase', ['--execute', '--password-file', join(dir, 'password')]);
  noSend(result);
  assert.match(result.output, /global rate increased before sending/);
});

test('a changed simulation after unlocking refuses without sending', () => {
  const result = run('late-revert', ['--execute', '--password-file', join(dir, 'password')]);
  noSend(result);
  assert.match(result.output, /final simulation failed/);
});
