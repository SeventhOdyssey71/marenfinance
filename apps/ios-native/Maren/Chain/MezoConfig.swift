import Foundation
import BigInt

// MARK: - Mezo chain configuration
//
// The Swift counterpart of packages/sdk/src/{chains,addresses}.ts. Every value here is
// transcribed from that package, which records the on-chain provenance of each address and
// the (verified) chain id and RPC hosts. A wrong value here silently sends user funds
// nowhere, so these are facts copied verbatim, never invented.
//
// Native gas currency is BTC with 18 decimals — this is an EVM chain and BTC is the gas
// token, so it follows the 18-decimal EVM convention, NOT Bitcoin's 8.

enum MezoNetwork: String, Sendable, CaseIterable {
    case testnet
    case mainnet
}

/// A chain's identity and endpoints. RPC URLs are listed in the order `chains.ts` argues
/// for, and that order is load-bearing: Mezo's public RPCs are transiently flaky, so a
/// client MUST fail over across the list rather than pin one URL.
struct MezoChain: Sendable {
    let network: MezoNetwork
    let chainId: Int
    let rpcURLs: [URL]
    let explorerURL: URL

    static let testnet = MezoChain(
        network: .testnet,
        chainId: 31611,
        rpcURLs: [
            URL(string: "https://rpc.test.mezo.org")!,
            URL(string: "https://mezo-testnet.drpc.org")!,
        ],
        explorerURL: URL(string: "https://explorer.test.mezo.org")!
    )

    static let mainnet = MezoChain(
        network: .mainnet,
        chainId: 31612,
        rpcURLs: [
            URL(string: "https://jsonrpc-mezo.boar.network")!,
            URL(string: "https://mainnet.mezo.public.validationcloud.io")!,
            URL(string: "https://mezo.drpc.org")!,
        ],
        explorerURL: URL(string: "https://explorer.mezo.org")!
    )

    static func of(_ network: MezoNetwork) -> MezoChain {
        network == .mainnet ? .mainnet : .testnet
    }
}

/// MUSD protocol addresses. Only the subset the app reads is carried here.
struct MusdAddresses: Sendable {
    let musd: String
    let troveManager: String
    let sortedTroves: String
    let hintHelpers: String
    let priceFeed: String

    static let testnet = MusdAddresses(
        musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
        troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
        sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
        hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
        priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366"
    )

    static let mainnet = MusdAddresses(
        musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
        troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
        sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
        hintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
        priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88"
    )

    static func of(_ network: MezoNetwork) -> MusdAddresses {
        network == .mainnet ? .mainnet : .testnet
    }
}

/// Maren's own deployments. Zero address == not deployed (mainnet is genuinely all zeroes).
struct MarenAddresses: Sendable {
    let marenVault: String
    let marenPay: String
    /// MarenRelayHub extends MarenForwarder and IS the single trusted forwarder — the
    /// standalone forwarder is deliberately not deployed. This is the EIP-712
    /// `verifyingContract` for a ForwardRequest.
    let marenForwarder: String
    let marenRegistry: String
    let marenEarn: String

    var isDeployed: Bool { marenPay != Self.zero }
    static let zero = "0x0000000000000000000000000000000000000000"

    static let testnet = MarenAddresses(
        marenVault: "0x46252B00AB59384518d9dB6D1f210ffF1221645b",
        marenPay: "0xe475Ff919D54E055809f516E3bed8a5c7a101836",
        marenForwarder: "0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C",
        marenRegistry: "0x9e123Cdd0CD524812CF9F552d3FAB13d8143b77E",
        marenEarn: "0xE3B02b215085B99Ce61E0F5ea9763Ac637aa7826"
    )

    static let mainnet = MarenAddresses(
        marenVault: zero, marenPay: zero, marenForwarder: zero,
        marenRegistry: zero, marenEarn: zero
    )

    static func of(_ network: MezoNetwork) -> MarenAddresses {
        network == .mainnet ? .mainnet : .testnet
    }
}

/// Mezo's BTC/USD price oracle is a NATIVE CHAIN PRECOMPILE, not a deployed Chainlink/Pyth
/// contract. It implements only `decimals()` and `latestRoundData()`.
let MEZO_PRICE_ORACLE_PRECOMPILE = "0x7b7c000000000000000000000000000000000015"

/// 200 MUSD escrowed at trove open, in wei (1e18). `TroveManager` reports it inside the
/// principal, so it is subtracted back out for the net drawn figure.
let MUSD_GAS_COMPENSATION: BigUInt = BigUInt(200) * BigUInt(10).power(18)

/// Ongoing interest: 1.00% APR, simple, fixed for the life of a loan.
let INTEREST_RATE_BPS = 100

/// The widest `[fromBlock, toBlock]` span Mezo's public RPC answers in one `eth_getLogs`.
/// Measured: a wider range returns `maximum [from, to] blocks distance: 10000`.
let MEZO_MAX_LOG_RANGE = 10_000
