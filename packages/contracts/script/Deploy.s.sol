// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarenEarn} from "../src/MarenEarn.sol";
import {MarenForwarder} from "../src/MarenForwarder.sol";
import {MarenPay} from "../src/MarenPay.sol";
import {MarenRegistry} from "../src/MarenRegistry.sol";
import {MarenVault} from "../src/MarenVault.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/**
 * @title Deploy
 * @notice Deploys all five Maren contracts, wires roles, and writes the addresses to
 *         `deployments/<chainid>.json` as well as printing them as JSON.
 *
 * USAGE
 *   Dry run (no key needed, no broadcast):
 *     forge script script/Deploy.s.sol --rpc-url mezo_testnet
 *
 *   Real deployment — prefer a keystore over a raw private key:
 *     forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast \
 *       --account maren-deployer --verify --verifier blockscout \
 *       --verifier-url https://api.explorer.test.mezo.org/api
 *
 * ENVIRONMENT
 *   MAREN_ADMIN     defaults to the broadcaster. Should be a multisig on mainnet.
 *   MAREN_KEEPER    defaults to the broadcaster. The bot that runs the pooled trove.
 *   MAREN_GUARDIAN  defaults to MAREN_ADMIN. May pause ENTRIES only — never exits.
 *   VAULT_DEPOSIT_CAP / EARN_DEPOSIT_CAP  in wei. Both default deliberately small.
 *
 * DEPLOYMENT ORDER matters: MarenPay takes the registry address, so the registry is first.
 * Nothing here opens the pooled trove — that is a separate, deliberate keeper action
 * (`openPooledTrove`) taken after the deployment has been reviewed.
 */
contract Deploy is Script {
    // MUSD protocol, verified live with cast on 2026-08-15. Never edit by hand; re-derive
    // from @mezo-org/musd-contracts and re-verify on-chain.
    struct MusdAddresses {
        address musd;
        address borrowerOperations;
        address troveManager;
        address stabilityPool;
        address priceFeed;
    }

    /// @dev Canonical Permit2. 9,152 bytes of code verified at this address on BOTH networks.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 internal constant MEZO_MAINNET = 31612;
    uint256 internal constant MEZO_TESTNET = 31611;

    /**
     * @dev Conservative starting caps. ARCHITECTURE.md §7 is explicit that mainnet launches
     *      capped and is raised only as the position proves out. 5 BTC of pooled collateral is
     *      roughly $315k at the price these were verified at.
     */
    uint256 internal constant DEFAULT_VAULT_CAP = 5 ether;
    uint256 internal constant DEFAULT_EARN_CAP = 250_000e18;

    function musdAddressesFor(uint256 chainId) public pure returns (MusdAddresses memory a) {
        if (chainId == MEZO_MAINNET) {
            a = MusdAddresses({
                musd: 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186,
                borrowerOperations: 0x44b1bac67dDA612a41a58AAf779143B181dEe031,
                troveManager: 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193,
                stabilityPool: 0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32,
                priceFeed: 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
            });
        } else if (chainId == MEZO_TESTNET) {
            a = MusdAddresses({
                musd: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503,
                borrowerOperations: 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5,
                troveManager: 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0,
                stabilityPool: 0x1CCA7E410eE41739792eA0A24e00349Dd247680e,
                priceFeed: 0x86bCF0841622a5dAC14A313a15f96A95421b9366
            });
        } else {
            revert("Deploy: unsupported chain - Maren only deploys to Mezo 31612 or 31611");
        }
    }

    function run() external {
        MusdAddresses memory musd = musdAddressesFor(block.chainid);

        address broadcaster = msg.sender;
        address admin = vm.envOr("MAREN_ADMIN", broadcaster);
        address keeper = vm.envOr("MAREN_KEEPER", broadcaster);
        address guardian = vm.envOr("MAREN_GUARDIAN", admin);
        uint256 vaultCap = vm.envOr("VAULT_DEPOSIT_CAP", DEFAULT_VAULT_CAP);
        uint256 earnCap = vm.envOr("EARN_DEPOSIT_CAP", DEFAULT_EARN_CAP);

        vm.startBroadcast();

        MarenForwarder forwarder = new MarenForwarder();
        MarenRegistry registry = new MarenRegistry(address(forwarder));
        MarenPay pay = new MarenPay(musd.musd, address(registry), PERMIT2, address(forwarder));

        MarenVault vault = new MarenVault(
            musd.borrowerOperations,
            musd.troveManager,
            musd.priceFeed,
            musd.musd,
            address(forwarder),
            admin,
            vaultCap
        );

        MarenEarn earn =
            new MarenEarn(musd.musd, musd.stabilityPool, musd.priceFeed, address(forwarder), admin, earnCap);

        // Roles. The deployer holds DEFAULT_ADMIN_ROLE only if it IS the admin; otherwise the
        // constructor already granted it to `admin` and the deployer can grant nothing.
        if (admin == broadcaster) {
            vault.grantRole(vault.KEEPER_ROLE(), keeper);
            vault.grantRole(vault.GUARDIAN_ROLE(), guardian);
            earn.grantRole(earn.KEEPER_ROLE(), keeper);
        }

        vm.stopBroadcast();

        _report(
            block.chainid,
            admin,
            keeper,
            guardian,
            address(forwarder),
            address(registry),
            address(pay),
            address(vault),
            address(earn)
        );

        if (admin != broadcaster) {
            console2.log("");
            console2.log("ACTION REQUIRED: admin != deployer, so roles were NOT granted.");
            console2.log("From the admin account, call:");
            console2.log("  MarenVault.grantRole(KEEPER_ROLE, keeper)");
            console2.log("  MarenVault.grantRole(GUARDIAN_ROLE, guardian)");
            console2.log("  MarenEarn.grantRole(KEEPER_ROLE, keeper)");
        }
        console2.log("");
        console2.log("NEXT: the pooled trove is NOT open. A keeper must call");
        console2.log("MarenVault.openPooledTrove{value: seed}(1800e18, upperHint, lowerHint)");
        console2.log("with hints computed off-chain from SortedTroves/HintHelpers.");
    }

    function _report(
        uint256 chainId,
        address admin,
        address keeper,
        address guardian,
        address forwarder,
        address registry,
        address pay,
        address vault,
        address earn
    ) internal {
        string memory obj = "maren";
        vm.serializeUint(obj, "chainId", chainId);
        vm.serializeAddress(obj, "admin", admin);
        vm.serializeAddress(obj, "keeper", keeper);
        vm.serializeAddress(obj, "guardian", guardian);
        vm.serializeAddress(obj, "marenForwarder", forwarder);
        vm.serializeAddress(obj, "marenRegistry", registry);
        vm.serializeAddress(obj, "marenPay", pay);
        vm.serializeAddress(obj, "marenVault", vault);
        string memory json = vm.serializeAddress(obj, "marenEarn", earn);

        console2.log(json);

        // Best effort: the run still succeeds if ./deployments is not writable.
        try vm.writeJson(json, string.concat("./deployments/", vm.toString(chainId), ".json")) {
            console2.log("");
            console2.log("Written to deployments/%s.json", vm.toString(chainId));
        } catch {
            console2.log("");
            console2.log("Could not write deployments/ - copy the JSON above by hand.");
        }
    }
}
