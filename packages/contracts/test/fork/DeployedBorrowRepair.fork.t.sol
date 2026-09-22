// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../../src/MarenVault.sol";
import {IMUSD} from "../../src/interfaces/IMUSD.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {ForkOracleStub} from "../mocks/ForkOracleStub.sol";
import {Test} from "forge-std/Test.sol";

/// @notice Reproduces the incident against the EXISTING deployed vault, without
/// publishing contracts or transactions. Mezo's oracle precompile is replaced by
/// the explicitly supplied live price because Anvil cannot replay that precompile.
contract DeployedBorrowRepairForkTest is Test {
    address constant VAULT = 0x46252B00AB59384518d9dB6D1f210ffF1221645b;
    address constant KEEPER = 0x54196397D6f01b48739dB3957257cB33cD341885;
    address constant MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant SORTED = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant ORACLE = 0x7b7c000000000000000000000000000000000015;

    function test_deployedBorrowRefusesAtCeilingThenRefinanceRestoresLoop() public {
        string memory rpc = vm.envOr("MAREN_REPAIR_FORK_RPC", string(""));
        uint256 price = vm.envOr("MAREN_REPAIR_PRICE_WEI", uint256(0));
        vm.skip(bytes(rpc).length == 0 || price == 0);
        // Historical incident snapshot: remains reproducible after live repair.
        vm.createSelectFork(rpc, 15_688_608);
        assertEq(block.chainid, 31611, "testnet only");
        ForkOracleStub stub = new ForkOracleStub();
        vm.etch(ORACLE, address(stub).code);
        ForkOracleStub(ORACLE).set(int256(price), block.timestamp);

        MarenVault pool = MarenVault(payable(VAULT));
        ITroveManager manager = ITroveManager(MANAGER);
        ISortedTroves sorted = ISortedTroves(SORTED);
        address borrower = makeAddr("repair-fork-borrower");
        vm.deal(borrower, 0.002 ether);
        assertEq(pool.reserveMUSD(), 0, "incident requires an empty reserve");
        uint256 ceilingBefore = manager.getTroveMaxBorrowingCapacity(VAULT);
        assertLt(ceilingBefore, manager.getTroveDebt(VAULT) + 10e18);

        address upper = sorted.getPrev(VAULT);
        address lower = sorted.getNext(VAULT);
        vm.prank(borrower);
        pool.deposit{value: 0.002 ether}(upper, lower);
        assertEq(
            manager.getTroveMaxBorrowingCapacity(VAULT),
            ceilingBefore,
            "deposit does not reset Mezo's frozen ceiling"
        );
        upper = sorted.getPrev(VAULT);
        lower = sorted.getNext(VAULT);
        vm.prank(borrower);
        vm.expectRevert();
        pool.borrow(10e18, upper, lower);

        vm.prank(KEEPER);
        pool.refinancePooledTrove(upper, lower);
        assertGt(manager.getTroveMaxBorrowingCapacity(VAULT), ceilingBefore);
        upper = sorted.getPrev(VAULT);
        lower = sorted.getNext(VAULT);
        vm.prank(borrower);
        pool.borrow(10e18, upper, lower);
        assertEq(IMUSD(MUSD).balanceOf(borrower), 10e18, "borrow settles after keeper repair");
        // Include origination fee in repayment, using only a local test fixture top-up.
        uint256 debt = pool.debtOf(borrower);
        deal(MUSD, borrower, debt);
        vm.startPrank(borrower);
        IMUSD(MUSD).approve(VAULT, debt);
        pool.repay(debt, sorted.getPrev(VAULT), sorted.getNext(VAULT));
        assertEq(pool.debtOf(borrower), 0);
        pool.withdraw(0.002 ether, sorted.getPrev(VAULT), sorted.getNext(VAULT));
        vm.stopPrank();
        assertEq(borrower.balance, 0.002 ether, "full collateral exits after repayment");
        assertEq(pool.collateral(borrower), 0);
    }
}
