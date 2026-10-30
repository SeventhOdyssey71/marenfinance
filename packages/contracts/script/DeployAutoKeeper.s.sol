// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenAutoKeeper} from "../src/MarenAutoKeeper.sol";
import {MarenVault} from "../src/MarenVault.sol";
import {ISortedTroves} from "../src/interfaces/ISortedTroves.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/**
 * @title DeployAutoKeeper
 * @notice Deploys MarenAutoKeeper against the EXISTING vault and grants it KEEPER_ROLE, in one
 *         broadcast. No vault redeploy, no migration, no user position touched.
 *
 * The broadcaster must hold the vault's DEFAULT_ADMIN_ROLE (on testnet, the deployer key).
 * The grant reverts in simulation otherwise, before anything is sent.
 *
 * WHY THE FIRST rebalance() IS NOT IN HERE. It reads Mezo's oracle, a consensus precompile
 * that forge's local simulation cannot run (see test/mocks/ForkOracleStub.sol), so the
 * script would fail before broadcasting. `tools/ops/enable-auto-keeper.mjs` sends it with
 * `cast send` straight after this, which the live node executes normally. Neither step needs
 * a price to be guessed.
 *
 *   forge script script/DeployAutoKeeper.s.sol --rpc-url mezo_testnet --broadcast \
 *     --account maren-deployer --verify --verifier blockscout \
 *     --verifier-url https://api.explorer.test.mezo.org/api
 */
contract DeployAutoKeeper is Script {
    // Mezo testnet, verified live 2026-10-30 (vault bytecode carries topUpCollateral,
    // refinancePooledTrove, syncTrove and grantRole).
    address internal constant TESTNET_VAULT = 0x46252B00AB59384518d9dB6D1f210ffF1221645b;
    address internal constant TESTNET_SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;

    function run() external returns (MarenAutoKeeper keeper) {
        require(block.chainid == 31611, "DeployAutoKeeper: Mezo testnet only");
        MarenVault vault = MarenVault(payable(vm.envOr("MAREN_VAULT", TESTNET_VAULT)));
        ISortedTroves sorted = ISortedTroves(vm.envOr("MEZO_SORTED_TROVES", TESTNET_SORTED_TROVES));
        bytes32 role = vault.KEEPER_ROLE();

        vm.startBroadcast();
        keeper = new MarenAutoKeeper(vault, sorted);
        vault.grantRole(role, address(keeper));
        vm.stopBroadcast();

        require(vault.hasRole(role, address(keeper)), "DeployAutoKeeper: role not granted");
        // Recorded by tools/ops/enable-auto-keeper.mjs from the broadcast receipt, not here:
        // a dry run would otherwise write a simulated address into deployments/31611.json.
        console2.log("MarenAutoKeeper", address(keeper));
    }
}
