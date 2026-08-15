// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @notice Records exactly who a forwarded call appeared to come from.
 *
 * @dev Exists so `MarenRelayHub`'s most important property — that `_msgSender()` inside a
 *      target resolves to the END USER and not to the hub — can be asserted DIRECTLY rather
 *      than inferred from a payment that moved the expected balances. A payment can move the
 *      right balances for the wrong reason; a recorded address cannot.
 *
 *      `recordedRawCaller` captures `msg.sender` alongside it, so a test can show the two are
 *      genuinely different: the hub is the raw caller, the user is the resolved sender. If the
 *      ERC-2771 calldata suffix were ever dropped, the two would collapse to the same value
 *      and the test fails loudly.
 */
contract SenderProbe is ERC2771Context {
    address public recordedSender;
    address public recordedRawCaller;
    uint256 public callCount;

    constructor(address trustedForwarder_) ERC2771Context(trustedForwarder_) {}

    function record() external {
        recordedSender = _msgSender();
        recordedRawCaller = msg.sender;
        callCount += 1;
    }
}
