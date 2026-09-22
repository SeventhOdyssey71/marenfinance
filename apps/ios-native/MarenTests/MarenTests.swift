import XCTest
import SwiftUI
import BigInt
import web3
@testable import Maren

final class MarenTests: XCTestCase {
    func testStubIsHonestlyDemo() async throws {
        // The Wave 1 stub must expose the price feed as unavailable, never a fake number.
        let client = StubMarenClient()
        let feed = try await client.priceFeed()
        guard case .unavailable = feed else {
            return XCTFail("Default stub should report the price feed as unavailable")
        }
    }

    // MARK: - The production no-wallet path never fabricates
    //
    // THE REGRESSION THIS PINS. The app used to fall back to `StubMarenClient` /
    // `DemoMarenActions` whenever no wallet was loaded, and used them as the SwiftUI
    // Environment defaults — so any view rendered outside a configured session was handed
    // invented balances, an invented address and invented transaction hashes, in Release as
    // much as in Debug. The fabricating types are now `#if DEBUG` and the production fallback
    // is the unconfigured pair below. These tests fail the moment anything is wired back.
    //
    // The rule being pinned: WITH NO ACCOUNT, THERE IS NOTHING TO SAY. Every read is absent
    // (a throw, or the type's own honest unavailable case) and every write declines.

    func testUnconfiguredClientReadsReturnNoValues() async throws {
        let client = UnconfiguredMarenClient()

        // Each read must throw rather than hand back a value. `XCTAssertThrowsError` does not
        // take an async expression, so each is asserted through a small do/catch.
        func expectThrow<T>(_ what: String, _ read: () async throws -> T) async {
            do {
                let value = try await read()
                XCTFail("Unconfigured \(what) returned \(value); with no account it must not return anything")
            } catch {
                // Expected: nothing to read.
            }
        }

        await expectThrow("account") { try await client.account() }
        await expectThrow("position") { try await client.position() }
        await expectThrow("balances") { try await client.balances() }
        await expectThrow("earnBalance") { try await client.earnBalance() }
        await expectThrow("earnExposure") { try await client.earnExposure() }
        await expectThrow("earnRealisedYield") { try await client.earnRealisedYield() }
        await expectThrow("recentActivity") { try await client.recentActivity() }

        // paymentRequest THROWS rather than returning nil: nil would be the claim "the contract
        // holds no such request", which is a statement about a chain this client is not on.
        await expectThrow("paymentRequest") { try await client.paymentRequest(1) }

        // The price feed has an honest "absent" case in its own type, so it uses that rather
        // than throwing. It must never be `.available` with a fabricated figure.
        let feed = try await client.priceFeed()
        guard case .unavailable = feed else {
            return XCTFail("Unconfigured price feed must be unavailable, never a fabricated price")
        }
    }

