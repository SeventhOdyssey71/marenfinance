// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title MarenForwarder
 * @author Maren Finance
 * @notice The ERC-2771 trusted forwarder for Maren-native actions (Pay, Earn, Registry and
 *         the pooled Vault). A user signs an EIP-712 `ForwardRequest`; Maren's relayer
 *         submits it and pays the BTC gas. Combined with MUSD's EIP-2612 `permit`, a
 *         first-time user can approve AND pay holding zero BTC.
 *
 * @dev This is deliberately a thin subclass of OpenZeppelin's `ERC2771Forwarder`. It adds no
 *      logic, because every line added to a forwarder is a line that can forge a sender.
 *      Replay protection (per-signer nonce), expiry (`deadline`), and the `msg.value`
 *      accounting are all inherited unmodified.
 *
 * TRUST MODEL — read before pointing anything at this contract:
 *  - Any contract that trusts this forwarder delegates `_msgSender()` to it entirely. Only
 *    Maren contracts do so. This is never a general-purpose public relayer.
 *  - The relayer key is a liveness dependency, not a custody one: whoever holds it can
 *    censor or reorder Maren meta-transactions and can waste its own BTC. It cannot move
 *    user funds, because every value transfer downstream is a `transferFrom` under the
 *    user's own allowance or permit.
 *  - `ERC2771Forwarder.execute` reverts if the inner call reverts, so a failed sponsored
 *    action costs the relayer gas and consumes the nonce. The relayer must simulate with
 *    `eth_call` first. This matters more on Mezo than elsewhere: `PriceFeed.fetchPrice()`
 *    reverts on >60s oracle staleness, so vault calls can fail for reasons unrelated to the
 *    signed request.
 *
 * WHY NOT ERC-4337: EntryPoint v0.7 is deployed on Mezo at
 * 0x0000000071727De22E5E9d8BAf0edAc6f37da032 and is byte-identical to L1, but it is inert —
 * zero UserOperations, and mezod's RPCs do not implement `debug_traceCall`, so no
 * ERC-7562-compliant bundler can validate. No vendor supports Mezo. ERC-2771 + EIP-2612 is
 * the working path today; EIP-7702 (live on Mezo mainnet since block 9,275,000) is the
 * upgrade path, which is why Maren's user-facing entrypoints are small and independently
 * callable rather than monolithic — a 7702-delegated account can batch them.
 */
contract MarenForwarder is ERC2771Forwarder {
    /// @dev EIP-712 domain. Changing either string changes every signature's digest, so
    ///      these are fixed for the life of the deployment. The `maren/sdk` package hardcodes
    ///      them and the relayer asserts they match before signing anything.
    string public constant DOMAIN_NAME = "Maren Forwarder";
    string public constant DOMAIN_VERSION = "1";

    constructor() ERC2771Forwarder(DOMAIN_NAME) {}
}
