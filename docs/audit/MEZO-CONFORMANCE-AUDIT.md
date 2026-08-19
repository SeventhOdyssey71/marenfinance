# Mezo / MUSD conformance audit

Does Maren integrate with Mezo and MUSD correctly, against the contracts actually deployed
rather than against the documentation?

Audited 19 August 2026 against Mezo matsnet (31611) and Mezo mainnet (31612). The reference
for expected behaviour is `docs/audit/MEZO-GROUND-TRUTH.md`; the record of Maren's
assumptions is `packages/sdk/src/{constants.ts,addresses.ts,chains.ts}`. Where the two
disagree, the chain wins.

## Method, and why it is stronger than the last pass

Earlier verification passes called a getter and checked the answer. That proves a function
exists; it does not prove the ones Maren has never called exist, and it cannot prove a
function is ABSENT, which is half of what the Liquity divergences claim.

This pass worked at the dispatch table. Every core MUSD contract is a
TransparentUpgradeableProxy, so the runtime code at the address Maren integrates against is
the proxy, not the logic. For each one the EIP-1967 implementation slot was read, the
implementation's runtime bytecode fetched, and the 4-byte selector of every function Maren
declares searched for inside it. A Solidity dispatcher emits each selector as a `PUSH4`
constant, so presence in the runtime bytes is a direct statement about the ABI.

```sh
# 1. the implementation behind the proxy
cast storage 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url https://rpc.test.mezo.org
#   -> 0x...c05bf344bd5b58825784326dd3112fb6cc160dcc

# 2. its runtime bytecode
cast code 0xc05bf344bd5b58825784326dd3112fb6cc160dcc --rpc-url https://rpc.test.mezo.org > bo.hex

# 3. the selector, and whether it is in there
cast sig "withdrawMUSD(uint256,address,address)"   # -> 0xaf8b4fd0
grep -i af8b4fd0 bo.hex                            # -> present
```

Three further techniques carried most of the interesting findings:

- **Negative controls.** Every Liquity-shaped variant carrying `_maxFeePercentage` was
  checked too. A claim that a parameter does not exist is only worth something if the
  method could have found it.
- **ASCII extraction from the constant pool.** Solidity `require` strings are stored
  verbatim in runtime bytecode. Reading them out gives the protocol's own rules in its own
  words, which is how the Recovery Mode finding below was made. This is not inference.
- **Payability probes.** `eth_call` with a non-zero `value` against a non-payable function
  reverts with empty returndata, while a payable one reaches its logic and reverts with a
  message. That distinguishes "native BTC as msg.value" from a guess.

Both networks were checked for BorrowerOperations and TroveManager. The remaining contracts
were checked on matsnet, which is where Maren is deployed. The testnet RPC flaked twice
during the run; both calls succeeded on retry. Two rows below are marked UNPROVEN and say
exactly what was not reached.

RPC endpoints used: `https://rpc.test.mezo.org` primary,
`https://mezo-testnet.drpc.org` fallback, `https://jsonrpc-mezo.boar.network` for mainnet.

## Summary

73 integration points were given an explicit verdict.

| Verdict | Count | Where |
| --- | --- | --- |
| PASS | 64 | selectors 39, divergences 6, doc discrepancies 1, hints 6, oracle 5, precompiles 7 |
| DRIFTED | 6 | Recovery Mode (1), `PaidToHandle` topic0 (1), `isUsingStalePrice` unused (1), byte counts (3) |
| UNPROVEN | 3 | refinance-fee arithmetic, circulating-vs-backed ratio, MEZO token precompile |

Every one of the 44 function selectors Maren declares exists on the deployed contract with
the argument types Maren encodes, on both networks. No type mismatch was found anywhere,
and no selector is assumed without proof.

The drift is not in the ABIs. It is in one recorded behavioural assumption that turned out
to be narrower than the chain (Recovery Mode, Finding 1), one event signature that hashes to
a topic the chain never emits (Finding 2), one exposed staleness flag nothing reads
(Finding 3), and three byte counts that were hex-string lengths (Finding 5). Findings 1, 2
and 5 are fixed in this branch, the first two with tests. Finding 3 is left open on purpose:
it needs a designed state in the Earn screen rather than a guard, and inventing that copy
here would be guessing at intent.

## 1. Interfaces: every selector Maren declares

### BorrowerOperations

Proxy matsnet `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` (impl
`0xc05bf344bd5b58825784326dd3112fb6cc160dcc`, 24,552 bytes); proxy mainnet
`0x44b1bac67dDA612a41a58AAf779143B181dEe031` (impl
`0x501670bbbe2ec8c11449c28c0c9e6677d5ea9b61`, 24,552 bytes). Declared in
`packages/contracts/src/interfaces/IBorrowerOperations.sol`.

