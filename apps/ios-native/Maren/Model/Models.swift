import SwiftUI

// MARK: - Domain models
//
// Value types, all Sendable, so they cross the client boundary cleanly under strict
// concurrency. Amounts are protocol-native: BTC and MUSD are held in their own units,
// never pre-converted to USD — a conversion needs a price, and the price can be absent.

/// Maren's policy constants, verbatim from packages/sdk/src/constants.ts. Facts, not
/// invention: 0.001 BTC floor, Maren's 180% healthy floor, Mezo's 110% liquidation
/// cliff, 1.00% fixed simple APR.
enum MarenPolicy {
    static let minCollateralBtc: Decimal = 0.001
    static let marenHealthyFloorPercent: Decimal = 180
    static let marenTargetPercent: Decimal = 250
    static let marenVaultLiquidationPercent: Decimal = 140
    static let mezoLiquidationPercent: Decimal = 110
    static let fixedAprPercent: Decimal = 1.00
}

struct Account: Sendable, Equatable {
    let handle: String       // e.g. "@demo"
    let address: String      // 0x… (truncated for display)
}

/// A read that can be genuinely absent. Honest-data discipline: the USD price feed is
/// not wired in Wave 1, and the UI must show that rather than a fabricated number.
enum PriceFeed: Sendable, Equatable {
    case available(usdPerBtc: Decimal, asOf: Date)
    case unavailable(reason: String)
}

enum HealthStatus: String, Sendable, CaseIterable {
    case none, healthy, caution, warning, danger, liquidatable

    var label: String {
        switch self {
        case .none: return "No debt"
        case .healthy: return "Healthy"
        case .caution: return "Caution"
        case .warning: return "Warning"
        case .danger: return "Danger"
        case .liquidatable: return "Liquidatable"
        }
    }

    var tone: Color {
        switch self {
        case .none: return Theme.Palette.tertiary
        case .healthy: return Theme.Palette.success
        case .caution, .warning: return Theme.Palette.warning
        case .danger, .liquidatable: return Theme.Palette.danger
        }
    }
}

/// A borrow position. Protocol-native figures plus a plain-language safety read. The
/// collateral ratio and drop-to-liquidation are optional: with no debt, there is no
/// such thing, and the UI dashes rather than boasting infinity.
struct Position: Sendable, Equatable {
    let bitcoinLocked: Decimal        // BTC
    let borrowed: Decimal             // MUSD
    let leftToBorrow: Decimal         // MUSD, headroom under the 180% floor
    let collateralRatioPercent: Decimal?
    let dropToLiquidationPercent: Decimal?   // how far BTC can fall before liquidation
    let health: HealthStatus
}

struct Balances: Sendable, Equatable {
    let musd: Decimal                 // spendable MUSD in the wallet
}

struct ActivityItem: Sendable, Equatable, Identifiable {
    enum Kind: Sendable { case send, receive, borrow, deposit }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let amount: String                // pre-formatted, carries its own sign + unit
    let date: Date

    var icon: String {
        switch kind {
        case .send: return "arrow.up.right"
        case .receive: return "arrow.down.left"
        case .borrow: return "banknote"
        case .deposit: return "bitcoinsign"
        }
    }
}