    func testUnconfiguredActionsDeclineAndResolveNothing() async {
        let actions = UnconfiguredMarenActions()

        // It says up front that it cannot settle, so the review step tells the truth.
        XCTAssertFalse(actions.canSettle)

        // Every kind of write declines with a stated reason. Crucially it is NOT `.demo` and
        // NOT `.delivered`: a demo walk and a receipt are both claims that something happened.
        let intents: [Intent.Kind] = [
            .send(to: "0x0", memo: ""), .deposit, .borrow, .repay, .withdraw,
            .earnSupply, .earnWithdraw,
            .split(recipients: ["0x0"], amounts: [1]),
            .request(payer: nil, memo: ""), .fulfillRequest(requestId: 1),
            .createLink(linkKey: "0x0", expiry: 1, memo: ""),
            .claim(PaymentLinks.ClaimLink(linkId: 1, secret: "0x00")),
            .commitHandle(handle: "sele", secret: "0x00"),
            .registerHandle(handle: "sele", secret: "0x00"),
        ]
        for kind in intents {
            let outcome = await actions.submit(Intent(kind: kind, amount: 1, unit: .musd))
            guard case let .declined(reason) = outcome else {
                XCTFail("Unconfigured submit must decline, got \(outcome)")
                continue
            }
            XCTAssertFalse(reason.isEmpty, "A decline must state a reason")
        }

        // No registry to ask, so nothing resolves — not a handle, and not even a well-formed
        // address, which would otherwise read as "this recipient was checked".
        let resolvedHandle = await actions.resolve("@sele")
        XCTAssertNil(resolvedHandle)
        let resolvedAddress = await actions.resolve("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
        XCTAssertNil(resolvedAddress)
    }

    // The Environment defaults are what an unwired view inherits. They must be the
    // non-fabricating pair in EVERY configuration, so a view rendered outside a configured
    // session shows an honest gap rather than plausible invented figures.
    @MainActor
    func testEnvironmentDefaultsAreNonFabricating() {
        let values = EnvironmentValues()
        XCTAssertTrue(values.marenClient is UnconfiguredMarenClient,
                      "Default marenClient must not fabricate; got \(type(of: values.marenClient))")
        XCTAssertTrue(values.marenActions is UnconfiguredMarenActions,
                      "Default marenActions must not fabricate; got \(type(of: values.marenActions))")
    }

    // A fresh session with no wallet loaded must not reach for a fabricating client. The test
    // bundle is a DEBUG build with no `MAREN_DEMO` set, which is exactly the shape of the
    // Release no-wallet path, so this covers it from the session end too.
    @MainActor
    func testSessionWithNoWalletIsUnconfiguredNotDemo() {
        let session = MarenSession()
        guard session.address == nil else {
            // A wallet is persisted on this simulator from another test or a manual run; the
            // no-wallet branch is not what is under test then.
            return
        }
        XCTAssertFalse(session.isDemo, "No wallet and no screenshot hook is not demo data")
        XCTAssertFalse(session.hasWallet)
        XCTAssertTrue(session.client is UnconfiguredMarenClient,
                      "No wallet must mean no client; got \(type(of: session.client))")
        XCTAssertTrue(session.actions is UnconfiguredMarenActions,
                      "No wallet must mean no runner; got \(type(of: session.actions))")
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

    // MARK: - A nickname is not a handle
    //
    // THE REGRESSION THIS PINS. The name typed during onboarding is a device-local label that
    // MarenRegistry has never heard of. It used to be handed to `Account.handle` and rendered as
    // the account's @handle, AND built into the Receive QR code and the Request share link. If
    // the registry resolves that same name to a DIFFERENT address, a payer following that link
    // pays a stranger. `Account` now separates the two, and only a registry-confirmed handle can
    // ever become a payment target.

    private let selfAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

    func testNicknameIsNeverPresentedAsAHandle() {
        let account = Account(address: selfAddress, registeredHandle: nil, nickname: "sele")
        XCTAssertNil(account.handle, "An unconfirmed nickname must never surface as an @handle")
        XCTAssertEqual(account.title, "sele", "It may still be shown as a name")
        XCTAssertFalse(account.title.hasPrefix("@"), "…but never wearing an @")
        XCTAssertTrue(account.titleCaption.contains("nickname"),
                      "The caption must say what the title actually is")
    }

    // The dangerous input: somebody types "@sele" as their onboarding name. It is still only a
    // nickname, and it must not become a payment target on the strength of its punctuation.
    func testNicknameShapedLikeAHandleIsStillOnlyANickname() {
        let account = Account(address: selfAddress, registeredHandle: nil, nickname: "@sele")
        XCTAssertNil(account.handle)
        XCTAssertEqual(account.payTarget, selfAddress)
    }

    func testPayTargetIsTheAddressUntilTheRegistryConfirmsAHandle() {
        let unconfirmed = Account(address: selfAddress, registeredHandle: nil, nickname: "sele")
        XCTAssertEqual(unconfirmed.payTarget, selfAddress)

        let confirmed = Account(address: selfAddress, registeredHandle: "sele", nickname: "Sele")
        XCTAssertEqual(confirmed.handle, "@sele")
        XCTAssertEqual(confirmed.payTarget, "@sele")
        XCTAssertEqual(confirmed.title, "@sele", "A confirmed handle outranks the nickname")
    }

    // The share link and the QR code are the same string, and this is the one that can misdirect
    // funds. An unconfirmed name must not appear anywhere in it.
    func testShareLinkCarriesTheAddressNotTheNickname() throws {
        let unconfirmed = Account(address: selfAddress, registeredHandle: nil, nickname: "sele")
        let link = PaymentLinks.buildPayment(to: unconfirmed.payTarget)
        XCTAssertFalse(link.contains("sele"), "A device-local nickname must never reach a pay link")
        let parsed = try XCTUnwrap(PaymentLinks.parsePayment(link))
        XCTAssertEqual(parsed.to, selfAddress)

        // Once the registry confirms it, the handle is what the link addresses, and it parses
        // back as a handle a payer's app will resolve.
        let confirmed = Account(address: selfAddress, registeredHandle: "sele", nickname: "sele")
        let handleLink = PaymentLinks.buildPayment(to: confirmed.payTarget)
        XCTAssertEqual(try XCTUnwrap(PaymentLinks.parsePayment(handleLink)).to, "@sele")
    }

    // An empty string is not a handle and not a nickname. Blank values must normalise to nil so
    // no screen can render "@" or an empty title.
    func testBlankNamesNormaliseToNothing() {
        let account = Account(address: selfAddress, registeredHandle: "", nickname: "")
        XCTAssertNil(account.handle)
        XCTAssertNil(account.nickname)
        XCTAssertEqual(account.payTarget, selfAddress)
        XCTAssertEqual(account.title, "0xf39F…2266")
    }

    // MARK: - Position figures follow the oracle's own staleness rule
    //
    // THE REGRESSION THIS PINS. `position()` read the oracle with no staleness gate, while
    // `priceFeed()` applied Mezo's 60s rule — so Finance could show a collateral ratio and a
    // drop-to-liquidation line computed from a price the protocol would reject, directly above
    // its own "price unavailable" banner. Every price-derived field is now withheld together.

    /// 1 BTC of collateral against 20,000 MUSD of debt at $60,000/BTC: a 300% ratio.
    private func position(priceIsFresh: Bool) -> Position {
        MezoMarenClient.buildPosition(
            collWei: BigUInt(10).power(18),                  // 1 BTC
            ratioDebtWei: BigUInt(20_000) * BigUInt(10).power(18),
            shownDebtWei: BigUInt(20_000) * BigUInt(10).power(18),
            priceWei: BigUInt(60_000) * BigUInt(10).power(18),
            priceIsFresh: priceIsFresh
        )
    }

    func testFreshPriceStillProducesEveryFigure() throws {
        let p = position(priceIsFresh: true)
        XCTAssertEqual(try XCTUnwrap(p.collateralRatioPercent), 300)
        XCTAssertNotNil(p.dropToLiquidationPercent)
        XCTAssertNotNil(p.leftToBorrow)
        XCTAssertEqual(p.health, .healthy)
    }

    // MARK: - Mezo's per-trove ceiling bounds "Left to borrow"
    //
    // THE REGRESSION THIS PINS, and it reached a real tester. `leftToBorrow` was derived from
    // Maren's 180% ratio alone and ignored `getTroveMaxBorrowingCapacity` entirely, which is
    // fixed at the price the trove opened at and does not rise when collateral is added. On
    // matsnet on 2026-09-11 the pooled trove's ceiling was 2,749.20 MUSD against 2,664.68 of
    // debt — 84.52 of headroom — while the app offered 1,319.10. Borrowing 84 simulated clean
    // and 90 reverted with "BorrowerOps: An operation that exceeds maxBorrowingCapacity is not
    // permitted". The relayer refused to pay for it, which is correct, but the user had been
    // shown a number that could never have worked.

    /// The live pooled trove at the moment the tester hit this, in wei.
    private enum Matsnet {
        static let ceiling = BigUInt("2749201745000000000000")      // 2,749.20 MUSD
        static let troveDebt = BigUInt("2664680000000000000000")    // 2,664.68 MUSD
    }

    func testLeftToBorrowIsCappedByMezosTroveCeiling() throws {
        // Generous collateral, so the 180% ratio is nowhere near binding: the ceiling must be.
        let p = MezoMarenClient.buildPosition(
            collWei: BigUInt(10).power(18),                                 // 1 BTC
            ratioDebtWei: BigUInt(20_000) * BigUInt(10).power(18),
            shownDebtWei: BigUInt(20_000) * BigUInt(10).power(18),
            priceWei: BigUInt(60_000) * BigUInt(10).power(18),
            priceIsFresh: true,
            troveCapacityWei: Matsnet.ceiling,
            troveTotalDebtWei: Matsnet.troveDebt
        )
        let left = try XCTUnwrap(p.leftToBorrow)
        // 84.52 raw, minus the 0.1% origination fee the protocol adds before comparing.
        XCTAssertLessThan(left, 85, "Must not exceed the 84.52 MUSD the trove ceiling allows")
        XCTAssertGreaterThan(left, 80, "Must not be pessimistic to the point of uselessness")
    }

    func testRatioStillBindsWhenItIsTheSmallerLimit() throws {
        // Ceiling wide open; the 180% floor is the real constraint and must still win.
        let p = MezoMarenClient.buildPosition(
            collWei: BigUInt(10).power(18),
            ratioDebtWei: BigUInt(30_000) * BigUInt(10).power(18),
            shownDebtWei: BigUInt(30_000) * BigUInt(10).power(18),
            priceWei: BigUInt(60_000) * BigUInt(10).power(18),
            priceIsFresh: true,
            troveCapacityWei: BigUInt(1_000_000) * BigUInt(10).power(18),
            troveTotalDebtWei: BigUInt(30_000) * BigUInt(10).power(18)
        )
        // 60,000 / 1.8 = 33,333 max debt, minus 30,000 drawn = 3,333.
        let left = try XCTUnwrap(p.leftToBorrow)
        XCTAssertGreaterThan(left, 3_000)
        XCTAssertLessThan(left, 3_400)
    }

    func testRatioMetricsHelperWithoutPoolInputs() throws {
        // The metrics helper is not the actionable pool quote; position(from:) applies required shared reads.
        let p = position(priceIsFresh: true)
        XCTAssertNotNil(p.leftToBorrow)
        XCTAssertGreaterThan(try XCTUnwrap(p.leftToBorrow), 0)
    }

    private func pooledSnapshot() -> MezoSnapshot {
        let wad = BigUInt(10).power(18)
        var snap = MezoSnapshot()
        snap.priceWei = 60_000 * wad
        snap.priceUpdatedAt = BigUInt(Date().timeIntervalSince1970)
        snap.vaultCollWei = wad
        snap.vaultDebtWei = 0
        snap.vaultMaxBorrowableWei = 30_000 * wad
        snap.troveCapacityWei = 2_000 * wad
        snap.troveTotalDebtWei = 2_000 * wad
        snap.troveCollateralWei = wad / 10
        snap.reserveMusdWei = 100 * wad
        snap.borrowingRateWei = wad / 1_000
        snap.borrowingPaused = false
        snap.troveOpen = true
        snap.troveStatus = 1
        return snap
    }

    func testEntireTroveDoesNotDoubleCountPendingRedistribution() throws {
        let words: [BigUInt] = [100, 200, 30, 10, 20, 3]
        let data = words.reduce(into: Data()) { result, value in
            let bytes = value.serialize()
            result.append(Data(repeating: 0, count: 32 - bytes.count)); result.append(bytes)
        }
        let trove = try MezoRPC.decodeEntireTrove(data)
        XCTAssertEqual(trove.collWei, 100)
        XCTAssertEqual(trove.principalWei, 200)
        XCTAssertEqual(trove.interestWei, 30)
        XCTAssertThrowsError(try MezoRPC.decodeEntireTrove(data.prefix(160)))
    }

    func testDebtFreeUserIsStillBoundBySharedCapacityButCanUseReserve() throws {
        let result = try MezoMarenClient.position(from: pooledSnapshot())
        XCTAssertEqual(result.leftToBorrow, 100)
        XCTAssertEqual(result.borrowed, 0)
        XCTAssertNil(result.collateralRatioPercent)
        XCTAssertTrue(result.borrowUnavailableReason?.contains("refinance") == true)
    }

    func testPooledBorrowChargesOnlyNewProtocolDraw() throws {
        var snap = pooledSnapshot()
        let wad = BigUInt(10).power(18)
        snap.troveCapacityWei = 20_000 * wad
        snap.troveCollateralWei = wad
        snap.vaultMaxBorrowableWei = 200 * wad
        let available = MezoMarenClient.pooledBorrowAvailability(snap, priceIsFresh: true)
        XCTAssertEqual(available.amountWei, 100 * wad + 100 * wad * wad / (wad + wad / 1_000))
        let result = try MezoMarenClient.position(from: snap)
        XCTAssertEqual(result.debtAfterBorrow(150), Decimal(string: "150.05"))
    }

    func testPooledGlobalRatioCanBlockEvenReserveDraws() {
        var snap = pooledSnapshot()
        snap.troveCollateralWei = BigUInt(10).power(18) / 100
        let available = MezoMarenClient.pooledBorrowAvailability(snap, priceIsFresh: true)
        XCTAssertEqual(available.amountWei, 0)
        XCTAssertTrue(available.reason?.contains("180%") == true)
    }

    func testUnreadablePoolStateWithholdsBorrowLimit() throws {
        var snap = pooledSnapshot()
        snap.troveTotalDebtWei = nil
        XCTAssertNil(try MezoMarenClient.position(from: snap).leftToBorrow)
        snap = pooledSnapshot(); snap.borrowingRateWei = nil
        XCTAssertNil(try MezoMarenClient.position(from: snap).leftToBorrow)
        snap = pooledSnapshot(); snap.reserveMusdWei = nil
        XCTAssertNil(try MezoMarenClient.position(from: snap).leftToBorrow)
        snap = pooledSnapshot(); snap.vaultDebtWei = nil
        XCTAssertThrowsError(try MezoMarenClient.position(from: snap))
    }

    func testPausedAndInactivePoolsDoNotOfferBorrowing() {
        var snap = pooledSnapshot(); snap.borrowingPaused = true
        XCTAssertEqual(MezoMarenClient.pooledBorrowAvailability(snap, priceIsFresh: true).amountWei, 0)
        snap = pooledSnapshot(); snap.troveStatus = 3
        XCTAssertEqual(MezoMarenClient.pooledBorrowAvailability(snap, priceIsFresh: true).amountWei, 0)
        XCTAssertNil(MezoMarenClient.pooledBorrowAvailability(pooledSnapshot(), priceIsFresh: false).amountWei)
    }

    func testDirectLoanDoesNotOfferPooledBorrowWrites() throws {
        var snap = pooledSnapshot()
        snap.vaultCollWei = 0; snap.vaultDebtWei = 0
        snap.trove = .init(collWei: BigUInt(10).power(18), principalWei: 2_200 * BigUInt(10).power(18), interestWei: 0)
        let result = try MezoMarenClient.position(from: snap)
        XCTAssertNil(result.leftToBorrow)
        XCTAssertTrue(result.borrowUnavailableReason?.contains("direct Mezo") == true)
        XCTAssertEqual(result.usesPooledVault, false)
        XCTAssertTrue(MezoActions.vaultWriteUnavailableReason(snap)?.contains("in Mezo") == true)
    }

    func testAllVaultWritesRequireVerifiedPooledPositionBeforeSigning() throws {
        let pooled = pooledSnapshot()
        XCTAssertNil(MezoActions.vaultWriteUnavailableReason(pooled))
        XCTAssertEqual(try MezoMarenClient.position(from: pooled).usesPooledVault, true)
        var missing = pooled; missing.vaultDebtWei = nil
        XCTAssertNotNil(MezoActions.vaultWriteUnavailableReason(missing))
        var empty = pooled; empty.vaultCollWei = 0; empty.vaultDebtWei = 0
        XCTAssertNotNil(MezoActions.vaultWriteUnavailableReason(empty))
    }

    func testPooledLiquidationDistanceUsesInternal140PercentThreshold() throws {
        var snap = pooledSnapshot()
        snap.vaultDebtWei = 20_000 * BigUInt(10).power(18)
        let result = try MezoMarenClient.position(from: snap)
        XCTAssertEqual(result.liquidationThresholdPercent, 140)
        XCTAssertEqual(result.dropToLiquidationPercent, 53)
        let risk = try XCTUnwrap(LiquidationRisk.of(collateralBtc: 1, debtMusd: 20_000,
            priceUsd: 60_000, liquidationPercent: 140))
        XCTAssertEqual(risk.price, 28_000)
    }

    func testStalePriceWithholdsEveryPriceDerivedFigure() {
        let p = position(priceIsFresh: false)
        XCTAssertNil(p.collateralRatioPercent, "A ratio needs a price the protocol would accept")
        XCTAssertNil(p.dropToLiquidationPercent, "So does the drop to liquidation")
        XCTAssertNil(p.leftToBorrow, "Headroom is priced collateral")
        XCTAssertNil(p.health, "Health is derived from the ratio, so it goes with it")
    }

    // The non-price fields are read straight off the vault and owe the oracle nothing, so a
    // stale price must not blank them: that would be its own dishonesty.
    func testStalePriceStillShowsCollateralAndDebt() {
        let p = position(priceIsFresh: false)
        XCTAssertEqual(p.bitcoinLocked, 1)
        XCTAssertEqual(p.borrowed, 20_000)
    }

    // The gate is Mezo's own: `PriceFeed.fetchPrice()` reverts past 60s, so 60s is still fresh
    // and 61s is not. A clock-skewed future timestamp reads as fresh, matching `priceFeed()`.
    func testStalenessGateMatchesTheOracle() {
        XCTAssertEqual(ORACLE_MAX_PRICE_DELAY_SECONDS, 60)
        let now = Date(timeIntervalSince1970: 1_000_000)
        func fresh(ageSeconds: Int) -> Bool {
            MezoMarenClient.isFresh(updatedAt: BigUInt(1_000_000 - ageSeconds), now: now)
        }
        XCTAssertTrue(fresh(ageSeconds: 0))
        XCTAssertTrue(fresh(ageSeconds: 59))
        XCTAssertTrue(fresh(ageSeconds: 60), "Exactly 60s old is still inside the window")
        XCTAssertFalse(fresh(ageSeconds: 61))
        XCTAssertFalse(fresh(ageSeconds: 3_600))
        XCTAssertTrue(fresh(ageSeconds: -30), "A clock-skewed future timestamp is not stale")
    }

    // MARK: - A row with no block timestamp has no date
    //
    // THE REGRESSION THIS PINS. Block times are fetched best-effort after the logs, and a failed
    // `eth_getBlockByNumber` used to fall back to `Date(timeIntervalSince1970: 0)`, filing a real
    // transaction under a "January 1" header dated 1970. The field is optional now, and the UI
    // groups and labels the absence as "Time unknown".
    func testActivityItemDateIsGenuinelyOptional() throws {
        let undated = ActivityItem(id: "x", kind: .send, title: "Sent MUSD",
                                   subtitle: "MarenPay transfer", amount: "-10.00 MUSD", date: nil)
        XCTAssertNil(undated.date)

        // It survives the Home cache round-trip as an absence, not as an epoch date.
        let data = try JSONEncoder().encode(undated)
        let decoded = try JSONDecoder().decode(ActivityItem.self, from: data)
        XCTAssertNil(decoded.date)
        XCTAssertNotEqual(decoded.date, Date(timeIntervalSince1970: 0))
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

final class TestnetFinalizationTests: XCTestCase {
    private let relay = Relayer(baseURL: URL(string: "https://relay.example")!)
    private let payer = "0x" + String(repeating: "1", count: 40)
    private let txHash = "0x" + String(repeating: "2", count: 64)

    func testRelayerURLRejectsLookalikeLoopbackAndCredentials() {
        for url in ["http://localhost.evil.test", "http://127.0.0.1.evil.test", "http://localhost@evil.test",
                    "https://user:password@relay.example", "https:///", "ftp://localhost", "https://relay.example?secret=x"] {
            XCTAssertNil(RelayerConfig.normalise(url), url)
        }
        for url in ["https://relay.example/", "http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"] {
            XCTAssertNotNil(RelayerConfig.normalise(url), url)
        }
    }

    func testRelayAcceptanceRequiresMatchingPayerAndHash() throws {
        let valid: [String: Any] = ["hash": txHash, "state": "submitted", "payer": payer]
        XCTAssertEqual(try relay.decode(status: 202, body: valid, expectedPayer: payer).get().hash, txHash)
        for body: [String: Any] in [
            ["hash": txHash, "state": "submitted"],
            ["hash": txHash, "state": "submitted", "payer": "0xother"],
            ["hash": "invented", "state": "submitted", "payer": payer]
        ] {
            guard case .failure(let reason) = relay.decode(status: 202, body: body, expectedPayer: payer) else {
                return XCTFail("An unbound receipt must not report success")
            }
            XCTAssertTrue(reason.submissionMayExist)
        }
    }

    func testLostRelayResponsesAndUpstreamFailuresRemainUncertain() {
        XCTAssertTrue(Relayer.uncertainResponse.submissionMayExist)
        XCTAssertTrue(relay.failureReason(status: 409, code: "DUPLICATE_REQUEST_IN_FLIGHT").submissionMayExist)
        for (status, code) in [(502, "UPSTREAM_ERROR"), (503, "SUBMISSION_FAILED"), (504, "unknown")] {
            let reason = relay.failureReason(status: status, code: code)
            XCTAssertTrue(reason.submissionMayExist)
            XCTAssertFalse(reason.detail.contains("Nothing was submitted"))
        }
    }

    func testExplicitPreBroadcastRefusalsRemainDeclines() {
        for code in ["SIMULATION_REVERTED", "INVALID_SIGNATURE", "GLOBAL_DAILY_BUDGET_EXHAUSTED"] {
            XCTAssertFalse(relay.failureReason(status: 400, code: code).submissionMayExist)
        }
    }

    func testPrivateKeyMustBeValidSecp256k1Scalar() {
        XCTAssertNil(Keystore.normalise(String(repeating: "0", count: 64)))
        XCTAssertNil(Keystore.normalise("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"))
        XCTAssertNil(Keystore.normalise(String(repeating: "f", count: 64)))
        XCTAssertNotNil(Keystore.normalise(String(repeating: "0", count: 63) + "1"))
        XCTAssertNotNil(Keystore.normalise("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140"))
    }

    private func history(head: Int = 100, errors: Bool = false, rows: [[String: Any]] = []) -> [String: Any] {
        ["data": ["_meta": ["block": ["number": head], "hasIndexingErrors": errors], "activities": rows]]
    }

    func testStaleOrFailedIndexerCannotReportEmptyHistory() {
        XCTAssertNil(SubgraphActivity.decode(history(head: 99), chainHead: 100))
        XCTAssertNil(SubgraphActivity.decode(history(errors: true), chainHead: 100))
        XCTAssertNil(SubgraphActivity.decode(["data": ["activities": []]], chainHead: 100))
        XCTAssertNotNil(SubgraphActivity.decode(history(), chainHead: 100))
    }

    func testMalformedIndexedRowFallsBackRatherThanDroppingPayment() {
        let row: [String: Any] = ["kind": "Paid", "amount": "100", "timestamp": "1234", "blockNumber": "100", "txHash": txHash, "outgoing": false]
        XCTAssertEqual(SubgraphActivity.decode(history(rows: [row]), chainHead: 100)?.count, 1)
        XCTAssertNil(SubgraphActivity.decode(history(rows: [row, ["kind": "Paid"]]), chainHead: 100))
        var missingDirection = row
        missingDirection.removeValue(forKey: "outgoing")
        XCTAssertNil(SubgraphActivity.decode(history(rows: [missingDirection]), chainHead: 100))
    }
}


extension TestnetFinalizationTests {
    func testNativeClaimHandoffKeepsSecretInFragment() throws {
        let secret = "0x" + String(repeating: "0", count: 63) + "1"
        let native = "maren://claim?id=7#" + secret
        XCTAssertEqual(PaymentLinks.parseClaim(native)?.linkId, 7)
        XCTAssertEqual(PaymentLinks.parseClaim(native)?.secret, secret)
        let publicLink = PaymentLinks.buildClaim(linkId: 7, secret: secret)
        XCTAssertEqual(URLComponents(string: publicLink)?.host, "marenfinance.vercel.app")
        XCTAssertEqual(URLComponents(string: publicLink)?.query, "id=7")
        for invalid in ["maren://claim?id=7&secret=" + secret,
                        "maren://claim?id=7&id=8#" + secret,
                        "maren://claim?id=7#0x" + String(repeating: "0", count: 64),
                        "https://maren.finance@evil.test/claim?id=7#" + secret,
                        "maren://claim:123?id=7#" + secret] {
            XCTAssertNil(PaymentLinks.parseClaim(invalid))
        }
        XCTAssertNotNil(PaymentLinks.parseClaim("https://maren.finance/claim?id=7#" + secret))
    }

    func testNativePaymentAmountsStayBounded() {
        XCTAssertEqual(PaymentLinks.parsePayment("maren://pay?to=@sele&amount=1.25")?.amount, "1.25")
        XCTAssertNil(PaymentLinks.parsePayment("maren://pay?to=@sele&to=@other"))
        XCTAssertNil(PaymentLinks.parsePayment("maren://pay?to=@sele&amount=" + String(repeating: "9", count: 100))?.amount)
        XCTAssertFalse(PaymentLinks.isAmount("0.0000000000000000001"))
    }

    func testConcurrentWalletActionIsRefusedWhileFirstIsInFlight() async {
        let gate = WalletSubmissionGate()
        let (started, start) = AsyncStream<Void>.makeStream()
        let (release, finish) = AsyncStream<Void>.makeStream()
        let first = Task {
            await gate.run(wallet: "0xABC") {
                start.yield(())
                for await _ in release { break }
                return .demo
            }
        }
        for await _ in started { break }
        let second = await gate.run(wallet: "0xabc") { .demo }
        guard case .declined = second else {
            finish.yield(())
            return XCTFail("Two actions must not race the same wallet nonce")
        }
        finish.yield(())
        _ = await first.value
        guard case .demo = await gate.run(wallet: "0xABC", action: { .demo }) else {
            return XCTFail("Completed actions must release the wallet")
        }
    }
}

extension TestnetFinalizationTests {
    func testDurableSubmissionUncertaintyRetainsOnlyValidatedHash() {
        let body: [String: Any] = ["error": "SUBMISSION_UNCERTAIN", "meta": ["hash": txHash, "statusUrl": "https://untrusted.example"]]
        guard case .failure(let reason) = relay.decode(status: 503, body: body, expectedPayer: payer) else {
            return XCTFail("Uncertain journal ACK is not acceptance")
        }
        XCTAssertTrue(reason.submissionMayExist)
        XCTAssertEqual(reason.knownHash, txHash)
        guard case .failure(let malformed) = relay.decode(status: 503,
            body: ["error": "SUBMISSION_UNCERTAIN", "meta": ["hash": "not-a-hash"]], expectedPayer: payer) else {
            return XCTFail("Malformed hash must remain unknown")
        }
        XCTAssertTrue(malformed.submissionMayExist)
        XCTAssertNil(malformed.knownHash)
    }
}

extension TestnetFinalizationTests {
    private func claimDraft() throws -> PendingClaimLink {
        let secret = "0x" + String(repeating: "0", count: 63) + "1"
        let key = try XCTUnwrap(Keystore.normalise(secret))
        return PendingClaimLink(owner: payer, secret: secret, linkKey: try Keystore.address(of: key),
                                amount: "1.25", expiry: 123456, startBlock: 100)
    }

    func testClaimDraftSurvivesRestartBeforeHashWasSaved() throws {
        let original = try claimDraft()
        let stored = try JSONEncoder().encode(original)
        let restarted = try JSONDecoder().decode(PendingClaimLink.self, from: stored)
        XCTAssertEqual(restarted, original)
        XCTAssertTrue(restarted.validated(owner: payer))
        XCTAssertNil(restarted.txHash)
        XCTAssertFalse(restarted.validated(owner: "0x" + String(repeating: "3", count: 40)))
    }

    func testClaimDraftKeepsBearerKeyAcrossEveryUncertainOutcome() throws {
        for result: SubmitOutcome in [.failed(.submissionUnknown(reason: "lost response")),
                                      .failed(.timeout(hash: txHash)),
                                      .failed(.unreachable(hash: txHash, error: "offline"))] {
            var draft = try claimDraft()
            XCTAssertTrue(draft.retain(after: result))
            let restarted = try JSONDecoder().decode(PendingClaimLink.self, from: JSONEncoder().encode(draft))
            XCTAssertEqual(restarted.secret, draft.secret)
            XCTAssertTrue(restarted.validated(owner: payer))
        }
    }

    func testClaimDraftMayClearOnlyAfterDefiniteNoEscrowOutcome() throws {
        for result: SubmitOutcome in [.declined(reason: "not signed"), .demo,
                                      .failed(.reverted(hash: txHash, blockNumber: 100))] {
            var draft = try claimDraft()
            XCTAssertFalse(draft.retain(after: result))
        }
        var confirmed = try claimDraft()
        XCTAssertTrue(confirmed.retain(after: .delivered(Delivered(hash: txHash, blockNumber: 100,
            gasUsed: 100, sponsored: false, mintedId: 7))))
        let restarted = try JSONDecoder().decode(PendingClaimLink.self, from: JSONEncoder().encode(confirmed))
        XCTAssertEqual(restarted.linkId, 7)
        XCTAssertEqual(restarted.txHash, txHash)
    }
}

extension TestnetFinalizationTests {
    func testClaimRecoverySelectsOnlyItsOwnEscrowEvent() throws {
        let draft = try claimDraft()
        let contract = MarenAddresses.of(.testnet).marenPay
        let ownerTopic = "0x" + String(repeating: "0", count: 24) + payer.dropFirst(2)
        let keyTopic = "0x" + String(repeating: "0", count: 24) + draft.linkKey.dropFirst(2).lowercased()
        func log(owner: String, key: String, removed: Bool = false) throws -> EthereumLog {
            let json: [String: Any] = ["address": contract, "transactionHash": txHash, "data": "0x",
                "blockNumber": "0x64", "removed": removed,
                "topics": [MarenEncoding.linkCreatedTopic, "0x" + String(repeating: "0", count: 63) + "7", owner, key]]
            return try JSONDecoder().decode(EthereumLog.self, from: JSONSerialization.data(withJSONObject: json))
        }
        let valid = try log(owner: ownerTopic, key: keyTopic)
        XCTAssertEqual(draft.matchingHash(in: [valid], contract: contract), txHash)
        XCTAssertNil(draft.matchingHash(in: [try log(owner: keyTopic, key: keyTopic)], contract: contract))
        XCTAssertNil(draft.matchingHash(in: [try log(owner: ownerTopic, key: ownerTopic)], contract: contract))
        XCTAssertNil(draft.matchingHash(in: [try log(owner: ownerTopic, key: keyTopic, removed: true)], contract: contract))
        XCTAssertNil(draft.matchingHash(in: [valid], contract: payer))
    }
}
