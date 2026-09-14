import Foundation
import BigInt
import web3

// MARK: - Receipt — R15, "a transaction hash is not a success"
//
// The single place this app decides a transaction succeeded, mirroring `apps/ios/src/chain/
// receipt.ts`. Nothing may render a payment, deposit, borrow, repay or withdraw as delivered
// except by holding a `Delivered` returned from `confirm`. `Delivered` is constructed only
// here — the only way to obtain one is to have gone through the receipt check.

/// Proof that an on-chain receipt was fetched and its status was literally `success`.
struct Delivered: Sendable, Equatable {
    let hash: String
    let blockNumber: BigUInt
    let gasUsed: BigUInt
    /// True when a Maren relayer paid the BTC gas under ERC-2771; then the user paid nothing.
    let sponsored: Bool
    /// The id this transaction MINTED, read out of the very receipt that proved it succeeded —
    /// the `linkId` from `LinkCreated`, the `requestId` from `RequestCreated`.
    ///
    /// nil for every action that mints nothing, AND nil when the log was absent or unreadable.
    /// It is never guessed: a link whose id could not be read is reported as such, because a
    /// fabricated id builds a claim link that points at somebody else's escrow.
    var mintedId: UInt64? = nil
}

/// Where a minted id lives in a receipt: the contract that emits it, the event's topic0, and
/// which indexed topic carries the number. `LinkCreated` and `RequestCreated` both declare the
/// id as their FIRST indexed parameter, so it rides in `topics[1]` and needs no data decoding.
struct MintedIdSource: Sendable, Equatable {
    let contract: String
    let topic0: String
    var topicIndex: Int = 1
}

enum TxOutcome: Sendable, Equatable {
    /// Submission was attempted but its response did not establish a transaction hash.
    case submissionUnknown(reason: String)
    case delivered(Delivered)
    /// The chain accepted the transaction and then reverted it. Funds did not move.
    case reverted(hash: String, blockNumber: BigUInt)
    /// No receipt inside the timeout. NOT a failure — it may still land.
    case timeout(hash: String)
    /// Could not reach the chain at all. Says nothing about whether it landed.
    case unreachable(hash: String, error: String)
}

enum Receipt {
    /// The one and only success check. Polls for a receipt until `timeout`, then classifies.
    /// A missing receipt (`noResultFound`) is "not yet", not a failure — we keep waiting.
    /// `mintedIdFrom` names an event whose indexed id this action created. It is read from the
    /// SAME receipt that established success, so an id can only ever be reported for a
    /// transaction the chain confirmed — and only `Receipt` can put one on a `Delivered`.
    static func confirm(
        client: EthereumHttpClient,
        hash: String,
        sponsored: Bool,
        mintedIdFrom: MintedIdSource? = nil,
        timeout: TimeInterval = 60,
        pollInterval: TimeInterval = 2
    ) async -> TxOutcome {
        let deadline = Date().addingTimeInterval(timeout)
        var lastTransportError: String?

        while Date() < deadline {
            do {
                let receipt = try await client.eth_getTransactionReceipt(txHash: hash)
                switch receipt.status {
                case .success:
                    return .delivered(Delivered(
                        hash: hash,
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed,
                        sponsored: sponsored,
                        mintedId: mintedIdFrom.flatMap { mintedId(in: receipt.logs, from: $0) }
                    ))
                case .failure:
                    return .reverted(hash: hash, blockNumber: receipt.blockNumber)
                case .notProcessed:
                    lastTransportError = nil // still pending
                }
            } catch EthereumClientError.noResultFound {
                lastTransportError = nil // receipt not mined yet — keep waiting
            } catch {
                // A transport failure must not be reported as if the transaction failed.
                lastTransportError = String(describing: error)
            }
            try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }

        if let err = lastTransportError {
            return .unreachable(hash: hash, error: err)
        }
        return .timeout(hash: hash)
    }

    /// The id `source` names, or nil. Every guard here returns nil rather than a fallback:
    /// a log from a different contract, a different event, a topic slot that is not there, or
    /// a value too large for a UInt64 all mean "this receipt did not tell us the id", and that
    /// is a state the UI is built to state plainly.
    static func mintedId(in logs: [EthereumLog], from source: MintedIdSource) -> UInt64? {
        let contract = source.contract.lowercased()
        let topic0 = source.topic0.lowercased()
        for log in logs {
            guard log.address.asString().lowercased() == contract else { continue }
            guard log.topics.count > source.topicIndex,
                  log.topics[0].lowercased() == topic0 else { continue }
            guard let value = BigUInt(hex: log.topics[source.topicIndex]),
                  value > 0, value <= BigUInt(UInt64.max) else { return nil }
            return UInt64(value)
        }
        return nil
    }
}
