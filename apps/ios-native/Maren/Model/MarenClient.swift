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
    func recentActivity() async throws -> [ActivityItem]
}

// MARK: - StubMarenClient
//
// A CLEARLY-FAKE, demo-only implementation. It returns obviously-placeholder values so
// the foundation is exercisable before any chain is wired — the UI wears a "Demo data"
// badge wherever this feeds it, and nothing here is presented as a real balance.
//
// HONEST-DATA on purpose: `priceFeed()` returns `.unavailable`. The USD price is not
// wired in Wave 1, so the app must show an explicit unavailable state rather than a
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
        Balances(musd: 1_240.5)
    }

    func earnBalance() async throws -> Decimal { 512.40 }

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
}
