import Foundation
import BigInt
import web3

// MARK: - MezoMarenClient
//
// The real Mezo implementation of `MarenClient`. Reads run against the public testnet RPC
// (no key required); the write/sign path is built here but GATED on a configured relayer URL
// — none is set in this repo, so writes decline honestly, exactly as the RN app does.
//
// HONEST DATA throughout: a read that fails throws, and the price feed reports `.unavailable`
// rather than a fabricated dollar figure. Nothing here invents a balance, a ratio, or a hash.

enum MarenClientError: LocalizedError {
    case noAccount
    case liveWritesUnavailable
    case keyMismatch
    case demoHasNoChain

    var errorDescription: String? {
        switch self {
        case .demoHasNoChain:
            return "This build runs on demo data, so there is no Mezo record to read for that."
        case .noAccount:
            return "No account is loaded, so there is nothing to read or sign for."
        case .liveWritesUnavailable:
            return "This build reads Mezo but has no relayer configured to sign to it, so submitting here would produce a receipt and a transaction hash that do not exist on chain. Configure MAREN_RELAYER_URL, or use demo data to walk the flow."
        case .keyMismatch:
            return "The signing key on this device does not match the loaded account."
        }
    }
}

struct MezoMarenClient: MarenClient {
    let chain: MezoChain
    /// The address reads are bound to. Reads are public, so this can be any address the app
    /// has been pointed at; the write path additionally checks the Keychain key derives it.
    let accountAddress: String
    /// The device-local display nickname. It is carried here as a LABEL and is never promoted
    /// to a handle: only `confirmedHandle()` can produce one of those.
    let nickname: String

    private var rpc: MezoRPC { MezoRPC(chain) }

    /// Cache key for the coalescing snapshot store. Network-scoped so switching networks
    /// cannot serve the other one's balances.
    private var snapshotKey: String { "\(chain.network)|\(accountAddress.lowercased())" }

    /// The one batched read every screen-level accessor below draws from.
    private func snapshot() async throws -> MezoSnapshot {
        try await MezoSnapshotStore.shared.snapshot(rpc: rpc, account: accountAddress, key: snapshotKey)
    }

    init(network: MezoNetwork = .testnet, accountAddress: String, nickname: String = "") {
        self.chain = .of(network)
        self.accountAddress = accountAddress
        self.nickname = nickname
    }

    // MARK: reads

    func account() async throws -> Account {
        Account(address: accountAddress,
                registeredHandle: await confirmedHandle(),
                nickname: nickname)
    }

    /// The @handle MarenRegistry says this address owns, or nil.
    ///
    /// BOTH LEGS OF THE REGISTRY MUST AGREE. `primaryHandle(owner)` is the reverse read and
    /// names the handle; `tryResolve(handle)` is the forward read that a payer's app actually
    /// follows, and it must come back to this exact address. Requiring both means the name this
    /// app prints as "@you" is the same name a stranger's payment would land on. Anything else
    /// (no registration, a read that failed, an address mismatch) yields nil, and the account
    /// falls back to the 0x address, which is always true.
    private func confirmedHandle() async -> String? {
        guard MarenAddresses.of(chain.network).isDeployed else { return nil }
        guard let name = try? await rpc.primaryHandle(of: accountAddress), !name.isEmpty else {
            return nil
        }
        guard let resolved = try? await rpc.resolveHandle(name),
              resolved.lowercased() == accountAddress.lowercased() else {
            return nil
        }
        return name
    }

