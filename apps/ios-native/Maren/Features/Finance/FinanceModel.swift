import SwiftUI

// MARK: - FinanceModel
//
// Loads the reads the Vault and Earn screens share — position, balances, price — through the
// injected client. Honest-data discipline: the price feed is kept as its own value so an
// `.unavailable` result flows to the UI intact and nothing price-derived is fabricated.

@MainActor
@Observable
final class FinanceModel {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    private(set) var phase: Phase = .loading
    private(set) var position: Position?
    private(set) var balances: Balances?
    private(set) var earnBalance: Decimal?   // MUSD supplied to the Stability Pool, nil if unread
    private(set) var earnExposure: EarnExposure?   // what backs the pool, nil if unread
    private(set) var priceFeed: PriceFeed = .unavailable(reason: "Not loaded")
    /// A background reload is in flight while values already on screen stay put.
    private(set) var refreshing = false

    var priceLive: Bool {
        if case .available = priceFeed { return true }
        return false
    }

    private var hasData: Bool {
        position != nil || balances != nil || earnBalance != nil || earnExposure != nil
    }

    /// First paint with genuinely nothing to show — the screen renders a redacted skeleton.
    var isFirstLoad: Bool { phase == .loading && !hasData }

    // Skeleton feeds: neutral placeholder shapes while first-loading, the real values after.
    // These drive DISPLAY only; every flow's inputs read the real `position`/`balances`.
    var displayPosition: Position? { isFirstLoad ? .placeholder : position }
    var displayBalances: Balances? { isFirstLoad ? .placeholder : balances }
    var displayEarnBalance: Decimal? { isFirstLoad ? 1234 : earnBalance }
    var displayEarnExposure: EarnExposure? { isFirstLoad ? .placeholder : earnExposure }

    func load(using client: any MarenClient) async {
        // Only blank to the skeleton when there is genuinely nothing yet; otherwise keep the
        // values on screen and refresh in place.
        if hasData { refreshing = true } else { phase = .loading }
        defer { refreshing = false }

        async let position = client.position()
        async let balances = client.balances()
        async let price = client.priceFeed()
        async let earn = client.earnBalance()
        async let exposure = client.earnExposure()

        // Independent + tolerant: each read that FAILS keeps the last good value rather than
        // blanking the field or fabricating one — a refresh can only replace with a truer value.
        if let value = try? await position { self.position = value }
        if let value = try? await balances { self.balances = value }
        if let value = try? await price { self.priceFeed = value }
        self.earnBalance = try? await earn
        self.earnExposure = try? await exposure
        phase = .loaded
    }

    /// USD value of locked collateral, or nil when the price is unavailable. Never fabricated.
    var collateralUsd: Decimal? {
        guard case let .available(usdPerBtc, _) = priceFeed, let btc = position?.bitcoinLocked else {
            return nil
        }
        return btc * usdPerBtc
    }
}
