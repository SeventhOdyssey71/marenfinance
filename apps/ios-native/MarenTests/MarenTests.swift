import XCTest
import SwiftUI
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
