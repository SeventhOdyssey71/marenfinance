#!/usr/bin/env node
/**
 * Generates `src/musd-abis.ts` from the official `@mezo-org/musd-contracts` package.
 *
 * WHY CODEGEN INSTEAD OF IMPORTING THE JSON DIRECTLY. Two reasons, both about types:
 *   1. A JSON import gives TypeScript a WIDENED type (`string`, not `'function'`;
 *      `any[]`-shaped members), which throws away everything viem's inference is for —
 *      no typed args, no typed returns, no event narrowing. Only an `as const` literal
 *      in a .ts file keeps the narrow types, and JSON modules cannot be `as const`.
 *   2. The package has no `exports` map and no types of its own, so deep JSON imports
 *      are a resolution hazard for consumers with stricter bundler settings than ours.
 *
 * The generated file is committed. It is NOT hand-edited — this script is the only
 * writer, and `src/musd-artifacts.test.ts` fails if the committed output ever drifts
 * from the installed package (so a package bump forces a regeneration, and a
 * regeneration forces the address drift-guard to pass first).
 *
 * The script HARD-FAILS if the matsnet and mainnet ABIs for any contract differ,
 * because the generated file deliberately carries ONE ABI per contract. If Mezo ever
 * ships different interfaces per network, a human has to decide what that means —
 * this script must not pick silently. (Verified identical for all 15 contracts in
 * v1.1.0 on 2026-09-05.)
 *
 * Run with:  pnpm --filter @maren/sdk generate:musd-abis
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve('@mezo-org/musd-contracts/package.json');
const pkgRoot = path.dirname(pkgJsonPath);
const pkgVersion = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;

/**
 * The contracts we expose ABIs for, in render order.
 * [artifact file name, exported const name, one-line doc]
 *
 * `troveManagerFullAbi` and `priceFeedFullAbi` carry a `Full` suffix ONLY because
 * `src/abis.ts` already exports hand-curated `troveManagerAbi` / `priceFeedAbi`
 * subsets that the apps depend on. Both files are star-exported from `src/index.ts`,
 * and a name collision between star exports is silently DROPPED by the ES module
 * spec rather than reported — the suffix is what keeps every export resolvable.
 */
const CONTRACTS = [
  [
    'MUSD',
    'musdTokenAbi',
    'MUSD token — ERC-20 + EIP-2612 permit. Not a proxy (see addresses.ts).',
  ],
  [
    'BorrowerOperations',
    'borrowerOperationsAbi',
    'Trove lifecycle: open/adjust/close, collateral and MUSD movements.',
  ],
  [
    'BorrowerOperationsSignatures',
    'borrowerOperationsSignaturesAbi',
    'EIP-712 gasless trove ops — every BorrowerOperations action as a *WithSignature variant, plus getNonce/eip712Domain.',
  ],
  [
    'TroveManager',
    'troveManagerFullAbi',
    'Trove state, liquidations, redemptions. Full official ABI; the curated subset in abis.ts is troveManagerAbi.',
  ],
  [
    'StabilityPool',
    'stabilityPoolAbi',
    'MUSD Stability Pool — deposits, collateral gains, liquidation absorption.',
  ],
  [
    'PriceFeed',
    'priceFeedFullAbi',
    'BTC/USD price feed. Full official ABI; the curated subset in abis.ts is priceFeedAbi.',
  ],
  [
    'HintHelpers',
    'hintHelpersAbi',
    'Hint computation for sorted-trove insertion (getApproxHint et al.).',
  ],
  ['SortedTroves', 'sortedTrovesAbi', 'The ICR-ordered doubly-linked trove list.'],
  ['PCV', 'pcvAbi', 'Protocol Controlled Value — fee recipient and bootstrap-loan holder.'],
  [
    'InterestRateManager',
    'interestRateManagerAbi',
    'Governance-controlled simple interest rate on trove principal.',
  ],
];

/** Canonical stringify (sorted keys) so key order can never fake a difference. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function loadAbi(network, name) {
  const file = path.join(pkgRoot, 'deployments', network, `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')).abi;
}

const blocks = [];
for (const [artifact, exportName, doc] of CONTRACTS) {
  const matsnet = loadAbi('matsnet', artifact);
  const mainnet = loadAbi('mainnet', artifact);
  if (stable(matsnet) !== stable(mainnet)) {
    console.error(
      `FATAL: ${artifact} ABI differs between matsnet and mainnet in ` +
        `@mezo-org/musd-contracts@${pkgVersion}. This file carries one ABI per ` +
        `contract; a per-network split needs a deliberate design change, not a regen.`,
    );
    process.exit(1);
  }
  blocks.push(
    `/** ${doc} */\n` +
      `export const ${exportName} = ${JSON.stringify(matsnet, null, 2)} as const;\n`,
  );
}

const header = `/**
 * MUSD protocol ABIs — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Source:    @mezo-org/musd-contracts@${pkgVersion} (npm), hardhat-deploy artifacts under
 *            deployments/{matsnet,mainnet}/<Contract>.json — Mezo's official package.
 * Generator: packages/sdk/scripts/generate-musd-abis.mjs
 * Regenerate with:  pnpm --filter @maren/sdk generate:musd-abis
 *
 * These are the FULL official ABIs, one per contract, identical on matsnet and
 * mainnet (the generator hard-fails if they ever diverge). The hand-curated
 * app-facing subsets stay in src/abis.ts; nothing here replaces them.
 *
 * Addresses do NOT live here — they stay pinned in src/addresses.ts, where the
 * provenance trail is. The repo rule is VERIFIED BYTECODE BEATS DOCS: the package
 * is treated as a witness for our pins, never as the authority over them.
 * src/musd-artifacts.test.ts cross-checks every pinned address against this
 * package on every test run and fails loudly on any drift, so a future package
 * bump can never move an address (or these ABIs) under us silently.
 *
 * Tree-shaking: import from '@maren/sdk/musd-abis' (or the root re-export). Every
 * export is an independent const, so consumers that only want addresses never pay
 * for a byte of ABI.
 */

import type { Abi } from 'viem';

/**
 * The package version this file was generated from. The drift-guard test asserts
 * it equals the INSTALLED version, so bumping the dependency without regenerating
 * (and therefore without re-running the address guard) is a red test, not a
 * silent skew.
 */
export const MUSD_CONTRACTS_PACKAGE_VERSION = '${pkgVersion}';

`;

// A compile-time-only check that every generated literal satisfies viem's Abi type,
// without widening the exported consts.
const footer =
  `\n// Compile-time guard: every export above must satisfy viem's Abi type.\n` +
  `// (satisfies would widen nothing either, but a plain assignability check keeps\n` +
  `// the generator trivial and the error message obvious.)\n` +
  CONTRACTS.map(([, exportName]) => `const _check_${exportName}: Abi = ${exportName};`).join('\n') +
  `\nvoid [${CONTRACTS.map(([, n]) => `_check_${n}`).join(', ')}];\n`;

const out = header + blocks.join('\n') + footer;
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'musd-abis.ts');
writeFileSync(dest, out);
console.log(
  `Wrote ${path.relative(process.cwd(), dest)} from @mezo-org/musd-contracts@${pkgVersion} ` +
    `(${CONTRACTS.length} contracts).`,
);
