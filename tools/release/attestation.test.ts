import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMarenAddresses } from '@maren/sdk';
import { toFunctionSelector } from 'viem';
import {
  attestDeployment,
  attestLocalConfiguration,
  attestRelayerHealth,
  domainMatches,
  type DeploymentReader,
} from './attestation.js';

const maren = getMarenAddresses('testnet');
const domain = [
  '0x0f',
  'Maren Forwarder',
  '1',
  31611n,
  maren.marenForwarder,
  `0x${'0'.repeat(64)}`,
  [],
];

function reader(overrides: Partial<DeploymentReader> = {}): DeploymentReader {
  return {
    getChainId: async () => 31611,
    getBlockNumber: async () => 20_000_000n,
    getCode: async () => '0x123456',
    readContract: async ({ functionName, args, blockNumber }) => {
      expect(blockNumber).toBe(20_000_000n);
      if (functionName === 'eip712Domain') return domain;
      if (functionName === 'trustedForwarder') return maren.marenForwarder;
      if (functionName === 'decimals') return 18;
      return ![
        toFunctionSelector('deposit(address,address)'),
        toFunctionSelector('createLink(address,uint256,uint64,string)'),
      ].includes(args?.[1] as `0x${string}`);
    },
    ...overrides,
  };
}

describe('deployed identity', () => {
  it('reads every configuration property at the same block', async () => {
    const report = await attestDeployment(reader());
    expect(report.passed).toBe(true);
    expect(report.observations.length).toBeGreaterThan(25);
  });
  it('refuses the wrong chain before inspecting any target', async () => {
    const report = await attestDeployment(
      reader({
        getChainId: async () => 31612,
        getCode: async () => {
          throw new Error('must not get here');
        },
      }),
    );
    expect(report.passed).toBe(false);
    expect(report.observations).toHaveLength(1);
  });
  it('reports an RPC outage as failure instead of an empty chain', async () => {
    const report = await attestDeployment(
      reader({
        getChainId: async () => {
          throw new Error('provider secret');
        },
      }),
    );
    expect(report.passed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('provider secret');
  });
  it('refuses missing code even when the ABI calls return expected values', async () => {
    expect((await attestDeployment(reader({ getCode: async () => '0x' }))).passed).toBe(false);
  });
  it('refuses a hub that claims every selector is allowed', async () => {
    const healthy = reader();
    expect(
      (
        await attestDeployment(
          reader({
            readContract: async (args) =>
              args.functionName === 'allowedCall' ? true : healthy.readContract(args),
          }),
        )
      ).passed,
    ).toBe(false);
  });
  it('refuses a revoked selector', async () => {
    const healthy = reader();
    const report = await attestDeployment(
      reader({
        readContract: async (args) =>
          args.functionName === 'allowedCall' ? false : healthy.readContract(args),
      }),
    );
    expect(report.passed).toBe(false);
    expect(report.observations.find((o) => o.name === 'allowed marenVault.borrow')?.status).toBe(
      'fail',
    );
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('rejects a changed domain field %i', (index) => {
    const changed: unknown[] = [...domain];
    changed[index] = index === 6 ? [1n] : 'wrong';
    expect(domainMatches(changed)).toBe(false);
  });
});

const files = {
  swift: readFileSync(
    new URL('../../apps/ios-native/Maren/Chain/MezoConfig.swift', import.meta.url),
    'utf8',
  ),
  plist: readFileSync(new URL('../../apps/ios-native/Maren/Info.plist', import.meta.url), 'utf8'),
  wrangler: readFileSync(new URL('../../apps/relayer/wrangler.jsonc', import.meta.url), 'utf8'),
};
const relayer = 'https://maren-relayer.rolandojude18.workers.dev';

describe('local configuration alignment', () => {
  it('matches the repository Swift and Worker testnet configuration to the SDK', () => {
    expect(attestLocalConfiguration(files, relayer).filter((o) => o.status === 'fail')).toEqual([]);
  });
  it('detects a transcribed iOS address error', () => {
    const observations = attestLocalConfiguration(
      { ...files, swift: files.swift.replace(maren.marenVault, maren.marenPay) },
      relayer,
    );
    expect(observations.find((o) => o.name === 'iOS marenVault')?.status).toBe('fail');
  });
  it('detects malformed Worker config and a mismatched relayer URL', () => {
    const observations = attestLocalConfiguration(
      { ...files, wrangler: '{ invalid' },
      'https://wrong.test',
    );
    expect(observations.find((o) => o.name === 'Worker network')?.status).toBe('fail');
    expect(observations.find((o) => o.name === 'iOS relayer URL')?.status).toBe('fail');
  });
});

describe('deployed relayer deep health', () => {
  const health = {
    ok: true,
    accepting: true,
    chainId: 31611,
    network: 'testnet',
    forwarder: maren.marenForwarder,
    store: 'durable',
    balanceWei: '100',
    nonce: 5,
    problems: [],
    targets: ['marenPay', 'marenRegistry', 'marenVault'].map(
      (name) => `${name}:${maren[name as keyof typeof maren]}`,
    ),
  };
  it('accepts a reachable, configured, funded testnet signer', () =>
    expect(attestRelayerHealth(health)).toBe(true));
  it('fails closed on errors, missing values, and a differently configured service', () => {
    for (const value of [
      null,
      {},
      { ...health, chainId: 31612 },
      { ...health, balanceWei: null },
      { ...health, forwarder: maren.marenVault },
      { ...health, targets: [] },
      { ...health, problems: ['RPC offline'] },
    ])
      expect(attestRelayerHealth(value)).toBe(false);
  });
});
