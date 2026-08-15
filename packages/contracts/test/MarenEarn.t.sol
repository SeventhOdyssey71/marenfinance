// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenEarn} from "../src/MarenEarn.sol";
import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {MockStabilityPool} from "./mocks/MockStabilityPool.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";

contract MarenEarnTest is Test {
    uint256 internal constant BTC_PRICE = 63_071.83e18;

    MockMUSD internal musd;
    MockPriceFeed internal priceFeed;
    MockStabilityPool internal pool;
    MockSwapRouter internal router;
    MarenForwarder internal forwarder;
    MarenEarn internal earn;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        musd = new MockMUSD();
        priceFeed = new MockPriceFeed(BTC_PRICE);
        pool = new MockStabilityPool(musd);
        router = new MockSwapRouter(musd, BTC_PRICE);
        forwarder = new MarenForwarder();

        earn = new MarenEarn(
            address(musd),
            address(pool),
            address(priceFeed),
            address(forwarder),
            admin,
            type(uint256).max
        );

        // startPrank, not prank: `earn.KEEPER_ROLE()` is itself a call and would consume a
        // one-shot prank before grantRole ever ran.
        vm.startPrank(admin);
        earn.grantRole(earn.KEEPER_ROLE(), keeper);
        vm.stopPrank();

        musd.mint(alice, 100_000e18);
        musd.mint(bob, 100_000e18);
        vm.prank(alice);
        musd.approve(address(earn), type(uint256).max);
        vm.prank(bob);
        musd.approve(address(earn), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return earn.deposit(amount, who);
    }

    // ------------------------------------------------------------------ //
    //                            ERC-4626 core                           //
    // ------------------------------------------------------------------ //

    function test_metadata() public view {
        assertEq(earn.name(), "Maren Earn MUSD");
        assertEq(earn.symbol(), "mMUSD");
        assertEq(earn.asset(), address(musd));
        assertEq(earn.decimals(), 21, "18 asset decimals + a 3-decimal share offset");
    }

    function test_deposit_forwardsEverythingToTheStabilityPool() public {
        _deposit(alice, 10_000e18);

        assertEq(pool.getCompoundedMUSDDeposit(address(earn)), 10_000e18, "MUSD is put to work, not parked");
        assertEq(musd.balanceOf(address(earn)), 0);
        assertEq(earn.totalAssets(), 10_000e18);
        assertGt(earn.balanceOf(alice), 0);
    }

    function test_withdraw_pullsBackOutOfTheStabilityPool() public {
        _deposit(alice, 10_000e18);
        uint256 balanceBefore = musd.balanceOf(alice);

        vm.prank(alice);
        earn.withdraw(4_000e18, alice, alice);

        assertEq(musd.balanceOf(alice), balanceBefore + 4_000e18);
        assertEq(pool.getCompoundedMUSDDeposit(address(earn)), 6_000e18);
    }

    function test_redeem_allSharesReturnsAllAssets() public {
        uint256 shares = _deposit(alice, 10_000e18);
        vm.prank(alice);
        uint256 assets = earn.redeem(shares, alice, alice);

        assertEq(assets, 10_000e18);
        assertEq(earn.totalSupply(), 0);
        assertEq(earn.balanceOf(alice), 0);
    }

    function test_twoDepositorsShareProRata() public {
        _deposit(alice, 10_000e18);
        _deposit(bob, 30_000e18);

        assertApproxEqRel(earn.balanceOf(bob), earn.balanceOf(alice) * 3, 1e12);
        assertEq(earn.totalAssets(), 40_000e18);
    }

    /// @dev With no decimals offset, the first depositor could donate assets straight to the
    ///      vault and round every later small deposit down to zero shares. The 3-decimal
    ///      offset makes that attack cost 1000x what it could steal.
    function test_inflationAttack_isNotProfitable() public {
        _deposit(alice, 1); // 1 wei, the classic setup

        // Attacker donates a large amount directly, trying to inflate the share price.
        vm.prank(alice);
        musd.transfer(address(earn), 10_000e18);

        uint256 bobShares = _deposit(bob, 5_000e18);
        assertGt(bobShares, 0, "victim must still receive non-zero shares");

        uint256 attackerRedeemable = earn.previewRedeem(earn.balanceOf(alice));

        vm.prank(bob);
        uint256 recovered = earn.redeem(bobShares, bob, bob);

        // The victim keeps essentially all of their deposit...
        assertGe(recovered, 4_990e18, "victim recovers essentially all of their deposit");
        // ...and, decisively, the attacker cannot get back even what they donated. Spending
        // 10,000 MUSD to extract single-digit MUSD is not an attack, it is a donation.
        assertLt(attackerRedeemable, 10_000e18, "the attack must cost more than it yields");
    }

    // ------------------------------------------------------------------ //
    //                        Liquidation gains                           //
    // ------------------------------------------------------------------ //

    /// @dev The real yield mechanism: MUSD is burned to absorb a liquidation and BTC arrives
    ///      in its place. Net of the discount, `totalAssets()` goes UP.
    function test_liquidationGain_increasesTotalAssets() public {
        _deposit(alice, 10_000e18);
        uint256 before = earn.totalAssets();

        // Absorb 1,000 MUSD of debt, receive BTC worth ~1,100 (a 10% liquidation discount).
        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        assertGt(earn.totalAssets(), before, "depositors are net ahead after a liquidation");
        assertEq(pool.getCompoundedMUSDDeposit(address(earn)), 9_000e18, "MUSD was burned");
        assertApproxEqRel(pool.getDepositorCollateralGain(address(earn)), btcGain, 1e12);
    }

    /// @dev Unclaimed gains are already counted, so a depositor arriving one block before a
    ///      harvest cannot capture yield earned before they took any risk.
    function test_pendingGainsAreCountedBeforeHarvest() public {
        _deposit(alice, 10_000e18);
        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        uint256 assetsBeforeHarvest = earn.totalAssets();
        vm.prank(keeper);
        earn.harvest(0, block.timestamp + 1);
        assertApproxEqAbs(earn.totalAssets(), assetsBeforeHarvest, 2, "harvest does not create value");
    }

    // ------------------------------------------------------------------ //
    //                              Harvest                               //
    // ------------------------------------------------------------------ //

    /// @dev The documented default: no router on Mezo yet, so BTC is held and valued via the
    ///      oracle. The vault is then partly BTC-denominated, which is a real exposure.
    function test_harvest_withNoRouter_holdsBtcAndCountsIt() public {
        _deposit(alice, 10_000e18);
        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        assertEq(address(earn.swapRouter()), address(0), "router unset by default");

        vm.prank(keeper);
        (uint256 claimed, uint256 compounded) = earn.harvest(0, block.timestamp + 1);

        assertApproxEqRel(claimed, btcGain, 1e12);
        assertEq(compounded, 0, "nothing converted without a router");
        assertEq(address(earn).balance, claimed, "BTC held in the vault");

        (,, uint256 btcHeld,, uint256 btcValued) = earn.assetBreakdown();
        assertEq(btcHeld, claimed);
        assertApproxEqRel(btcValued, 1_100e18, 1e12, "held BTC is valued at the oracle price");
    }

    function test_harvest_withRouter_convertsAndCompounds() public {
        _deposit(alice, 10_000e18);
        vm.prank(admin);
        earn.setSwapRouter(address(router));

        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        vm.prank(keeper);
        (, uint256 compounded) = earn.harvest(1_000e18, block.timestamp + 1);

        assertApproxEqRel(compounded, 1_100e18, 1e12);
        assertEq(address(earn).balance, 0, "all BTC converted");
        assertApproxEqRel(pool.getCompoundedMUSDDeposit(address(earn)), 10_100e18, 1e12);
    }

    function test_harvest_takesThePerformanceFee() public {
        _deposit(alice, 10_000e18);
        vm.startPrank(admin);
        earn.setSwapRouter(address(router));
        earn.setPerformanceFee(1000, treasury); // 10%
        vm.stopPrank();

        uint256 btcGain = (1_000e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(500e18);

        vm.prank(keeper);
        earn.harvest(0, block.timestamp + 1);

        assertApproxEqRel(musd.balanceOf(treasury), 100e18, 1e12, "10% of the converted MUSD");
    }

    /// @dev The router is untrusted for value. `harvest` measures its OWN balance rather than
    ///      believing the router's return value, so a router that reports a swap it did not
    ///      perform reverts the whole harvest.
    function test_harvest_rejectsARouterThatDoesNotDeliver() public {
        _deposit(alice, 10_000e18);
        vm.prank(admin);
        earn.setSwapRouter(address(router));
        router.setRug(true);

        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarenEarn.SwapReturnedTooLittle.selector, 0, 1_000e18));
        earn.harvest(1_000e18, block.timestamp + 1);
    }

    function testRevert_harvest_withoutKeeperRole() public {
        bytes32 role = earn.KEEPER_ROLE();
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, role)
        );
        earn.harvest(0, block.timestamp + 1);
    }

    // ------------------------------------------------------------------ //
    //                          Oracle behaviour                          //
    // ------------------------------------------------------------------ //

    /**
     * @notice `totalAssets()` must never revert. Every preview and every redemption depends on
     *         it, and Mezo's oracle can simply stop for a minute at a time.
     */
    function test_totalAssets_neverRevertsWhenTheOracleIsDown() public {
        _deposit(alice, 10_000e18);
        uint256 btcGain = (1_100e18 * 1e18) / BTC_PRICE;
        vm.deal(address(this), btcGain);
        pool.offset{value: btcGain}(1_000e18);

        vm.prank(keeper);
        earn.harvest(0, block.timestamp + 1); // caches the price

        priceFeed.setStale(true);
        assertTrue(earn.isUsingStalePrice());

        uint256 assets = earn.totalAssets(); // must not revert
        assertGt(assets, 0);
        assertEq(earn.lastObservedBtcPrice(), BTC_PRICE, "fell back to the cached price");

        // And redemption still works while the oracle is down.
        uint256 half = earn.balanceOf(alice) / 2;
        vm.prank(alice);
        earn.redeem(half, alice, alice);
    }

    /// @dev If a price has never been observed, held BTC is valued at ZERO. That understates
    ///      the vault, which costs a redeemer and protects everyone who stays — the only safe
    ///      direction to be wrong in.
    function test_btcValuedAtZeroWhenNoPriceHasEverBeenObserved() public {
        _deposit(alice, 10_000e18);
        priceFeed.setStale(true);

        vm.deal(address(earn), 1 ether);
        assertEq(earn.lastObservedBtcPrice(), 0);
        assertEq(earn.totalAssets(), 10_000e18, "unpriceable BTC contributes nothing");

        priceFeed.setStale(false);
        earn.pokePrice();
        assertEq(earn.lastObservedBtcPrice(), BTC_PRICE);
        assertApproxEqRel(earn.totalAssets(), 10_000e18 + BTC_PRICE, 1e12);
    }

    // ------------------------------------------------------------------ //
    //                            Governance                              //
    // ------------------------------------------------------------------ //

    function testRevert_setPerformanceFee_aboveCap() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MarenEarn.FeeTooHigh.selector, 2001, 2000));
        earn.setPerformanceFee(2001, treasury);
    }

    function testRevert_setPerformanceFee_zeroRecipient() public {
        vm.prank(admin);
        vm.expectRevert(MarenEarn.ZeroAddress.selector);
        earn.setPerformanceFee(100, address(0));
    }

    function testRevert_governance_withoutAdminRole() public {
        bytes memory err =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, bytes32(0));
        vm.startPrank(bob);
        vm.expectRevert(err);
        earn.setSwapRouter(address(router));
        vm.expectRevert(err);
        earn.setPerformanceFee(100, treasury);
        vm.expectRevert(err);
        earn.setDepositCap(1);
        vm.expectRevert(err);
        earn.emergencyWithdrawFromStabilityPool(1);
        vm.stopPrank();
    }

    function test_depositCap_isEnforcedThroughMaxDeposit() public {
        vm.prank(admin);
        earn.setDepositCap(5_000e18);

        assertEq(earn.maxDeposit(alice), 5_000e18);
        _deposit(alice, 5_000e18);
        assertEq(earn.maxDeposit(alice), 0);

        vm.prank(bob);
        vm.expectRevert();
        earn.deposit(1e18, bob);
    }

    /// @dev De-risking lever, not a withdrawal path: MUSD moves out of the Stability Pool but
    ///      stays in the vault, so `totalAssets()` is unchanged and users can still redeem.
    function test_emergencyWithdraw_leavesTotalAssetsAndRedemptionsIntact() public {
        _deposit(alice, 10_000e18);
        uint256 before = earn.totalAssets();

        vm.prank(admin);
        earn.emergencyWithdrawFromStabilityPool(type(uint256).max);

        assertEq(earn.totalAssets(), before, "value did not move, only its location");
        assertEq(musd.balanceOf(address(earn)), 10_000e18);
        assertEq(pool.getCompoundedMUSDDeposit(address(earn)), 0);

        uint256 shares = earn.balanceOf(alice);
        vm.prank(alice);
        earn.redeem(shares, alice, alice);
        assertEq(musd.balanceOf(alice), 100_000e18);
    }
}
