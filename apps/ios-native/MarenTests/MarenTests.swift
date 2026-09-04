import XCTest
@testable import Maren

// Empty for now — the harness exists so golden/snapshot tests can land in a later wave.
final class MarenTests: XCTestCase {
    func testStubIsHonestlyDemo() async throws {
        // The Wave 1 stub must expose the price feed as unavailable, never a fake number.
        let client = StubMarenClient()
        let feed = try await client.priceFeed()
        guard case .unavailable = feed else {
            return XCTFail("Default stub should report the price feed as unavailable")
        }
    }

    // MoneyText is a SwiftUI view type (@MainActor), so its static `split` is main-actor
    // isolated; the test hops onto the main actor to call it under Swift 6 strict concurrency.
    @MainActor
    func testMoneyGreysDecimals() {
        let (head, tail) = MoneyText.split("1,240.50 MUSD")
        XCTAssertEqual(head, "1,240")
        XCTAssertEqual(tail, ".50 MUSD")
    }

    // MARK: - Realised-yield annualisation

    // 800 MUSD realised on a 41,200 MUSD base over 92 days annualises to
    // 800/41200 * 365/92 * 100 = 7.7037...%. Checked by hand.
    func testRealisedYieldAnnualises() throws {
        let pct = try XCTUnwrap(RealisedYieldMath.annualisedPercent(
            realisedMusd: 800, baseMusd: 41_200, windowDays: 92,
            minWindowDays: EARN_YIELD_MIN_ANNUALISE_DAYS))
        // Compare on the same Decimal path the app uses.
        let expected = Decimal(800) / Decimal(41_200) * Decimal(365) / Decimal(92) * 100
        XCTAssertEqual(pct, expected)
        XCTAssertEqual((pct as NSDecimalNumber).doubleValue, 7.7037, accuracy: 0.001)
    }

    // Every dishonest input returns nil, never a fabricated 0%.
    func testRealisedYieldWithholdsWhenItCannotBeHonest() {
        // A zero base is a divide-by-zero: withheld.
        XCTAssertNil(RealisedYieldMath.annualisedPercent(
            realisedMusd: 800, baseMusd: 0, windowDays: 92, minWindowDays: 14))
        // A window shorter than the minimum: annualising a lumpy gain over it would inflate.
        XCTAssertNil(RealisedYieldMath.annualisedPercent(
            realisedMusd: 800, baseMusd: 41_200, windowDays: 3, minWindowDays: 14))
        // No realised gain: the caller shows the empty state, not 0%.
        XCTAssertNil(RealisedYieldMath.annualisedPercent(
            realisedMusd: 0, baseMusd: 41_200, windowDays: 92, minWindowDays: 14))
    }

    // A scan that found no seized BTC is the honest "no return yet" state, not a 0% yield.
    func testRealisedYieldNoReturnIsNotAZeroRate() {
        let y = RealisedYield(btcRealised: 0, musdRealised: nil, windowDays: 90,
                              liquidationEvents: 0, annualisedPercent: nil, lastGainAt: nil)
        XCTAssertFalse(y.hasReturn)
    }
}