| Function | Selector | Maren assumes | Chain says | Verdict |
| --- | --- | --- | --- | --- |
| `openTrove(uint256,address,address)` | `0x2f3a6d98` | payable, no fee cap | present both nets; `eth_call` with `value:1` reached `"BorrowerOps: Trove is active"`, so it accepts value | PASS |
| `addColl(address,address)` | `0x68647db1` | payable | present both; `eth_call` with `value:1` succeeded | PASS |
| `withdrawColl(uint256,address,address)` | `0x5530273c` | non-payable | present both | PASS |
| `withdrawMUSD(uint256,address,address)` | `0xaf8b4fd0` | non-payable | present both; call with no value reached protocol logic | PASS |
| `repayMUSD(uint256,address,address)` | `0xdc283bb3` | non-payable | present both | PASS |
| `closeTrove()` | `0x0e704d50` | no arguments | present both; reverts `"Caller doesnt have enough mUSD to make repayment"` | PASS |
| `refinance(address,address)` | `0xdc1cdb2c` | hints only | present both | PASS |
| `claimCollateral()` | `0x6f0b0c1c` | no arguments | present both | PASS |
| `adjustTrove(uint256,uint256,bool,address,address)` | `0x45c842e6` | declared, never called | present both | PASS |
| `minNetDebt()` | `0x969c2452` | 1.8e21 | 1800000000000000000000 both | PASS |

Negative controls, all four ABSENT on both networks, which is the point:

| Liquity form | Selector | Verdict |
| --- | --- | --- |
| `openTrove(uint256,uint256,address,address)` | `0x860665b3` | absent (PASS) |
| `openTrove(uint256,uint256,uint256,address,address)` | `0x8f09162b` | absent (PASS) |
| `withdrawMUSD(uint256,uint256,address,address)` | `0x5f705f69` | absent (PASS) |
| `adjustTrove(uint256,uint256,uint256,bool,address,address)` | `0xc6a6cf20` | absent (PASS) |

No `maxFeePercentage` appears anywhere in Maren, and no fee-cap require string
(`"Fee exceeded provided maximum"` or similar) appears in the deployed bytecode.

### TroveManager

Proxy matsnet `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` (impl
`0x9aab567966983e95536fc460c12266fb0cc10b07`, 19,997 bytes); mainnet impl
`0xdcfdab0dea52e5efc8400283d46fd0d122a519e9`, same size.

| Function | Selector | Verdict | Note |
| --- | --- | --- | --- |
| `getTroveColl(address)` | `0x480cd578` | PASS | |
| `getTroveStatus(address)` | `0x21e37801` | PASS | returned `1` for the vault's own trove |
| `getTroveDebt(address)` | `0xd66a2553` | PASS | |
| `getTroveMaxBorrowingCapacity(address)` | `0xe07fdf03` | PASS | |
| `getCurrentICR(address,uint256)` | `0xd293c710` | PASS | |
| `getTCR(uint256)` | `0xb82f263d` | PASS | 1.905e18 matsnet, 2.467e18 mainnet |
| `checkRecoveryMode(uint256)` | `0x4e443d9e` | PASS | `false` on both, so Recovery Mode was NOT live during the audit |
| `getEntireDebtAndColl(address)` | `0xb91af97c` | PASS | see the arity check below |
| `redeemCollateral(uint256,address,address,address,uint256,uint256)` | `0x3db23605` | PASS | |
| `MCR()` | `0x794e5724` | PASS | 1.1e18 both |
| `CCR()` | `0x5733d58f` | PASS | 1.5e18 both |

Absences, all confirmed on both networks:

| Function | Selector | Verdict |
| --- | --- | --- |
| `redeemCollateral(...,uint256)` 7-arg Liquity form | `0xbcd37526` | absent (PASS); live call reverts with empty returndata |
| `baseRate()` | `0x1f68f20a` | absent (PASS) |
| `getRedemptionRateWithDecay()` | `0xc52861f2` | absent (PASS) |
| `REDEMPTION_FEE_FLOOR()` | `0x28d28b5b` | absent (PASS) |
| `isAccountFeeExempt(address)` | `0x2cbc5804` | absent (PASS); present on BorrowerOperations |

The 6-return arity was checked at the byte level rather than by trusting a decoder:

```sh
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 \
  'getEntireDebtAndColl(address)' 0x52d033E64774F31A8B7562806aA5782CbbD29382 \
  --rpc-url https://rpc.test.mezo.org
# 192 bytes of returndata = exactly 6 words. Liquity v1 would return 128.
```

### SortedTroves, HintHelpers, PriceFeed, StabilityPool, MUSD

