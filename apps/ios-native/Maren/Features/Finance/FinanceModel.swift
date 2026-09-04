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
            async let earn = client.earnBalance()
            async let exposure = client.earnExposure()
            self.position = try await position
            self.balances = try await balances
            self.priceFeed = try await price
            // Independent + tolerant: a failed Earn read shows "unavailable", it never fails
            // the whole screen or fabricates a pool balance or exposure.
            self.earnBalance = try? await earn
            self.earnExposure = try? await exposure
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
