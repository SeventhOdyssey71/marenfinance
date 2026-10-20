// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../../src/MarenVault.sol";
import {IMUSD} from "../../src/interfaces/IMUSD.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {ForkOracleStub} from "../mocks/ForkOracleStub.sol";
import {Test} from "forge-std/Test.sol";

interface INativeHintHelper {
    function computeNominalCR(uint256 collateral, uint256 principal) external pure returns (uint256);
}

/// @notice Opt-in regression against deployed testnet bytecode at the reported build-73 snapshot.
/// No signer, broadcast, keeper refinance or new vault deployment. Only the oracle precompile
/// is stubbed at its observed price. Calls impersonate the user directly on the LOCAL fork;
/// this proves bounded target execution, not ERC-2771 signature validation or live settlement.
contract NativeBorrowHintsForkTest is Test {
    address constant VAULT = 0x46252B00AB59384518d9dB6D1f210ffF1221645b;
    address constant USER = address(uint160(0x004b0b25687fee0eb9d90617d656490dfd2964c0ef));
    address constant MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant SORTED = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant OPERATIONS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant HELPER = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant ORACLE = 0x7b7c000000000000000000000000000000000015;
    uint256 constant PINNED_BLOCK = 15_696_997;
    uint256 constant PRICE = 85_842_246_340_000_000_000_000;
    uint256 constant MAX_GAS = 1_500_000;
    uint256 constant BORROW_GAS = 789_132;
    uint256 constant AMOUNT = 500e18;
    uint256 constant FEE = 0.5e18;

    MarenVault pool = MarenVault(payable(VAULT));
    ITroveManager manager = ITroveManager(MANAGER);
    ISortedTroves sorted = ISortedTroves(SORTED);
    address[] coldTargets;

    struct RepayState {
        uint256 coll;
        uint256 principal;
        uint256 interest;
        uint256 reserve;
        uint256 grossDebt;
        uint256 pushed;
        uint256 principalReduction;
        uint256 userBalance;
        uint256 userDebt;
    }

    function setUp() public {
        string memory rpc = vm.envOr("MAREN_NATIVE_HINTS_FORK_RPC", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc, PINNED_BLOCK);
        assertEq(block.chainid, 31611, "testnet only");
        ForkOracleStub stub = new ForkOracleStub();
        vm.etch(ORACLE, address(stub).code);
        ForkOracleStub(ORACLE).set(int256(PRICE), block.timestamp);
        coldTargets = [VAULT, MANAGER, SORTED, MUSD, OPERATIONS, HELPER, PRICE_FEED, ORACLE];
        // Cooling all known dependencies keeps hint-discovery reads from subsidising execution.
        string[4] memory getters =
            ["activePool()", "defaultPool()", "interestRateManager()", "governableVariables()"];
        for (uint256 i; i < getters.length; ++i) {
            (bool success, bytes memory result) = OPERATIONS.staticcall(abi.encodeWithSignature(getters[i]));
            if (success && result.length == 32) coldTargets.push(abi.decode(result, (address)));
        }
    }

    function test_pinned500BorrowTargetHintsRepayAndIdleWithdrawalWithinNativeBudget() public {
        assertEq(block.number, PINNED_BLOCK);
        emit log_named_uint("pinned timestamp", block.timestamp);
        emit log_named_uint("fork user preview debt", pool.previewDebtOf(USER));
        assertEq(pool.collateral(USER), 0.045 ether);
        assertEq(IMUSD(MUSD).balanceOf(USER), 314e18);
        // Re-read at the pinned block: RPC and fork agree exactly on this accrued debt.
        assertEq(pool.previewDebtOf(USER), 334_434_878_629_836_825_441);
        assertEq(block.timestamp, 1_790_069_126);
        assertEq(pool.reserveMUSD(), 0);

        // The companion user-borrow-probe evidence covers zero hints failing at 1.5m.
        // Avoid replaying its unbounded list walk through hundreds of archive RPC slots.
        _borrowWithProjectedHints();
        _repayWithProjectedHints();
        _withdrawWithProjectedHints();
    }

    function _borrowWithProjectedHints() private {
        (uint256 coll, uint256 principal, uint256 interest,,,) = manager.getEntireDebtAndColl(VAULT);
        assertEq(coll, 69_061_097_205_866_344);
        assertEq(principal, 2_750_084_790_152_317_068_015);
        assertGt(interest, 0, "snapshot includes interest that must not enter NICR");
        (address upper, address lower) = _hints(coll, principal + AMOUNT + FEE);
        assertEq(upper, 0x8E42315A5276f7069D516a38d97b9D16507f5e87);
        assertEq(lower, 0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A);
        uint256 balanceBefore = IMUSD(MUSD).balanceOf(USER);
        assertTrue(_attempt(abi.encodeCall(MarenVault.borrow, (AMOUNT, upper, lower)), BORROW_GAS));
        assertEq(IMUSD(MUSD).balanceOf(USER) - balanceBefore, AMOUNT);
        (, uint256 principalAfter,,,,) = manager.getEntireDebtAndColl(VAULT);
        assertEq(principalAfter, principal + AMOUNT + FEE);
        assertEq(pool.reserveMUSD(), 0);
        emit log_named_uint("borrow gas cap", BORROW_GAS);
    }

    function _repayWithProjectedHints() private {
        uint256 repayment = AMOUNT + FEE;
        RepayState memory beforeState;
        (beforeState.coll, beforeState.principal, beforeState.interest,,,) =
            manager.getEntireDebtAndColl(VAULT);
        beforeState.reserve = pool.reserveMUSD();
        beforeState.grossDebt = beforeState.principal + beforeState.interest;
        uint256 room = beforeState.grossDebt > 2000e18 ? beforeState.grossDebt - 2000e18 : 0;
        beforeState.pushed = beforeState.reserve + repayment < room ? beforeState.reserve + repayment : room;
        beforeState.principalReduction =
            beforeState.pushed > beforeState.interest ? beforeState.pushed - beforeState.interest : 0;
        (address upper, address lower) =
            _hints(beforeState.coll, beforeState.principal - beforeState.principalReduction);
        vm.prank(USER);
        assertTrue(IMUSD(MUSD).approve(VAULT, repayment));
        bytes memory data = abi.encodeCall(MarenVault.repay, (repayment, upper, lower));
        // Contract success alone is insufficient: _pushRepayment catches inner-call OOG.
        uint256 outerEstimate = _minimumCallGas(data, false);
        uint256 pushedEstimate = _minimumCallGas(data, true);
        uint256 nativeBudget = _padded(outerEstimate + _intrinsicGas(data));
        emit log_named_uint("repay minimum outer-call gas", outerEstimate);
        emit log_named_uint("repay minimum full-push gas", pushedEstimate);
        emit log_named_uint("repay native padded budget", nativeBudget);
        assertLe(nativeBudget, MAX_GAS, "repay policy cannot silently clamp an oversized estimate");
        beforeState.userBalance = IMUSD(MUSD).balanceOf(USER);
        beforeState.userDebt = pool.previewDebtOf(USER);
        assertTrue(_attempt(data, nativeBudget), "repay must settle within the native budget");
        assertEq(
            pool.reserveMUSD(),
            beforeState.reserve + repayment - beforeState.pushed,
            "repayment must actually reach pool"
        );
        assertEq(pool.reserveMUSD(), 0, "no catch-and-hold fallback at this snapshot");
        (, uint256 principalAfter, uint256 interestAfter,,,) = manager.getEntireDebtAndColl(VAULT);
        assertEq(
            principalAfter,
            beforeState.principal - beforeState.principalReduction,
            "interest is paid before principal"
        );
        assertEq(principalAfter + interestAfter, beforeState.grossDebt - beforeState.pushed);
        assertEq(beforeState.userBalance - IMUSD(MUSD).balanceOf(USER), repayment);
        assertApproxEqAbs(
            beforeState.userDebt - pool.previewDebtOf(USER), repayment, 2, "user repayment accounting"
        );
    }

    function _withdrawWithProjectedHints() private {
        uint256 amount = 0.001 ether;
        uint256 idleBefore = pool.idleCollateral();
        uint256 userCollBefore = pool.collateral(USER);
        uint256 userBtcBefore = USER.balance;
        (uint256 coll, uint256 principal,,,,) = manager.getEntireDebtAndColl(VAULT);
        uint256 pulled = amount > idleBefore ? amount - idleBefore : 0;
        (address upper, address lower) = _hints(coll - pulled, principal);
        bytes memory data = abi.encodeCall(MarenVault.withdraw, (amount, upper, lower));
        uint256 estimated = _minimumCallGas(data, false);
        uint256 nativeBudget = _padded(estimated + _intrinsicGas(data));
        emit log_named_uint("withdraw minimum outer-call gas", estimated);
        emit log_named_uint("withdraw native padded budget", nativeBudget);
        assertLe(nativeBudget, MAX_GAS);
        assertTrue(_attempt(data, nativeBudget));
        assertEq(pool.collateral(USER), userCollBefore - amount);
        assertEq(USER.balance, userBtcBefore + amount);
        assertEq(pool.idleCollateral(), idleBefore - amount, "this snapshot withdraws idle BTC first");
        (uint256 collAfter,,,,,) = manager.getEntireDebtAndColl(VAULT);
        assertEq(collAfter, coll, "idle withdrawal must leave pool collateral unchanged");
    }

    function _hints(uint256 coll, uint256 principal) private view returns (address upper, address lower) {
        uint256 nicr = INativeHintHelper(HELPER).computeNominalCR(coll, principal);
        // These search seeds were independently discovered by the pinned read-only RPC probe.
        // Validate them onchain without repeating the expensive historical list traversal.
        address seedUpper = principal > 3000e18
            ? 0x8E42315A5276f7069D516a38d97b9D16507f5e87
            : 0x57a270C711Ccea7AFCB5361d214eAef149C5fA9B;
        address seedLower = principal > 3000e18
            ? 0x41Cbf317fcF3d5128ECF46e1B9f96dDf2994850A
            : 0x306919805Eed1aD4772d92e18d00A1c132b07C19;
        (upper, lower) = sorted.findInsertPosition(nicr, seedUpper, seedLower);
        // findInsertPosition runs before the existing vault is removed; never return itself.
        if (upper == VAULT) upper = sorted.getPrev(VAULT);
        if (lower == VAULT) lower = sorted.getNext(VAULT);
    }

    function _attempt(bytes memory data, uint256 budget) private returns (bool success) {
        for (uint256 i; i < coldTargets.length; ++i) {
            vm.cool(coldTargets[i]);
        }
        vm.prank(USER);
        (success,) = VAULT.call{gas: budget}(data);
    }

    /// @dev Local binary-search analogue of estimateGas. Snapshot restoration prevents any
    /// probe from changing balances. Adding intrinsic gas before padding is conservative;
    /// the measured target-call threshold is not an RPC gas estimate or a broadcast receipt.
    function _minimumCallGas(bytes memory data, bool requireFullPush) private returns (uint256) {
        uint256 snapshot = vm.snapshotState();
        uint256 low = 21_000;
        uint256 high = MAX_GAS;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            bool success = _attempt(data, mid);
            if (success && requireFullPush) success = pool.reserveMUSD() == 0;
            assertTrue(vm.revertToState(snapshot));
            if (success) high = mid;
            else low = mid + 1;
        }
        assertTrue(_attempt(data, high), "even max gas cannot execute target");
        if (requireFullPush) assertEq(pool.reserveMUSD(), 0, "even max gas cannot push repayment");
        assertTrue(vm.revertToStateAndDelete(snapshot));
        return high;
    }

    function _padded(uint256 estimate) private pure returns (uint256) {
        return estimate + estimate / 2 + 60_000;
    }

    function _intrinsicGas(bytes memory data) private pure returns (uint256 gas) {
        gas = 21_000;
        for (uint256 i; i < data.length; ++i) {
            gas += data[i] == 0 ? 4 : 16;
        }
    }
}
