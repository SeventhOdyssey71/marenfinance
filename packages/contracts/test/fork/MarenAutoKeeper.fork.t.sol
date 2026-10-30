// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenAutoKeeper} from "../../src/MarenAutoKeeper.sol";
import {MarenVault} from "../../src/MarenVault.sol";
import {IMUSD} from "../../src/interfaces/IMUSD.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {ForkOracleStub} from "../mocks/ForkOracleStub.sol";
import {Test} from "forge-std/Test.sol";

/// @notice The permissionless repair against the EXISTING deployed vault, at chain head.
/// Publishes nothing. Mezo's oracle precompile is replaced by the supplied live price
/// because Anvil cannot replay it (see ForkOracleStub).
///
///   MAREN_REPAIR_FORK_RPC=https://rpc.test.mezo.org \
///   MAREN_REPAIR_PRICE_WEI=$(cast call <priceFeed> 'fetchPrice()(uint256)' ...) \
///   forge test --match-contract MarenAutoKeeperForkTest -vv
contract MarenAutoKeeperForkTest is Test {
    address constant VAULT = 0x46252B00AB59384518d9dB6D1f210ffF1221645b;
    address constant ADMIN = 0x54196397D6f01b48739dB3957257cB33cD341885;
    address constant SORTED = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant ORACLE = 0x7b7c000000000000000000000000000000000015;

    MarenVault pool;
    ITroveManager manager;
    ISortedTroves sorted;
    MarenAutoKeeper keeper;
    uint256 price;

    function setUp() public {
        string memory rpc = vm.envOr("MAREN_REPAIR_FORK_RPC", string(""));
        price = vm.envOr("MAREN_REPAIR_PRICE_WEI", uint256(0));
        vm.skip(bytes(rpc).length == 0 || price == 0);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 31611, "testnet only");
        ForkOracleStub stub = new ForkOracleStub();
        vm.etch(ORACLE, address(stub).code);
        ForkOracleStub(ORACLE).set(int256(price), block.timestamp);

        pool = MarenVault(payable(VAULT));
        manager = ITroveManager(pool.troveManager());
        sorted = ISortedTroves(SORTED);
        keeper = new MarenAutoKeeper(pool, sorted);

        // The one admin action the deployment performs.
        bytes32 role = pool.KEEPER_ROLE();
        vm.prank(ADMIN);
        pool.grantRole(role, address(keeper));
    }

    function test_anyoneRestoresBorrowingWithoutARole() public {
        address stranger = makeAddr("stranger");
        address borrower = makeAddr("borrower");
        vm.deal(borrower, 0.002 ether);

        uint256 icrBefore = manager.getCurrentICR(VAULT, price);
        uint256 idleBefore = pool.idleCollateral();
        uint256 collBefore = manager.getTroveColl(VAULT);
        emit log_named_decimal_uint("trove ICR before (%)", icrBefore * 100, 18);
        emit log_named_decimal_uint("idle before (BTC)  ", idleBefore, 18);

        // The incident: a fresh, healthy position still cannot borrow.
        vm.startPrank(borrower);
        pool.deposit{value: 0.002 ether}(sorted.getPrev(VAULT), sorted.getNext(VAULT));
        if (manager.getCurrentICR(VAULT, price) < pool.MIN_TROVE_CR()) {
            // Hints first: expectRevert applies to the NEXT call, and argument evaluation is one.
            (address up, address down) = (sorted.getPrev(VAULT), sorted.getNext(VAULT));
            vm.expectRevert();
            pool.borrow(10e18, up, down);
        }
        vm.stopPrank();

        // A stranger still cannot call the keeper function directly...
        vm.prank(stranger);
        vm.expectRevert();
        pool.topUpCollateral(1, address(0), address(0));

        // ...but can run the bounded repair.
        uint256 collMid = manager.getTroveColl(VAULT);
        uint256 expected = keeper.rebalanceAmount();
        assertGt(expected, 0, "the live trove needs a push");
        vm.prank(stranger);
        uint256 pushed = keeper.rebalance(address(0), address(0));
        assertEq(pushed, expected, "pushes exactly what the view promised");
        assertEq(manager.getTroveColl(VAULT), collMid + pushed, "into the trove");
        assertGe(collMid, collBefore, "the deposit did not shrink the trove");
        assertLe(pushed, idleBefore, "never more than was idle");

        uint256 icrAfter = manager.getCurrentICR(VAULT, price);
        emit log_named_decimal_uint("pushed (BTC)       ", pushed, 18);
        emit log_named_decimal_uint("trove ICR after (%)", icrAfter * 100, 18);
        assertGe(icrAfter, pool.MIN_TROVE_CR(), "trove back above the vault's floor");

        // Nothing left to do: a second call is refused rather than pushing more.
        vm.prank(stranger);
        vm.expectRevert(MarenAutoKeeper.NothingToRebalance.selector);
        keeper.rebalance(address(0), address(0));

        // The loop closes: borrow, repay, withdraw.
        vm.startPrank(borrower);
        pool.borrow(10e18, sorted.getPrev(VAULT), sorted.getNext(VAULT));
        assertEq(IMUSD(MUSD).balanceOf(borrower), 10e18, "borrow settles after the repair");
        uint256 debt = pool.debtOf(borrower);
        vm.stopPrank();
        deal(MUSD, borrower, debt);
        vm.startPrank(borrower);
        IMUSD(MUSD).approve(VAULT, debt);
        pool.repay(debt, sorted.getPrev(VAULT), sorted.getNext(VAULT));
        pool.withdraw(0.002 ether, sorted.getPrev(VAULT), sorted.getNext(VAULT));
        vm.stopPrank();
        assertEq(borrower.balance, 0.002 ether, "full collateral exits");
    }

    function test_refinanceIsRefusedWhileTheCeilingHasHeadroom() public {
        uint256 ceiling = manager.getTroveMaxBorrowingCapacity(VAULT);
        uint256 debt = manager.getTroveDebt(VAULT);
        vm.assume(debt * 10_000 < ceiling * keeper.REFINANCE_AT_BPS());
        assertFalse(keeper.refinanceAllowed());
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSelector(MarenAutoKeeper.CeilingHasHeadroom.selector, debt, ceiling));
        keeper.refinance(address(0), address(0));
    }
}