    func priceFeed() async throws -> PriceFeed {
        do {
            let snap = try await snapshot()
            guard let priceWei = snap.priceWei, let updatedAt = snap.priceUpdatedAt else {
                return .unavailable(reason: "The oracle price did not fit a decimal figure.")
            }
            guard let usd = Wei.toDecimal(priceWei) else {
                return .unavailable(reason: "The oracle price did not fit a decimal figure.")
            }
            let asOf = Date(timeIntervalSince1970: TimeInterval(updatedAt))
            // Mezo's PriceFeed.fetchPrice() reverts above 60s staleness, so a price this old is
            // one every on-chain borrow/liquidate/read path would reject. Surface it as
            // unavailable rather than presenting a number the protocol itself would refuse. A
            // clock-skewed future timestamp (negative age) is treated as fresh, not stale.
            let age = Date().timeIntervalSince(asOf)
            if !Self.isFresh(updatedAt: updatedAt) {
                return .unavailable(reason: "Mezo's price oracle is \(Int(age))s old — past the 60s the protocol accepts, so it reads as unavailable.")
            }
            return .available(usdPerBtc: usd, asOf: asOf)
        } catch {
            // A failed or stale read is unavailable, NEVER a fabricated number.
            return .unavailable(reason: "Mezo's price oracle could not be read right now.")
        }
    }

    func position() async throws -> Position {
        // ONE batched read. This used to be priceObservation -> vaultPosition -> trove, three
        // requests nose to tail at ~300ms each before anything could render.
        let snap = try await snapshot()
        guard let priceWei = snap.priceWei, let updatedAt = snap.priceUpdatedAt else {
            throw MezoRPCError.decode("oracle returned a non-positive price")
        }
        // THE SAME 60s GATE `priceFeed()` APPLIES. This read used to take the oracle price with
        // no staleness check at all, so Finance could print a collateral ratio and a
        // drop-to-liquidation line directly above its own "price unavailable" banner, both
        // computed from a price the protocol would have rejected. A stale price now withholds
        // every price-derived field; collateral and debt need no oracle and still show.
        // A clock-skewed future timestamp (negative age) is treated as fresh, matching priceFeed.
        let priceIsFresh = Self.isFresh(updatedAt: updatedAt)

        // POOLED FIRST, best-effort. Most Maren loans are pooled positions held in MarenVault
        // and keyed by the user's EOA; the raw TroveManager trove is owned by the vault, not the
        // user, so a read that only hit `trove()` reported "no debt" for a real pooled borrower.
        // A pooled debt carries no per-user 200 MUSD gas compensation, so nothing is subtracted.
        // A vault read failure must NOT hide a direct trove, so it is tolerated (try?).
        if let debt = snap.vaultDebtWei, debt > 0 {
            return Self.buildPosition(collWei: snap.vaultCollWei ?? 0, ratioDebtWei: debt,
                                      shownDebtWei: debt, priceWei: priceWei,
                                      priceIsFresh: priceIsFresh)
        }

        // Otherwise a direct trove (>= the 1,800 MUSD protocol minimum), owned by the EOA. Its
        // principal includes the 200 MUSD gas compensation: the ratio is computed against the
        // gross debt, but the "borrowed" figure shown subtracts the gas comp back out.
        let trove = snap.trove
        if let trove {
            let grossDebtWei = trove.principalWei + trove.interestWei
            if grossDebtWei > 0, trove.collWei > 0 {
                let netPrincipal = trove.principalWei > MUSD_GAS_COMPENSATION ? trove.principalWei - MUSD_GAS_COMPENSATION : BigUInt(0)
                return Self.buildPosition(collWei: trove.collWei, ratioDebtWei: grossDebtWei,
                                          shownDebtWei: netPrincipal + trove.interestWei,
                                          priceWei: priceWei, priceIsFresh: priceIsFresh)
            }
        }

        // NO EQUIVALENT OF THE OLD "both reads failed" GUARD IS NEEDED, and removing it is
        // not a loss of honesty. It existed because each read was its own request with its own
        // `try?`, so "nil" could mean either "no position" or "the network failed" and the two
        // had to be told apart. In one batched call the transport either succeeded — in which
        // case a reverting sub-call genuinely means this account has no trove and no pooled
        // position — or it threw, and `snapshot()` above has already propagated that.

        // No debt on either route. Collateral may still sit in the vault with nothing borrowed.
        // "No debt" is a fact about the vault, so the health reads `.none` either way; the
        // headroom is priced collateral, so it is withheld when the price is stale.
        let collWei = snap.vaultCollWei ?? trove?.collWei ?? BigUInt(0)
        let collateralValueWei = collWei * priceWei / BigUInt(10).power(18)
        return Position(
            bitcoinLocked: Wei.toDecimal(collWei) ?? 0,
            borrowed: 0,
            leftToBorrow: priceIsFresh
                ? (Wei.toDecimal(collateralValueWei).map { $0 / (MarenPolicy.marenHealthyFloorPercent / 100) } ?? 0)
                : nil,
            collateralRatioPercent: nil,
            dropToLiquidationPercent: nil,
            health: HealthStatus.none
        )
    }

