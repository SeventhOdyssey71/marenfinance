// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IStabilityPool} from "../../src/interfaces/IStabilityPool.sol";
import {MockMUSD} from "./MockMUSD.sol";

/**
 * @notice Stability Pool mock using Liquity's product/sum (P/S) accounting, so a test can
 *         drive a real liquidation: depositors' MUSD is burned and they receive native BTC.
 *
 *         `offset(debtToOffset)` payable is the test hook — send BTC as `msg.value` and name
 *         the MUSD to burn. There are no token emissions here because there are none in the
 *         real pool either; liquidation gains are the entire yield.
 */
contract MockStabilityPool is IStabilityPool {
    MockMUSD public immutable musd;

    uint256 private constant WAD = 1e18;

    uint256 public P = WAD;
    uint256 public S; // cumulative BTC gain per unit staked, scaled by P

    mapping(address => uint256) private _deposits;
    mapping(address => uint256) private _pSnapshot;
    mapping(address => uint256) private _sSnapshot;

    uint256 public totalDeposits;

    error NothingDeposited();

    constructor(MockMUSD musd_) {
        musd = musd_;
    }

    receive() external payable {}

    function provideToSP(uint256 _amount) external {
        _settle(msg.sender);
        musd.transferFrom(msg.sender, address(this), _amount);
        _deposits[msg.sender] += _amount;
        totalDeposits += _amount;
        _pSnapshot[msg.sender] = P;
        _sSnapshot[msg.sender] = S;
    }

    function withdrawFromSP(uint256 _amount) external {
        uint256 gain = getDepositorCollateralGain(msg.sender);
        uint256 compounded = getCompoundedMUSDDeposit(msg.sender);
        uint256 toSend = _amount < compounded ? _amount : compounded;

        _deposits[msg.sender] = compounded - toSend;
        totalDeposits = totalDeposits >= toSend ? totalDeposits - toSend : 0;
        _pSnapshot[msg.sender] = P;
        _sSnapshot[msg.sender] = S;

        if (toSend > 0) musd.transfer(msg.sender, toSend);
        if (gain > 0) {
            (bool ok,) = msg.sender.call{value: gain}("");
            require(ok, "gain transfer failed");
        }
    }

    function getCompoundedMUSDDeposit(address d) public view returns (uint256) {
        uint256 snap = _pSnapshot[d];
        if (snap == 0) return _deposits[d];
        return (_deposits[d] * P) / snap;
    }

    /// @dev Liquity's gain formula. Note there is exactly ONE division by the snapshot of P
    ///      here: the 1e18 scaling is already carried inside S by `offset`.
    function getDepositorCollateralGain(address d) public view returns (uint256) {
        uint256 snap = _pSnapshot[d];
        if (snap == 0) return 0;
        return (_deposits[d] * (S - _sSnapshot[d])) / snap;
    }

    function getTotalMUSDDeposits() external view returns (uint256) {
        return totalDeposits;
    }

    /// @notice Test hook: absorb `debtToOffset` MUSD of liquidated debt and pay out `msg.value`
    ///         of BTC collateral to depositors, exactly as a real liquidation does.
    function offset(uint256 debtToOffset) external payable {
        uint256 total = totalDeposits;
        if (total == 0) revert NothingDeposited();

        uint256 gainPerUnit = (msg.value * WAD) / total;
        uint256 lossPerUnit = (debtToOffset * WAD) / total;
        if (lossPerUnit > WAD) lossPerUnit = WAD;

        S += (P * gainPerUnit) / WAD;
        P = (P * (WAD - lossPerUnit)) / WAD;
        totalDeposits = total - debtToOffset;

        musd.burn(address(this), debtToOffset);
    }

    function _settle(address d) private {
        uint256 gain = getDepositorCollateralGain(d);
        _deposits[d] = getCompoundedMUSDDeposit(d);
        if (gain > 0) {
            (bool ok,) = d.call{value: gain}("");
            require(ok, "gain transfer failed");
        }
    }
}
