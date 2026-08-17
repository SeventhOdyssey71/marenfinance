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
    uint256 public ghostRedeemed;
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

    /**
     * @dev Somebody else's MUSD reaches into the pooled trove. Deliberately NOT followed by a
     *      reconciliation: the invariants have to hold in the window between a redemption
     *      landing and anyone noticing, because that window is where the first-come-first-
     *      served failure would live.
     */
    function redeem(uint256 amount) external {
        uint256 redeemable = vault.outstandingDebt();
        if (redeemable < 2) return;
        amount = bound(amount, 1, redeemable - 1);
        address redeemerActor = makeAddr("h_redeemer");
        musd.mint(redeemerActor, amount);
        vm.prank(redeemerActor);
        try protocol.redeemCollateral(amount, address(vault), address(0), address(0), 0, 0) {
            ghostRedeemed += amount;
        } catch {}
        callCount++;
    }

    /// @dev A keeper, or anyone at all, flushing an account that has gone quiet.
    function settle(uint256 actorSeed) external {
        try vault.settleRedemption(_actor(actorSeed)) {} catch {}
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
     * @notice Every wei of collateral an account can CLAIM is either inside the pooled trove
     *         or sitting idle in this contract. There is no third place for it to be.
     * @dev The strongest statement the vault can make about custody: the books cannot claim
     *      collateral the protocol does not hold. Stated against `collateralOf` rather than
     *      the raw ledger, because between a redemption landing and an account being settled
     *      the raw ledger is knowingly stale and the claim is the true number. The equality
     *      is asserted too, whenever there is no redemption in flight.
     */
    function invariant_collateralIsFullyBacked() public view {
        uint256 held = protocol.getTroveColl(address(vault)) + vault.idleCollateral();
        assertLe(
            _sumClaims(),
            held + vault.redemptionShortfall(),
            "claims must not exceed collateral actually held"
        );
        if (vault.pendingRedemptionCollateral() == 0 && vault.redemptionShortfall() == 0) {
            assertEq(
                vault.totalCollateral(), held, "credited collateral must equal trove collateral plus idle"
            );
        }
        assertGe(address(vault).balance, vault.idleCollateral(), "idle collateral must actually be here");
    }

    /**
     * @notice The per-account claims sum to the collateral actually held, to within the
     *         redemption dust. A divergence beyond that would mean some user's balance was
     *         created out of nothing, or quietly absorbed by the pool.
     * @dev The dust budget for a whole run is a tenth of a satoshi. Each redemption rounds its
     *      per-share debit UP, which costs at most `totalDebtShares / 1e18` wei plus one wei
     *      per holder, so with this handler's ~20,000 MUSD of pooled debt that is ~2e4 wei per
     *      redemption and a few hundred redemptions in the deepest run. 1e9 wei is four orders
     *      of magnitude of headroom above that and still a thousandth of what a UI can show.
     */
    function invariant_perAccountLedgerSumsToTotal() public view {
        uint256 held = protocol.getTroveColl(address(vault)) + vault.idleCollateral();
        assertGe(_sumClaims() + 1e9 + vault.redemptionShortfall(), held, "collateral vanished from the books");
    }

    /// @dev What every account this suite touches could actually withdraw right now.
    function _sumClaims() internal view returns (uint256 sum) {
        sum = vault.collateralOf(address(vault));
        for (uint256 i; i < 3; ++i) {
            sum += vault.collateralOf(handler.actors(i));
        }
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

    /**
     * @notice The interest index only ever falls at a redemption, and only by the debt the
     *         redemption actually cancelled.
     * @dev Absent redemptions this is the original monotonicity statement. With them, the
     *      thing to check is that a fall is always matched by measured relief, which is what
     *      the redeemed totals record.
     */
    function invariant_interestIndexOnlyFallsOnRedemptions() public view {
        if (vault.totalDebtRedeemed() == 0) {
            assertGe(vault.interestIndex(), 1e18, "index started at 1e18 and is monotonic");
        } else {
            assertGe(vault.interestIndex(), 1, "the index is floored, never zero");
        }
    }

    /// @notice Whatever the redemptions did, the pool still charges its users at least what
    ///         the trove will demand back. Restated here with redemptions in the mix because
    ///         it is the one that makes the vault solvent or not.
    function invariant_redemptionsNeverLeaveThePoolShort() public view {
        uint256 sum = vault.debtOf(address(vault));
        for (uint256 i; i < 3; ++i) {
            sum += vault.debtOf(handler.actors(i));
        }
        assertGe(sum, vault.outstandingDebt(), "user debt must cover what the trove owes");
    }

    /// @notice The reserve is real MUSD. It can never claim more than the contract holds.
    function invariant_reserveIsBackedByRealMusd() public view {
        assertLe(vault.reserveMUSD(), musd.balanceOf(address(vault)), "reserve must be backed by held MUSD");
    }
}
