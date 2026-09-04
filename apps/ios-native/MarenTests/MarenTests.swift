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

    // The gate now matches the web/SDK exactly: annualise ONLY when the window is at least
    // EARN_YIELD_MIN_ANNUALISE_DAYS (30) long AND carries at least
    // EARN_YIELD_MIN_ANNUALISE_EVENTS (4) gain-bearing harvests.
    func testAnnualiseThresholdsMatchWebSDK() {
        XCTAssertEqual(EARN_YIELD_MIN_ANNUALISE_DAYS, 30)
        XCTAssertEqual(EARN_YIELD_MIN_ANNUALISE_EVENTS, 4)
    }

    // A tiny helper so each test states only the axis it exercises.
    private func annualised(days: Int, events: Int,
                            realisedMusd: Decimal = 800,
                            baseMusd: Decimal = 41_200) -> Decimal? {
        RealisedYieldMath.annualisedPercent(
            realisedMusd: realisedMusd, baseMusd: baseMusd,
            windowDays: days, gainBearingEvents: events,
            minWindowDays: EARN_YIELD_MIN_ANNUALISE_DAYS,
            minEvents: EARN_YIELD_MIN_ANNUALISE_EVENTS)
    }

    // 800 MUSD realised on a 41,200 MUSD base over 92 days, 4 events, annualises to
    // 800/41200 * 365/92 * 100 = 7.7037...%. Checked by hand.
    func testRealisedYieldAnnualises() throws {
        let pct = try XCTUnwrap(annualised(days: 92, events: 4))
        // Compare on the same Decimal path the app uses.
        let expected = Decimal(800) / Decimal(41_200) * Decimal(365) / Decimal(92) * 100
        XCTAssertEqual(pct, expected)
        XCTAssertEqual((pct as NSDecimalNumber).doubleValue, 7.7037, accuracy: 0.001)
    }

    // Both bars are inclusive: exactly 30 days and exactly 4 events annualises.
    func testRealisedYieldAnnualisesAtExactBoundary() throws {
        XCTAssertNotNil(annualised(days: EARN_YIELD_MIN_ANNUALISE_DAYS,
                                   events: EARN_YIELD_MIN_ANNUALISE_EVENTS))
    }

    // One day under the window bar is withheld, even with plenty of events.
    func testRealisedYieldWithheldJustUnderDayBar() {
        XCTAssertNil(annualised(days: EARN_YIELD_MIN_ANNUALISE_DAYS - 1, events: 10))
    }

    // One event under the event bar is withheld, even over a long window: a single lumpy gain
    // stretched across months is still not something a yearly rate can be defended on.
    func testRealisedYieldWithheldJustUnderEventBar() {
        XCTAssertNil(annualised(days: 90, events: EARN_YIELD_MIN_ANNUALISE_EVENTS - 1))
    }

    // The old iOS-only 14-day gate is gone: 14 days no longer annualises under the new rule.
    func testFormerFourteenDayGateNoLongerAnnualises() {
        XCTAssertNil(annualised(days: 14, events: 10))
    }

    // Every dishonest input returns nil, never a fabricated 0%.
    func testRealisedYieldWithholdsWhenItCannotBeHonest() {
        // A zero base is a divide-by-zero: withheld.
        XCTAssertNil(annualised(days: 92, events: 4, baseMusd: 0))
        // A window shorter than the minimum: annualising a lumpy gain over it would inflate.
        XCTAssertNil(annualised(days: 3, events: 4))
        // No realised gain: the caller shows the empty state, not 0%.
        XCTAssertNil(annualised(days: 92, events: 4, realisedMusd: 0))
    }

    // A scan that found no seized BTC is the honest "no return yet" state, not a 0% yield.
    func testRealisedYieldNoReturnIsNotAZeroRate() {
        let y = RealisedYield(btcRealised: 0, musdRealised: nil, windowDays: 90,
                              liquidationEvents: 0, annualisedPercent: nil, lastGainAt: nil)
        XCTAssertFalse(y.hasReturn)
    }
}
