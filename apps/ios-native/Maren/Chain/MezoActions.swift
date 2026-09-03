import Foundation
import BigInt
import web3

// MARK: - MezoActions — the value-moving write/sign path
//
// The Swift port of `apps/ios/src/chain/actions.ts`, built to the same discipline:
//
//   1. Biometric-gated key access on EVERY signing action (Keystore.access forces Face ID).
//   2. Submit, yielding a hash — relayed as a signed ForwardRequest, or self-submitted.
//   3. `Receipt.confirm` — the single R15 checkpoint. A hash is not a success.
//
// The live path is GATED on a configured relayer URL. None is set in this repo, so
// `submit` returns `.declined` with the same honest sentence the RN app uses, rather than
// producing a receipt and a hash that do not exist on chain.

enum ActionResult: Sendable {
    case ok(Delivered)
    case declined(reason: String)
    case failed(TxOutcome)
}

/// An in-memory key storage so web3.swift's `EthereumAccount` can sign for the duration of
/// one action. The key is held only for this object's lifetime and never written to disk.
final class InMemoryKeyStorage: EthereumSingleKeyStorageProtocol {
    private let key: Data
    init(_ key: Data) { self.key = key }
    func storePrivateKey(key: Data) throws {}
    func loadPrivateKey() throws -> Data { key }
}

struct MezoActions {
    let chain: MezoChain
    private var rpc: MezoRPC { MezoRPC(chain) }

    init(_ chain: MezoChain) { self.chain = chain }

    // MARK: signing primitives (independently golden-tested)

    /// Sign an EIP-712 ForwardRequest. Returns the 65-byte signature as 0x hex (v = 27/28),
    /// exactly what `MarenRelayHub`/OpenZeppelin's `ERC2771Forwarder` recover against.
    static func signForwardRequest(privateKey: Data, chainId: Int, verifyingContract: String, request: MarenEncoding.ForwardRequest) throws -> String {
        let typed = try MarenEncoding.forwardRequestTypedData(chainId: chainId, verifyingContract: verifyingContract, request: request)
        let account = try EthereumAccount(keyStorage: InMemoryKeyStorage(privateKey))
        return try account.signMessage(message: typed)
    }

    /// Sign a claimable-link claim. The bearer key signs the EIP-191 personal-message hash of
    /// `keccak256(abi.encode("MarenPay.claimLink", chainId, marenPay, linkId, recipient))`,
    /// binding the payout to `recipient`. `EthereumAccount.signMessage(message:)` applies the
    /// identical `toEthSignedMessageHash` prefix the contract's `linkClaimDigest` uses.
    static func signClaimLink(linkSecret: Data, chainId: Int, marenPay: String, linkId: BigUInt, recipient: String) throws -> String {
        let inner = try MarenEncoding.claimLinkInner(chainId: chainId, marenPay: marenPay, linkId: linkId, recipient: recipient)
        let account = try EthereumAccount(keyStorage: InMemoryKeyStorage(linkSecret))
        return try account.signMessage(message: inner)
    }

    // MARK: relayed submit

    /// The gas cap to sign into a ForwardRequest, from a direct-call estimate. A generous
    /// ceiling costs nothing (the relayer runs its own estimate); a tight one buys an
    /// out-of-gas revert Maren pays for. Clamped to the ceiling past which the relayer refuses.
    static func relayGasLimit(directEstimate: BigUInt) -> BigUInt {
        let padded = directEstimate + directEstimate / 2 + 60_000
        let cap = BigUInt(MAX_RELAY_GAS)
        return padded > cap ? cap : padded
    }

    /// Submit a sponsored `pay` to `to`. Face ID → build calldata → sign ForwardRequest →
    /// POST to the relayer → confirm the receipt. Declines honestly when no relayer is set or
    /// the Keychain key does not derive `loadedAddress`.
    func send(loadedAddress: String, to: String, amountWei: BigUInt, memo: String) async -> ActionResult {
        guard let relayerURL = RelayerConfig.url else {
            return .declined(reason: MarenClientError.liveWritesUnavailable.errorDescription ?? "Live writes unavailable.")
        }

        // 1 — Face ID on every signing action, without exception.
        let access = await Keystore.shared.access()
        let privateKey: Data
        switch access {
        case .ok(let key): privateKey = key
        case .denied(let reason): return .declined(reason: reason)
        case .missing: return .declined(reason: "No signing key is available on this device.")
        }

        // The Keychain key MUST derive the loaded account, or signing would produce a valid
        // transaction from the WRONG account — worse than not signing at all.
        guard let derived = try? Keystore.address(of: privateKey),
              derived.lowercased() == loadedAddress.lowercased() else {
            return .declined(reason: MarenClientError.keyMismatch.errorDescription ?? "Key mismatch.")
        }

        let maren = MarenAddresses.of(chain.network)
        do {
            let data = try MarenEncoding.payCalldata(to: to, amount: amountWei, memo: memo)

            // 2 — build the signed ForwardRequest. Nonce is read on-chain, never guessed.
            let estimate = (try? await rpc.estimateGas(from: loadedAddress, to: maren.marenPay, data: data)) ?? BigUInt(300_000)
            let nonce = try await rpc.forwarderNonce(hub: maren.marenForwarder, owner: loadedAddress)
            let deadline = UInt64(Date().timeIntervalSince1970) + RELAY_DEADLINE_SECONDS
            let request = MarenEncoding.ForwardRequest(
                from: loadedAddress, to: maren.marenPay, value: 0,
                gas: Self.relayGasLimit(directEstimate: estimate), nonce: nonce,
                deadline: deadline, data: data
            )
            let signature = try Self.signForwardRequest(
                privateKey: privateKey, chainId: chain.chainId,
                verifyingContract: maren.marenForwarder, request: request
            )

            let body: [String: String] = [
                "from": request.from, "to": request.to,
                "value": String(request.value), "gas": String(request.gas),
                "nonce": String(request.nonce), "deadline": String(request.deadline),
                "data": request.data.web3.hexString, "signature": signature,
            ]

            // 3 — POST. A hash is not a success — it goes through the receipt check below.
            let accepted = try await Relayer(baseURL: relayerURL).post(body: body)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            let outcome = await Receipt.confirm(client: client, hash: accepted.hash, sponsored: true)
            if case .delivered(let d) = outcome { return .ok(d) }
            return .failed(outcome)
        } catch let refused as RelayRefused {
            return .declined(reason: refused.reason.detail)
        } catch {
            return .declined(reason: "The transaction could not be prepared, so nothing was submitted and no gas was spent.")
        }
    }
}
