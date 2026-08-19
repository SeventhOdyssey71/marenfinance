# Mezo ground truth for the audit

Read from Mezo's own contract source (`github.com/mezo-org/musd`) and the live bytecode
on 19 August 2026. This file is the reference every audit task checks Maren against.
Where Maren's assumptions and this disagree, this wins, and the finding is a bug.

## BorrowerOperations (verified against source)

Signatures, and the divergences from Liquity v1 that break a ported integration:

- `openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable`
- `adjustTrove(uint256 _collWithdrawal, uint256 _debtChange, bool _isDebtIncrease, address _upperHint, address _lowerHint) payable`
- `addColl(address _upperHint, address _lowerHint) payable`
- `withdrawColl(uint256 _amount, address _upperHint, address _lowerHint)`
- `withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)`
- `repayMUSD(uint256 _amount, address _upperHint, address _lowerHint)`
- `closeTrove()`
- `refinance(address _upperHint, address _lowerHint)`

**No `maxFeePercentage` anywhere.** Fees are protocol-state-driven, not user-bounded. A
ported ABI carrying that parameter will not encode against these functions.

Key require checks an integrator must satisfy: trove existence/absence as appropriate,
ICR >= MCR (normal) or CCR (recovery mode), TCR >= CCR, net debt >= minNetDebt,
borrowing capacity not exceeded, sufficient MUSD balance for repay/close.
`closeTrove` and `refinance` are blocked in Recovery Mode.

## Redemption (this is the splitter's correctness anchor)

`redeemCollateral(uint256 _amount, address _firstRedemptionHint, address _upperPartialRedemptionHint, address _lowerPartialRedemptionHint, uint256 _partialRedemptionHintNICR, uint256 _maxIterations)`

Per trove hit by a redemption:

1. **Collateral removed = `mUSDLot * 1e18 / price`** (DECIMAL_PRECISION scaling).
2. **Debt reduced by exactly `mUSDLot`**, and the reduction pays **accrued interest
   first, then principal**. This ordering matters: a pooled position's debt shares sit
   against principal+interest, so a splitter that assumes the reduction is proportional
   across principal and interest, or that reduces principal first, will misattribute.
3. **The redemption fee is paid by the redeemer** (sent to PCV, deducted from collateral
   the redeemer receives), NOT from the trove. So at the instant of redemption the trove
   is value-neutral: it loses collateral worth exactly the debt it shed.
4. Redemptions skip troves with ICR < MCR, and consume the **lowest-ICR troves first**.
   Troves can be partially or fully redeemed.

Audit question for the splitter: does `reconcileRedemption` compute `collateralRemoved`
and `debtRemoved` from the live trove delta in a way that matches (1) and (2) exactly,
including the interest-first ordering? And does its pro-rata split preserve per-position
value neutrality given that ordering?

`getCurrentICR(address _borrower, uint256 _price) view returns (uint)`

## Gas, precompiles, RPC (from prior live verification, re-confirm if load-bearing)

- Native gas token is BTC, 18 decimals.
- BTC/USD oracle is a consensus precompile at `0x7b7c...0015`; `fetchPrice()` reverts
  above 60s staleness. Not Chainlink/Pyth.
- ERC-4337 EntryPoint v0.7 deployed but zero UserOperations per the explorer index; no
  `debug_traceCall`, so no compliant bundler. EIP-7702 type-4 transactions are accepted.
- Multicall3 at the canonical address on both networks.

## Documented Mezo developer surface (mezo.org/docs)

The docs cover: MUSD borrowing integration, BorrowerOperations, TroveManager, native BTC
gas, precompiles, JSON-RPC support/limitations, ERC-4337 and EIP-7702. Several published
RPC hosts do not resolve; the working endpoints are in `packages/sdk/src/chains.ts`.
Where a doc claim and the deployed bytecode disagree (there are several, recorded in
`packages/sdk/src/constants.ts` DOC_DISCREPANCIES), the bytecode is authoritative.
