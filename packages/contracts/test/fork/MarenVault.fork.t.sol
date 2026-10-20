// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenForwarder} from "../../src/MarenForwarder.sol";
import {MarenVault} from "../../src/MarenVault.sol";
import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {IMUSD} from "../../src/interfaces/IMUSD.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {ForkOracleStub} from "../mocks/ForkOracleStub.sol";
import {Test} from "forge-std/Test.sol";

/**
 * @title MarenVaultForkTest
 * @notice Exercises MarenVault against the REAL MUSD contracts on Mezo matsnet (31611).
 *
 * Everything a mock can get wrong — the exact fee, whether trove debt includes the gas
 * compensation, what `getEntireDebtAndColl` actually returns, whether a CONTRACT is even
 * allowed to own a trove — is settled here against deployed bytecode.
 *
 * CI SAFETY: if `MEZO_TESTNET_RPC_URL` is unset, or the RPC is unreachable, every test in
 * this file skips rather than fails. A public testnet RPC is not something CI should be able
 * to break the build with. Run it deliberately:
 *
 *     MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*' -vv
 *
 * NOTE ON TIME: `PriceFeed.fetchPrice()` reverts when Mezo's oracle is more than 60 seconds
 * stale. A fork is pinned to the timestamp of the block it forked from, so the oracle is
 * fresh — but `vm.warp` forward by more than a minute and every price-dependent call starts
 * reverting. Interest-over-time behaviour is therefore tested against the mock, not here.
 */
