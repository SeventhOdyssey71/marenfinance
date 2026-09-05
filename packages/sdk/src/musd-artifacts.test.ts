import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { MUSD_ADDRESSES, type MusdAddresses } from './addresses';
import { MEZO_CHAIN_IDS } from './chains';
import * as musdAbis from './musd-abis';
import { MUSD_CONTRACTS_PACKAGE_VERSION } from './musd-abis';

/**
 * DRIFT GUARD — the official `@mezo-org/musd-contracts` package versus our pins.
 *
 * The repo rule is VERIFIED BYTECODE BEATS DOCS. Our addresses in `addresses.ts`
 * were verified on-chain (eth_getCode, functional calls, proxy-manifest cross-check —
 * see the provenance block there), so THEY are the source of truth. The npm package
 * is a witness we are glad to have, not an authority we defer to.
 *
 * What this guard is for: the day someone bumps `@mezo-org/musd-contracts` and the
 * new version moves an address or an ABI, this file goes red instead of the change
 * sliding through. A red run here means one of two things, and the difference matters:
 *
 *   1. Mezo redeployed and the package is telling the truth — re-verify the NEW
 *      address on-chain the same way the originals were verified, update the pin in
 *      `addresses.ts` with fresh provenance, rerun `generate:musd-abis`, and record
 *      the redeploy in the provenance comment.
 *   2. The package is wrong (it has happened with Mezo's docs before — see the
 *      mezo-chain-verified-facts memory). Keep our pin, document the conflict loudly
 *      in `addresses.ts`, and pin the package version until it is fixed.
 *
 * NEVER resolve a red run by copying the package's value into `addresses.ts`
 * unverified. That converts the guard into a rubber stamp.
 *
 * Verified in agreement (all 30 addresses, both networks) on 2026-09-05 against
 * v1.1.0, including a live eth_getCode + getNonce() probe of the matsnet
 * BorrowerOperationsSignatures deployment.
 */

const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve('@mezo-org/musd-contracts/package.json');
const pkgRoot = path.dirname(pkgJsonPath);
const installedVersion: string = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;

/** Our network names → the package's deployment directory names. */
const NETWORK_DIRS = { mainnet: 'mainnet', testnet: 'matsnet' } as const;

/** Every pinned address key → the package's artifact file name. All 15 are covered. */
const ARTIFACT_FOR_PIN: Record<keyof MusdAddresses, string> = {
  musd: 'MUSD',
  borrowerOperations: 'BorrowerOperations',
  borrowerOperationsSignatures: 'BorrowerOperationsSignatures',
  troveManager: 'TroveManager',
  stabilityPool: 'StabilityPool',
  priceFeed: 'PriceFeed',
  sortedTroves: 'SortedTroves',
  hintHelpers: 'HintHelpers',
  activePool: 'ActivePool',
  defaultPool: 'DefaultPool',
  collSurplusPool: 'CollSurplusPool',
  gasPool: 'GasPool',
  pcv: 'PCV',
  interestRateManager: 'InterestRateManager',
  governableVariables: 'GovernableVariables',
};

function loadArtifact(dir: string, name: string): { address: string; abi: unknown[] } {
  return JSON.parse(readFileSync(path.join(pkgRoot, 'deployments', dir, `${name}.json`), 'utf8'));
}

