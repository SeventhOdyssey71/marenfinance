import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createPublicClient, fallback, http } from 'viem';
import { mezoTestnet } from '@maren/sdk';
import {
  attestDeployment,
  attestLocalConfiguration,
  attestRelayerHealth,
  type Observation,
} from './attestation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const { values } = parseArgs({
    options: {
      rpc: { type: 'string' },
      relayer: { type: 'string', default: 'https://maren-relayer.rolandojude18.workers.dev' },
      local: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const configuration = attestLocalConfiguration(
    {
      swift: readFileSync(resolve(root, 'apps/ios-native/Maren/Chain/MezoConfig.swift'), 'utf8'),
      plist: readFileSync(resolve(root, 'apps/ios-native/Maren/Info.plist'), 'utf8'),
      wrangler: readFileSync(resolve(root, 'apps/relayer/wrangler.jsonc'), 'utf8'),
    },
    values.relayer,
  );
  let chain: Awaited<ReturnType<typeof attestDeployment>> | null = null;
  let health: Observation | null = null;
  if (!values.local) {
    // Read-only client; the attestation itself checks eth_chainId before any
    // contract read. No wallet or chain-specific signing formatter is needed.
    const client = createPublicClient({
      transport: fallback(
        (values.rpc ? [values.rpc] : [...mezoTestnet.rpcUrls.default.http]).map((url) =>
          http(url, { timeout: 10_000, retryCount: 1 }),
        ),
        { retryCount: 0 },
      ),
    });
    [chain, health] = await Promise.all([
      attestDeployment({
        getChainId: () => client.getChainId(),
        getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
        getCode: (args) => client.getCode(args),
        readContract: (args) => client.readContract(args),
      }),
      (async (): Promise<Observation> => {
        try {
          const response = await fetch(new URL('/health', values.relayer), {
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
          });
          const passed = response.status === 200 && attestRelayerHealth(await response.json());
          return {
            name: 'deployed relayer configuration and RPC health',
            status: passed ? 'pass' : 'fail',
            detail: passed
              ? 'accepting on testnet with expected forwarder/targets and readable signer balance/nonce'
              : 'health unavailable or configuration differs from this release',
          };
        } catch {
          return {
            name: 'deployed relayer configuration and RPC health',
            status: 'fail',
            detail: 'health request unavailable or undecodable',
          };
        }
      })(),
    ]);
  }
  const report = {
    checkedAt: new Date().toISOString(),
    scope: values.local
      ? 'Local testnet configuration alignment only; no network requests.'
      : 'Read-only testnet deployment and client configuration checks. Runtime code hashes are observations, not a proof that deployed code equals local source. No transaction signing or submission.',
    localCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    localChanges:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0,
    passed:
      configuration.every((o) => o.status === 'pass') &&
      (values.local || (chain?.passed === true && health?.status === 'pass')),
    configuration,
    chain,
    health,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.out) {
    const path = resolve(values.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json);
  }
  process.stdout.write(json);
  if (!report.passed) process.exitCode = 1;
}

main().catch(() => {
  console.error(
    'Attestation could not run. Check local configuration files and command arguments.',
  );
  process.exitCode = 1;
});
