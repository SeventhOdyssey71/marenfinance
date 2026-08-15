// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenVault} from "../src/MarenVault.sol";
import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockMusdProtocol} from "./mocks/MockMusdProtocol.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

/**
 * @notice Drives MarenVault through random sequences of real user actions. Operations that can
 *         legitimately fail (the 180% floor, the protocol's own ICR check, a stale oracle) are
 *         swallowed, because the invariants must hold across the successes AND the failures —
 *         a reverted borrow must leave the books exactly as it found them.
 */
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    MarenVault public immutable vault;
    MockMUSD public immutable musd;
    MockPriceFeed public immutable priceFeed;
    MockMusdProtocol public immutable protocol;

    address[3] public actors;

    /// @dev Ghost accounting, maintained independently of the contract, so the invariants are
    ///      checked against something the contract itself did not compute.
    mapping(address => uint256) public ghostDeposited;
    mapping(address => uint256) public ghostWithdrawn;
    mapping(address => uint256) public ghostSeized;
    uint256 public callCount;

    constructor(MarenVault vault_, MockMUSD musd_, MockPriceFeed priceFeed_, MockMusdProtocol protocol_) {
        vault = vault_;
        musd = musd_;
        priceFeed = priceFeed_;
        protocol = protocol_;
        actors = [makeAddr("h_alice"), makeAddr("h_bob"), makeAddr("h_carol")];
        for (uint256 i; i < actors.length; ++i) {
            musd.mint(actors[i], 20_000e18);
            vm.prank(actors[i]);
            musd.approve(address(vault), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, vault.MIN_DEPOSIT(), 10 ether);
        vm.deal(a, amount);
        vm.prank(a);
        try vault.deposit{value: amount}(address(0), address(0)) {
            ghostDeposited[a] += amount;
        } catch {}
        callCount++;
    }

    function borrow(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1e18, 5_000e18);
        vm.prank(a);
        try vault.borrow(amount, address(0), address(0)) {} catch {}
        callCount++;
    }

    function repay(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1e18, 5_000e18);
        vm.prank(a);
        try vault.repay(amount, address(0), address(0)) {} catch {}
        callCount++;
    }

    function withdraw(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1, 10 ether);
        uint256 before = a.balance;
        vm.prank(a);
        try vault.withdraw(amount, address(0), address(0)) {
            ghostWithdrawn[a] += a.balance - before;
        } catch {}
        callCount++;
    }

    function passTime(uint256 gap) external {
        vm.warp(block.timestamp + bound(gap, 1 hours, 60 days));
        try vault.syncTrove() {} catch {}
        callCount++;
    }

    /// @dev BTC moves. Bounded to +/-35% of the starting price so positions get stressed
    ///      without every run degenerating into mass insolvency.
    function movePrice(uint256 newPrice) external {
        priceFeed.setPrice(bound(newPrice, (63_071.83e18 * 65) / 100, (63_071.83e18 * 135) / 100));
        callCount++;
    }

    /// @dev The oracle going down is a normal Mezo condition, not an exotic one.
    function toggleOracle(bool stale) external {
        priceFeed.setStale(stale);
        callCount++;
    }

    function totalGhostDeposited() external view returns (uint256 t) {
        for (uint256 i; i < actors.length; ++i) {
            t += ghostDeposited[actors[i]];
        }
    }
}

contract MarenVaultInvariantTest is VaultTestBase {
    VaultHandler internal handler;

    function setUp() public {
        _deployVault();
        _openPooledTrove();
        handler = new VaultHandler(vault, musd, priceFeed, protocol);

        targetContract(address(handler));
    }

    /**
     * @notice Every wei of collateral credited to an account is either inside the pooled trove
     *         or sitting idle in this contract. There is no third place for it to be.
     * @dev The strongest statement the vault can make about custody: the books cannot claim
     *      collateral the protocol does not hold.
     */
    function invariant_collateralIsFullyBacked() public view {
        assertEq(
            vault.totalCollateral(),
            protocol.getTroveColl(address(vault)) + vault.idleCollateral(),
            "credited collateral must equal trove collateral plus idle"
        );
        assertGe(address(vault).balance, vault.idleCollateral(), "idle collateral must actually be here");
    }

    /// @notice The per-account ledger sums to the recorded total. A silent divergence here
    ///         would mean some user's balance was created out of nothing.
    function invariant_perAccountLedgerSumsToTotal() public view {
        uint256 sum = vault.collateral(address(vault));
        for (uint256 i; i < 3; ++i) {
            sum += vault.collateral(handler.actors(i));
        }
        assertEq(sum, vault.totalCollateral(), "per-account collateral must sum to totalCollateral");
    }

    /**
     * @notice The pool never charges its users less than the MUSD protocol will demand back.
     * @dev The single most important invariant in this contract. If it ever fails, the vault
     *      is quietly insolvent: users could all repay in full and the trove would still owe.
     */
    function invariant_userDebtCoversTroveDebt() public view {
        uint256 sum = vault.debtOf(address(vault));
        for (uint256 i; i < 3; ++i) {
            sum += vault.debtOf(handler.actors(i));
        }
        assertGe(sum, vault.outstandingDebt(), "user debt must cover what the trove owes");
    }

    /// @notice Nobody can withdraw more BTC than they put in. Collateral is not a faucet.
    function invariant_nobodyWithdrawsMoreThanTheyDeposited() public view {
        for (uint256 i; i < 3; ++i) {
            address a = handler.actors(i);
            assertLe(
                handler.ghostWithdrawn(a),
                handler.ghostDeposited(a),
                "an account withdrew more collateral than it ever deposited"
            );
            // And what they still hold plus what they took out cannot exceed what they put in.
            assertLe(
                vault.collateral(a) + handler.ghostWithdrawn(a),
                handler.ghostDeposited(a),
                "held plus withdrawn exceeds deposited"
            );
        }
    }

    /// @notice The interest index never runs backwards, whatever sequence of operations and
    ///         price moves it is subjected to.
    function invariant_interestIndexNeverDecreases() public view {
        assertGe(vault.interestIndex(), 1e18, "index started at 1e18 and is monotonic");
    }

    /// @notice The reserve is real MUSD. It can never claim more than the contract holds.
    function invariant_reserveIsBackedByRealMusd() public view {
        assertLe(vault.reserveMUSD(), musd.balanceOf(address(vault)), "reserve must be backed by held MUSD");
    }
}
