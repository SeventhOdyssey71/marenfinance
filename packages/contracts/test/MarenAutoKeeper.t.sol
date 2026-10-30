// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenAutoKeeper} from "../src/MarenAutoKeeper.sol";
import {ISortedTroves} from "../src/interfaces/ISortedTroves.sol";
import {VaultTestBase} from "./helpers/VaultTestBase.sol";

/// @notice The permissionless keeper against the mocked protocol. The fork suite proves it
///         against the deployed vault; this one runs in CI and pins the gates.
contract MarenAutoKeeperTest is VaultTestBase {
    MarenAutoKeeper internal auto_;
    address internal stranger = makeAddr("stranger");
    // The mock ignores hints, so any non-zero pair skips the SortedTroves lookup.
    address internal constant UP = address(1);
    address internal constant DOWN = address(2);

    function setUp() public {
        _deployVault();
        _openPooledTrove();
        auto_ = new MarenAutoKeeper(vault, ISortedTroves(address(0xdead)));
        bytes32 role = vault.KEEPER_ROLE();
        vm.prank(admin);
        vault.grantRole(role, address(auto_));
    }

    /// @dev The incident's shape: deposits made while the oracle was stale sit idle, beside
    ///      the trove, counting for nothing.
    function _strandIdle(uint256 amount) internal {
        priceFeed.setStale(true);
        _deposit(alice, amount);
        priceFeed.setStale(false);
        assertEq(vault.idleCollateral(), amount, "held idle on the stale oracle");
    }

    function _target() internal view returns (uint256) {
        uint256 ceiling = protocol.getTroveMaxBorrowingCapacity(address(vault));
        return (ceiling * vault.MIN_TROVE_CR() / priceFeed.fetchPrice()) * auto_.MARGIN_BPS() / 10_000;
    }

    function test_nothingToDoWhenTheTroveAlreadyHoldsEnough() public {
        // The ceiling is frozen at 110% of the open-time value, so the target (the whole
        // ceiling borrowable at 125% of the 180% floor) is ~2.05x the seed collateral. A
        // healthy deposit, pushed straight in, takes the trove past it.
        _deposit(bob, 1.5 ether);
        assertGe(protocol.getTroveColl(address(vault)), _target(), "trove already holds enough");
        _strandIdle(0.5 ether);
        assertEq(auto_.rebalanceAmount(), 0);
        vm.prank(stranger);
        vm.expectRevert(MarenAutoKeeper.NothingToRebalance.selector);
        auto_.rebalance(UP, DOWN);
        assertEq(vault.idleCollateral(), 0.5 ether, "idle untouched");
    }

    function test_strangerPushesExactlyTheShortfall() public {
        // Raise the frozen ceiling's target above what the trove holds by moving the price
        // down after open: the ceiling stays, the BTC is worth less, so more is needed.
        _strandIdle(5 ether);
        priceFeed.setPrice(BTC_PRICE / 2);
        uint256 coll = protocol.getTroveColl(address(vault));
        uint256 target = _target();
        assertGt(target, coll, "the trove is short of its target");

        uint256 expected = target - coll;
        assertLt(expected, 5 ether, "short by less than is idle");
        assertEq(auto_.rebalanceAmount(), expected);

        vm.prank(stranger);
        uint256 pushed = auto_.rebalance(UP, DOWN);
        assertEq(pushed, expected, "only the shortfall");
        assertEq(protocol.getTroveColl(address(vault)), target, "trove lands on the target");
        assertEq(vault.idleCollateral(), 5 ether - expected, "the rest stays idle for withdrawals");

        vm.prank(stranger);
        vm.expectRevert(MarenAutoKeeper.NothingToRebalance.selector);
        auto_.rebalance(UP, DOWN);
    }

    function test_neverPushesMoreThanIsIdle() public {
        _strandIdle(0.01 ether);
        priceFeed.setPrice(BTC_PRICE / 4);
        assertGt(_target() - protocol.getTroveColl(address(vault)), 0.01 ether);
        vm.prank(stranger);
        assertEq(auto_.rebalance(UP, DOWN), 0.01 ether);
        assertEq(vault.idleCollateral(), 0);
    }

    function test_aStaleOracleRefusesRatherThanGuessing() public {
        _strandIdle(5 ether);
        priceFeed.setPrice(BTC_PRICE / 4);
        priceFeed.setStale(true);
        vm.prank(stranger);
        vm.expectRevert();
        auto_.rebalance(UP, DOWN);
        assertEq(vault.idleCollateral(), 5 ether);
    }

    function test_strangersStillCannotCallTheKeeperFunctionsDirectly() public {
        _strandIdle(1 ether);
        vm.prank(stranger);
        vm.expectRevert();
        vault.topUpCollateral(1 ether, UP, DOWN);
        vm.prank(stranger);
        vm.expectRevert();
        vault.refinancePooledTrove(UP, DOWN);
    }

    function test_refinanceOnlyOnceTheCeilingIsNearlyUsed() public {
        uint256 ceiling = protocol.getTroveMaxBorrowingCapacity(address(vault));
        uint256 debt = protocol.getTroveDebt(address(vault));
        assertLt(debt * 10_000, ceiling * auto_.REFINANCE_AT_BPS(), "fresh trove has headroom");
        assertFalse(auto_.refinanceAllowed());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MarenAutoKeeper.CeilingHasHeadroom.selector, debt, ceiling));
        auto_.refinance(UP, DOWN);
    }
}
