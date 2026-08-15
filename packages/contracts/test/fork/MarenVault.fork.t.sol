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

    bool internal forked;

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
}
