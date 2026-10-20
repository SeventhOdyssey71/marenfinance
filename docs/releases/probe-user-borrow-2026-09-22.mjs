#!/usr/bin/env node
// Read-only diagnosis of the reported build73 / 500 MUSD request. No signer or send API.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../apps/relayer/package.json', import.meta.url));
const v = require('viem');
const wallet = '0x4b0b25687fee0eb9d90617d656490dfd2964c0ef';
const vault = '0x46252B00AB59384518d9dB6D1f210ffF1221645b';
const tm = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const bo = '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5';
const sorted = '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA';
const priceFeed = '0x86bCF0841622a5dAC14A313a15f96A95421b9366';
const token = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
const rpc = 'https://rpc.test.mezo.org';
const WAD = 10n ** 18n,
  MIN_CR = (18n * WAD) / 10n,
  amount = 500n * WAD;
const json = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item), 2);
const client = v.createPublicClient({ transport: v.http(rpc, { timeout: 20000, retryCount: 1 }) });
try {
  if (!v.isAddress(wallet)) throw new Error('reported wallet is not a valid address');
  if ((await client.getChainId()) !== 31611) throw new Error('wrong chain');
  const blockNumber = 15696997n; // pinned snapshot of the reported request
  const read = (address, signature, args = []) => {
    const abi = v.parseAbi([signature]);
    return client.readContract({ address, abi, functionName: abi[0].name, args, blockNumber });
  };
  const specs = {
    userCollateralWei: [vault, 'function collateral(address) view returns(uint256)', [wallet]],
    userDebtWei: [vault, 'function previewDebtOf(address) view returns(uint256)', [wallet]],
    userMaxBeforeFeeWei: [vault, 'function maxBorrowable(address) view returns(uint256)', [wallet]],
    userCurrentCR: [vault, 'function collateralRatioOf(address) view returns(uint256)', [wallet]],
    borrowingPaused: [vault, 'function borrowingPaused() view returns(bool)'],
    troveOpen: [vault, 'function troveOpen() view returns(bool)'],
    reserveWei: [vault, 'function reserveMUSD() view returns(uint256)'],
    idleWei: [vault, 'function idleCollateral() view returns(uint256)'],
    minimumNetDebtWei: [vault, 'function MIN_NET_DEBT() view returns(uint256)'],
    gasCompensationWei: [vault, 'function MUSD_GAS_COMPENSATION() view returns(uint256)'],
    governor: [bo, 'function governableVariables() view returns(address)'],
    poolStatus: [vault, 'function troveStatus() view returns(uint256,uint256,uint256)'],
    entireTrove: [
      tm,
      'function getEntireDebtAndColl(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)',
      [vault],
    ],
    ceilingWei: [
      tm,
      'function getTroveMaxBorrowingCapacity(address) view returns(uint256)',
      [vault],
    ],
    borrowingRateWei: [bo, 'function borrowingRate() view returns(uint256)'],
    priceWei: [priceFeed, 'function fetchPrice() view returns(uint256)'],
    musdBalanceWei: [token, 'function balanceOf(address) view returns(uint256)', [wallet]],
    upper: [sorted, 'function getPrev(address) view returns(address)', [vault]],
    lower: [sorted, 'function getNext(address) view returns(address)', [vault]],
  };
  const snapshot = Object.fromEntries(
    await Promise.all(
      Object.entries(specs).map(async ([name, args]) => [name, await read(...args)]),
    ),
  );
  snapshot.feeExempt = await read(
    snapshot.governor,
    'function isAccountFeeExempt(address) view returns(bool)',
    [vault],
  );
  if (snapshot.feeExempt) snapshot.borrowingRateWei = 0n;
  snapshot.btcBalanceWei = await client.getBalance({ address: wallet, blockNumber });
  const rawDebt = snapshot.entireTrove[1] + snapshot.entireTrove[2];
  const clamp = (n) => (n > 0n ? n : 0n);
  const inverse = (budget) =>
    budget <= snapshot.reserveWei
      ? clamp(budget)
      : snapshot.reserveWei +
        ((budget - snapshot.reserveWei) * WAD) / (WAD + snapshot.borrowingRateWei);
  const userMax = inverse(snapshot.userMaxBeforeFeeWei);
  const capacityMax =
    snapshot.reserveWei +
    (clamp(snapshot.ceilingWei - rawDebt) * WAD) / (WAD + snapshot.borrowingRateWei);
  const poolMax =
    snapshot.reserveWei +
    (clamp((snapshot.entireTrove[0] * snapshot.priceWei) / MIN_CR - rawDebt) * WAD) /
      (WAD + snapshot.borrowingRateWei);
  const max = [userMax, capacityMax, poolMax].reduce((a, b) => (a < b ? a : b));
  const debtAdded =
    amount + (clamp(amount - snapshot.reserveWei) * snapshot.borrowingRateWei) / WAD;
  const limits = {
    userMaxNetWei: userMax,
    capacityMaxNetWei: capacityMax,
    poolMaxNetWei: poolMax,
    overallMaxNetWei: max,
    requestedWithinLimits: amount <= max,
    feeWei: debtAdded - amount,
    postBorrowUserCR:
      (snapshot.userCollateralWei * snapshot.priceWei) / (snapshot.userDebtWei + debtAdded),
    postBorrowPoolCR:
      (snapshot.entireTrove[0] * snapshot.priceWei) /
      (rawDebt + (clamp(amount - snapshot.reserveWei) * (WAD + snapshot.borrowingRateWei)) / WAD),
  };
  const drawn = clamp(amount - snapshot.reserveWei);
  const protocolFee = await read(bo, 'function getBorrowingFee(uint256) view returns(uint256)', [
    drawn,
  ]);
  const helpers = '0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6';
  const projectedPrincipal = snapshot.entireTrove[1] + drawn + protocolFee;
  const targetNicr = await read(
    helpers,
    'function computeNominalCR(uint256,uint256) view returns(uint256)',
    [snapshot.entireTrove[0], projectedPrincipal],
  );
  const currentNicr = await read(tm, 'function getNominalICR(address) view returns(uint256)', [
    vault,
  ]);
  const computedCurrentNicr = await read(
    helpers,
    'function computeNominalCR(uint256,uint256) view returns(uint256)',
    [snapshot.entireTrove[0], snapshot.entireTrove[1]],
  );
  if (currentNicr !== computedCurrentNicr)
    throw Error('principal-only NICR does not match protocol');
  const targetHints = await read(
    sorted,
    'function findInsertPosition(uint256,address,address) view returns(address,address)',
    [targetNicr, snapshot.upper, snapshot.lower],
  );
  snapshot.projectedInsertion = {
    drawn,
    protocolFee,
    projectedPrincipal,
    currentNicr,
    targetNicr,
    targetHints,
  };
  console.log(json({ blockNumber, wallet, amountWei: amount, snapshot, limits }));
  const artifact = JSON.parse(
    readFileSync(
      new URL('../../packages/contracts/out/MarenVault.sol/MarenVault.json', import.meta.url),
      'utf8',
    ),
  ).abi;
  const rows = [];
  const describe = (error) => {
    const reverted =
      error instanceof v.BaseError
        ? error.walk((cause) => cause instanceof v.ContractFunctionRevertedError)
        : null;
    if (reverted?.data)
      return { state: 'reverted', errorName: reverted.data.errorName, args: reverted.data.args };
    const execution =
      error instanceof v.BaseError
        ? error.walk((cause) => cause instanceof v.ExecutionRevertedError)
        : null;
    return {
      state: execution ? 'reverted' : 'rpc-error',
      detail: error.shortMessage || error.name,
    };
  };
  for (const mode of ['old-zero-hints', 'current-neighbour-hints', 'target-insertion-hints']) {
    const hints =
      mode === 'old-zero-hints'
        ? [v.zeroAddress, v.zeroAddress]
        : mode === 'target-insertion-hints'
          ? targetHints
          : [snapshot.upper, snapshot.lower];
    const args = [amount, ...hints];
    const data = v.encodeFunctionData({ abi: artifact, functionName: 'borrow', args });
    let estimate;
    try {
      estimate = await client.estimateGas({
        account: wallet,
        to: vault,
        data,
        blockNumber,
        gasPrice: 0n,
      });
    } catch (error) {
      estimate = describe(error);
    }
    const padded = typeof estimate === 'bigint' ? estimate + estimate / 2n + 60000n : null;
    const cases = [
      ['fallback-660k', 660000n],
      [
        'estimated-policy-budget',
        padded === null
          ? 1500000n
          : mode === 'old-zero-hints' && padded > 1500000n
            ? 1500000n
            : padded,
      ],
    ];
    for (const [gasMode, gas] of cases) {
      let simulation;
      try {
        await client.simulateContract({
          account: wallet,
          address: vault,
          abi: artifact,
          functionName: 'borrow',
          args,
          blockNumber,
          gas,
          gasPrice: 0n,
        });
        simulation = { state: 'success' };
      } catch (error) {
        simulation = describe(error);
      }
      const row = {
        mode,
        hints,
        gasMode,
        gas,
        estimate,
        padded,
        fixedPolicyAccepts: padded !== null && padded <= 1500000n,
        simulation,
      };
      rows.push(row);
      console.log(json(row));
    }
  }
  const targetRow = rows.find(
    (row) => row.mode === 'target-insertion-hints' && row.gasMode === 'estimated-policy-budget',
  );
  const forwarder = '0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C';
  const forwardedData =
    v.encodeFunctionData({
      abi: artifact,
      functionName: 'borrow',
      args: [amount, ...targetHints],
    }) + wallet.slice(2);
  let trustedForwarderFraming;
  try {
    await client.call({
      account: forwarder,
      to: vault,
      data: forwardedData,
      gas: targetRow.gas,
      gasPrice: 0n,
      blockNumber,
    });
    trustedForwarderFraming = { state: 'success', gas: targetRow.gas };
  } catch (error) {
    trustedForwarderFraming = describe(error);
  }
  const evidence = {
    trustedForwarderFraming,
    observedAt: new Date().toISOString(),
    chainId: 31611,
    rpc,
    blockNumber,
    wallet,
    reportedBuild: 73,
    amountWei: amount,
    snapshot,
    limits,
    simulations: rows,
    publicTransactions: 0,
    limitations: [
      'Read-only direct eth_call from the public wallet address; no private key or user signature was requested.',
      'This pinned snapshot cannot identify an earlier failed request without its original signed payload or request log.',
      'The trusted-forwarder framing probe is an unsigned read-only eth_call from the trusted address with the wallet suffix; it verifies ERC2771 target execution, not signature verification or a broadcast.',
    ],
  };
  writeFileSync(
    new URL('./user-borrow-probe-2026-09-22.json', import.meta.url),
    json(evidence) + '\n',
  );
} catch (error) {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
}