    /// Is an oracle observation inside the 60s window Mezo's own `PriceFeed.fetchPrice()`
    /// accepts? One rule, shared by `priceFeed()` and `position()`, so the banner and the
    /// figures beneath it can never disagree about whether the price is usable.
    static func isFresh(updatedAt: BigUInt, now: Date = Date()) -> Bool {
        let asOf = Date(timeIntervalSince1970: TimeInterval(updatedAt))
        return now.timeIntervalSince(asOf) <= TimeInterval(ORACLE_MAX_PRICE_DELAY_SECONDS)
    }

    /// Build a `Position` from a collateral + debt pair and the on-chain price — shared by the
    /// pooled and direct routes so they can never disagree on the maths. All wei integer maths.
    /// `ratioDebtWei` is the debt the collateral ratio and liquidation are measured against;
    /// `shownDebtWei` is the figure shown as "borrowed" (they differ for a direct trove's gas
    /// compensation).
    ///
    /// `priceIsFresh` is the oracle's 60s gate. When it is false EVERY price-derived field comes
    /// back nil, because a ratio computed from a price the protocol would reject is exactly the
    /// kind of plausible figure this app must not print. Collateral and debt are unaffected:
    /// they are read from the vault and owe the oracle nothing.
    /// Internal rather than private so the stale-price rule can be pinned by a unit test with no
    /// network: the regression it guards (a ratio printed from a price the protocol rejects) is
    /// not something a view test would catch.
    static func buildPosition(collWei: BigUInt, ratioDebtWei: BigUInt, shownDebtWei: BigUInt,
                              priceWei: BigUInt, priceIsFresh: Bool) -> Position {
        let borrowed = Wei.toDecimal(shownDebtWei) ?? 0
        guard priceIsFresh else {
            return Position(
                bitcoinLocked: Wei.toDecimal(collWei) ?? 0,
                borrowed: borrowed,
                leftToBorrow: nil,
                collateralRatioPercent: nil,
                dropToLiquidationPercent: nil,
                health: nil
            )
        }

        let collateralValueWei = collWei * priceWei / BigUInt(10).power(18)
        let ratioPercent = ratioDebtWei > 0 ? collateralValueWei * 100 / ratioDebtWei : BigUInt(0)
        let ratio = Decimal(string: String(ratioPercent)) ?? 0

        // Headroom under Maren's 180% floor: max debt at that ratio, minus what is drawn.
        let maxDebtAtFloorWei = collateralValueWei * 100 / BigUInt(180)
        let leftWei = maxDebtAtFloorWei > ratioDebtWei ? maxDebtAtFloorWei - ratioDebtWei : BigUInt(0)

        // How far BTC can fall before the 110% Mezo liquidation cliff.
        // liqPrice = debt * 1.1 / coll, kept in the same 1e18 price scale (the * WAD is what
        // makes the units match `priceWei`; without it the drop collapsed to ~99% for a
        // small-collateral position). drop% = (price - liqPrice) / price * 100.
        var drop: Decimal? = nil
        if collWei > 0 {
            let liqPriceWei = ratioDebtWei * MezoLiquidationNumerator * BigUInt(10).power(18) / (collWei * 10)
            drop = priceWei > liqPriceWei
                ? Decimal(string: String((priceWei - liqPriceWei) * 100 / priceWei))
                : 0
        }

        return Position(
            bitcoinLocked: Wei.toDecimal(collWei) ?? 0,
            borrowed: borrowed,
            leftToBorrow: Wei.toDecimal(leftWei) ?? 0,
            collateralRatioPercent: ratio,
            dropToLiquidationPercent: drop,
            health: health(ratioPercent: ratio)
        )
    }

