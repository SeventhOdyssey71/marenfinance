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

/// Who the app is loaded as.
///
/// A NICKNAME IS NOT A HANDLE. The name typed during onboarding is a device-local label and
/// nothing else: MarenRegistry has never heard of it, and if the registry resolves that same
/// name to somebody else's address then putting it in a share link or a QR code sends money to
/// a stranger. So the two are separate fields, and only ONE of them can ever be a payment
/// target.
///
///   `registeredHandle` is set only when an authoritative MarenRegistry read says THIS address
///   owns that name. It is the bare handle, with no leading "@".
///   `nickname` is the local label. It may be shown as a name; it may never be shown as an
///   @handle and may never be built into a link, a QR code or any other payment target.
///
/// `payTarget` is the single accessor every share/QR path goes through, so the fallback to the
/// address is structural rather than something each screen has to remember.
struct Account: Sendable, Equatable, Codable {
    let address: String                 // 0x…
    /// The @handle MarenRegistry confirms this address owns, bare (no "@"). Nil until confirmed.
    let registeredHandle: String?
    /// The device-local display nickname from onboarding. Never a payment target.
    let nickname: String?

    init(address: String, registeredHandle: String? = nil, nickname: String? = nil) {
        self.address = address
        self.registeredHandle = registeredHandle.flatMap { $0.isEmpty ? nil : $0 }
        self.nickname = nickname.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The registry-confirmed handle with its "@", or nil. The ONLY string in this type that
    /// may be presented as a handle.
    var handle: String? { registeredHandle.map { "@\($0)" } }

    /// What a payment link or QR code addresses. The confirmed handle when there is one,
    /// otherwise the address, which is always correct and always this account's.
    var payTarget: String { handle ?? address }

    /// The name to show at the top of Profile: the confirmed handle, else the nickname, else a
    /// shortened address. Pair it with `titleCaption`, which says which of the three it is.
    var title: String {
        if let handle { return handle }
        if let nickname { return nickname }
        return address.count > 10 ? "\(address.prefix(6))…\(address.suffix(4))" : address
    }

    /// One line saying what `title` actually is, so a nickname is never mistaken for a name
    /// anybody can pay.
    var titleCaption: String {
        if handle != nil { return "Registered to this address on MarenRegistry." }
        if nickname != nil { return "A nickname saved on this device. It is not a name anyone can pay you at." }
        return "No name claimed yet. People pay you at the address below."
    }
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

/// A borrow position.
///
/// TWO KINDS OF FIGURE LIVE HERE, and the difference is the whole point of the optionals.
/// `bitcoinLocked` and `borrowed` are read straight off the vault and need no oracle, so they
/// are always true. EVERY OTHER FIELD IS PRICE-DERIVED: the headroom, the collateral ratio, the
/// drop to liquidation and the health that is computed from the ratio all rest on the BTC price.
///
/// Mezo's own `PriceFeed.fetchPrice()` reverts past 60s of staleness, so a price older than that
/// is one the protocol itself would refuse. When the client reads such a price, every
/// price-derived field is nil and the UI shows an honest gap. Finance must never print a
/// collateral ratio directly above its own "price unavailable" banner.
///
/// The ratio and drop are also nil for the ordinary reason: with no debt there is no such thing,
/// and the UI dashes rather than boasting infinity.
struct Position: Sendable, Equatable, Codable {
    let bitcoinLocked: Decimal        // BTC, from the vault, no oracle needed
    let borrowed: Decimal             // MUSD, from the vault, no oracle needed
    /// MUSD headroom under the 180% floor. Price-derived: nil when the oracle price is stale.
    var leftToBorrow: Decimal?
    var borrowUnavailableReason: String? = nil
    var borrowReserveMusd: Decimal? = nil
    var borrowFeeRate: Decimal? = nil
    var liquidationThresholdPercent: Decimal? = nil
    var usesPooledVault: Bool? = nil

    func debtAfterBorrow(_ amount: Decimal) -> Decimal {
        let freshDraw = max(0, amount - (borrowReserveMusd ?? 0))
        return borrowed + amount + freshDraw * (borrowFeeRate ?? 0)
    }
    let collateralRatioPercent: Decimal?
    let dropToLiquidationPercent: Decimal?   // how far BTC can fall before liquidation
    /// Derived from the collateral ratio, so it is absent whenever the ratio is. `.none` means
    /// "no debt", which is a statement of fact; nil means "not computable right now".
    let health: HealthStatus?
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
    /// honestly: no MUSD base, a window shorter than `EARN_YIELD_MIN_ANNUALISE_DAYS`, fewer
    /// than `EARN_YIELD_MIN_ANNUALISE_EVENTS` gain-bearing harvests, a stale price, or no gain
    /// at all. A withheld percent is never shown as 0%.
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
    /// is non-positive (divide-by-zero), the window is shorter than `minWindowDays`, the window
    /// carries fewer than `minEvents` gain-bearing harvests, or there is no realised gain — so
    /// the caller shows an empty state instead of a fabricated 0%. Both bars (days AND events)
    /// must clear, matching the web/SDK `realisedYield` rule so the two surfaces never disagree.
    static func annualisedPercent(realisedMusd: Decimal,
                                  baseMusd: Decimal,
                                  windowDays: Int,
                                  gainBearingEvents: Int,
                                  minWindowDays: Int,
                                  minEvents: Int) -> Decimal? {
        guard realisedMusd > 0, baseMusd > 0,
              windowDays >= minWindowDays, windowDays > 0,
              gainBearingEvents >= minEvents else {
            return nil
        }
        return realisedMusd / baseMusd * Decimal(365) / Decimal(windowDays) * 100
    }
}

/// A `MarenPay` payment request, as the UI needs it: a protocol-native MUSD figure, plain
/// addresses, and a status that says what it is. Read-only, and never synthesised — a request
/// the contract has no record of is `nil` at the client boundary, not a zero-amount row.
struct PaymentRequestRecord: Sendable, Equatable, Codable {
    /// The contract's own enum: 0 None, 1 Open, 2 Fulfilled, 3 Cancelled.
    enum Status: Int, Sendable, Codable {
        case none = 0, open = 1, fulfilled = 2, cancelled = 3

        var label: String {
            switch self {
            case .none: return "No such request"
            case .open: return "Open"
            case .fulfilled: return "Already paid"
            case .cancelled: return "Cancelled"
            }
        }
    }

    let id: UInt64
    /// Who gets paid.
    let requester: String
    /// Who is expected to pay, or nil when anyone holding the id may fulfil it (the contract
    /// stores the zero address for that, which is never shown as if it were an address).
    let payer: String?
    let amount: Decimal
    let createdAt: Date
    let status: Status

    var isOpen: Bool { status == .open }
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
    /// When the transaction landed, from the block's own timestamp.
    ///
    /// OPTIONAL BECAUSE THE TIMESTAMP FETCH IS BEST-EFFORT. Block times are read in a separate
    /// `eth_getBlockByNumber` round after the logs, and a block that cannot be read leaves the
    /// row's time genuinely unknown. This field used to be non-optional with a
    /// `Date(timeIntervalSince1970: 0)` fallback, which filed a real transaction under a
    /// "January 1" header dated 1970. Nil is the honest answer, and the UI groups and labels it
    /// as "Time unknown".
    let date: Date?

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
