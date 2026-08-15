// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISwapRouter} from "../../src/interfaces/ISwapRouter.sol";
import {MockMUSD} from "./MockMUSD.sol";

/// @notice Mints MUSD at a settable BTC price. Exists only to prove MarenEarn's router seam
///         works; there is no verified DEX on Mezo to point the real thing at yet.
contract MockSwapRouter is ISwapRouter {
    MockMUSD public immutable musd;
    uint256 public price;

    /// @notice When true the router returns nothing, to prove `harvest` catches a bad router
    ///         by measuring its own balance rather than trusting the return value.
    bool public rug;

    constructor(MockMUSD musd_, uint256 price_) {
        musd = musd_;
        price = price_;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setRug(bool r) external {
        rug = r;
    }

    function swapExactBtcForMusd(uint256, address _recipient, uint256) external payable returns (uint256) {
        if (rug) return 0;
        uint256 out = (msg.value * price) / 1e18;
        musd.mint(_recipient, out);
        return out;
    }
}
