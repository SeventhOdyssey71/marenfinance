// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";

/**
 * @notice Reproduces the one behaviour of Mezo's PriceFeed that breaks integrations: it is a
 *         `view` that REVERTS when the oracle is stale, with no `lastGoodPrice()` fallback.
 *         `setStale(true)` is how every "oracle is down" test is driven.
 */
contract MockPriceFeed is IPriceFeed {
    error PriceStale();

    uint256 private _price;
    bool private _stale;

    constructor(uint256 initialPrice) {
        _price = initialPrice;
    }

    function fetchPrice() external view returns (uint256) {
        if (_stale) revert PriceStale();
        return _price;
    }

    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }

    function setStale(bool stale) external {
        _stale = stale;
    }

    /// @notice Lets a test drive the "oracle returns 0" case, which Maren treats as unavailable
    ///         rather than trusting a zero price.
    function setZero() external {
        _price = 0;
    }
}
