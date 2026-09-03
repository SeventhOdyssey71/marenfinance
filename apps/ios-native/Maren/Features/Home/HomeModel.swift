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

    func load(using client: any MarenClient) async {
        phase = .loading
        do {
            async let account = client.account()
            async let position = client.position()
            async let balances = client.balances()
            async let price = client.priceFeed()

            self.account = try await account
            self.position = try await position
            self.balances = try await balances
            self.priceFeed = try await price
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
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
