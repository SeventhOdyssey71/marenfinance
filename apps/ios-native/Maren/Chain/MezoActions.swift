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
    /// A relayed (gasless) MarenPay payment. `pay` moves MUSD with transferFrom, so a first
    /// send approves MarenPay once (self-paid); every send after it is fully gasless.
    func send(loadedAddress: String, to: String, amountWei: BigUInt, memo: String) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        if let approveDecline = await ensureMusdAllowance(privateKey: key, loadedAddress: loadedAddress,
                                                          spender: maren.marenPay, needed: amountWei) {
            return .declined(reason: approveDecline)
        }
        let data: Data
        do { data = try MarenEncoding.payCalldata(to: to, amount: amountWei, memo: memo) }
        catch { return .declined(reason: prepFailed) }
        return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenPay, data: data)
    }

    /// A relayed (gasless) MarenVault write — `function` is "borrow" | "repay" | "withdraw".
    func vaultWrite(_ function: String, loadedAddress: String, amountWei: BigUInt) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let data: Data
        do { data = try MarenEncoding.vaultWriteCalldata(function: function, amount: amountWei) }
        catch { return .declined(reason: prepFailed) }
        return await relayCall(privateKey: key, loadedAddress: loadedAddress,
                               to: MarenAddresses.of(chain.network).marenVault, data: data)
    }

    /// A self-paid deposit — the BTC is sent as msg.value, which a relayer cannot carry, so the
    /// user signs a direct tx and pays the BTC gas. `sponsored: false`, so it reads "you paid BTC".
    func deposit(loadedAddress: String, valueWei: BigUInt) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        do {
            let data = try MarenEncoding.depositCalldata()
            let hash = try await sendSelfPaid(privateKey: key, loadedAddress: loadedAddress,
                                              to: MarenAddresses.of(chain.network).marenVault,
                                              value: valueWei, data: data, gasLimit: 500_000)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            let outcome = await Receipt.confirm(client: client, hash: hash, sponsored: false)
            if case .delivered(let d) = outcome { return .ok(d) }
            return .failed(outcome)
        } catch {
            return .declined(reason: prepFailed)
        }
    }

    /// Supply MUSD to MarenEarn (ERC-4626). Self-paid: MarenEarn is not on the relay allowlist,
    /// so the user pays the BTC gas. A first supply approves MarenEarn to pull MUSD (one-time),
    /// then deposits `assets` to the user as receiver.
    func earnSupply(loadedAddress: String, assetsWei: BigUInt) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let earn = MarenAddresses.of(chain.network).marenEarn
        if let approveDecline = await ensureMusdAllowance(privateKey: key, loadedAddress: loadedAddress,
                                                          spender: earn, needed: assetsWei) {
            return .declined(reason: approveDecline)
        }
        do {
            let data = try MarenEncoding.earnDepositCalldata(assets: assetsWei, receiver: loadedAddress)
            let hash = try await sendSelfPaid(privateKey: key, loadedAddress: loadedAddress,
                                              to: earn, value: 0, data: data, gasLimit: 400_000)
            return await confirmSelfPaid(hash)
        } catch { return .declined(reason: prepFailed) }
    }

    /// Withdraw MUSD from MarenEarn. Self-paid; the user is both receiver and owner.
    func earnWithdraw(loadedAddress: String, assetsWei: BigUInt) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        do {
            let data = try MarenEncoding.earnWithdrawCalldata(assets: assetsWei, receiver: loadedAddress, owner: loadedAddress)
            let hash = try await sendSelfPaid(privateKey: key, loadedAddress: loadedAddress,
                                              to: MarenAddresses.of(chain.network).marenEarn, value: 0, data: data, gasLimit: 400_000)
            return await confirmSelfPaid(hash)
        } catch { return .declined(reason: prepFailed) }
    }

    /// Claim a payment link (relayed). The claimer's key signs the ForwardRequest; the link's
    /// own secret signs the claim digest that binds the payout to the claimer as recipient.
    func claimLink(loadedAddress: String, linkId: UInt64, secretHex: String) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        guard let secret = Data(hex: secretHex) else {
            return .declined(reason: "That claim link is malformed, so nothing was submitted.")
        }
        do {
            let signature = try Self.signClaimLink(linkSecret: secret, chainId: chain.chainId,
                                                   marenPay: maren.marenPay, linkId: BigUInt(linkId), recipient: loadedAddress)
            guard let sigData = Data(hex: signature) else {
                return .declined(reason: prepFailed)
            }
            let data = try MarenEncoding.claimLinkCalldata(linkId: BigUInt(linkId), recipient: loadedAddress, signature: sigData)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenPay, data: data)
        } catch {
            return .declined(reason: prepFailed)
        }
    }

    private func confirmSelfPaid(_ hash: String) async -> ActionResult {
        let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
        let outcome = await Receipt.confirm(client: client, hash: hash, sponsored: false)
        if case .delivered(let d) = outcome { return .ok(d) }
        return .failed(outcome)
    }

    private var prepFailed: String {
        "The transaction could not be prepared, so nothing was submitted and no gas was spent."
    }

    // MARK: - Shared internals

    private enum KeyOutcome { case ok(Data); case fail(String) }

    /// Face ID → a signing key that derives the loaded account, or a stated decline. Called
    /// once per user action, so a flow never prompts for Face ID twice.
    private func accessKey(_ loadedAddress: String) async -> KeyOutcome {
        switch await Keystore.shared.access() {
        case .ok(let key):
            // The key MUST derive the loaded account, or signing would produce a valid
            // transaction from the WRONG account — worse than not signing at all.
            guard let derived = try? Keystore.address(of: key),
                  derived.lowercased() == loadedAddress.lowercased() else {
                return .fail(MarenClientError.keyMismatch.errorDescription ?? "Key mismatch.")
            }
            return .ok(key)
        case .denied(let reason): return .fail(reason)
        case .missing: return .fail("No signing key is available on this device.")
        }
    }

    /// Ensure MarenPay may pull the sender's MUSD. Returns nil when the allowance already covers
    /// `needed`; otherwise sends a one-time self-paid MAX approve and returns nil on success or a
    /// decline reason on failure. Only the first send ever pays this gas.
    private func ensureMusdAllowance(privateKey: Data, loadedAddress: String, spender: String, needed: BigUInt) async -> String? {
        let current = (try? await rpc.musdAllowance(owner: loadedAddress, spender: spender)) ?? BigUInt(0)
        if current >= needed { return nil }
        do {
            let data = try MarenEncoding.approveCalldata(spender: spender, amount: BigUInt(2).power(256) - 1)
            let hash = try await sendSelfPaid(privateKey: privateKey, loadedAddress: loadedAddress,
                                              to: MusdAddresses.of(chain.network).musd, value: 0, data: data, gasLimit: 120_000)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            if case .delivered = await Receipt.confirm(client: client, hash: hash, sponsored: false) { return nil }
            return "The one-time MUSD approval did not confirm, so nothing was sent."
        } catch {
            return "The one-time MUSD approval could not be submitted, so nothing was sent."
        }
    }

    // The shared relayed-write flow (the caller has already done Face ID): signed ForwardRequest
    // → relay → receipt. A hash is never a success on its own — `Receipt.confirm` decides.
    private func relayCall(privateKey: Data, loadedAddress: String, to: String, data: Data) async -> ActionResult {
        guard let relayerURL = RelayerConfig.url else {
            return .declined(reason: MarenClientError.liveWritesUnavailable.errorDescription ?? "Live writes unavailable.")
        }
        let maren = MarenAddresses.of(chain.network)
        do {
            let estimate = (try? await rpc.estimateGas(from: loadedAddress, to: to, data: data)) ?? BigUInt(400_000)
            let nonce = try await rpc.forwarderNonce(hub: maren.marenForwarder, owner: loadedAddress)
            let deadline = UInt64(Date().timeIntervalSince1970) + RELAY_DEADLINE_SECONDS
            let request = MarenEncoding.ForwardRequest(
                from: loadedAddress, to: to, value: 0,
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
            let accepted = try await Relayer(baseURL: relayerURL).post(body: body)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            let outcome = await Receipt.confirm(client: client, hash: accepted.hash, sponsored: true)
            if case .delivered(let d) = outcome { return .ok(d) }
            return .failed(outcome)
        } catch let refused as RelayRefused {
            return .declined(reason: refused.reason.detail)
        } catch {
            return .declined(reason: prepFailed)
        }
    }

    /// Sign + send a self-paid transaction, returning its hash. Shared by deposit and the
    /// one-time MUSD approve. The nonce is filled with the pending nonce on send.
    private func sendSelfPaid(privateKey: Data, loadedAddress: String, to: String, value: BigUInt, data: Data, gasLimit: Int) async throws -> String {
        let account = try EthereumAccount(keyStorage: InMemoryKeyStorage(privateKey))
        let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
        let gasPrice = (try? await client.eth_gasPrice()) ?? BigUInt(2_000_000)
        let tx = EthereumTransaction(
            from: EthereumAddress(loadedAddress), to: EthereumAddress(to),
            value: value, data: data, nonce: nil, gasPrice: gasPrice,
            gasLimit: BigUInt(gasLimit), chainId: chain.chainId
        )
        return try await client.eth_sendRawTransaction(tx, withAccount: account)
    }
}
