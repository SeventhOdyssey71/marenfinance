import XCTest
import BigInt
import web3
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

    // MARK: - Minted ids read out of a receipt
    //
    // `createLink` and `createRequest` learn the id the contract just minted from the receipt's
    // own logs. Every one of these asserts the same rule from a different angle: an id is
    // either read from the right log on the right contract, or it is nil. It is never guessed,
    // because a guessed link id builds a claim link pointing at somebody else's escrow.

    private let payAddress = "0xe475Ff919D54E055809f516E3bed8a5c7a101836"

    /// A log, built the way the node hands one over (JSON), so the test exercises the real
    /// decoding path rather than a hand-made Swift value.
    private func log(address: String, topics: [String]) throws -> EthereumLog {
        let json = """
        {"removed":false,"logIndex":"0x0","transactionIndex":"0x0",
         "transactionHash":"0x\(String(repeating: "1", count: 64))",
         "blockHash":"0x\(String(repeating: "2", count: 64))","blockNumber":"0x10",
         "address":"\(address)","data":"0x","topics":[\(topics.map { "\"\($0)\"" }.joined(separator: ","))]}
        """
        return try JSONDecoder().decode(EthereumLog.self, from: Data(json.utf8))
    }

    private func word(_ value: UInt64) -> String {
        "0x" + String(String(value, radix: 16)).leftPad(to: 64)
    }

    func testLinkIdIsReadFromTheLinkCreatedTopic() throws {
        let logs = [try log(address: payAddress,
                            topics: [MarenEncoding.linkCreatedTopic, word(42), word(1), word(2)])]
        let source = MintedIdSource(contract: payAddress, topic0: MarenEncoding.linkCreatedTopic)
        XCTAssertEqual(Receipt.mintedId(in: logs, from: source), 42)
    }

    func testRequestIdIsReadFromTheRequestCreatedTopic() throws {
        let logs = [try log(address: payAddress,
                            topics: [MarenEncoding.requestCreatedTopic, word(7), word(1), word(2)])]
        let source = MintedIdSource(contract: payAddress, topic0: MarenEncoding.requestCreatedTopic)
        XCTAssertEqual(Receipt.mintedId(in: logs, from: source), 7)
    }

    // A receipt with no matching log yields nil, never a fallback id.
    func testMintedIdIsNilWhenTheEventIsAbsent() throws {
        let logs = [try log(address: payAddress,
                            topics: [MarenEncoding.requestCreatedTopic, word(7), word(1), word(2)])]
        let source = MintedIdSource(contract: payAddress, topic0: MarenEncoding.linkCreatedTopic)
        XCTAssertNil(Receipt.mintedId(in: logs, from: source))
    }

    // The right event emitted by the WRONG contract must not be trusted: anyone can deploy a
    // contract that emits `LinkCreated(42)`.
    func testMintedIdIgnoresTheSameEventFromAnotherContract() throws {
        let impostor = "0x000000000000000000000000000000000000dEaD"
        let logs = [try log(address: impostor,
                            topics: [MarenEncoding.linkCreatedTopic, word(99), word(1), word(2)])]
        let source = MintedIdSource(contract: payAddress, topic0: MarenEncoding.linkCreatedTopic)
        XCTAssertNil(Receipt.mintedId(in: logs, from: source))
    }

    // Both contracts number their ids from 1, so a zero id is a decode that went wrong.
    func testMintedIdRejectsZero() throws {
        let logs = [try log(address: payAddress,
                            topics: [MarenEncoding.linkCreatedTopic, word(0), word(1), word(2)])]
        let source = MintedIdSource(contract: payAddress, topic0: MarenEncoding.linkCreatedTopic)
        XCTAssertNil(Receipt.mintedId(in: logs, from: source))
    }

    // A `Delivered` for any other action carries no id at all.
    func testDeliveredCarriesNoIdByDefault() {
        let delivered = Delivered(hash: "0xabc", blockNumber: 1, gasUsed: 21_000, sponsored: true)
        XCTAssertNil(delivered.mintedId)
    }

    // MARK: - Honest gas
    //
    // The cost line the review step shows must match what MarenRelayHub will actually forward,
    // read from `script/Deploy.s.sol`'s allowlist. The asymmetry worth pinning: `claimLink` IS
    // allowlisted and `createLink` is NOT, so creating a link costs the creator BTC gas while
    // claiming it is free. Copy and behaviour cannot be allowed to disagree about that.
    func testGasModeMatchesTheHubAllowlist() {
        func gas(_ kind: Intent.Kind) -> GasMode {
            Intent(kind: kind, amount: 1, unit: .musd).gas
        }
        XCTAssertEqual(gas(.deposit), .youPayBtc)
        XCTAssertEqual(gas(.earnSupply), .youPayBtc)
        XCTAssertEqual(gas(.earnWithdraw), .youPayBtc)
        XCTAssertEqual(gas(.createLink(linkKey: "0x0", expiry: 1, memo: "")), .youPayBtc)

        XCTAssertEqual(gas(.send(to: "0x0", memo: "")), .sponsored)
        XCTAssertEqual(gas(.borrow), .sponsored)
        XCTAssertEqual(gas(.split(recipients: [], amounts: [])), .sponsored)
        XCTAssertEqual(gas(.request(payer: nil, memo: "")), .sponsored)
        XCTAssertEqual(gas(.fulfillRequest(requestId: 1)), .sponsored)
        XCTAssertEqual(gas(.claim(PaymentLinks.ClaimLink(linkId: 1, secret: "0x00"))), .sponsored)
        XCTAssertEqual(gas(.commitHandle(handle: "sele", secret: "0x00")), .sponsored)
        XCTAssertEqual(gas(.registerHandle(handle: "sele", secret: "0x00")), .sponsored)
    }

    // MARK: - Handle commit-reveal

    // MarenRegistry's own constants, transcribed. If the contract ever changes them, the app's
    // countdown and expiry copy would start lying, so they are pinned.
    func testCommitmentAgesMatchTheRegistry() {
        XCTAssertEqual(HANDLE_MIN_COMMITMENT_AGE, 60)
        XCTAssertEqual(HANDLE_MAX_COMMITMENT_AGE, 7 * 24 * 60 * 60)
    }

    func testCommitmentPhaseWalksTheWholeTwoStepFlow() {
        let committedAt: UInt64 = 1_000_000

        // No commitment on-chain: nothing has been reserved, and the UI must say so rather
        // than count down a wait that never started.
        XCTAssertEqual(HandleCommitmentStore.phase(committedAt: 0, now: committedAt), .notCommitted)

        // Inside the 60s minimum age, the remaining seconds come from the CHAIN's timestamp.
        XCTAssertEqual(HandleCommitmentStore.phase(committedAt: committedAt, now: committedAt + 19),
                       .waiting(secondsRemaining: 41))

        // The bar is inclusive: exactly MIN_COMMITMENT_AGE old is revealable.
        XCTAssertEqual(HandleCommitmentStore.phase(committedAt: committedAt,
                                                   now: committedAt + HANDLE_MIN_COMMITMENT_AGE),
                       .revealable)

        // Still revealable a day later, and dead one second past seven days.
        XCTAssertEqual(HandleCommitmentStore.phase(committedAt: committedAt, now: committedAt + 86_400),
                       .revealable)
        XCTAssertEqual(HandleCommitmentStore.phase(committedAt: committedAt,
                                                   now: committedAt + HANDLE_MAX_COMMITMENT_AGE + 1),
                       .expired)
    }

    // `MarenRegistry._validateHandle` transcribed: 3-32 chars of [a-z0-9_]. Checked before a
    // transaction so nobody learns they cannot use a full stop by paying for a revert.
    func testHandleValidationMatchesTheRegistry() {
        XCTAssertNil(MezoActions.handleProblem("sele"))
        XCTAssertNil(MezoActions.handleProblem("@sele"))          // the @ is display only
        XCTAssertNil(MezoActions.handleProblem("a_1"))
        XCTAssertNil(MezoActions.handleProblem(String(repeating: "a", count: 32)))
        XCTAssertNotNil(MezoActions.handleProblem("ab"))          // too short
        XCTAssertNotNil(MezoActions.handleProblem(String(repeating: "a", count: 33)))
        XCTAssertNotNil(MezoActions.handleProblem("Sele"))        // uppercase is REJECTED, not normalised
        XCTAssertNotNil(MezoActions.handleProblem("se.le"))
        XCTAssertNotNil(MezoActions.handleProblem("se le"))
    }

    // The bare handle is what reaches the calldata; the contract hashes raw bytes, so a
    // leading @ would register a different, unreachable name.
    func testBareHandleStripsTheAtSign() {
        XCTAssertEqual(MezoActions.bareHandle("@sele"), "sele")
        XCTAssertEqual(MezoActions.bareHandle("  @sele  "), "sele")
        XCTAssertEqual(MezoActions.bareHandle("sele"), "sele")
    }

    // A secret is 32 bytes from the platform CSPRNG, and two draws are never the same.
    func testCommitmentSecretIs32FreshBytes() throws {
        let first = try XCTUnwrap(HandleCommitmentStore.newSecret())
        let second = try XCTUnwrap(HandleCommitmentStore.newSecret())
        XCTAssertEqual(Data(hex: first)?.count, 32)
        XCTAssertNotEqual(first, second)
    }

    // The store is what survives a relaunch inside the 60-second wait. Round-trip it.
    func testPendingCommitmentSurvivesTheStore() throws {
        let handle = "goldentest_\(Int.random(in: 100_000...999_999))"
        let secret = try XCTUnwrap(HandleCommitmentStore.newSecret())
        let record = PendingCommitment(handle: handle, secret: secret,
                                       owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
                                       network: .testnet, txHash: nil, committedAt: nil)
        HandleCommitmentStore.save(record)
        defer { HandleCommitmentStore.clear(network: .testnet, handle: handle) }

        let loaded = HandleCommitmentStore.load(network: .testnet, handle: handle)
        XCTAssertEqual(loaded?.secret, secret)
        XCTAssertTrue(HandleCommitmentStore.all(network: .testnet).contains { $0.handle == handle })

        HandleCommitmentStore.clear(network: .testnet, handle: handle)
        XCTAssertNil(HandleCommitmentStore.load(network: .testnet, handle: handle))
    }
}

private extension String {
    /// Left-pad with zeroes to `width`, for building 32-byte topic words in tests.
    func leftPad(to width: Int) -> String {
        count >= width ? self : String(repeating: "0", count: width - count) + self
    }
}