| Contract | Members declared | Result |
| --- | --- | --- |
| SortedTroves impl `0x9177df58...` | `findInsertPosition(uint256,address,address)`, `getSize()`, `getFirst()`, `getLast()`, `getNext(address)`, `getPrev(address)`, `contains(address)` | 7/7 PASS. `getSize()` -> 230 matsnet, 25 mainnet, matching `getTroveOwnersCount()` on each |
| HintHelpers impl `0x8adf3f35...` | `computeNominalCR(uint256,uint256)`, `getApproxHint(uint256,uint256,uint256)`, `getRedemptionHints(uint256,uint256,uint256)` | 3/3 PASS. `computeNominalCR(1e18, 2000e18)` -> 5e16, confirming the 1e20 scaling Maren's comment records |
| PriceFeed impl `0xec42b37c...` | `fetchPrice()` | PASS. `lastGoodPrice()` (`0x0490be83`) ABSENT, as recorded |
| StabilityPool impl `0x8f0ca419...` | `provideToSP(uint256)`, `withdrawFromSP(uint256)`, `getCompoundedMUSDDeposit(address)`, `getDepositorCollateralGain(address)`, `getTotalMUSDDeposits()` | 5/5 PASS |
| MUSD `0x118917a4...` (NOT a proxy: impl slot reads zero, 6,437 bytes of direct runtime) | `permit`, `nonces`, `DOMAIN_SEPARATOR`, `eip712Domain`, `decimals`, `transferFrom`, `approve`, `balanceOf`, `allowance` | 9/9 PASS. The full canonical EIP-2612 surface, not a near-miss variant |

### Maren's own SDK ABI fragments

`packages/sdk/src/abis.ts`. Function fragments all match. One EVENT fragment did not, and
event fragments fail differently from function fragments: see Finding 2.

| Fragment | Verdict |
| --- | --- |
| `troveManagerAbi` (6 members, now 7 with `getTCR`) | PASS |
| `priceFeedAbi`, `priceOracleAbi` | PASS |
| `marenVaultAbi`, `marenRegistryAbi`, `marenEarnAbi` | PASS |
| `MAREN_PAY_EVENTS` -> `Paid`, `RequestCreated`, `LinkCreated`, `LinkClaimed` | PASS, topic0 located in deployed MarenPay bytecode |
| `MAREN_PAY_EVENTS` -> `PaidToHandle` | **DRIFTED**, now fixed. Finding 2 |

## 2. The seven Liquity divergences

Re-checked against current bytecode, and then checked that Maren's code actually respects
each one.

| # | Recorded divergence | Chain says | Does Maren respect it | Verdict |
| --- | --- | --- | --- | --- |
| 1 | No `_maxFeePercentage` on openTrove/adjustTrove/withdrawMUSD | Confirmed. Four Liquity variants absent on both networks; no fee-cap require string in the bytecode | Yes. No `maxFeePercentage` token exists anywhere in the repo; `IBorrowerOperations.sol` and the SDK both encode the 3-argument forms | PASS |
| 2 | `fetchPrice()` reverts above 60s staleness, no `lastGoodPrice()` | Confirmed twice over. `lastGoodPrice()` absent; the PriceFeed constant pool contains `"PriceFeed: Oracle is stale."`, `"Oracle returns 0 for price"` and `"Invalid Decimals from Oracle"` | Yes, and well. `MarenVault._price()` try/catches into `PriceFeedUnavailable()`; both clients read the precompile's `updatedAt` instead so they can say HOW stale. `forge test test_fork_staleOracleSurfacesAsNamedError` passes against live matsnet | PASS |
| 3 | `maxBorrowingCapacity` is fixed at the opening price; only `refinance()` raises it | Confirmed. Getter present both nets, and the BorrowerOperations constant pool contains `"BorrowerOps: An operation that exceeds maxBorrowingCapacity is not permitted"` | Yes. The UI quotes `troveMaxBorrowingCapacity()` rather than an ICR-derived number, and `preflightBorrow` distinguishes "at Mezo's ceiling" from "past Maren's floor". `forge test test_fork_maxBorrowingCapacityIsFrozenUntilRefinance` passes against live matsnet | PASS |
| 4 | No baseRate accumulator, no redemption-fee decay | Confirmed. `baseRate()`, `getRedemptionRateWithDecay()`, `REDEMPTION_FEE_FLOOR()` all absent on both networks | Yes. Nothing reads them | PASS |
| 5 | Recovery Mode "only forces new loans to open at >=150% and blocks refinance()" | **Narrower than the chain.** Three distinct require strings, two of which close user-facing doors the recorded text does not mention | No, it did not. Finding 1 | **DRIFTED** |
| 6 | Collateral is native BTC via msg.value, no approve step | Confirmed by payability probe: `openTrove` and `addColl` accept `value` and reach their logic; no `_collAmount` argument on any signature | Yes. `MarenVault.deposit` is the one payable entrypoint; there is no ERC-20 approve on the collateral path | PASS |
| 7 | `getEntireDebtAndColl` returns 6 values, not 4 | Confirmed at the byte level: 192 bytes of returndata | Yes, in all three places. `ITroveManager.sol`, `packages/sdk/src/abis.ts`, and `apps/web/src/lib/chain/hints.ts:129` destructures all six and sums pending into the total | PASS |

