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
    private(set) var priceFeed: PriceFeed = .unavailable(reason: "Not loaded")

    var priceLive: Bool {
        if case .available = priceFeed { return true }
        return false
    }

    func load(using client: any MarenClient) async {
        phase = .loading
        do {
            async let position = client.position()
            async let balances = client.balances()
            async let price = client.priceFeed()
            self.position = try await position
            self.balances = try await balances
            self.priceFeed = try await price
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// USD value of locked collateral, or nil when the price is unavailable. Never fabricated.
    var collateralUsd: Decimal? {
        guard case let .available(usdPerBtc, _) = priceFeed, let btc = position?.bitcoinLocked else {
            return nil
        }
        return btc * usdPerBtc
    }
}