    func balances() async throws -> Balances {
        let snap = try await snapshot()
        return Balances(musd: Wei.toDecimal(snap.musdWei ?? 0) ?? 0,
                        btc: Wei.toDecimal(snap.btcWei ?? 0) ?? 0)
    }

    func earnBalance() async throws -> Decimal {
        Wei.toDecimal(try await snapshot().earnSharesWei ?? 0) ?? 0
    }

    /// The Earn pool's live composition: MUSD backing plus any Bitcoin it seized absorbing
    /// liquidations, valued in MUSD at the oracle price. The stale-price flag is read alongside
    /// so the UI can refuse to present the BTC valuation as authoritative when the oracle price
    /// is one the protocol would reject. A read failure throws — never a fabricated breakdown.
    func earnExposure() async throws -> EarnExposure {
        let snap = try await snapshot()
        guard let b = snap.earnBreakdown else {
            throw MezoRPCError.decode("could not read the Earn vault's asset breakdown")
        }
        let musdBacking = (Wei.toDecimal(b.musdIdleWei) ?? 0) + (Wei.toDecimal(b.musdInPoolWei) ?? 0)
        let btcSeized = (Wei.toDecimal(b.btcHeldWei) ?? 0) + (Wei.toDecimal(b.btcPendingWei) ?? 0)
        return EarnExposure(
            musdBacking: musdBacking,
            btcSeized: btcSeized,
            btcValuedMusd: Wei.toDecimal(b.btcValuedWei) ?? 0,
            stalePrice: snap.earnStalePrice ?? false
        )
    }

    /// Backward-looking realised yield for MarenEarn, from the vault's on-chain `Harvested`
    /// events. Each harvest records the exact native BTC the vault SEIZED from liquidations
    /// (`btcClaimed`, data word 0); summing it over a bounded trailing window is an exact,
    /// non-overlapping quantity that needs no oracle. Its MUSD value is that BTC at the CURRENT
    /// oracle price and is WITHHELD when the price is stale or unavailable — a value the
    /// protocol would reject is never shown. The MUSD leg does not add `musdCompounded`: that is
    /// a denomination change of BTC already counted, so adding it would double-count the gain.
    ///
    /// This is a vault-wide figure — what backs every share, not this account's slice — because
    /// a per-user cost basis needs a deposit/withdraw ledger the chain does not expose without an
    /// off-chain indexer. A scan that fails on every endpoint THROWS; a scan that succeeds and
    /// finds no gains returns a `RealisedYield` with `hasReturn == false`, never a faked rate.
    func earnRealisedYield() async throws -> RealisedYield {
        let maren = MarenAddresses.of(chain.network)
        guard maren.isDeployed else {
            return RealisedYield(btcRealised: 0, musdRealised: nil, windowDays: 0,
                                 liquidationEvents: 0, annualisedPercent: nil, lastGainAt: nil)
        }

        // The MUSD base and the live-price gate come from reads that fail over on their own;
        // the log scan runs its own endpoint failover, mirroring recentActivity.
        async let exposure = earnExposure()
        async let feed = priceFeed()
        let scan = try await scanHarvests(contract: maren.marenEarn)
        let exp = try await exposure
        let priceFeed = try await feed

        // Value the seized BTC only when the oracle price is one the protocol would accept —
        // both the app's own 60s gate (priceFeed .available) AND the vault's own stale flag.
        var musdRealised: Decimal? = nil
        if case let .available(usdPerBtc, _) = priceFeed, !exp.stalePrice {
            musdRealised = scan.btcRealised * usdPerBtc
        }

        // Annualise only from a real MUSD gain over a long-enough window against a real base;
        // otherwise the percent is withheld (nil), never shown as 0%.
        let annualised = musdRealised.flatMap {
            RealisedYieldMath.annualisedPercent(realisedMusd: $0, baseMusd: exp.musdBacking,
                                                windowDays: scan.windowDays,
                                                gainBearingEvents: scan.liquidationEvents,
                                                minWindowDays: EARN_YIELD_MIN_ANNUALISE_DAYS,
                                                minEvents: EARN_YIELD_MIN_ANNUALISE_EVENTS)
        }

        return RealisedYield(
            btcRealised: scan.btcRealised,
            musdRealised: musdRealised,
            windowDays: scan.windowDays,
            liquidationEvents: scan.liquidationEvents,
            annualisedPercent: annualised,
            lastGainAt: scan.lastGainAt
        )
    }