Divergence 5's FIRST clause, that the liquidation threshold stays at 110% in both modes, is
consistent with everything observed: the TroveManager constant pool contains no Recovery
Mode string at all, so the liquidation path does not branch on it. It is marked PASS on
that evidence. It was not possible to observe a live liquidation during Recovery Mode,
because neither network was in Recovery Mode during the audit.

## 3. The three doc discrepancies

| # | Recorded discrepancy | Re-check | Verdict |
| --- | --- | --- | --- |
| 1 | Docs promise borrowers a zero redemption fee; the code does not | Substantively confirmed, and by stronger evidence than before: `isAccountFeeExempt(address)` (`0x2cbc5804`) is present on BorrowerOperations and ABSENT from TroveManager on both networks, so the exemption cannot be consulted on the redemption path at all. The recorded wording said TroveManager "applies `getRedemptionRate()`", which implies a public getter; `getRedemptionRate()` (`0x2b11551a`) has no selector on TroveManager either, so it is internal. Comment corrected; the conclusion stands | PASS (wording tightened) |
| 2 | Docs say the refinance fee is 0.1%; the code computes 20% of old net debt then 0.1% of that | Partially confirmed. `refinancingFeePercentage()` (`0x6246d497`) is present on BorrowerOperations, and `"BorrowerOps: Refinancing fee percentage..."` appears in its constant pool, so the mechanism is where the note says. The 20%-then-0.1% arithmetic was not re-derived live: the getter is on BorrowerOperations rather than on GovernableVariables, and reading it was not attempted because no Maren code path depends on the number | **UNPROVEN** (arithmetic only) |
| 3 | Circulating MUSD materially exceeds trove-backed debt | Directionally confirmed. Mainnet `totalSupply()` = 30,944,988.63 MUSD against 25 troves; matsnet = 1,375,934,819 MUSD. Mainnet StabilityPool holds 14,175,086 MUSD. The full trove-backed-debt total was not summed across all 25 troves, so the precise ratio in the note is not re-derived | **UNPROVEN** (precise ratio only) |

## 4. Hint computation

`apps/web/src/lib/chain/hints.ts`. The sequence Maren uses is the one MUSD's own hint
documentation prescribes, and each step was exercised live:

```sh
# nicr for a 1 BTC / 2000 MUSD position
cast call 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 \
  'computeNominalCR(uint256,uint256)(uint256)' 1000000000000000000 2000000000000000000000
# -> 50000000000000000

cast call 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 \
  'getApproxHint(uint256,uint256,uint256)(address,uint256,uint256)' 50000000000000000 15 1
# -> 0x08a1D63589A52455E90CA1eC01c8D48C54a84Ed0, diff 45029351678339406, seed ...

cast call 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA \
  'findInsertPosition(uint256,address,address)(address,address)' 50000000000000000 0x0 0x0
# -> (0x123694886DBf5Ac94DDA07135349534536D14cAf, 0x50F10d257a8E5A6edEA2a3ca5A2Cf8B8Ab63Bb77)
```

| Question | Answer | Verdict |
| --- | --- | --- |
| Is `getApproxHint` / `findInsertPosition` used per Mezo's SortedTroves | Yes. `computeNominalCR` -> `getApproxHint(nicr, 15*sqrt(size), seed)` -> `findInsertPosition(nicr, approx, approx)`. All three live-verified above | PASS |
| Are hints read-only | Yes. Every function in `hints.ts` is an `eth_call`; none is ever put in a transaction, which is correct because `getApproxHint` walks up to `numTrials` nodes | PASS |
| Is the NICR computed off the right debt | Yes, and this is the subtle one. It uses `getEntireDebtAndColl` (TOTAL debt, including the 200 MUSD gas compensation and accrued interest) rather than `MarenVault.troveStatus()` (NET debt). The sorted list ranks on total; feeding it net would put the hint on the wrong side of the insertion point | PASS |
| Does any BorrowerOperations call site pass `address(0), address(0)` where a real hint is needed | **No.** All 8 `IBorrowerOperations` call sites in `MarenVault.sol` (lines 755, 777, 858, 1459, 1528, 1543, 1590, plus `closeTrove` at 917 which takes none) forward caller-supplied parameters. There is no `address(0)` literal in the file | PASS |
| Do the web call sites derive real hints | Yes, all four. `write.ts:462` deposit `(+coll, 0)`, `:497` borrow `(0, +debt)`, `:516` repay `(0, -debt)`, `:535` withdraw `(-coll, 0)`. The sign convention matches `hintsForDelta`'s `collAfter = current + delta` | PASS |
| Is `NO_HINTS` a legitimate fallback | Yes. `findInsertPosition` is re-run on-chain from the hint and self-corrects, so a wrong hint costs gas and never corrupts ordering. Using it when a hint READ fails is correct: a failed RPC must not block a withdrawal | PASS |