describe('drift guard: @mezo-org/musd-contracts vs pinned addresses', () => {
  it('the installed package is the version the generated ABIs came from', () => {
    // A bump without `pnpm --filter @maren/sdk generate:musd-abis` (which is also what
    // re-exposes any address drift below) must be a red test, not a silent skew.
    expect(installedVersion).toBe(MUSD_CONTRACTS_PACKAGE_VERSION);
  });

  it("the package's .chainId files are the chains we think they are", () => {
    for (const [network, dir] of Object.entries(NETWORK_DIRS)) {
      const chainId = Number(
        readFileSync(path.join(pkgRoot, 'deployments', dir, '.chainId'), 'utf8'),
      );
      expect(chainId, `deployments/${dir}/.chainId`).toBe(
        MEZO_CHAIN_IDS[network as keyof typeof MEZO_CHAIN_IDS],
      );
    }
  });

  for (const [network, dir] of Object.entries(NETWORK_DIRS) as [
    keyof typeof NETWORK_DIRS,
    string,
  ][]) {
    it(`every pinned ${network} address matches deployments/${dir}`, () => {
      const pins = MUSD_ADDRESSES[network];
      for (const [pinKey, artifactName] of Object.entries(ARTIFACT_FOR_PIN) as [
        keyof MusdAddresses,
        string,
      ][]) {
        const packaged = getAddress(loadArtifact(dir, artifactName).address);
        const pinned = getAddress(pins[pinKey]);
        expect(
          packaged,
          `ADDRESS DRIFT for ${artifactName} on ${network}: the installed ` +
            `@mezo-org/musd-contracts@${installedVersion} says ${packaged} but our ` +
            `on-chain-verified pin is ${pinned}. Do NOT copy the package value in — ` +
            `re-verify on-chain first. See the guard's header comment for the procedure.`,
        ).toBe(pinned);
      }
    });
  }

  it('generated ABIs are in sync with the installed package (both networks)', () => {
    const generated: Record<string, unknown> = {
      MUSD: musdAbis.musdTokenAbi,
      BorrowerOperations: musdAbis.borrowerOperationsAbi,
      BorrowerOperationsSignatures: musdAbis.borrowerOperationsSignaturesAbi,
      TroveManager: musdAbis.troveManagerFullAbi,
      StabilityPool: musdAbis.stabilityPoolAbi,
      PriceFeed: musdAbis.priceFeedFullAbi,
      HintHelpers: musdAbis.hintHelpersAbi,
      SortedTroves: musdAbis.sortedTrovesAbi,
      PCV: musdAbis.pcvAbi,
      InterestRateManager: musdAbis.interestRateManagerAbi,
    };
    for (const [artifactName, abi] of Object.entries(generated)) {
      // toEqual on both directions of network: the generator asserts matsnet === mainnet
      // before writing, and this re-asserts it so the invariant cannot rot unnoticed.
      expect(abi, `${artifactName}: regenerate with generate:musd-abis`).toEqual(
        loadArtifact('matsnet', artifactName).abi,
      );
      expect(abi, `${artifactName}: matsnet/mainnet ABIs diverged in the package`).toEqual(
        loadArtifact('mainnet', artifactName).abi,
      );
    }
  });
});

describe('BorrowerOperationsSignatures ABI surface (EIP-712 gasless trove ops)', () => {
  type AbiItem = {
    type: string;
    name?: string;
    inputs?: readonly { type: string }[];
    outputs?: readonly { type: string }[];
  };
  const abi = musdAbis.borrowerOperationsSignaturesAbi as readonly AbiItem[];
  const fn = (name: string) => abi.find((i) => i.type === 'function' && i.name === name);

  // Every gasless variant the relayer path can ever need. If Mezo renames or drops
  // one in a future package version, this list is the tripwire.
  const SIGNATURE_FUNCTIONS = [
    'openTroveWithSignature',
    'adjustTroveWithSignature',
    'addCollWithSignature',
    'withdrawCollWithSignature',
    'withdrawMUSDWithSignature',
    'repayMUSDWithSignature',
    'closeTroveWithSignature',
    'claimCollateralWithSignature',
    'refinanceWithSignature',
  ];

  for (const name of SIGNATURE_FUNCTIONS) {
    it(`exposes ${name}`, () => {
      expect(fn(name), `${name} missing from BorrowerOperationsSignatures ABI`).toBeDefined();
    });
  }

  it('exposes getNonce(address) -> uint256', () => {
    const getNonce = fn('getNonce');
    expect(getNonce).toBeDefined();
    expect(getNonce?.inputs?.map((i) => i.type)).toEqual(['address']);
    expect(getNonce?.outputs?.map((o) => o.type)).toEqual(['uint256']);
  });

  it('exposes eip712Domain (ERC-5267), so the signing domain is readable on-chain', () => {
    expect(fn('eip712Domain')).toBeDefined();
  });
});
