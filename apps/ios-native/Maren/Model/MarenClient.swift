import Foundation

// MARK: - MarenClient
//
// The single seam between the UI and the chain. Every screen reads through this
// protocol; the real Mezo wiring is a later wave and slots in behind the same methods
// with no view changes. Sendable so an implementation can be an actor.

protocol MarenClient: Sendable {
    func account() async throws -> Account
    func priceFeed() async throws -> PriceFeed
    func position() async throws -> Position
    func balances() async throws -> Balances
    func earnBalance() async throws -> Decimal
    /// What backs the Earn pool right now — its MUSD plus any Bitcoin it seized absorbing
    /// liquidations. Read live; a failure throws so the UI can show unavailable, never a zero.
    func earnExposure() async throws -> EarnExposure
    /// Backward-looking realised yield for the Earn vault, computed from its on-chain
    /// `Harvested` events over a bounded trailing window. A read failure throws so the UI shows
    /// unavailable; a successful scan that found no gains returns a `RealisedYield` whose
    /// `hasReturn` is false — the honest "no return yet" state, never a fabricated rate.
    func earnRealisedYield() async throws -> RealisedYield
    func recentActivity() async throws -> [ActivityItem]
    /// One MarenPay payment request by id, or nil when the contract holds no record under that
    /// id. A read that FAILS throws, so the UI can say "couldn't read it" — which is a
    /// different sentence from "there is no such request", and only one of them is true.
    func paymentRequest(_ requestId: UInt64) async throws -> PaymentRequestRecord?
}

// MARK: - UnconfiguredMarenClient
//
// The PRODUCTION no-wallet client, and the Environment default for `\.marenClient`. There is
// no account and no chain behind it, so it has nothing true to say — and so it says nothing.
// Every read throws; the one read with an honest "absent" case in its own type, the price
// feed, reports `.unavailable` with the reason. It cannot state a balance, a position, a
// handle, an address or a hash, because it does not have one.
//
// This is what a view rendered outside a configured session gets. The screens already render
// a throw and an `.unavailable` honestly, so an unwired view shows a gap, never a plausible
// invented figure.

struct UnconfiguredMarenClient: MarenClient {
    func account() async throws -> Account { throw MarenClientError.noAccount }
    func priceFeed() async throws -> PriceFeed {
        .unavailable(reason: "No account is loaded, so there is no price to read.")
    }
    func position() async throws -> Position { throw MarenClientError.noAccount }
    func balances() async throws -> Balances { throw MarenClientError.noAccount }
    func earnBalance() async throws -> Decimal { throw MarenClientError.noAccount }
    func earnExposure() async throws -> EarnExposure { throw MarenClientError.noAccount }
    func earnRealisedYield() async throws -> RealisedYield { throw MarenClientError.noAccount }
    func recentActivity() async throws -> [ActivityItem] { throw MarenClientError.noAccount }
    func paymentRequest(_ requestId: UInt64) async throws -> PaymentRequestRecord? {
        throw MarenClientError.noAccount
    }
}

#if DEBUG

// MARK: - StubMarenClient (DEBUG ONLY)
//
// A CLEARLY-FAKE, demo-only implementation. It returns obviously-placeholder values so
// SwiftUI previews and the `MAREN_DEMO` screenshot shell are exercisable without a wallet —
// the UI wears a "Demo data" badge wherever this feeds it, and nothing here is presented as
// a real balance.
//
// COMPILED OUT OF RELEASE. This whole type lives inside `#if DEBUG`, so a shipping binary
// contains none of these figures and no code path can reach them. `#Preview` blocks are
// themselves DEBUG-only, so previews keep working unchanged.
//
// HONEST-DATA on purpose: `priceFeed()` returns `.unavailable`. The USD price is not
// wired for the stub, so the app must show an explicit unavailable state rather than a
// fabricated dollar figure. The BTC/MUSD figures are protocol-native demo amounts; the
// USD *conversion* of them is what is honestly missing until a real feed lands.

struct StubMarenClient: MarenClient {
    /// Flip to `true` in a later wave (or a preview) to exercise the "price wired" path.
    var priceWired: Bool = false