Three observations that are gas-only and are recorded rather than changed, in Finding 4.

## 5. Recovery Mode

The headline finding. See Finding 1.

| Path | Behaviour in Recovery Mode | Before this audit | After |
| --- | --- | --- | --- |
| `deposit` -> `addColl` | Allowed. Raises ICR | enabled (correct) | enabled |
| `repay` -> `repayMUSD` | Allowed. Raises ICR | enabled (correct) | enabled |
| `borrow` -> `withdrawMUSD` | **Blocked.** Adding debt without collateral always lowers ICR | enabled, reverted after gas | blocked with an explanation |
| `withdraw` -> `withdrawColl` | **Blocked** outright, at any ratio | enabled, reverted after gas | capped at idle collateral, explained |
| `closePooledTrove` -> `closeTrove` | Blocked (keeper-only) | documented in a comment only | unchanged, still keeper-only |
| `refinancePooledTrove` -> `refinance` | Blocked (keeper-only) | documented in a comment only | unchanged, still keeper-only |

## 6. Oracle

| Site | Behaviour | Verdict |
| --- | --- | --- |
| `MarenVault._price()` (`MarenVault.sol:1607`) | try/catch on `fetchPrice()`, reverts `PriceFeedUnavailable()`; also treats a zero price as unavailable | PASS |
| `MarenVault._tryPushCollateral()` (`:1536`) | Catches, holds BTC idle, emits `CollateralPushFailed` with the revert selector so a keeper can tell a stale oracle from an unexpected revert | PASS |
| `apps/web/src/lib/chain/price.ts` and `apps/ios/src/chain/price.ts` | A discriminated union over `live`, `stale` and `unavailable`, where only `live` carries `priceWei`. A stale number is structurally unrenderable as a live one | PASS |
| `apps/web/src/lib/data/live.ts:readPrice` and the iOS equivalent | Read the precompile's `latestRoundData().updatedAt` rather than `fetchPrice()`, precisely because a revert cannot say HOW old. Throws on a non-positive answer; never returns 0 | PASS |
| `preflightBorrow` / `preflightWithdraw` | Gate on the feed where the contract prices, and only there. Repay and debt-free idle withdrawal stay open with the oracle down | PASS |
| `MarenEarn.isUsingStalePrice()` | Exposed on-chain and in the SDK ABI, **zero consumers** in web, iOS or SDK. Earn can price shares off a cached BTC value with nothing in the UI saying so | **DRIFTED**, Finding 3 |

`fetchPrice()` cannot return zero: the deployed PriceFeed reverts with
`"Oracle returns 0 for price"` first. `MarenVault._price()`'s zero check is therefore
belt-and-braces rather than load-bearing, which is the right way round.

## 7. Precompiles and gas

| Claim | `cast` used | Result | Verdict |
| --- | --- | --- | --- |
| Oracle precompile at `0x7b7c...0015` | `cast call 0x7b7c...0015 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'` | Answers on both networks. matsnet 65,004.67, mainnet 64,960.04, `updatedAt` within seconds of wall clock | PASS |
| It implements only two AggregatorV3 members | `cast call 0x7b7c...0015 'decimals()(uint8)'` -> 18; `'description()(string)'` | `description()` fails with `method not found in ABI: no method with id 0x7284e416`, exactly as recorded. This is a NATIVE precompile error, not an EVM revert, which is itself confirmation it is not a deployed contract | PASS |
| Oracle reports 18 decimals | `cast call ... 'decimals()(uint8)'` | 18 on both, so the app's `10 ** (18 - decimals)` rescale is a no-op today and still correct if it ever changes | PASS |
| Native gas token is BTC, 18 decimals | Native currency in `chains.ts`; oracle answers scale to 1e18; `PriceFeed.fetchPrice()` -> 64,975.80e18 matsnet | Consistent throughout. `MarenVault.deposit` takes `msg.value` in native BTC and no ERC-20 collateral path exists | PASS |
| BTC precompile `0x7b7C...0000` | `cast code` | 2,463 bytes | PASS |
| MEZO token precompile `0x7B7c...0001` | not probed this pass | nothing in Maren reads it | **UNPROVEN** (unused) |
| Multicall3 canonical address | `cast code 0xcA11...CA11` | 3,808 bytes on both networks, the canonical size. Recorded as 7,619; see Finding 5 | **DRIFTED** (byte count) |
| Permit2 canonical address | `cast code 0x0000...8BA3` | 9,152 bytes on both | PASS |
| x402 settlement `0x402085c2...` | `cast code` mainnet | 2,913 bytes. Recorded as 5,829 | **DRIFTED** (byte count) |
| EntryPoint v0.7 deployed but inert | `cast code 0x0000...a032` mainnet | 16,035 bytes, consistent with the L1 EntryPoint. Recorded as 32,073 | **DRIFTED** (byte count) |
| Chain IDs | `cast chain-id` | 31611 matsnet, 31612 mainnet, as recorded | PASS |

