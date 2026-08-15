// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../../src/MarenForwarder.sol";
import {MarenVault} from "../../src/MarenVault.sol";
import {MockMUSD} from "../mocks/MockMUSD.sol";
import {MockMusdProtocol} from "../mocks/MockMusdProtocol.sol";
import {MockPriceFeed} from "../mocks/MockPriceFeed.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Shared fixture for the vault unit, fuzz and invariant suites.
abstract contract VaultTestBase is Test {
    /// @dev The live Mezo BTC/USD price on 2026-08-15, so the numbers in these tests are the
    ///      numbers a user would actually have seen.
    uint256 internal constant BTC_PRICE = 63_071.83e18;

    /// @dev What a DIRECT trove needs: 1,800 MUSD minimum net debt at a 250% ratio.
    ///      Verified against packages/sdk/src/position.ts. MarenVault's floor is 0.001 BTC,
    ///      79.3x lower, and that gap is the reason this contract exists.
    uint256 internal constant DIRECT_TROVE_COLLATERAL_AT_250 = 0.079346 ether;

    MockMUSD internal musd;
    MockPriceFeed internal priceFeed;
    MockMusdProtocol internal protocol;
    MarenForwarder internal forwarder;
    MarenVault internal vault;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant SEED_COLLATERAL = 1 ether;
    uint256 internal constant SEED_DEBT = 1800e18;
    uint256 internal constant DEPOSIT_CAP = 1000 ether;

    function _deployVault() internal {
        musd = new MockMUSD();
        priceFeed = new MockPriceFeed(BTC_PRICE);
        protocol = new MockMusdProtocol(musd, priceFeed);
        forwarder = new MarenForwarder();

        // BorrowerOperations and TroveManager are the same mock; MarenVault only ever calls
        // the union of the two interfaces, so one address serves both roles.
        vault = new MarenVault(
            address(protocol),
            address(protocol),
            address(priceFeed),
            address(musd),
            address(forwarder),
            admin,
            DEPOSIT_CAP
        );

        vm.startPrank(admin);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();
    }

    function _openPooledTrove() internal {
        vm.deal(keeper, SEED_COLLATERAL);
        vm.prank(keeper);
        vault.openPooledTrove{value: SEED_COLLATERAL}(SEED_DEBT, address(0), address(0));
    }

    function _deposit(address who, uint256 amount) internal {
        vm.deal(who, amount);
        vm.prank(who);
        vault.deposit{value: amount}(address(0), address(0));
    }

    function _borrow(address who, uint256 amount) internal {
        vm.prank(who);
        vault.borrow(amount, address(0), address(0));
    }

    function _repay(address who, uint256 amount) internal {
        vm.prank(who);
        musd.approve(address(vault), amount);
        vm.prank(who);
        vault.repay(amount, address(0), address(0));
    }

    function _withdraw(address who, uint256 amount) internal {
        vm.prank(who);
        vault.withdraw(amount, address(0), address(0));
    }

    /// @dev Sum of every account this suite ever touches, including the vault's own protocol
    ///      position. Used by the collateral-conservation assertions.
    function _sumTrackedCollateral() internal view returns (uint256 total) {
        total = vault.collateral(address(vault)) + vault.collateral(alice) + vault.collateral(bob)
            + vault.collateral(carol);
    }

    function _sumTrackedDebt() internal view returns (uint256 total) {
        total = vault.debtOf(address(vault)) + vault.debtOf(alice) + vault.debtOf(bob) + vault.debtOf(carol);
    }

    function _troveNetDebt() internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) = protocol.getEntireDebtAndColl(address(vault));
        return principal + interest - vault.MUSD_GAS_COMPENSATION();
    }
}
