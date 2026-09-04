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

/// What backs MarenEarn right now, in protocol-native units. The pool is not pure MUSD: as it
/// absorbs liquidations it takes on Bitcoin, so `btcSeized` is the BTC the pool is holding from
/// those liquidations and `btcValuedMusd` is that BTC valued in MUSD at the oracle price.
/// `stalePrice` is true when that valuation rests on a price the oracle would reject as too old,
/// so `btcValuedMusd` may understate the real figure and must never be shown as authoritative.
struct EarnExposure: Sendable, Equatable, Codable {
    let musdBacking: Decimal          // MUSD idle + in the Stability Pool
    let btcSeized: Decimal            // BTC held + pending from liquidations (18-dec BTC)
    let btcValuedMusd: Decimal        // that BTC valued in MUSD at the oracle price
    let stalePrice: Bool              // the BTC valuation rests on a price the oracle would reject
}

/// Backward-looking realised yield for MarenEarn, computed from the vault's on-chain
/// `Harvested` events — never a forward APY, never a fabricated rate.
///
/// WHAT IS ACTUALLY REALISED. Each harvest emits the exact native BTC the vault SEIZED from
/// liquidations in that harvest (`btcClaimed`). Summing it over the observed window is an
/// exact, on-chain, non-overlapping quantity that needs no oracle: `btcRealised`. Its MUSD
/// value (`musdRealised`) is that BTC priced at the CURRENT oracle rate — so it is withheld
/// (left nil) whenever the price is stale or unavailable, because a value the protocol itself
/// would reject must never be shown as authoritative. The MUSD leg deliberately does NOT add
/// the `musdCompounded` a router would later produce: that is a denomination change of BTC
/// already counted here, and adding it would double-count the same gain.
///
/// This is a VAULT-WIDE figure — what every share earned, not this account's slice — because a
/// per-user cost basis needs a deposit/withdraw ledger the chain does not expose without an
/// off-chain indexer. The UI labels it as such.
struct RealisedYield: Sendable, Equatable, Codable {
    /// BTC the pool seized from liquidations across the window (exact, from `Harvested`).
    let btcRealised: Decimal
    /// That BTC valued in MUSD at the current oracle price; nil when the price is stale or
    /// unavailable, so a rejected price is never rendered as a dollar figure.
    let musdRealised: Decimal?
    /// The real number of days the scan observed, from the floor block's timestamp — never
    /// assumed from a block-time constant.
    let windowDays: Int
    /// How many harvests seized BTC in the window (the count of realised liquidation gains).
    let liquidationEvents: Int
    /// The trailing realised gain annualised to a percent, or nil when it cannot be computed
    /// honestly: no MUSD base, a window shorter than `EARN_YIELD_MIN_ANNUALISE_DAYS`, a stale
    /// price, or no gain at all. A withheld percent is never shown as 0%.
    let annualisedPercent: Decimal?
    /// When the most recent realised gain landed, or nil if there has been none.
    let lastGainAt: Date?

    /// True only when the pool has genuinely realised a liquidation gain in the window.
    /// False is the honest "no return to report yet" state, NOT a 0% yield.
    var hasReturn: Bool { liquidationEvents > 0 && btcRealised > 0 }
}

/// The pure annualisation, factored out so it is unit-testable without a network. Trailing
/// realised yield = gain / base, scaled from the observed window up to a year. Every path that
/// cannot produce an honest number returns nil rather than a misleading zero.
enum RealisedYieldMath {
    /// realisedMusd / baseMusd, annualised from `windowDays` to 365. Returns nil when the base
    /// is non-positive (divide-by-zero), the window is shorter than `minWindowDays`, or there is
    /// no realised gain — so the caller shows an empty state instead of a fabricated 0%.
    static func annualisedPercent(realisedMusd: Decimal,
                                  baseMusd: Decimal,
                                  windowDays: Int,
                                  minWindowDays: Int) -> Decimal? {
        guard realisedMusd > 0, baseMusd > 0, windowDays >= minWindowDays, windowDays > 0 else {
            return nil
        }
        return realisedMusd / baseMusd * Decimal(365) / Decimal(windowDays) * 100
    }
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
