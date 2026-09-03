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

struct Account: Sendable, Equatable, Codable {
    let handle: String       // e.g. "@demo"
    let address: String      // 0x… (truncated for display)
}

/// A read that can be genuinely absent. Honest-data discipline: the USD price feed is
/// not wired in Wave 1, and the UI must show that rather than a fabricated number.
enum PriceFeed: Sendable, Equatable, Codable {
    case available(usdPerBtc: Decimal, asOf: Date)
    case unavailable(reason: String)
}

enum HealthStatus: String, Sendable, CaseIterable, Codable {
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
struct Position: Sendable, Equatable, Codable {
    let bitcoinLocked: Decimal        // BTC
    let borrowed: Decimal             // MUSD
    let leftToBorrow: Decimal         // MUSD, headroom under the 180% floor
    let collateralRatioPercent: Decimal?
    let dropToLiquidationPercent: Decimal?   // how far BTC can fall before liquidation
    let health: HealthStatus
}

struct Balances: Sendable, Equatable, Codable {
    let musd: Decimal                 // spendable MUSD in the wallet
    let btc: Decimal                  // native BTC in the wallet (gas token), for deposits
}

/// R15 status wording. `pending` never reads as delivered, and `failed` says plainly that no
/// funds moved rather than hiding behind "unsuccessful".
enum ActivityStatus: Sendable, Equatable, Codable {
    case pending, confirmed, failed

    var label: String {
        switch self {
        case .pending: return "Awaiting receipt"
        case .confirmed: return "Confirmed"
        case .failed: return "Failed, no funds moved"
        }
    }

    var tone: Color {
        switch self {
        case .pending: return Theme.Palette.warning
        case .confirmed: return Theme.Palette.success
        case .failed: return Theme.Palette.danger
        }
    }

    var icon: String {
        switch self {
        case .pending: return "clock"
        case .confirmed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        }
    }
}

struct ActivityItem: Sendable, Equatable, Identifiable, Codable {
    enum Kind: Sendable, Codable { case send, receive, borrow, deposit, repay, withdraw, earnDeposit, earnWithdraw }
    let id: String
    let kind: Kind
    let title: String
    let subtitle: String
    let amount: String                // pre-formatted, carries its own sign + unit
    let date: Date

    // Optional receipt detail. Defaulted so the Chain client (which does not populate them yet)
    // keeps compiling; a nil field renders as an honest gap in the receipt, never a fake value.
    var status: ActivityStatus = .confirmed
    var hash: String? = nil
    var memo: String? = nil
    var counterparty: String? = nil
    /// True when a Maren relayer paid the BTC gas; nil when it is not known for this row.
    var sponsored: Bool? = nil

    var icon: String {
        switch kind {
        case .send: return "arrow.up.right"
        case .receive: return "arrow.down.left"
        case .borrow: return "banknote"
        case .deposit: return "bitcoinsign"
        case .repay: return "arrow.counterclockwise"
        case .withdraw: return "arrow.up.bitcoinsign"
        case .earnDeposit: return "leaf.fill"
        case .earnWithdraw: return "arrow.up.left"
        }
    }

    /// The token this row is denominated in, read from its own formatted amount.
    var isBtc: Bool { amount.contains("BTC") }

    /// Green for money in (+), red for money out (−), ink otherwise. Failed rows override
    /// this in the row itself (greyed + struck through).
    var amountColor: Color {
        if amount.hasPrefix("+") { return Theme.Palette.moneyIn }
        if amount.hasPrefix("-") || amount.hasPrefix("−") { return Theme.Palette.moneyOut }
        return Theme.Palette.ink
    }
}