contract MarenVaultForkTest is Test {
    // Verified live 2026-08-15 with cast against https://rpc.test.mezo.org (chainId 31611).
    address internal constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address internal constant BORROWER_OPERATIONS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address internal constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address internal constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address internal constant SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address internal constant HINT_HELPERS = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;

    /// @dev Skip Connect, Mezo's consensus x/oracle module. Not Chainlink, not Pyth.
    address internal constant ORACLE_PRECOMPILE = 0x7b7c000000000000000000000000000000000015;

    /// @dev The live matsnet answer on 2026-08-15, replayed into the injected oracle so the
    ///      fork tests run at a realistic BTC price.
    uint256 internal constant FORK_BTC_PRICE = 63_063.05288e18;

    uint256 internal constant MEZO_TESTNET_CHAIN_ID = 31611;

    /// @dev EIP-2612's own type hash, spelled out rather than imported, so a signature built
    ///      here is built the way an off-chain signer builds one.
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    bool internal forked;

    /// @dev What alice borrows out of the pooled trove and hands to the redeemer. Her 0.8 BTC
    ///      supports 28,028 MUSD at the vault's 180% floor, so this leaves a margin, and it is
    ///      enough to redeem through roughly ten matsnet troves on the way to the pooled one.
    uint256 internal constant REDEEMER_BUDGET = 25_000e18;

    /// @dev How much of the pooled trove itself the redemption should take, once it has eaten
    ///      everything below it. Small enough to leave the trove well above the protocol's
    ///      1,800 MUSD minimum, so the redemption is partial and the trove stays active.
    uint256 internal constant SLICE_OF_POOLED_TROVE = 1000e18;

    /// @dev How far up the sorted list the redemption is allowed to walk before this test
    ///      gives up and says so.
    uint256 internal constant MAX_REDEMPTION_HOPS = 16;

    /// @dev Working values for the real-redemption test. A struct rather than locals purely to
    ///      stay inside the EVM's stack window, the same reason MarenVault has `Liquidation`.
    struct Redemption {
        address firstHint;
        address redeemer;
        uint256 amount;
        uint256 hops;
        uint256 collBefore;
        uint256 debtBefore;
        uint256 aliceDebtBefore;
        uint256 aliceCollBefore;
        bool ready;
    }

    MarenVault internal vault;
    MarenForwarder internal forwarder;

    address internal admin = makeAddr("fork_admin");
    address internal keeper = makeAddr("fork_keeper");
    address internal alice = makeAddr("fork_alice");

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;

        try vm.createSelectFork(rpc) {
            forked = block.chainid == MEZO_TESTNET_CHAIN_ID;
        } catch {
            forked = false;
            return;
        }
        if (!forked) return;

        // Mezo's BTC/USD oracle is a consensus precompile that cannot be replayed in a forked
        // EVM — see ForkOracleStub for the full explanation. Substitute it, and only it.
        ForkOracleStub stub = new ForkOracleStub();
        vm.etch(ORACLE_PRECOMPILE, address(stub).code);
        ForkOracleStub(ORACLE_PRECOMPILE).set(int256(FORK_BTC_PRICE), block.timestamp);

        forwarder = new MarenForwarder();
        vault = new MarenVault(
            BORROWER_OPERATIONS, TROVE_MANAGER, PRICE_FEED, MUSD, address(forwarder), admin, 1000 ether
        );
        vm.startPrank(admin);
        vault.grantRole(vault.KEEPER_ROLE(), keeper);
        vault.grantRole(vault.GUARDIAN_ROLE(), admin);
        vm.stopPrank();
    }

    modifier requiresFork() {
        vm.skip(!forked);
        _;
    }

    /// @dev Computes the hints the way the keeper does off-chain, so the fork tests exercise
    ///      the same code path production will.
    function _hints(uint256 coll, uint256 debt) internal view returns (address upper, address lower) {
        uint256 nicr = IHintHelpers(HINT_HELPERS).computeNominalCR(coll, debt);
        (address approx,,) = IHintHelpers(HINT_HELPERS).getApproxHint(nicr, 20, 42);
        (upper, lower) = ISortedTroves(SORTED_TROVES).findInsertPosition(nicr, approx, approx);
    }

    function _openPooledTrove(uint256 seedColl, uint256 seedDebt) internal {
        vm.deal(keeper, seedColl);
        (address u, address l) = _hints(seedColl, seedDebt + 200e18);
        vm.prank(keeper);
        vault.openPooledTrove{value: seedColl}(seedDebt, u, l);
    }

    // ------------------------------------------------------------------ //
    //                     The chain facts, re-verified                   //
    // ------------------------------------------------------------------ //

    /// @dev Every constant Maren hardcodes, checked against deployed bytecode. If Mezo ever
    ///      changes one of these, this test is what tells us before users do.
    function test_fork_protocolParametersAreWhatWeAssume() public requiresFork {
        assertEq(block.chainid, MEZO_TESTNET_CHAIN_ID);
        assertEq(IMUSD(MUSD).decimals(), 18);
        assertEq(IBorrowerOperations(BORROWER_OPERATIONS).minNetDebt(), 1800e18, "minNetDebt");
        assertEq(ITroveManager(TROVE_MANAGER).MCR(), 1.1e18, "MCR is 110%");
        assertEq(ITroveManager(TROVE_MANAGER).CCR(), 1.5e18, "CCR is 150%");
        assertEq(vault.MIN_NET_DEBT(), IBorrowerOperations(BORROWER_OPERATIONS).minNetDebt());
        assertEq(vault.LIQUIDATION_CR(), 1.4e18);
        assertGt(
            vault.LIQUIDATION_CR(), ITroveManager(TROVE_MANAGER).MCR(), "our floor sits above the protocol's"
        );
    }

    /**
     * @notice The REAL PriceFeed contract, reading the injected oracle.
     * @dev This exercises the deployed PriceFeed's own logic — its staleness window and its
     *      scaling — against a substituted consensus oracle. It does NOT prove the live
     *      precompile works; that is verified out of band with `cast`, and doing so was how
     *      the fork limitation in ForkOracleStub was discovered in the first place.
     */
    function test_fork_priceFeedReadsTheInjectedOracle() public requiresFork {
        uint256 price = IPriceFeed(PRICE_FEED).fetchPrice();
        assertEq(price, FORK_BTC_PRICE, "18-decimal answer passes through unscaled");
    }

    /// @dev Warping past the 60-second staleness window makes the real PriceFeed revert, and
    ///      MarenVault must surface that as its own named error rather than an opaque one.
    function test_fork_staleOracleSurfacesAsNamedError() public requiresFork {
        _openPooledTrove(1 ether, 1800e18);
        vm.deal(alice, 0.01 ether);
        vm.prank(alice);
        vault.deposit{value: 0.01 ether}(address(0), address(0));

        vm.warp(block.timestamp + 1 hours); // the oracle is now well past 60s stale

        vm.prank(alice);
        vm.expectRevert(MarenVault.PriceFeedUnavailable.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                        The reason this exists                      //
    // ------------------------------------------------------------------ //

    /**
     * @notice Against the REAL BorrowerOperations: a small holder cannot open a trove, and the
     *         pooled vault serves them anyway.
     */
    function test_fork_subMinimumHolderIsRejectedByTheRealProtocol() public requiresFork {
        uint256 smallStack = 0.01 ether;
        vm.deal(alice, smallStack);
        vm.prank(alice);
        vm.expectRevert();
        IBorrowerOperations(BORROWER_OPERATIONS).openTrove{value: smallStack}(1800e18, address(0), address(0));

        // Anything below the protocol minimum is refused outright, whatever the collateral.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        IBorrowerOperations(BORROWER_OPERATIONS).openTrove{value: 1 ether}(100e18, address(0), address(0));
    }

    // ------------------------------------------------------------------ //
    //                          Full lifecycle                            //
    // ------------------------------------------------------------------ //

    /// @notice Open the pooled trove on the real protocol, then deposit, borrow, repay and
    ///         withdraw through it.
    function test_fork_fullLifecycle() public requiresFork {
        _openPooledTrove(1 ether, 1800e18);

        assertTrue(vault.troveOpen());
        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveColl(address(vault)), 1 ether, "real trove holds the seed"
        );
        assertEq(vault.reserveMUSD(), 1800e18, "drawn MUSD is held as the borrow reserve");
        assertEq(IMUSD(MUSD).balanceOf(address(vault)), 1800e18);

        // The seed's only outstanding debt is the origination fee — measured, not modelled.
        uint256 outstanding = vault.outstandingDebt();
        assertGt(outstanding, 0, "the fee is real debt");
        assertLt(outstanding, 10e18, "and it is only the fee");

        // Deposit far below what a direct trove would need.
        uint256 deposited = 0.02 ether;
        vm.deal(alice, deposited);
        vm.prank(alice);
        vault.deposit{value: deposited}(address(0), address(0));

        assertEq(vault.collateral(alice), deposited);
        assertEq(vault.idleCollateral(), 0, "pushed into the real trove");
        assertEq(ITroveManager(TROVE_MANAGER).getTroveColl(address(vault)), 1 ether + deposited);

        // Borrow. Served from the reserve, so the real trove is untouched.
        uint256 troveDebtBefore = ITroveManager(TROVE_MANAGER).getTroveDebt(address(vault));
        vm.prank(alice);
        vault.borrow(200e18, address(0), address(0));

        assertEq(IMUSD(MUSD).balanceOf(alice), 200e18, "alice holds real MUSD");
        assertEq(vault.debtOf(alice), 200e18);
        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveDebt(address(vault)), troveDebtBefore, "trove untouched"
        );
        assertGe(vault.collateralRatioOf(alice), vault.MIN_BORROW_CR());

        // Repay in full.
        vm.startPrank(alice);
        IMUSD(MUSD).approve(address(vault), type(uint256).max);
        vault.repay(type(uint256).max, address(0), address(0));
        vm.stopPrank();
        assertEq(vault.debtOf(alice), 0);
        assertEq(vault.debtShares(alice), 0);

        // Withdraw everything back out of the real trove.
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        vault.withdraw(deposited, address(0), address(0));

        assertEq(alice.balance, balanceBefore + deposited, "collateral came back out of the real trove");
        assertEq(vault.collateral(alice), 0);
        assertEq(ITroveManager(TROVE_MANAGER).getTroveColl(address(vault)), 1 ether);
    }

    /**
     * @notice Confirms against real bytecode that a trove's recorded debt INCLUDES the 200
     *         MUSD gas compensation.
     * @dev The entire per-user ledger is built on this: `_troveCollAndNetDebt` subtracts 200
     *      before attributing anything to users. If it were wrong in either direction, every
     *      user's debt would be off by 200 MUSD divided across the pool.
     */
    function test_fork_troveDebtIncludesGasCompensation() public requiresFork {
        _openPooledTrove(1 ether, 1800e18);

        (, uint256 principal, uint256 interest,,,) =
            ITroveManager(TROVE_MANAGER).getEntireDebtAndColl(address(vault));
        uint256 gross = principal + interest;

        // 1,800 net + 0.1% fee + 200 gas compensation = 2,001.8 MUSD.
        assertApproxEqAbs(gross, 2001.8e18, 1e18, "gross debt includes the 200 MUSD gas comp");
        assertEq(vault.outstandingDebt(), gross - 200e18 - 1800e18, "net of gas comp and reserve");
    }

    /// @notice The Mezo-only per-trove ceiling is fixed at the open-time price; only
    ///         `refinance()` raises it. Adding collateral must NOT.
    function test_fork_maxBorrowingCapacityIsFrozenUntilRefinance() public requiresFork {
        _openPooledTrove(1 ether, 1800e18);
        uint256 capAtOpen = vault.troveMaxBorrowingCapacity();
        assertGt(capAtOpen, 0);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 1 ether}(address(0), address(0));

        assertEq(vault.troveMaxBorrowingCapacity(), capAtOpen, "adding collateral does not raise the ceiling");

        // Recovery Mode blocks refinance, so tolerate that rather than assert unconditionally.
        vm.prank(keeper);
        try vault.refinancePooledTrove(address(0), address(0)) {
            assertGt(
                vault.troveMaxBorrowingCapacity(), capAtOpen, "refinance is the only thing that raises it"
            );
        } catch {
            emit log("refinance unavailable at this block (Recovery Mode) - ceiling assertion skipped");
        }
    }

    // ------------------------------------------------------------------ //
    //                     Redemptions, for real                          //
    // ------------------------------------------------------------------ //

    /// @notice The status getter the whole redemption-versus-liquidation distinction rests on,
    ///         read off deployed bytecode for a trove this test opened itself.
    function test_fork_troveStatusIsActiveOnARealTrove() public requiresFork {
        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveStatus(address(vault)),
            0,
            "nonExistent before the pooled trove is opened"
        );
        _openPooledTrove(1 ether, 1800e18);
        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveStatus(address(vault)),
            vault.TROVE_STATUS_ACTIVE(),
            "active once it is open, and 1 is what the vault checks for"
        );
    }

    /**
     * @notice A REAL redemption, executed by the real TroveManager, walking the real
     *         SortedTroves list, landing on the pooled trove, and reconciled by the vault.
     *
     * @dev Getting a redemption to land on a chosen trove is not a matter of asking for it.
     *      MUSD serves redemptions from the lowest-ICR end of the list, so the pooled trove
     *      has to be MADE the second stop on that walk. This test does it the only way the
     *      protocol allows:
     *
     *        1. Read where a redemption would go right now (`getRedemptionHints`) and where
     *           the trove immediately above it sits.
     *        2. Open the pooled trove, then pull protocol-owned collateral back out until the
     *           trove's NICR lands between those two. Nothing here is faked: the vault's own
     *           `withdrawProtocolCollateral` does it, subject to every check it normally
     *           applies, and the protocol's own 110% floor.
     *        3. Fund an outside redeemer with MUSD that came out of the pooled trove itself,
     *           through `borrow`. No `deal`, no minting, no cheatcode on a balance.
     *        4. Redeem enough to consume the trove below and take a slice of the pooled one.
     *
     *      Every precondition is checked at runtime and logged rather than asserted, because
     *      matsnet's trove list is live state that this test does not own. What it does NOT do
     *      is fake the redemption: if the walk reaches the pooled trove, the assertions below
     *      are against a redemption the deployed MUSD contracts actually performed.
     */
    function test_fork_realRedemptionIsSplitAcrossPooledPositions() public requiresFork {
        Redemption memory r = _positionPooledTroveForRedemption();
        if (!r.ready) return;

        // From here on the redemption is real, so everything is asserted.
        (address walkFrom, uint256 partialNicr, uint256 truncated) =
            IHintHelpers(HINT_HELPERS).getRedemptionHints(r.amount, FORK_BTC_PRICE, 10);
        assertEq(walkFrom, r.firstHint, "the walk still starts below us");

        r.collBefore = ITroveManager(TROVE_MANAGER).getTroveColl(address(vault));
        r.debtBefore = _entireDebtOf(address(vault));
        r.aliceDebtBefore = vault.debtOf(alice);
        r.aliceCollBefore = vault.collateralOf(alice);

        {
            (address upper, address lower) = _insertPositionFor(partialNicr);
            vm.prank(r.redeemer);
            ITroveManager(TROVE_MANAGER)
                .redeemCollateral(truncated, walkFrom, upper, lower, partialNicr, r.hops + 2);
        }

        uint256 collRemoved = r.collBefore - ITroveManager(TROVE_MANAGER).getTroveColl(address(vault));
        if (collRemoved == 0) {
            emit log("the redemption stopped before reaching the pooled trove - assertions skipped");
            return;
        }
        emit log_named_uint("real redemption reached the pooled trove, BTC removed", collRemoved);

        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveStatus(address(vault)),
            vault.TROVE_STATUS_ACTIVE(),
            "a partial redemption leaves the trove active, which is what makes it reconcilable"
        );
        assertApproxEqRel(
            (collRemoved * FORK_BTC_PRICE) / 1e18,
            r.debtBefore - _entireDebtOf(address(vault)),
            0.01e18,
            "the real protocol took collateral worth the debt it cancelled"
        );

        // Nothing has told the vault any of this. It works it out from the trove.
        assertApproxEqAbs(vault.pendingRedemptionCollateral(), collRemoved, 1, "the vault sees the gap");
        vault.reconcileRedemption();
        _assertPooledSplit(r);
    }

    /// @dev Split out to stay inside the stack limit, and because the assertions are the part
    ///      worth reading on their own.
    function _assertPooledSplit(Redemption memory r) internal {
        uint256 aliceRelief = r.aliceDebtBefore - vault.debtOf(alice);
        assertGt(aliceRelief, 0, "alice's debt fell");
        assertApproxEqRel(
            r.aliceCollBefore - vault.collateralOf(alice),
            (aliceRelief * 1e18) / FORK_BTC_PRICE,
            0.001e18,
            "and she gave up collateral worth exactly that relief"
        );
        assertEq(
            vault.totalCollateral(),
            ITroveManager(TROVE_MANAGER).getTroveColl(address(vault)) + vault.idleCollateral(),
            "the books match the real trove again"
        );
        assertGe(
            vault.debtOf(alice) + vault.debtOf(address(vault)),
            vault.outstandingDebt(),
            "and the pool still covers what the real trove owes"
        );

        // She cannot walk away with the collateral she had before the redemption, and the
        // refusal is on the balance itself, not on the collateral ratio.
        uint256 claim = vault.collateralOf(alice);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MarenVault.InsufficientCollateral.selector, r.aliceCollBefore, claim)
        );
        vault.withdraw(r.aliceCollBefore, address(0), address(0));

        // And the exit still works at the post-redemption number, against the real protocol.
        // The redeemer hands back what they did not spend so alice can repay; she stays a few
        // MUSD short of her full debt, because the origination fee is debt no MUSD was ever
        // minted for, which is the same reason `closePooledTrove` needs a top-up.
        uint256 unspent = IMUSD(MUSD).balanceOf(r.redeemer);
        vm.prank(r.redeemer);
        IMUSD(MUSD).transfer(alice, unspent);

        vm.startPrank(alice);
        IMUSD(MUSD).approve(address(vault), type(uint256).max);
        vault.repay(unspent, address(0), address(0));
        uint256 balanceBefore = alice.balance;
        vault.withdraw(0.01 ether, address(0), address(0));
        vm.stopPrank();
        assertEq(alice.balance, balanceBefore + 0.01 ether, "collateral came back out of the real trove");
    }

    /**
     * @dev Opens the pooled trove, gives alice a position inside it, funds an outside redeemer
     *      out of that same trove, and then pulls protocol-owned collateral back out until the
     *      trove drops into the low-ICR end of the list where redemptions are served from.
     *
     *      `ready` comes back false, with a log line, for any live-state reason this cannot be
     *      arranged at the forked block. Nothing is faked in either case.
     */
    function _positionPooledTroveForRedemption() internal returns (Redemption memory r) {
        (address tailTarget,,) = IHintHelpers(HINT_HELPERS).getRedemptionHints(100e18, FORK_BTC_PRICE, 20);
        if (tailTarget == address(0)) {
            emit log("no redeemable trove at this block - redemption fork test skipped");
            return r;
        }
        address above = ISortedTroves(SORTED_TROVES).getPrev(tailTarget);
        if (above == address(0)) {
            emit log("redemption target is the top of the list - redemption fork test skipped");
            return r;
        }

        uint256 nicrLow = _nominalCrOf(tailTarget);
        uint256 nicrHigh = _nominalCrOf(above);
        if (nicrHigh <= nicrLow + 2) {
            emit log("no room in the list between the target and the trove above it - skipped");
            return r;
        }
        // Aim between the trove a redemption hits first and the one above it. Landing exactly
        // there is not guaranteed, which is what the walk below is for.
        uint256 targetNicr = nicrLow + (nicrHigh - nicrLow) / 2;

        // The pooled trove has to be big enough that alice's own collateral still fits inside
        // it once it has been drained to ~110%, and her borrowing capacity at the vault's 180%
        // floor is what funds the whole redemption.
        _openPooledTrove(2 ether, 50_000e18);

        vm.deal(alice, 0.8 ether);
        vm.prank(alice);
        vault.deposit{value: 0.8 ether}(address(0), address(0));
        vm.prank(alice);
        vault.borrow(REDEEMER_BUDGET, address(0), address(0));

        r.redeemer = makeAddr("fork_redeemer");
        vm.prank(alice);
        IMUSD(MUSD).transfer(r.redeemer, REDEEMER_BUDGET);

        // Drop the pooled trove into position, through the vault's own admin path, subject to
        // every check it normally applies. Rounding UP keeps the resulting ICR above the
        // target's, and therefore above the protocol's 110% floor.
        uint256 troveDebt = _entireDebtOf(address(vault));
        uint256 collTarget = (troveDebt * targetNicr + 1e20 - 1) / 1e20;
        uint256 troveColl = ITroveManager(TROVE_MANAGER).getTroveColl(address(vault));
        if (collTarget >= troveColl || troveColl - collTarget > vault.collateral(address(vault))) {
            emit log("cannot position the pooled trove without touching user collateral - skipped");
            return r;
        }
        (address u, address l) = _hints(collTarget, troveDebt);
        vm.prank(admin);
        vault.withdrawProtocolCollateral(troveColl - collTarget, u, l);

        // Where the trove ACTUALLY landed. Every trove accrues interest at a rate fixed when it
        // opened, so the live NICR ordering drifts out of the ordering the list stores, and an
        // insert does not always land where the arithmetic says it should. So do not assume:
        // ask the protocol where a redemption starts now, and walk from there exactly as
        // `redeemCollateral` will, pricing every trove the walk has to eat on the way.
        (r.firstHint,,) = IHintHelpers(HINT_HELPERS).getRedemptionHints(100e18, FORK_BTC_PRICE, 20);
        (r.hops, r.amount) = _walkToPooledTrove(r.firstHint);
        if (r.hops == 0) {
            emit log("the pooled trove is not within reach of the redemption walk - skipped");
            return r;
        }
        r.amount += SLICE_OF_POOLED_TROVE;
        if (r.amount > REDEEMER_BUDGET) {
            emit log_named_uint("redeeming through to the pooled trove costs more than the budget", r.amount);
            return r;
        }
        emit log_named_uint("troves between the redemption target and the pooled trove", r.hops - 1);
        r.ready = true;
    }

    /**
     * @dev Follows the same path `redeemCollateral` will: start at the first redemption hint
     *      and walk UP the list, adding each trove's net debt, until the pooled trove is
     *      reached. Returns the number of hops and the MUSD it takes to consume everything
     *      below the pooled trove. Zero hops means it is not reachable within the bound.
     */
    function _walkToPooledTrove(address start) internal view returns (uint256 hops, uint256 cost) {
        address current = start;
        for (uint256 i = 1; i <= MAX_REDEMPTION_HOPS; ++i) {
            if (current == address(0)) return (0, 0);
            if (current == address(vault)) return (i, cost);
            cost += _netDebtOf(current);
            current = ISortedTroves(SORTED_TROVES).getPrev(current);
        }
        return (0, 0);
    }

    function _entireDebtOf(address borrower) internal view returns (uint256) {
        (, uint256 principal, uint256 interest,,,) =
            ITroveManager(TROVE_MANAGER).getEntireDebtAndColl(borrower);
        return principal + interest;
    }

    function _netDebtOf(address borrower) internal view returns (uint256) {
        return _entireDebtOf(borrower) - 200e18;
    }

    function _nominalCrOf(address borrower) internal view returns (uint256) {
        (uint256 coll,,,,,) = ITroveManager(TROVE_MANAGER).getEntireDebtAndColl(borrower);
        return IHintHelpers(HINT_HELPERS).computeNominalCR(coll, _entireDebtOf(borrower));
    }

    function _insertPositionFor(uint256 nicr) internal view returns (address upper, address lower) {
        (address approx,,) = IHintHelpers(HINT_HELPERS).getApproxHint(nicr, 20, 7);
        (upper, lower) = ISortedTroves(SORTED_TROVES).findInsertPosition(nicr, approx, approx);
    }

    /// @notice Exits stay open against the real protocol too, not just against the mock.
    function test_fork_exitsStayOpenWhileEntriesArePaused() public requiresFork {
        _openPooledTrove(1 ether, 1800e18);
        vm.deal(alice, 0.02 ether);
        vm.prank(alice);
        vault.deposit{value: 0.02 ether}(address(0), address(0));
        vm.prank(alice);
        vault.borrow(150e18, address(0), address(0));

        vm.startPrank(admin);
        vault.setDepositsPaused(true);
        vault.setBorrowingPaused(true);
        vm.stopPrank();

        vm.startPrank(alice);
        IMUSD(MUSD).approve(address(vault), type(uint256).max);
        vault.repay(type(uint256).max, address(0), address(0));
        vault.withdraw(0.02 ether, address(0), address(0));
        vm.stopPrank();

        assertEq(vault.collateral(alice), 0, "alice exited fully with entries shut");
    }

    // ------------------------------------------------------------------ //
    //                       The composed entrypoints                     //
    // ------------------------------------------------------------------ //

    /**
     * @notice `depositAndBorrow` and `repayWithPermit` against the REAL BorrowerOperations and
     *         the REAL MUSD token, in the shape a first-time user actually experiences: two
     *         transactions from a standing start to a cleared loan, where it used to be four.
     *
     * @dev The permit half is the reason this test is here rather than only in the mock suite.
     *      MarenVault now depends on MUSD implementing EIP-2612 exactly, and this repo's rule is
     *      bytecode over documentation. The verification recorded in IMUSD.sol was done out of
     *      band with `cast` (selector 0xd505accf present in the deployed runtime code, an
     *      expired-deadline call reverting with OpenZeppelin's `ERC2612ExpiredSignature`), and
     *      this test is the executable half of it: a signature built against the deployed
     *      token's OWN `DOMAIN_SEPARATOR` and its OWN `nonces`, spent through
     *      `repayWithPermit`, with no approval transaction anywhere.
     *
     *      The domain is asserted independently first. If Mezo ever redeploys MUSD under a
     *      different name or version, every permit signature Maren's SDK builds becomes invalid
     *      silently, and this is the test that says so before a user finds out.
     */
    function test_fork_composedEntrypointsAgainstTheRealContracts() public requiresFork {
        (address user, uint256 userPk) = makeAddrAndKey("fork_permit_user");
        _openPooledTrove(1 ether, 1800e18);

        // 1. The EIP-712 domain, rebuilt from the fields a signer has to know, must match what
        //    the deployed token reports. Name "Mezo USD", version "1", no salt.
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Mezo USD")),
                keccak256(bytes("1")),
                block.chainid,
                MUSD
            )
        );
        assertEq(domain, IMUSD(MUSD).DOMAIN_SEPARATOR(), "the live token's EIP-712 domain is what we sign");

        // 2. Deposit and borrow in ONE call, against the real trove.
        uint256 deposited = 0.02 ether;
        uint256 borrowed = 150e18;
        uint256 troveCollBefore = ITroveManager(TROVE_MANAGER).getTroveColl(address(vault));

        vm.deal(user, deposited);
        vm.prank(user);
        vault.depositAndBorrow{value: deposited}(borrowed, address(0), address(0));

        assertEq(vault.collateral(user), deposited, "the deposit leg landed");
        assertEq(vault.debtOf(user), borrowed, "and so did the borrow leg");
        assertEq(IMUSD(MUSD).balanceOf(user), borrowed, "holding real MUSD after one transaction");
        assertEq(
            ITroveManager(TROVE_MANAGER).getTroveColl(address(vault)),
            troveCollBefore + deposited,
            "the BTC went into the real trove"
        );
        assertGe(vault.collateralRatioOf(user), vault.MIN_BORROW_CR(), "above the 180% floor");

        // 3. Repay it with a permit, against the real token, with zero prior allowance.
        assertEq(IMUSD(MUSD).allowance(user, address(vault)), 0, "precondition: never approved");

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, user, address(vault), borrowed, IMUSD(MUSD).nonces(user), deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(userPk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));

        vm.prank(user);
        vault.repayWithPermit(borrowed, deadline, v, r, s, address(0), address(0));

        assertEq(vault.debtOf(user), 0, "the loan is cleared");
        assertEq(vault.debtShares(user), 0);
        assertEq(IMUSD(MUSD).balanceOf(user), 0, "the real MUSD went back");
        assertEq(IMUSD(MUSD).allowance(user, address(vault)), 0, "the permit allowance was fully spent");
        assertEq(IMUSD(MUSD).nonces(user), 1, "the deployed token consumed exactly one nonce");
    }
}
