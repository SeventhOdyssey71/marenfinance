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
}

enum TxOutcome: Sendable, Equatable {
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
    static func confirm(
        client: EthereumHttpClient,
        hash: String,
        sponsored: Bool,
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
                        sponsored: sponsored
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
}
