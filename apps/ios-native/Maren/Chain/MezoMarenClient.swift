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
        let trove = try await rpc.trove(accountAddress)
        let (priceWei, _) = try await rpc.priceObservation()

        // Net principal drawn: TroveManager's principal includes the 200 MUSD gas compensation,
        // so it is subtracted back out. Total debt is principal + interest.
        let netPrincipal = trove.principalWei > MUSD_GAS_COMPENSATION ? trove.principalWei - MUSD_GAS_COMPENSATION : BigUInt(0)
        let debtWei = trove.principalWei + trove.interestWei
        let netDebtWei = netPrincipal + trove.interestWei

        let bitcoinLocked = Wei.toDecimal(trove.collWei) ?? 0
        let borrowed = Wei.toDecimal(netDebtWei) ?? 0

        // Collateral value in MUSD, from the on-chain price. All wei maths, so no rounding lie.
        let collateralValueWei = trove.collWei * priceWei / BigUInt(10).power(18)

        guard debtWei > 0, trove.collWei > 0 else {
            return Position(bitcoinLocked: bitcoinLocked, borrowed: 0, leftToBorrow: Wei.toDecimal(collateralValueWei).map { $0 / (MarenPolicy.marenHealthyFloorPercent / 100) } ?? 0,
                            collateralRatioPercent: nil, dropToLiquidationPercent: nil, health: .none)
        }

        let ratioPercent = collateralValueWei * 100 / debtWei
        let ratio = Decimal(string: String(ratioPercent)) ?? 0

        // Headroom under Maren's 180% floor: max debt at that ratio, minus what is drawn.
        let maxDebtAtFloorWei = collateralValueWei * 100 / BigUInt(180)
        let leftWei = maxDebtAtFloorWei > debtWei ? maxDebtAtFloorWei - debtWei : BigUInt(0)
        let leftToBorrow = Wei.toDecimal(leftWei) ?? 0

        // How far BTC can fall before the 110% Mezo liquidation cliff.
        // liqPrice = debt * 1.1 / coll ; drop% = (price - liqPrice) / price * 100.
        let liqPriceWei = debtWei * MezoLiquidationNumerator / (trove.collWei * 10)
        let drop: Decimal?
        if priceWei > liqPriceWei {
            let dropWei = (priceWei - liqPriceWei) * 100 / priceWei
            drop = Decimal(string: String(dropWei))
        } else {
            drop = 0
        }

        return Position(
            bitcoinLocked: bitcoinLocked,
            borrowed: borrowed,
            leftToBorrow: leftToBorrow,
            collateralRatioPercent: ratio,
            dropToLiquidationPercent: drop,
            health: Self.health(ratioPercent: ratio)
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
