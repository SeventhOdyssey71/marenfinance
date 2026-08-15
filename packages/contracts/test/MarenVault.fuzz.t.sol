// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";

/**
 * @notice Fuzzing for the one thing in MarenVault that cannot be checked by inspection: that
 *         the per-user interest-index ledger stays glued to the pooled trove's real debt under
 *         arbitrary interleavings of deposit / borrow / repay / withdraw and arbitrary
 *         amounts of elapsed time.
 *
 *         Every assertion checks BOTH magnitude and DIRECTION. A drift of a few wei is
 *         unavoidable in fixed-point accounting; a drift in the USER's favour is a solvency
 *         bug, because it means the pool has charged its users less than the MUSD protocol
 *         will demand back.
 */
contract MarenVaultFuzzTest is VaultTestBase {
    /// @dev Rounding tolerance. Each individual operation can add at most `interestIndex / 1e18`
    ///      wei of surplus, and there are at most a few dozen operations per run, so anything
    ///      approaching 0.001 MUSD indicates a systematic error rather than rounding.
    uint256 internal constant DRIFT_TOLERANCE = 1e15;

    function setUp() public {
        _deployVault();
        _openPooledTrove();
    }

    /**
     * @notice Deposits, borrows and repays in any order, with time passing, must never let the
     *         sum of user debt fall below what the trove actually owes.
     */
    function testFuzz_ledgerNeverDriftsAgainstTheProtocol(
        uint96[8] calldata amounts,
        uint8[8] calldata kinds,
        uint32[8] calldata gaps
    ) public {
        address[3] memory actors = [alice, bob, carol];
        for (uint256 i; i < actors.length; ++i) {
            _deposit(actors[i], 1 ether);
            musd.mint(actors[i], 5_000e18);
            vm.prank(actors[i]);
            musd.approve(address(vault), type(uint256).max);
        }

        for (uint256 k; k < amounts.length; ++k) {
            address actor = actors[k % actors.length];
            uint256 amount = bound(uint256(amounts[k]), 1e18, 2_000e18);
            uint256 kind = kinds[k] % 4;

            vm.startPrank(actor);
            if (kind == 0) {
                // Borrows can legitimately fail on the 180% floor or the trove ICR check.
                try vault.borrow(amount, address(0), address(0)) {} catch {}
            } else if (kind == 1) {
                try vault.repay(amount, address(0), address(0)) {} catch {}
            } else if (kind == 2) {
                try vault.withdraw(bound(amount, 1, 0.2 ether), address(0), address(0)) {} catch {}
            } else {
                vm.stopPrank();
                vm.deal(actor, 0.05 ether);
                vm.prank(actor);
                vault.deposit{value: 0.05 ether}(address(0), address(0));
                vm.startPrank(actor);
            }
            vm.stopPrank();

            vm.warp(block.timestamp + bound(uint256(gaps[k]), 0, 30 days));
        }

        vault.syncTrove();

        uint256 userDebt = _sumTrackedDebt();
        uint256 owed = vault.outstandingDebt();

        // DIRECTION: the pool must never have charged its users less than it owes.
        assertGe(userDebt, owed, "ledger drifted in the user's favour - this is a solvency bug");
        // MAGNITUDE: and the surplus must stay at rounding scale.
        assertLe(userDebt - owed, DRIFT_TOLERANCE, "drift exceeds rounding tolerance");
    }

    /// @dev Collateral is conserved exactly. Whatever is credited to accounts equals what is
    ///      in the trove plus what is sitting here idle — no third place for it to go.
    function testFuzz_collateralIsConserved(uint96[6] calldata deposits, uint8[6] calldata whichActor) public {
        address[3] memory actors = [alice, bob, carol];

        for (uint256 k; k < deposits.length; ++k) {
            address actor = actors[whichActor[k] % actors.length];
            uint256 amount = bound(uint256(deposits[k]), vault.MIN_DEPOSIT(), 5 ether);
            vm.deal(actor, amount);
            vm.prank(actor);
            vault.deposit{value: amount}(address(0), address(0));

            assertEq(
                vault.totalCollateral(),
                protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
                "collateral must be either in the trove or idle here"
            );
            assertEq(_sumTrackedCollateral(), vault.totalCollateral(), "per-account sum matches the total");
        }
    }

    /// @dev Interest is charged, never refunded: more elapsed time can only ever mean more debt.
    function testFuzz_interestIsMonotonicInTime(uint32 gapA, uint32 gapB) public {
        _deposit(alice, 1 ether);
        _borrow(alice, 1_000e18);

        vm.warp(block.timestamp + bound(uint256(gapA), 1 days, 365 days));
        vault.syncTrove();
        uint256 debtA = vault.debtOf(alice);
        uint256 indexA = vault.interestIndex();
        assertGe(debtA, 1_000e18, "debt never falls below principal borrowed");

        vm.warp(block.timestamp + bound(uint256(gapB), 1 days, 365 days));
        vault.syncTrove();
        assertGe(vault.debtOf(alice), debtA, "debt is monotonic in time");
        assertGe(vault.interestIndex(), indexA, "index is monotonic in time");
    }

    /// @dev A borrow served entirely from the reserve costs exactly the amount borrowed: the
    ///      origination fee only applies to MUSD actually drawn from the trove.
    function testFuzz_borrowFromReserveChargesNoFee(uint96 raw) public {
        _deposit(alice, 1 ether);
        uint256 amount = bound(uint256(raw), 1e18, vault.reserveMUSD());
        // Stay inside the 180% floor: 1 BTC supports far more than the reserve holds.
        _borrow(alice, amount);
        assertEq(vault.debtOf(alice), amount, "no fee when the trove is never touched");
        assertEq(musd.balanceOf(alice), amount);
    }

    /// @dev Full repayment always clears the position exactly, with no dust share left behind
    ///      that would quietly keep accruing interest.
    function testFuzz_fullRepaymentClearsThePositionExactly(uint96 raw, uint32 gap) public {
        _deposit(alice, 1 ether);
        uint256 amount = bound(uint256(raw), 1e18, 1_500e18);
        _borrow(alice, amount);

        vm.warp(block.timestamp + bound(uint256(gap), 0, 400 days));
        musd.mint(alice, 1_000e18);

        vm.prank(alice);
        musd.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.repay(type(uint256).max, address(0), address(0));

        assertEq(vault.debtOf(alice), 0);
        assertEq(vault.debtShares(alice), 0);
        assertEq(vault.maxBorrowable(alice), (1 ether * BTC_PRICE) / 1.8e18);
    }
}