## 8. Live protocol state at the time of audit

Recorded so a future reader can tell a protocol change from a measurement error.

| Reading | matsnet (31611) | mainnet (31612) |
| --- | --- | --- |
| `PriceFeed.fetchPrice()` | 64,975.80 | 64,949.44 |
| `TroveManager.MCR()` | 1.1e18 | 1.1e18 |
| `TroveManager.CCR()` | 1.5e18 | 1.5e18 |
| `BorrowerOperations.minNetDebt()` | 1.8e21 | 1.8e21 |
| `InterestRateManager.interestRate()` | 100 (1.00% APR) | not read |
| `SortedTroves.getSize()` | 230 | 25 |
| `TroveManager.getTCR(price)` | 1.905e18 | 2.467e18 |
| `TroveManager.checkRecoveryMode(price)` | false | false |
| `MUSD.totalSupply()` | 1,375,934,819 | 30,944,988.63 |
| `StabilityPool.getTotalMUSDDeposits()` | 86,231,976 | 14,175,086 |
| Maren pooled trove status | 1 (active), coll 0.0690 BTC, principal 2,001.8 MUSD, interest 0.2118 MUSD | not deployed |

Every risk parameter in `packages/sdk/src/constants.ts` that is readable on-chain matches:
MCR, CCR, `MIN_NET_DEBT`, `INTEREST_RATE_BPS`. `MAREN_VAULT`'s mirrored constants were
re-confirmed by the fork suite rather than re-read here.

## Findings

### Finding 1 (HIGH) Recovery Mode is wider than recorded, and was unhandled in the UI

FIXED in this branch.

`LIQUITY_DIVERGENCES[4]` recorded that Recovery Mode "only forces new loans to open at
>=150% and blocks `refinance()`". Extracting the ASCII literals from the deployed
BorrowerOperations constant pool shows THREE distinct require strings, not one:

```
BorrowerOps: Operation not permitted during Recovery Mode
BorrowerOps: Collateral withdrawal not permitted Recovery Mode
BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode
```

Note the missing preposition in the second and the straight apostrophe in the third. Those
are the contract's, transcribed verbatim, and they matter because the runtime match is on
the exact string.

The two the recorded text did not mention are the two that sit directly under user
actions:

- **`withdrawColl` is blocked outright**, at any collateral ratio, however
  overcollateralised the trove is. `MarenVault._sendCollateral` (`MarenVault.sol:1528`)
  calls it unguarded whenever a withdrawal exceeds the vault's idle balance.
- **Any operation that lowers a trove's ICR is blocked.** A bare `withdrawMUSD` always
  lowers ICR, because it adds debt without adding collateral. So borrowing is closed in
  Recovery Mode at ANY size, not merely below 150%.

That second point overturns a comfortable-looking conclusion. Maren's `MIN_BORROW_CR` and
`MIN_TROVE_CR` are both 180%, stricter than the 150% CCR, so it is tempting to say borrowing
is incidentally protected. It is not: the check is on the DIRECTION of the ICR change, not
on its level, so a borrow that leaves the trove at 400% still reverts.

Maren had no defence at any layer. `MarenVault.sol` never calls `checkRecoveryMode` or
`getTCR`. `ProtocolStats` had no field to carry it, so `preflight.ts` structurally could not
check it. `packages/sdk/src/position.ts:238` exports an `isRecoveryMode(tcr)` helper with
zero callers, and `checkRecoveryMode` sat in the SDK ABI with zero callers. The controls
stayed enabled and the user paid gas to be told, in Solidity, that the protocol was in
Recovery Mode.

Fixed by:

- `packages/sdk/src/constants.ts` divergence 5 rewritten with all three strings and their
  provenance.