    private struct HarvestScan: Sendable {
        let btcRealised: Decimal
        let liquidationEvents: Int
        let windowDays: Int
        let lastGainAt: Date?
    }

    /// Sum the BTC seized across `Harvested` events over `EARN_YIELD_LOOKBACK_BLOCKS`, in the
    /// same parallel 10k-block `eth_getLogs` pages recentActivity uses, with the same endpoint
    /// failover. The window's length is read from the floor block's real timestamp, not assumed.
    private func scanHarvests(contract: String) async throws -> HarvestScan {
        let chainId = chain.chainId
        let topic = Self.harvestedTopic

        var lastError = "no endpoints"
        for url in chain.rpcURLs {
            do {
                let head = try await EthereumHttpClient(url: url, network: .custom(String(chainId))).eth_blockNumber()
                let floor = max(0, head - EARN_YIELD_LOOKBACK_BLOCKS)

                var windows: [(Int, Int)] = []
                var from = floor
                while from <= head {
                    let to = min(head, from + MEZO_MAX_LOG_RANGE - 1)
                    windows.append((from, to))
                    from = to + 1
                }

                let raw = try await withThrowingTaskGroup(of: [RawLog].self) { group -> [RawLog] in
                    for window in windows {
                        group.addTask {
                            try await Self.fetchLogs(url: url, chainId: chainId, address: contract,
                                                     from: window.0, to: window.1)
                        }
                    }
                    var all: [RawLog] = []
                    for try await page in group { all.append(contentsOf: page) }
                    return all
                }

                // Keep only Harvested logs; sum btcClaimed (data word 0) across them. A harvest
                // that seized nothing (btcClaimed == 0) is not a realised gain and is not counted.
                var btcWei = BigUInt(0)
                var events = 0
                var lastGainBlock = 0
                for log in raw where log.topics.first?.lowercased() == topic {
                    guard let data = Data(hex: log.data) else { continue }
                    let claimed = MezoRPC.word(data, 0)
                    if claimed > 0 {
                        btcWei += claimed
                        events += 1
                        if log.block > lastGainBlock { lastGainBlock = log.block }
                    }
                }

                // Real window length from the floor block's timestamp, plus the most-recent
                // gain's timestamp. A block we cannot read leaves that figure unknown rather
                // than inventing a date from an assumed block interval.
                var wanted = [floor]
                if lastGainBlock > 0 { wanted.append(lastGainBlock) }
                let times = await Self.blockTimestamps(url: url, chainId: chainId, blocks: wanted)

                var windowDays = 0
                if let floorTime = times[floor] {
                    let secs = Date().timeIntervalSince(floorTime)
                    windowDays = secs > 0 ? Int(secs / 86_400) : 0
                }
                let lastGainAt = lastGainBlock > 0 ? times[lastGainBlock] : nil

                return HarvestScan(
                    btcRealised: Wei.toDecimal(btcWei) ?? 0,
                    liquidationEvents: events,
                    windowDays: windowDays,
                    lastGainAt: lastGainAt
                )
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    /// topic0 of `Harvested(uint256,uint256,uint256,uint256)` — the vault's realised-gain event.
    /// Computed with the same keccak the activity map uses; a golden test pins it to the value
    /// Foundry's `cast keccak` produces so a wrong byte here fails loudly rather than silently
    /// dropping every harvest.
    static let harvestedTopic = "Harvested(uint256,uint256,uint256,uint256)"
        .web3.keccak256.web3.hexString.lowercased()

    /// Activity from `eth_getLogs`, across all three Maren contracts and every event they
    /// emit — the same scan the web app runs (apps/web/src/lib/chain/logs.ts), so the two
    /// apps agree on a user's history. Vault (deposit/borrow/repay/withdraw), Pay
    /// (send/receive/request/link) and Earn (supply/withdraw). Scans a bounded window back
    /// from head in 10k-block pages (Mezo's `eth_getLogs` cap). An empty array means the scan
    /// succeeded and found nothing; a scan that fails THROWS rather than faking an empty list.
    /// A Sendable snapshot of a log, so the many `eth_getLogs` pages can be fetched
    /// concurrently under strict concurrency — `EthereumLog` itself is not Sendable, so it
    /// cannot cross a task boundary, but this can.
    private struct RawLog: Sendable {
        let topics: [String]
        let data: String
        let block: Int
        let logIndex: Int
        let txHash: String?
    }

    /// One MarenPay request, read live from `requests(uint256)`. A `None` status means the
    /// contract holds no record under that id, which is returned as nil — never as a
    /// zero-amount request with a zero-address requester. A transport failure throws.
    func paymentRequest(_ requestId: UInt64) async throws -> PaymentRequestRecord? {
        guard MarenAddresses.of(chain.network).isDeployed else { return nil }
        let read = try await rpc.paymentRequest(BigUInt(requestId))
        guard read.exists, let amount = Wei.toDecimal(read.amountWei) else { return nil }
        return PaymentRequestRecord(
            id: requestId,
            requester: read.requester,
            payer: read.openToAnyone ? nil : read.payer,
            amount: amount,
            createdAt: Date(timeIntervalSince1970: TimeInterval(read.createdAt)),
            status: PaymentRequestRecord.Status(rawValue: read.status) ?? .none
        )
    }

    func recentActivity() async throws -> [ActivityItem] {
        let maren = MarenAddresses.of(chain.network)
        guard maren.isDeployed else { return [] }
        let acct = "0x" + String(accountAddress.dropFirst(2)).lowercased().leftPadded(to: 64)
        let names = Self.eventNamesByTopic
        let contracts = [maren.marenVault, maren.marenPay, maren.marenEarn]
        let chainId = chain.chainId

        var lastError = "no endpoints"
        for url in chain.rpcURLs {
            do {
                let head = try await EthereumHttpClient(url: url, network: .custom(String(chainId))).eth_blockNumber()
                let floor = max(0, head - MEZO_MAX_LOG_RANGE * 4)

                var windows: [(Int, Int)] = []
                var from = floor
                while from <= head {
                    let to = min(head, from + MEZO_MAX_LOG_RANGE - 1)
                    windows.append((from, to))
                    from = to + 1
                }

                // Every (window × contract) page in parallel — each task builds its own client
                // and returns Sendable RawLogs, so one round-trip's latency covers them all.
                let raw = try await withThrowingTaskGroup(of: [RawLog].self) { group -> [RawLog] in
                    for window in windows {
                        for contract in contracts {
                            group.addTask {
                                try await Self.fetchLogs(url: url, chainId: chainId, address: contract,
                                                         from: window.0, to: window.1)
                            }
                        }
                    }
                    var all: [RawLog] = []
                    for try await page in group { all.append(contentsOf: page) }
                    return all
                }

                let mine = raw
                    .filter { Self.involves($0, account: acct, names: names) }
                    .sorted { $0.block != $1.block ? $0.block > $1.block : $0.logIndex > $1.logIndex }
                    .prefix(50)

                let times = await Self.blockTimestamps(url: url, chainId: chainId,
                                                       blocks: Array(Set(mine.map { $0.block })))
                return mine.compactMap { decodeActivity($0, account: acct, names: names, times: times) }
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    /// One contract's logs over one window, snapshotted to Sendable RawLogs. Static + its own
    /// client, so it is safe to run in a task group.
    private static func fetchLogs(url: URL, chainId: Int, address: String, from: Int, to: Int) async throws -> [RawLog] {
        let client = EthereumHttpClient(url: url, network: .custom(String(chainId)))
        let logs = try await client.eth_getLogs(
            addresses: [EthereumAddress(address)], topics: nil,
            fromBlock: .Number(from), toBlock: .Number(to)
        )
        return logs.map {
            RawLog(topics: $0.topics, data: $0.data, block: blockInt($0.blockNumber),
                   logIndex: Int($0.logIndex ?? 0), txHash: $0.transactionHash)
        }
    }

    /// Block timestamps for the rows about to render, read concurrently. A block we cannot
    /// read leaves that row's date unknown rather than inventing one from an assumed interval.
    private static func blockTimestamps(url: URL, chainId: Int, blocks: [Int]) async -> [Int: Date] {
        // Immutable once mined, so anything already seen this session is free. Only the
        // genuinely new blocks cost a request.
        let cached = await BlockTimeCache.shared.known(blocks)
        let missing = blocks.filter { $0 > 0 && cached[$0] == nil }
        if missing.isEmpty { return cached }

        let fetched = await withTaskGroup(of: (Int, Date)?.self) { group -> [Int: Date] in
            for block in missing {
                group.addTask {
                    let client = EthereumHttpClient(url: url, network: .custom(String(chainId)))
                    guard let info = try? await client.eth_getBlockByNumber(.Number(block)) else { return nil }
                    return (block, info.timestamp)
                }
            }
            var out: [Int: Date] = [:]
            for await entry in group { if let entry { out[entry.0] = entry.1 } }
            return out
        }
        await BlockTimeCache.shared.store(fetched)
        return cached.merging(fetched) { _, new in new }
    }

    /// The Int of an `EthereumBlock`, or 0 for a non-numeric case (never reached for a log).
    private static func blockInt(_ block: EthereumBlock) -> Int {
        if case let .Number(n) = block { return n }
        return 0
    }

    // MARK: activity events + decode

    /// Canonical signatures of every event the history renders — one copy, mirroring the
    /// SDK's MAREN_*_EVENTS. topic0 = keccak(signature).
    private static let activityEventSignatures = [
        "Deposited(address,uint256,uint256,bool)",
        "Withdrawn(address,uint256,uint256)",
        "Borrowed(address,uint256,uint256,uint256,bool)",
        "Repaid(address,uint256,uint256)",
        "Paid(address,address,uint256,bytes32,string)",
        "PaidToHandle(bytes32,address,address,uint256,string)",
        "RequestCreated(uint256,address,address,uint256,string)",
        "LinkCreated(uint256,address,address,uint256,uint64)",
        "LinkClaimed(uint256,address,uint256)",
        "Deposit(address,address,uint256,uint256)",
        "Withdraw(address,address,address,uint256,uint256)",
    ]

    /// Lowercased topic0 → event name.
    static let eventNamesByTopic: [String: String] = {
        var map: [String: String] = [:]
        for sig in activityEventSignatures {
            let name = String(sig.prefix(while: { $0 != "(" }))
            map[sig.web3.keccak256.web3.hexString.lowercased()] = name
        }
        return map
    }()

    /// Is this a known event, indexed by this account? The account is an indexed address in
    /// every one of these events, so it appears in one of topics[1...]; that is the filter.
    private static func involves(_ log: RawLog, account: String, names: [String: String]) -> Bool {
        guard let t0 = log.topics.first?.lowercased(), names[t0] != nil else { return false }
        return log.topics.dropFirst().contains { $0.lowercased() == account }
    }

    private func decodeActivity(_ log: RawLog, account: String, names: [String: String], times: [Int: Date]) -> ActivityItem? {
        guard let t0 = log.topics.first?.lowercased(), let name = names[t0] else { return nil }
        guard let data = Data(hex: log.data) else { return nil }
        let amountWei = MezoRPC.word(data, 0)      // amount/assets is data word 0 in every one
        let amount = Wei.toDecimal(amountWei) ?? 0
        let topics = log.topics.map { $0.lowercased() }
        // No fallback date. `blockTimestamps` is best-effort, and a block it could not read
        // leaves this nil so the row renders as "Time unknown" rather than being filed under a
        // fabricated January 1970 header.
        let date = times[log.block]
        let id = (log.txHash ?? UUID().uuidString) + "-" + String(log.logIndex)

        func musd(_ sign: String) -> String { "\(sign)\(MoneyFormat.musd(amount, unit: false)) MUSD" }
        func btc(_ sign: String) -> String { "\(sign)\(MoneyFormat.btc(amount, unit: false)) BTC" }
        func row(_ kind: ActivityItem.Kind, _ title: String, _ subtitle: String, _ amountText: String) -> ActivityItem {
            ActivityItem(id: id, kind: kind, title: title, subtitle: subtitle, amount: amountText, date: date)
        }

        switch name {
        case "Deposited":   return row(.deposit, "Deposited Bitcoin", "Vault collateral", btc("+"))
        case "Withdrawn":   return row(.withdraw, "Withdrew Bitcoin", "From your vault", btc("-"))
        case "Borrowed":    return row(.borrow, "Borrowed MUSD", "Against BTC vault", musd("+"))
        case "Repaid":      return row(.repay, "Repaid MUSD", "To your vault", musd("-"))
        case "Paid":
            // from = topic1, to = topic2.
            let outgoing = topics.count > 1 && topics[1] == account
            return row(outgoing ? .send : .receive,
                       outgoing ? "Sent MUSD" : "Received MUSD", "MarenPay transfer",
                       musd(outgoing ? "-" : "+"))
        case "PaidToHandle":
            // from = topic2, to = topic3.
            let outgoing = topics.count > 2 && topics[2] == account
            return row(outgoing ? .send : .receive,
                       outgoing ? "Sent MUSD" : "Received MUSD", "MarenPay transfer",
                       musd(outgoing ? "-" : "+"))
        case "RequestCreated": return row(.receive, "Payment request", "MarenPay request", musd(""))
        case "LinkCreated":    return row(.send, "Created a claim link", "Escrowed MUSD", musd("-"))
        case "LinkClaimed":    return row(.receive, "Claim link claimed", "MarenPay link", musd("+"))
        case "Deposit":        return row(.earnDeposit, "Supplied to Earn", "Stability Pool", musd("-"))
        case "Withdraw":       return row(.earnWithdraw, "Withdrew from Earn", "Stability Pool", musd("+"))
        default: return nil
        }
    }

    private func shortAddress(_ addr: String) -> String {
        guard addr.count > 10 else { return addr }
        return String(addr.prefix(6)) + "…" + String(addr.suffix(4))
    }

    // MARK: health mapping

    static func health(ratioPercent ratio: Decimal) -> HealthStatus {
        if ratio >= MarenPolicy.marenTargetPercent { return .healthy }
        if ratio >= MarenPolicy.marenHealthyFloorPercent { return .caution }
        if ratio >= MarenPolicy.marenVaultLiquidationPercent { return .warning }
        if ratio >= MarenPolicy.mezoLiquidationPercent { return .danger }
        return .liquidatable
    }
}

/// 1.10 expressed as a numerator over 10, to keep the drop-to-liquidation maths in integers.
private let MezoLiquidationNumerator = BigUInt(11)

private extension String {
    func leftPadded(to length: Int) -> String {
        count >= length ? self : String(repeating: "0", count: length - count) + self
    }
}
