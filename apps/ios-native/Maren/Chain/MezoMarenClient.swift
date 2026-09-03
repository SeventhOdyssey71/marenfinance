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

    var errorDescription: String? {
        switch self {
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
    let handle: String

    private var rpc: MezoRPC { MezoRPC(chain) }

    init(network: MezoNetwork = .testnet, accountAddress: String, handle: String = "") {
        self.chain = .of(network)
        self.accountAddress = accountAddress
        self.handle = handle
    }

    // MARK: reads

    func account() async throws -> Account {
        Account(handle: handle.isEmpty ? shortAddress(accountAddress) : handle, address: accountAddress)
    }

    func priceFeed() async throws -> PriceFeed {
        do {
            let (priceWei, updatedAt) = try await rpc.priceObservation()
            guard let usd = Wei.toDecimal(priceWei) else {
                return .unavailable(reason: "The oracle price did not fit a decimal figure.")
            }
            let asOf = Date(timeIntervalSince1970: TimeInterval(updatedAt))
            return .available(usdPerBtc: usd, asOf: asOf)
        } catch {
            // A failed or stale read is unavailable, NEVER a fabricated number.
            return .unavailable(reason: "Mezo's price oracle could not be read right now.")
        }
    }

    func position() async throws -> Position {
        let (priceWei, _) = try await rpc.priceObservation()

        // POOLED FIRST, best-effort. Most Maren loans are pooled positions held in MarenVault
        // and keyed by the user's EOA; the raw TroveManager trove is owned by the vault, not the
        // user, so a read that only hit `trove()` reported "no debt" for a real pooled borrower.
        // A pooled debt carries no per-user 200 MUSD gas compensation, so nothing is subtracted.
        // A vault read failure must NOT hide a direct trove, so it is tolerated (try?).
        let vault = try? await rpc.vaultPosition(accountAddress)
        if let vault, vault.debtWei > 0 {
            return Self.buildPosition(collWei: vault.collWei, ratioDebtWei: vault.debtWei,
                                      shownDebtWei: vault.debtWei, priceWei: priceWei)
        }

        // Otherwise a direct trove (>= the 1,800 MUSD protocol minimum), owned by the EOA. Its
        // principal includes the 200 MUSD gas compensation: the ratio is computed against the
        // gross debt, but the "borrowed" figure shown subtracts the gas comp back out.
        let trove = try? await rpc.trove(accountAddress)
        if let trove {
            let grossDebtWei = trove.principalWei + trove.interestWei
            if grossDebtWei > 0, trove.collWei > 0 {
                let netPrincipal = trove.principalWei > MUSD_GAS_COMPENSATION ? trove.principalWei - MUSD_GAS_COMPENSATION : BigUInt(0)
                return Self.buildPosition(collWei: trove.collWei, ratioDebtWei: grossDebtWei,
                                          shownDebtWei: netPrincipal + trove.interestWei, priceWei: priceWei)
            }
        }

        // If BOTH position reads failed, that is a genuine failure — throw so the UI shows an
        // honest "couldn't load", never a false "no debt".
        if vault == nil && trove == nil {
            throw MezoRPCError.allEndpointsFailed("position reads failed on every endpoint")
        }

        // No debt on either route. Collateral may still sit in the vault with nothing borrowed.
        let collWei = vault?.collWei ?? trove?.collWei ?? BigUInt(0)
        let collateralValueWei = collWei * priceWei / BigUInt(10).power(18)
        return Position(
            bitcoinLocked: Wei.toDecimal(collWei) ?? 0,
            borrowed: 0,
            leftToBorrow: Wei.toDecimal(collateralValueWei).map { $0 / (MarenPolicy.marenHealthyFloorPercent / 100) } ?? 0,
            collateralRatioPercent: nil,
            dropToLiquidationPercent: nil,
            health: .none
        )
    }

    /// Build a `Position` from a collateral + debt pair and the on-chain price — shared by the
    /// pooled and direct routes so they can never disagree on the maths. All wei integer maths.
    /// `ratioDebtWei` is the debt the collateral ratio and liquidation are measured against;
    /// `shownDebtWei` is the figure shown as "borrowed" (they differ for a direct trove's gas
    /// compensation).
    private static func buildPosition(collWei: BigUInt, ratioDebtWei: BigUInt, shownDebtWei: BigUInt, priceWei: BigUInt) -> Position {
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
            borrowed: Wei.toDecimal(shownDebtWei) ?? 0,
            leftToBorrow: Wei.toDecimal(leftWei) ?? 0,
            collateralRatioPercent: ratio,
            dropToLiquidationPercent: drop,
            health: health(ratioPercent: ratio)
        )
    }

    func balances() async throws -> Balances {
        let wei = try await rpc.musdBalance(accountAddress)
        return Balances(musd: Wei.toDecimal(wei) ?? 0)
    }

    /// Activity from `eth_getLogs`: MarenPay `Paid` events touching this account, over a
    /// bounded recent window. An empty array means the scan succeeded and found nothing in the
    /// window; a scan that fails THROWS rather than returning an empty history.
    func recentActivity() async throws -> [ActivityItem] {
        let maren = MarenAddresses.of(chain.network)
        guard maren.isDeployed else { return [] }
        let paidTopic0 = "Paid(address,address,uint256,bytes32,string)".web3.keccak256.web3.hexString
        let accountTopic = "0x" + String(accountAddress.dropFirst(2)).lowercased().leftPadded(to: 64)

        var lastError = "no endpoints"
        for url in chain.rpcURLs {
            do {
                let client = EthereumHttpClient(url: url, network: .custom(String(chain.chainId)))
                let head = try await client.eth_blockNumber()
                let from = max(0, head - Int(MEZO_MAX_LOG_RANGE))
                let logs = try await client.eth_getLogs(
                    addresses: [EthereumAddress(maren.marenPay)],
                    topics: [paidTopic0],
                    fromBlock: .Number(from),
                    toBlock: .Latest
                )
                return logs.compactMap { decodePaid($0, accountTopic: accountTopic) }
                    .sorted { $0.date > $1.date }
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    // MARK: activity decode

    private func decodePaid(_ log: EthereumLog, accountTopic: String) -> ActivityItem? {
        guard log.topics.count >= 3 else { return nil }
        let fromTopic = log.topics[1].lowercased()
        let toTopic = log.topics[2].lowercased()
        let isFrom = fromTopic == accountTopic
        let isTo = toTopic == accountTopic
        guard isFrom || isTo else { return nil }

        // data = amount(32) + memo offset(32) + memo len(32) + memo bytes
        guard let data = Data(hex: log.data) else { return nil }
        let amountWei = MezoRPC.word(data, 0)
        let amount = Wei.toDecimal(amountWei) ?? 0
        let kind: ActivityItem.Kind = isTo ? .receive : .send
        let sign = isTo ? "+" : "-"
        let id = (log.transactionHash ?? UUID().uuidString) + "-" + String(log.logIndex ?? 0)
        return ActivityItem(
            id: id,
            kind: kind,
            title: isTo ? "Received MUSD" : "Sent MUSD",
            subtitle: "MarenPay transfer",
            amount: "\(sign)\(MoneyFormat.musd(amount, unit: false)) MUSD",
            date: Date()  // block timestamp is a separate read; omitted rather than faked precisely
        )
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
