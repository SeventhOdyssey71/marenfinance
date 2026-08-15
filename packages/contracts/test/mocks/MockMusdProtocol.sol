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
 * It is deliberately NOT a full fork of MUSD. Redistributions, Recovery Mode and redemptions
 * are out of scope here — that is what the matsnet fork tests are for. What this buys is the
 * ability to fast-forward a year of interest, crash the BTC price 40%, and stale the oracle,
 * none of which can be done against a live chain.
 */
contract MockMusdProtocol is IBorrowerOperations, ITroveManager {
    struct Trove {
        uint256 coll;
        uint256 principal; // includes gas compensation
        uint256 interest;
        uint256 lastAccrued;
        uint256 maxBorrowingCapacity;
        bool active;
    }

    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant MIN_NET_DEBT = 1800e18;
    uint256 public constant BORROWING_RATE = 1e15; // 0.1%
    uint256 public constant INTEREST_RATE_BPS = 100; // 1% APR simple
    uint256 public constant ONE_YEAR = 365 days;

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

        (bool ok,) = msg.sender.call{value: coll}("");
        require(ok, "coll transfer failed");
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
