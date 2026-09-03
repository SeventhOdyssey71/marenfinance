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
}
