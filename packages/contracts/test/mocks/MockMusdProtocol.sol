// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {MockMUSD} from "./MockMUSD.sol";

/**
 * @title MockMusdProtocol
 * @notice A single contract that plays both BorrowerOperations and TroveManager, so a test
 *         can hand MarenVault the same address for each.
 *
 * It reproduces the behaviours MarenVault's accounting actually depends on, and no more:
 *  - native BTC collateral via `msg.value`, no ERC-20 approve step
 *  - trove debt = principal + interest, principal INCLUDING the 200e18 gas compensation
 *  - a 0.1% origination fee added to debt on open and on every `withdrawMUSD`
 *  - 1% APR SIMPLE interest on principal, accrued from the last touch
 *  - net debt may never be repaid below 1,800e18 without closing
 *  - every mutating call reads the price feed first, so a stale oracle reverts it
 *  - `getEntireDebtAndColl` returns SIX values, as Mezo's does, not Liquity's four
 *
 *  - `redeemCollateral` swaps MUSD for trove collateral at the oracle price, taking the full
 *    collateral out of the trove and handing the redeemer that amount less the 0.75% fee,
 *    which is what the real one does to the trove it lands on
 *
 * It is deliberately NOT a full fork of MUSD. Redistributions and Recovery Mode are out of
 * scope here, which is what the matsnet fork tests are for. What this buys is the ability to
 * fast-forward a year of interest, crash the BTC price 40%, stale the oracle, and aim a
 * redemption at a chosen trove, none of which can be done against a live chain.
 *
 * The redemption here is aimed by `_firstRedemptionHint` rather than by walking SortedTroves,
 * because there is only ever one trove in this mock. Walking the real sorted list, and being
 * bound by where the pooled trove actually sits in it, is what the fork test covers.
 */
