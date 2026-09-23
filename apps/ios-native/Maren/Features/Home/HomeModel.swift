import SwiftUI

// MARK: - HomeModel
//
// Loads the Home reads through the injected client. Honest-data discipline lives here:
// the price feed is kept as its own value so an `.unavailable` result flows to the UI
// intact — the view never substitutes a zero for a missing price.

@MainActor
@Observable
final class HomeModel {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    private(set) var phase: Phase = .loading
    private(set) var account: Account?
    private(set) var position: Position?
    private(set) var balances: Balances?
    private(set) var priceFeed: PriceFeed = .unavailable(reason: "Not loaded")
    private(set) var activity: [ActivityItem] = []
    /// A background reload is in flight while values already on screen stay put.
    private(set) var refreshing = false

    var hasData: Bool {
        balances != nil || position != nil || account != nil || !activity.isEmpty
    }

    /// First paint with genuinely nothing to show — the screen renders a redacted skeleton.
    var isFirstLoad: Bool { phase == .loading && !hasData }

    // Skeleton feeds: neutral placeholder shapes while first-loading, the real values after.
    // These drive DISPLAY only; action inputs always read the real `balances`/`position`.
    var displayBalances: Balances? { isFirstLoad ? .placeholder : balances }
    var displayPosition: Position? { isFirstLoad ? .placeholder : position }
    var displayActivity: [ActivityItem] { isFirstLoad ? ActivityItem.placeholders : activity }

    func load(using client: any MarenClient, address: String? = nil) async {
        // Fast first paint: with nothing in memory, hydrate from the on-disk snapshot for this
        // address so the balance and history show instantly. Only show the loading state when
        // there is genuinely nothing to paint; otherwise refresh in place.
        if hasData {
            refreshing = true
        } else if let address, let snapshot = HomeCache.load(address: address) {
            apply(snapshot)
            phase = .loaded
            refreshing = true
        } else {
            phase = .loading
        }
        defer { refreshing = false }

        // Refresh in the background. Each read is independent, and a read that FAILS keeps the
        // last good value (cached or previous) rather than blanking the field — honest data
        // means "stale but true", never a nil that erases a figure the user just saw.
        async let account = client.account()
        async let position = client.position()
        async let balances = client.balances()
        async let price = client.priceFeed()
        async let activity = client.recentActivity()

        // The four screen-critical reads all draw from ONE batched multicall, so awaiting
        // them costs a single round trip between them.
        if let value = try? await account { self.account = value }
        // Track the position read specifically. Keeping the last good value on failure is
        // right, but with nothing cached there IS no last good value, and the screen then sat
        // on "Loading your position…" forever with no error and no retry — the codebase
        // already documents Mezo's public RPCs as transiently flaky, so this is a normal
        // first-run outcome, not an exotic one. Activity got this right; Home did not.
        var positionUnavailable = false
        if let value = try? await position { self.position = value } else { positionUnavailable = true }
        if let value = try? await balances { self.balances = value }
        if let value = try? await price { self.priceFeed = value }

        // PAINT HERE, before Activity. Activity is a multi-window `eth_getLogs` crawl — four
        // windows across three contracts, about a second even fully parallel — and it used to
        // gate `.loaded`, so the balance sat behind a history scan it does not depend on. The
        // crawl is already in flight from the `async let` above; it lands a moment later and
        // fills the list in place.
        // Only a failed read with nothing to fall back on is a failure. A failed refresh over
        // cached data stays `.loaded` and keeps showing the stale figures, which is the point.
        phase = positionUnavailable && self.position == nil
            ? .failed("Mezo did not answer. Your funds are safe on-chain — this is only the read.")
            : .loaded

        if let value = try? await activity { self.activity = value }

        // Persist the fresh snapshot for the next launch.
        if let address {
            HomeCache.save(
                HomeSnapshot(account: self.account, position: self.position, balances: self.balances,
                             priceFeed: self.priceFeed, activity: self.activity, savedAt: Date()),
                address: address
            )
        }
    }

    private func apply(_ snapshot: HomeSnapshot) {
        if let value = snapshot.account { account = value }
        if let value = snapshot.position { position = value }
        if let value = snapshot.balances { balances = value }
        if let value = snapshot.priceFeed { priceFeed = value }
        if !snapshot.activity.isEmpty { activity = snapshot.activity }
    }

    /// The plain-language safety line. Only stated when there is debt and a real drop
    /// figure to state; otherwise the caller shows the no-debt line instead.
    var safetyLine: String? {
        guard let drop = position?.dropToLiquidationPercent, (position?.borrowed ?? 0) > 0 else {
            return nil
        }
        return "Your Bitcoin can fall \(MoneyFormat.percent(drop)) before it could be liquidated."
    }

    /// The USD value of locked BTC — or nil when the price feed is unavailable. Never a
    /// fabricated number; the view renders an explicit unavailable state for nil.
    var collateralUsd: Decimal? {
        guard case let .available(usdPerBtc, _) = priceFeed, let btc = position?.bitcoinLocked else {
            return nil
        }
        return btc * usdPerBtc
    }
}