- `ProtocolStats` gains `recoveryMode: boolean | null` and `systemTcrWei: bigint | null`,
  read in `readProtocolStats` via `checkRecoveryMode(price)` and `getTCR(price)`. Both take
  the price as an argument and are plain views, so unlike `fetchPrice()` they still answer
  when the oracle is stale. `null` means unknown, never false.
- `preflightBorrow` refuses the whole range in Recovery Mode, ahead of the price gate,
  because no fresher price and no smaller amount would help.
- `preflightWithdraw` caps at the vault's IDLE collateral rather than at zero, because idle
  BTC leaves the vault directly and never reaches BorrowerOperations. Getting that
  distinction wrong would tell someone whose Bitcoin was never pushed into the trove that
  they cannot have it back.
- `errors.ts` translates all three strings, plus `exceeds maxBorrowingCapacity` and
  `PriceFeed: Oracle is stale.`, for the render/press race that no preflight can close.
  Matching is on a substring so a future MUSD rewording degrades to the raw string rather
  than to a confidently wrong explanation.
- 10 tests in `preflight.test.ts` and `errors.test.ts`.

Left as a documented finding, deliberately: `MarenVault.sol` still does not check Recovery
Mode on-chain. Adding a check would cost an external call on every user operation to prevent
a revert that already happens safely, and the keeper-only `closePooledTrove` and
`refinancePooledTrove` paths are operated by people who can read a revert string. The UI is
the right layer for this.

### Finding 2 (HIGH) `PaidToHandle` had a topic0 that does not exist on chain

FIXED in this branch.

`MAREN_PAY_EVENTS` in `packages/sdk/src/abis.ts` declared:

```
event PaidToHandle(bytes32 indexed node, address indexed from, address indexed to,
                   uint256 amount, string handle, string memo)
```

`MarenPay.sol:107` emits five parameters, without the trailing `string memo`. An event's
topic0 is the keccak hash of its full signature, so the extra argument produced a
different filter:

```sh
cast keccak "PaidToHandle(bytes32,address,address,uint256,string)"
# 0xf0db1b294d6bbc31336b73cb68f72c857041a71d934da23f335b2aa2d56a38fd   <- the chain
cast keccak "PaidToHandle(bytes32,address,address,uint256,string,string)"
# 0x310129e95d2636b0c6579ab8cd368da4f0581810c0e2b22a46d7fe0761133c1d   <- the SDK

cast code 0xe475Ff919D54E055809f516E3bed8a5c7a101836 --rpc-url https://rpc.test.mezo.org \
  | grep -ci f0db1b294d6bbc31336b73cb68f72c857041a71d934da23f335b2aa2d56a38fd   # 1
```

The first hash is in the deployed MarenPay bytecode. The second is not.

This is worse than a wrong function selector, and the difference is the reason it survived.
A wrong function selector fails loudly: the node rejects the call. A wrong event signature
fails silently and SUCCESSFULLY: `eth_getLogs` accepts the filter, the node answers, and the
answer is an empty array. Every payment sent to an `@handle` was therefore missing from
Activity in both apps, and Activity rendered "you have done nothing yet" over a real
history, with nothing logged and nothing to notice.

Fixed, and pinned by `packages/sdk/src/abis.test.ts`, which asserts the computed topic0 of
all five MarenPay events against the hashes located in the deployed bytecode. The other four
were checked the same way and match; they are the controls that made the mismatch credible
before it was believed.

### Finding 3 (MEDIUM) `MarenEarn.isUsingStalePrice()` has no consumer

NOT fixed. Documented.

`MarenEarn._valueBtc` (`MarenEarn.sol:137`) deliberately falls back to a cached BTC price
and then to zero, rather than reverting like `MarenVault._price()` does. That is a defensible
choice and it is documented at the top of the file: zero understates the vault, which is the
non-exploitable direction.

The contract exposes `isUsingStalePrice()` so a caller can say so. It is in the SDK ABI at
`abis.ts` and has **zero consumers** in web, iOS or the SDK helpers. So Earn can price
shares off a cached BTC value with nothing in either UI saying so, while the Vault screen
right beside it has a full stale-price banner.

Left unfixed because it is a product decision, not a conformance bug: it needs a designed
state in the Earn screen, not a preflight guard, and inventing that copy here would be
guessing at intent.

### Finding 4 (LOW) Hint magnitudes are approximate at three web call sites

NOT fixed. Documented, and gas-only.

The four `hintsForDelta` deltas in `write.ts` have correct SIGNS but approximate
magnitudes, because the user-facing amount is not always the trove delta:

- **borrow** overstates: `debtDelta = +amount`, but the trove only grows by
  `amount - reserveMUSD` plus the origination fee. Already acknowledged in a comment at
  `write.ts:494`.
