#!/usr/bin/env node
// Read-only regression probe. No sendRawTransaction, wallet broadcast or relay POST.
// Run from any directory after pnpm install:
//   node docs/releases/probe-borrow-gas-2026-09-22.mjs
// Optional full-forwarder simulation uses the existing disposable proof key in a private
// local JSON file {privateKey: ...}; the key and signed request are never emitted:
//   ... --signer-file /private/path/wallet.json --out /tmp/borrow-gas.json
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
const require = createRequire(new URL('../../apps/relayer/package.json', import.meta.url));
const v = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { values } = parseArgs({
  options: {
    rpc: { type: 'string', default: 'https://rpc.test.mezo.org' },
    'signer-file': { type: 'string' },
    out: { type: 'string' },
  },
});
const vault = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const forwarder = '0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C';
const relayer = '0xd90245ee16B2f58eD8654961BBf2fa835046df89';
const owner = '0xc06eDC6325e374778ec88cDCeC7a2E7FA4B7E8CE';
const sorted = '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA';
const blockNumber = 15695455n; // after the disposable deposit, before its confirmed borrow
const abi = v.parseAbi(['function borrow(uint256,address,address)']);
const sortedAbi = v.parseAbi([
  'function getPrev(address) view returns(address)',
  'function getNext(address) view returns(address)',
]);
const forwardAbi = v.parseAbi([
  'function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable',
]);
const types = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item), 2);
try {
  const client = v.createPublicClient({
    transport: v.http(values.rpc, { timeout: 20000, retryCount: 1 }),
  });
  if ((await client.getChainId()) !== 31611) throw new Error('wrong chain');
  let signer;
  if (values['signer-file']) {
    signer = privateKeyToAccount(
      JSON.parse(readFileSync(values['signer-file'], 'utf8')).privateKey,
    );
    if (signer.address.toLowerCase() !== owner.toLowerCase())
      throw new Error('wrong disposable signer');
  }
  const neighbours = await Promise.all(
    ['getPrev', 'getNext'].map((functionName) =>
      client.readContract({
        address: sorted,
        abi: sortedAbi,
        functionName,
        args: [vault],
        blockNumber,
      }),
    ),
  );
  const block = await client.getBlock({ blockNumber });
  const rows = [];
  for (const mode of [
    'old-native-fallback',
    'old-native-successful-estimate',
    'fixed-native-estimated-hints',
  ]) {
    const hints =
      mode === 'fixed-native-estimated-hints' ? neighbours : [v.zeroAddress, v.zeroAddress];
    const data = v.encodeFunctionData({
      abi,
      functionName: 'borrow',
      args: [v.parseEther('10'), ...hints],
    });
    // Mirrors the fixed native estimate: caller identity is preserved; only the simulated
    // fee is zero. The override proves that lack of user BTC does not prevent estimation.
    const estimate = await client.estimateGas({
      account: owner,
      to: vault,
      data,
      blockNumber,
      gasPrice: 0n,
      stateOverride: [{ address: owner, balance: 0n }],
    });
    const padded = estimate + estimate / 2n + 60000n;
    const gas =
      mode === 'old-native-fallback'
        ? 660000n
        : mode === 'old-native-successful-estimate'
          ? padded > 1500000n
            ? 1500000n
            : padded
          : padded;
    if (mode === 'fixed-native-estimated-hints' && gas > 1500000n)
      throw new Error('fixed estimate exceeds sponsorship cap');
    let simulation;
    try {
      if (signer) {
        const request = {
          from: owner,
          to: vault,
          value: 0n,
          gas,
          nonce: 0n,
          deadline: Number(block.timestamp + 600n),
          data,
        };
        const signature = await signer.signTypedData({
          domain: {
            name: 'Maren Forwarder',
            version: '1',
            chainId: 31611,
            verifyingContract: forwarder,
          },
          types,
          primaryType: 'ForwardRequest',
          message: request,
        });
        await client.call({
          account: relayer,
          to: forwarder,
          blockNumber,
          data: v.encodeFunctionData({
            abi: forwardAbi,
            functionName: 'execute',
            args: [{ ...request, signature }],
          }),
        });
      } else {
        await client.call({
          account: owner,
          to: vault,
          data,
          gas,
          gasPrice: 0n,
          blockNumber,
          stateOverride: [{ address: owner, balance: 0n }],
        });
      }
      simulation = 'success';
    } catch (error) {
      const reverted =
        error instanceof v.BaseError &&
        error.walk((cause) => cause instanceof v.ExecutionRevertedError);
      if (!reverted) throw new Error('RPC failed; no simulation conclusion');
      simulation = 'reverted';
    }
    rows.push({ mode, hints, directEstimate: estimate, signedGas: gas, simulation });
  }
  if (
    rows[0].simulation !== 'reverted' ||
    rows[1].simulation !== 'success' ||
    rows[2].simulation !== 'success'
  ) {
    throw new Error('unexpected regression probe outcome');
  }
  const result = {
    observedAt: new Date().toISOString(),
    chainId: 31611,
    historicalBlock: blockNumber,
    amountWei: v.parseEther('10'),
    owner,
    vault,
    simulationMode: signer ? 'signed forwarder eth_call' : 'direct eth_call with gas cap',
    estimatedWithZeroUserBalance: true,
    simulationGasPrice: '0',
    publicTransactions: 0,
    rows,
    conclusion:
      'The zero-hint 660,000-gas fallback fails. Current neighbours with the measured estimate and full 50% plus 60,000 gas margin succeed below the policy cap.',
    limitation:
      'Reproduces a native failure mode; it does not identify an unobserved user request or prove their device has installed the fix.',
  };
  if (values.out) writeFileSync(values.out, json(result) + '\n');
  console.log(json(result));
} catch (error) {
  console.error(
    error instanceof v.BaseError || error instanceof SyntaxError ? error.name : error.message,
  );
  process.exitCode = 1;
}
