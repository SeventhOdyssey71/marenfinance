// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Stand-in for Mezo's MUSD: 18 decimals, EIP-2612 permit, mint/burn open to tests.
///         The real token is verified live at
///         0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 (matsnet) — the fork tests use that one.
contract MockMUSD is ERC20, ERC20Permit {
    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