- **repay** understates: `_repay` calls `_pushRepayment(type(uint256).max, ...)`, so the
  actual `repayMUSD` is `min(reserveMUSD, netDebt - MIN_NET_DEBT)`, which can exceed the
  user's amount.
- **withdraw** overstates: `_sendCollateral` drains idle collateral first and pulls only
  the shortfall from the trove.

Additionally, `depositAndBorrow` and `closePosition` each perform TWO sequential trove
mutations from ONE hint pair, so the second operation gets a hint computed for the state
before the first.

None of this is a correctness problem. `findInsertPosition` re-runs on-chain from the hint
and self-corrects, so the cost is a slightly longer walk. Recorded because the reason it is
safe is non-obvious, and because someone reading `write.ts` should not "fix" the signs.

### Finding 5 (LOW) Three byte counts in `addresses.ts` were hex-string lengths

FIXED in this branch.

Multicall3 was recorded as 7,619 bytes (actual 3,808), x402 settlement as 5,829 (actual
2,913), EntryPoint v0.7 as 32,073 (actual 16,035). Each recorded figure is exactly
`2 * bytes + 3`, the length of the hex string `eth_getCode` returns including `0x` and a
trailing newline.

Every contract is present and is the right one, so nothing was ever broken by this. It is
worth correcting because a recorded size is only useful as an identity check, and one that
is off by 2x cannot serve that purpose. Notably the MAREN deployment sizes in the same file
(Vault 14,508, Pay 9,264, and so on) are correct byte counts, and MarenPay re-measured at
exactly 9,264, so the error is confined to those three lines.

### Finding 6 (INFO) iOS has no write path, so no hint gap today

`apps/ios` never encodes a MarenVault call: `src/chain/actions.ts:71` returns `declined` for
the live data source and everything else is a mock. Its only `marenVaultAbi` use is
read-only. So there is no missing hint there now.

Worth flagging for when iOS writes are wired up: `hints.ts` lives in
`apps/web/src/lib/chain/`, not in `packages/sdk`, so iOS has nothing to import. The same
reasoning that moved `abis.ts` into the SDK applies, and Finding 2 is what two hand-
maintained copies of one thing eventually costs.

### Finding 7 (INFO) Two dead helpers on the price path

`vaultActionGate()` in `apps/web/src/lib/chain/price.ts:116` has zero callers, though
`apps/web/README.md:177` claims it is in use. Its logic is duplicated inside `preflight.ts`,
so behaviour is right today and the two copies can drift. `usablePrice()` is called only
from a test; production inlines the equivalent check.

Not fixed: deleting exported helpers is out of scope for a conformance audit, and the
README claim is a documentation fix rather than a chain-conformance one.

## What could not be confirmed live

Stated plainly rather than quietly rounded to PASS.

1. **The refinance fee arithmetic** (doc discrepancy 2). The mechanism was located
   (`refinancingFeePercentage()` on BorrowerOperations) but the 20%-then-0.1% computation
   was not re-derived. No Maren code path depends on it.
2. **The precise circulating-vs-backed ratio** (doc discrepancy 3). Supply and StabilityPool
   totals were read on both networks; trove-backed debt was not summed across all 25 mainnet
   troves.
3. **Liquidation behaviour during Recovery Mode.** Neither network was in Recovery Mode
   during the audit, so divergence 5's first clause rests on the absence of any Recovery Mode
   string in the TroveManager constant pool rather than on an observed liquidation.
4. **The MEZO token precompile** at `0x7B7c...0001` was not probed. Nothing in Maren reads
   it.

Two calls hit transient RPC failures during the run (`HTTP 500 Temporary internal error`)
and both succeeded on retry against the same primary endpoint. No result in this document
rests on a single unrepeated probe.

## Gates

```
CI=true pnpm typecheck                 5/5 pass
CI=true pnpm test                      37 files, all pass (sdk 5, ios 5, relayer 21, web 6 + 1 skipped)
CI=true pnpm lint                      4/4 pass
node tools/copy/em-dash-scan.mjs       clean
forge test --match-path "test/fork/*"  11/11 pass against live matsnet
```

The fork suite is the strongest single line there: it drives real `openTrove`, `addColl`,
`refinance` and `redeemCollateral` calls against the deployed MUSD contracts, and it
includes `test_fork_maxBorrowingCapacityIsFrozenUntilRefinance` (divergence 3),
`test_fork_staleOracleSurfacesAsNamedError` (divergence 2),
`test_fork_troveDebtIncludesGasCompensation` and
`test_fork_realRedemptionIsSplitAcrossPooledPositions`. All of them still pass against the
current bytecode, which is independent confirmation of the divergences this document marks
PASS.

No contracts were changed by this audit. No deployed address was changed. Nothing was
redeployed.