contract MockMusdProtocol is IBorrowerOperations, ITroveManager {
    struct Trove {
        uint256 coll;
        uint256 principal; // includes gas compensation
        uint256 interest;
        uint256 lastAccrued;
        uint256 maxBorrowingCapacity;
        bool active;
        uint256 status;
    }

    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant MIN_NET_DEBT = 1800e18;
    uint256 public constant BORROWING_RATE = 1e15; // 0.1%
    uint256 public constant INTEREST_RATE_BPS = 100; // 1% APR simple
    uint256 public constant ONE_YEAR = 365 days;
    uint256 public constant REDEMPTION_FEE_BPS = 75; // 0.75%, paid by the redeemer

    /// @dev Liquity's status enum, as the real TroveManager reports it.
    uint256 public constant STATUS_NON_EXISTENT = 0;
    uint256 public constant STATUS_ACTIVE = 1;
    uint256 public constant STATUS_CLOSED_BY_OWNER = 2;
    uint256 public constant STATUS_CLOSED_BY_LIQUIDATION = 3;
    uint256 public constant STATUS_CLOSED_BY_REDEMPTION = 4;

    MockMUSD public immutable musd;
    IPriceFeed public immutable priceFeed;

    mapping(address => Trove) private _troves;
    uint256 public totalColl;
    uint256 public totalDebt;

    error TroveNotActive();
    error TroveIsActive();
    error BelowMinNetDebt();
    error IcrBelowMcr(uint256 icr);
    error NotEnoughCollateral();
    error MaxBorrowingCapacityExceeded();
    error RedemptionExceedsTroveDebt();

    constructor(MockMUSD musd_, IPriceFeed priceFeed_) {
        musd = musd_;
        priceFeed = priceFeed_;
    }

    receive() external payable {}

    // --------------------------- BorrowerOperations --------------------------- //

    function openTrove(uint256 _debtAmount, address, address) external payable {
        Trove storage t = _troves[msg.sender];
        if (t.active) revert TroveIsActive();
        if (_debtAmount < MIN_NET_DEBT) revert BelowMinNetDebt();
        uint256 price = priceFeed.fetchPrice();

        uint256 fee = (_debtAmount * BORROWING_RATE) / 1e18;
        t.coll = msg.value;
        t.principal = _debtAmount + fee + GAS_COMPENSATION;
        t.interest = 0;
        t.lastAccrued = block.timestamp;
        t.active = true;
        t.status = STATUS_ACTIVE;
        // Mezo freezes this at the OPEN-TIME price. Adding collateral never raises it.
        t.maxBorrowingCapacity = (msg.value * price) / 1.1e18;

        _requireIcr(t, price);
        totalColl += msg.value;
        totalDebt += t.principal;
        musd.mint(msg.sender, _debtAmount);
    }

    function addColl(address, address) external payable {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        uint256 price = priceFeed.fetchPrice(); // reverts when stale, exactly like the real one
        _accrue(t);
        t.coll += msg.value;
        totalColl += msg.value;
        _requireIcr(t, price);
    }

    function withdrawColl(uint256 _amount, address, address) external {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        uint256 price = priceFeed.fetchPrice();
        _accrue(t);
        if (_amount > t.coll) revert NotEnoughCollateral();
        t.coll -= _amount;
        totalColl -= _amount;
        _requireIcr(t, price);
        (bool ok,) = msg.sender.call{value: _amount}("");
        require(ok, "coll transfer failed");
    }

    function withdrawMUSD(uint256 _amount, address, address) external {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        uint256 price = priceFeed.fetchPrice();
        _accrue(t);
        uint256 fee = (_amount * BORROWING_RATE) / 1e18;
        t.principal += _amount + fee;
        totalDebt += _amount + fee;
        if (t.principal - GAS_COMPENSATION > t.maxBorrowingCapacity) revert MaxBorrowingCapacityExceeded();
        _requireIcr(t, price);
        musd.mint(msg.sender, _amount);
    }

    function repayMUSD(uint256 _amount, address, address) external {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        priceFeed.fetchPrice();
        _accrue(t);
        uint256 netDebt = t.principal + t.interest - GAS_COMPENSATION;
        if (netDebt < _amount || netDebt - _amount < MIN_NET_DEBT) revert BelowMinNetDebt();

        musd.burn(msg.sender, _amount);
        // Interest first, then principal — the order MUSD itself uses.
        uint256 fromInterest = _amount < t.interest ? _amount : t.interest;
        t.interest -= fromInterest;
        uint256 fromPrincipal = _amount - fromInterest;
        t.principal -= fromPrincipal;
        totalDebt -= _amount;
    }

    function closeTrove() external {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        priceFeed.fetchPrice();
        _accrue(t);
        uint256 netDebt = t.principal + t.interest - GAS_COMPENSATION;
        musd.burn(msg.sender, netDebt);

        uint256 coll = t.coll;
        totalColl -= coll;
        totalDebt -= (t.principal + t.interest);
        delete _troves[msg.sender];
        _troves[msg.sender].status = STATUS_CLOSED_BY_OWNER;

        (bool ok,) = msg.sender.call{value: coll}("");
        require(ok, "coll transfer failed");
    }

    /**
     * @notice Redeem `_amount` MUSD against the trove named by `_firstRedemptionHint`.
     * @dev The trove loses `_amount` of debt and `_amount / price` of collateral, which is why
     *      a redemption is value neutral for the trove at the moment it lands. The redeemer
     *      pays the 0.75% fee out of the collateral they receive, so the fee is NOT a loss to
     *      the trove and must not show up in the vault's reconciliation.
     *
     *      The hint arguments the real protocol needs for a partial redemption are accepted
     *      and ignored: with one trove there is no list to walk and no insert position to fix.
     */
    function redeemCollateral(
        uint256 _amount,
        address _firstRedemptionHint,
        address,
        address,
        uint256,
        uint256
    ) external {
        Trove storage t = _troves[_firstRedemptionHint];
        if (!t.active) revert TroveNotActive();
        uint256 price = priceFeed.fetchPrice();
        _accrue(t);

        uint256 netDebt = t.principal + t.interest - GAS_COMPENSATION;
        if (_amount > netDebt) revert RedemptionExceedsTroveDebt();

        uint256 collDrawn = (_amount * 1e18) / price;
        if (collDrawn > t.coll) revert NotEnoughCollateral();

        musd.burn(msg.sender, _amount);
        uint256 fromInterest = _amount < t.interest ? _amount : t.interest;
        t.interest -= fromInterest;
        t.principal -= (_amount - fromInterest);
        t.coll -= collDrawn;
        totalDebt -= _amount;
        totalColl -= collDrawn;

        uint256 fee = (collDrawn * REDEMPTION_FEE_BPS) / 10_000;
        (bool ok,) = msg.sender.call{value: collDrawn - fee}("");
        require(ok, "redemption transfer failed");
    }

    /// @notice Test hook: the pooled trove is liquidated by the protocol. Collateral and debt
    ///         both leave, and the status stops being `active`. On the vault's collateral
    ///         ledger this is indistinguishable from a redemption, which is the entire reason
    ///         MarenVault reads the status instead of inferring it.
    function liquidateTrove(address borrower) external {
        Trove storage t = _troves[borrower];
        totalColl -= t.coll;
        totalDebt -= (t.principal + t.interest);
        t.coll = 0;
        t.principal = 0;
        t.interest = 0;
        t.active = false;
        t.status = STATUS_CLOSED_BY_LIQUIDATION;
    }

    /// @notice Test hook: a redemption large enough to consume the trove entirely. The real
    ///         protocol closes it and leaves the surplus collateral in the CollSurplusPool.
    function fullyRedeemTrove(address borrower) external {
        Trove storage t = _troves[borrower];
        totalDebt -= (t.principal + t.interest);
        t.principal = 0;
        t.interest = 0;
        t.active = false;
        t.status = STATUS_CLOSED_BY_REDEMPTION;
    }

    function refinance(address, address) external {
        Trove storage t = _troves[msg.sender];
        if (!t.active) revert TroveNotActive();
        uint256 price = priceFeed.fetchPrice();
        _accrue(t);
        // Docs say 0.1%; the code takes 0.1% of 20% of old net debt. We follow the code.
        uint256 netDebt = t.principal + t.interest - GAS_COMPENSATION;
        uint256 fee = (((netDebt * 2000) / 10_000) * BORROWING_RATE) / 1e18;
        t.principal += fee;
        totalDebt += fee;
        t.maxBorrowingCapacity = (t.coll * price) / 1.1e18;
    }

    function claimCollateral() external pure {
        return;
    }

    function adjustTrove(uint256, uint256, bool, address, address) external payable {
        revert("MockMusdProtocol: adjustTrove not used by MarenVault");
    }

    function minNetDebt() external pure returns (uint256) {
        return MIN_NET_DEBT;
    }

    // ------------------------------ TroveManager ------------------------------ //

    function getTroveColl(address b) external view returns (uint256) {
        return _troves[b].coll;
    }

    function getTroveStatus(address b) external view returns (uint256) {
        return _troves[b].status;
    }

    function getTroveDebt(address b) external view returns (uint256) {
        Trove storage t = _troves[b];
        return t.principal + t.interest + _pendingInterest(t);
    }

    function getTroveMaxBorrowingCapacity(address b) external view returns (uint256) {
        return _troves[b].maxBorrowingCapacity;
    }

    function getCurrentICR(address b, uint256 _price) public view returns (uint256) {
        Trove storage t = _troves[b];
        uint256 debt = t.principal + t.interest + _pendingInterest(t);
        if (debt == 0) return type(uint256).max;
        return (t.coll * _price) / debt;
    }

    function getTCR(uint256 _price) external view returns (uint256) {
        if (totalDebt == 0) return type(uint256).max;
        return (totalColl * _price) / totalDebt;
    }

    function checkRecoveryMode(uint256 _price) external view returns (bool) {
        if (totalDebt == 0) return false;
        return (totalColl * _price) / totalDebt < 1.5e18;
    }

    function getEntireDebtAndColl(address b)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        Trove storage t = _troves[b];
        return (t.coll, t.principal, t.interest + _pendingInterest(t), 0, 0, 0);
    }

    function MCR() external pure returns (uint256) {
        return 1.1e18;
    }

    function CCR() external pure returns (uint256) {
        return 1.5e18;
    }

    // -------------------------------- Internals ------------------------------- //

    function _pendingInterest(Trove storage t) private view returns (uint256) {
        if (!t.active) return 0;
        uint256 dt = block.timestamp - t.lastAccrued;
        if (dt == 0) return 0;
        return (t.principal * INTEREST_RATE_BPS * dt) / (10_000 * ONE_YEAR);
    }

    function _accrue(Trove storage t) private {
        t.interest += _pendingInterest(t);
        t.lastAccrued = block.timestamp;
    }

    function _requireIcr(Trove storage t, uint256 price) private view {
        uint256 debt = t.principal + t.interest;
        if (debt == 0) return;
        uint256 icr = (t.coll * price) / debt;
        if (icr < 1.1e18) revert IcrBelowMcr(icr);
    }
}
