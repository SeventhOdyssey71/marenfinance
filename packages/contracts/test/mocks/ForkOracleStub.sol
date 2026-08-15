// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ForkOracleStub
 * @notice Stands in for Mezo's BTC/USD oracle precompile at
 *         0x7b7c000000000000000000000000000000000015 inside a forked EVM.
 *
 * WHY THIS IS NECESSARY — this is a real and non-obvious limitation of forking Mezo:
 *
 *   Mezo's price oracle is Skip Connect, a CONSENSUS-LEVEL module in mezod, not a deployed
 *   contract. `eth_getCode` at that address does return bytecode, but that bytecode is a
 *   stub whose only action is to call 0x7b7c...0015 — itself. On Mezo, mezod intercepts the
 *   call and the native handler answers. Inside foundry's EVM there is no handler, so the
 *   stub recurses into itself and the call reverts, taking `PriceFeed.fetchPrice()` and
 *   therefore every borrow, adjust and liquidate path down with it.
 *
 *   Verified live on matsnet 2026-08-15: `latestRoundData()` returns
 *   (13806787, 63063052880000000000000, 1786767961, 1786767961, 0) and `decimals()` returns
 *   18 — so the precompile already reports 18-decimal prices, no scaling involved.
 *
 * The fork tests therefore `vm.etch` this at the precompile address. Everything else in
 * those tests — BorrowerOperations, TroveManager, MUSD, SortedTroves, HintHelpers and the
 * PriceFeed contract's own staleness logic — is the REAL deployed bytecode. Only the
 * consensus oracle underneath it is substituted, because it cannot be replayed.
 */
contract ForkOracleStub {
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    /// @dev Matches the live precompile exactly.
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId_,
            int256 answer_,
            uint256 startedAt_,
            uint256 updatedAt_,
            uint80 answeredInRound_
        )
    {
        return (roundId, answer, updatedAt, updatedAt, 0);
    }

    /// @dev Set both the price and its timestamp. Leaving `updatedAt` fixed while warping the
    ///      chain forward is how the fork suite reproduces a >60s stale oracle against the
    ///      real PriceFeed rather than a mocked one.
    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId += 1;
    }
}