    func account() async throws -> Account {
        Account(handle: "@demo", address: "0xDEMO…f00d")
    }

    func priceFeed() async throws -> PriceFeed {
        if priceWired {
            return .available(usdPerBtc: 64_000, asOf: Date())
        }
        return .unavailable(reason: "Price feed not wired yet — Wave 1 stub")
    }

    func position() async throws -> Position {
        // Demo position: 0.4 BTC locked, 8,000 MUSD borrowed, comfortably above the
        // 180% floor. Ratio and drop are handed directly here (a real client derives
        // them on-chain); they stay meaningful even while the USD price is absent.
        Position(
            bitcoinLocked: 0.4,
            borrowed: 8_000,
            leftToBorrow: 6_222.5,
            collateralRatioPercent: 320,
            dropToLiquidationPercent: 65.6,
            health: .healthy
        )
    }

    func balances() async throws -> Balances {
        Balances(musd: 1_240.5, btc: 0.4210)
    }

    func earnBalance() async throws -> Decimal { 512.40 }

    func earnExposure() async throws -> EarnExposure {
        // Demo composition: a mostly-MUSD pool that has taken on a little Bitcoin from
        // liquidations. The USD valuation is shown as fresh here (priceWired mirrors the feed).
        EarnExposure(musdBacking: 41_200, btcSeized: 0.0125, btcValuedMusd: 800, stalePrice: !priceWired)
    }

    func earnRealisedYield() async throws -> RealisedYield {
        // Demo composition: a handful of liquidation gains realised over a ~90-day window — long
        // enough and eventful enough to clear both annualisation bars — with the annualised
        // figure shown only when the price path is "wired" (mirrors the feed).
        let windowDays = 92
        let events = 4
        let btc: Decimal = 0.0125
        let musd: Decimal? = priceWired ? 800 : nil
        let annualised = priceWired
            ? RealisedYieldMath.annualisedPercent(realisedMusd: 800, baseMusd: 41_200,
                                                  windowDays: windowDays,
                                                  gainBearingEvents: events,
                                                  minWindowDays: EARN_YIELD_MIN_ANNUALISE_DAYS,
                                                  minEvents: EARN_YIELD_MIN_ANNUALISE_EVENTS)
            : nil
        return RealisedYield(
            btcRealised: btc,
            musdRealised: musd,
            windowDays: windowDays,
            liquidationEvents: events,
            annualisedPercent: annualised,
            lastGainAt: Date().addingTimeInterval(-6 * 86_400)
        )
    }

    func recentActivity() async throws -> [ActivityItem] {
        let now = Date()
        return [
            ActivityItem(id: "1", kind: .receive, title: "Received from @ada",
                         subtitle: "MarenPay transfer", amount: "+250.00 MUSD",
                         date: now.addingTimeInterval(-3_600),
                         status: .confirmed, hash: "0xdemo00000000000000000000000000000000000000000000000000000000a1",
                         memo: "lunch", counterparty: "@ada", sponsored: true),
            ActivityItem(id: "2", kind: .borrow, title: "Borrowed MUSD",
                         subtitle: "Against BTC vault", amount: "+2,000.00 MUSD",
                         date: now.addingTimeInterval(-86_400),
                         status: .confirmed, hash: "0xdemo00000000000000000000000000000000000000000000000000000000b2",
                         sponsored: true),
            ActivityItem(id: "3", kind: .deposit, title: "Deposited Bitcoin",
                         subtitle: "Vault collateral", amount: "+0.15 BTC",
                         date: now.addingTimeInterval(-2 * 86_400),
                         status: .confirmed, hash: "0xdemo00000000000000000000000000000000000000000000000000000000c3",
                         sponsored: false),
        ]
    }

    /// There is no chain behind demo data, so there is no request record to read. This THROWS
    /// rather than returning nil: nil would mean "the contract has no such request", which is a
    /// claim about a chain this client is not talking to.
    func paymentRequest(_ requestId: UInt64) async throws -> PaymentRequestRecord? {
        throw MarenClientError.demoHasNoChain
    }
}

#endif
