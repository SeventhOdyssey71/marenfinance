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
// The live path requires a configured relayer URL. A missing configuration declines before
// signing; acceptance still requires an on-chain receipt before the UI reports success.

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

    // MARK: recipient resolution

    /// A resolved recipient, or an honest reason it could not be resolved. `String` does not
    /// conform to `Error`, so this mirrors `KeyOutcome` rather than using `Result<_, String>`.
    enum RecipientOutcome { case ok(String); case fail(String) }

    /// Resolve a recipient the user typed — a `0x` address or an `@handle` — to a `0x` address.
    /// Handles go through `MarenRegistry.tryResolve`; an unregistered one is a clean decline
    /// rather than a silent send to the zero address. Send and Split call this first, so their
    /// golden-tested encoders always receive a real address.
    func resolveRecipient(_ recipient: String) async -> RecipientOutcome {
        let trimmed = recipient.trimmingCharacters(in: .whitespaces)
        if PaymentLinks.isAddress(trimmed) { return .ok(trimmed) }
        guard PaymentLinks.isHandle(trimmed) else {
            return .fail("“\(trimmed)” isn’t a 0x address or an @handle, so nothing was submitted.")
        }
        do {
            if let address = try await rpc.resolveHandle(trimmed) { return .ok(address) }
            return .fail("\(trimmed) isn’t registered yet, so nothing was submitted.")
        } catch {
            return .fail("Couldn’t reach the registry to resolve \(trimmed), so nothing was submitted.")
        }
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

    /// Vault calls must retain the full estimate margin within sponsorship policy.
    /// Silently clamping or guessing after a failed estimate can sign an unusable request.
    static func vaultRelayGasLimit(directEstimate: BigUInt) -> BigUInt? {
        guard directEstimate > 0 else { return nil }
        let padded = directEstimate + directEstimate / 2 + 60_000
        return padded <= BigUInt(MAX_RELAY_GAS) ? padded : nil
    }

    static func depositGasLimit(directEstimate: BigUInt) -> BigUInt {
        // Deposits catch an unsuccessful collateral push and may leave BTC idle. Preserve
        // the existing 500k floor so an estimate of that cheaper branch cannot lower it.
        max(BigUInt(500_000), directEstimate + directEstimate / 4 + 30_000)
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
    static func vaultWriteUnavailableReason(_ snap: MezoSnapshot) -> String? {
        guard let collateral = snap.vaultCollWei, let debt = snap.vaultDebtWei else {
            return "Your pooled vault position could not be verified. Refresh before continuing."
        }
        guard collateral > 0 || debt > 0 else {
            return "There is no Maren pooled position to manage. Direct Mezo loans must be repaid or withdrawn in Mezo."
        }
        return nil
    }

    func vaultWrite(_ function: String, loadedAddress: String, amountWei: BigUInt) async -> ActionResult {
        do {
            // Validate the route again before every vault signature, including repay/withdraw.
            let snap = try await rpc.fetchSnapshot(loadedAddress)
            if let reason = Self.vaultWriteUnavailableReason(snap) {
                return .declined(reason: reason)
            }
            if function == "borrow" {
                let fresh = snap.priceUpdatedAt.map { MezoMarenClient.isFresh(updatedAt: $0) } ?? false
                let available = MezoMarenClient.pooledBorrowAvailability(snap, priceIsFresh: fresh)
                guard let max = available.amountWei, amountWei > 0, amountWei <= max else {
                    return .declined(reason: available.reason ?? "That amount exceeds the current borrowing limit. Refresh the vault and choose a smaller amount.")
                }
            }
        } catch {
            return .declined(reason: "The current vault position could not be verified, so nothing was submitted. Refresh the vault and try again.")
        }
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let data: Data
        if function == "repay",
           let reason = await ensureMusdAllowance(privateKey: key, loadedAddress: loadedAddress,
               spender: MarenAddresses.of(chain.network).marenVault, needed: amountWei) {
            return .declined(reason: reason)
        }
        do {
            guard let operation = MezoRPC.VaultHintOperation(rawValue: function) else {
                return .declined(reason: prepFailed)
            }
            let hints = try await rpc.pooledTroveHints(operation: operation, amount: amountWei,
                                                      owner: loadedAddress)
            data = try MarenEncoding.vaultWriteCalldata(function: function, amount: amountWei, hints: hints)
        } catch {
            return .declined(reason: "The pooled vault's transaction hints could not be read. The vault transaction was not submitted. Refresh and try again.")
        }
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
            let hints = try await rpc.pooledTroveHints(operation: .deposit, amount: valueWei, owner: loadedAddress)
            let data = try MarenEncoding.depositCalldata(hints: hints)
            let estimate = try await rpc.estimateGas(from: loadedAddress,
                to: MarenAddresses.of(chain.network).marenVault, data: data,
                value: valueWei, sponsored: false)
            guard let gasLimit = Int(exactly: Self.depositGasLimit(directEstimate: estimate)) else {
                return .declined(reason: prepFailed)
            }
            let hash = try await sendSelfPaid(privateKey: key, loadedAddress: loadedAddress,
                                              to: MarenAddresses.of(chain.network).marenVault,
                                              value: valueWei, data: data, gasLimit: gasLimit)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            let outcome = await Receipt.confirm(client: client, hash: hash, sponsored: false)
            await MezoSnapshotStore.shared.invalidate()  // cached reads are stale now
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

    /// A relayed split payment — one MUSD transfer to each recipient. Like send, it needs a
    /// one-time MarenPay approval (transferFrom), then every split is gasless.
    func split(loadedAddress: String, recipients: [String], amountsWei: [BigUInt], totalWei: BigUInt, memo: String) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        if let approveDecline = await ensureMusdAllowance(privateKey: key, loadedAddress: loadedAddress,
                                                          spender: maren.marenPay, needed: totalWei) {
            return .declined(reason: approveDecline)
        }
        do {
            let data = try MarenEncoding.splitCalldata(recipients: recipients, amounts: amountsWei, memo: memo)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenPay, data: data)
        } catch { return .declined(reason: prepFailed) }
    }

    // MARK: claimable links — creation

    /// Create a claimable link. SELF-PAID, and that is a fact about the chain, not a shortcut.
    ///
    /// `script/Deploy.s.sol` allowlists ten MarenPay selectors on `MarenRelayHub` and
    /// `createLink` is NOT one of them — `claimLink`, its pair, is. So the hub would revert
    /// `CallNotAllowed` and the relayer would answer `SELECTOR_NOT_ALLOWED`. Rather than
    /// advertise a sponsorship the chain refuses, the user signs a direct transaction and pays
    /// the BTC gas, and the review step says so before they commit. The web records exactly the
    /// same asymmetry in `WRITE_ACTIONS.createLink`. Add this to the deploy script's allowlist
    /// and to `apps/relayer/src/registry.ts` in one change, and only then move it to `relayCall`.
    ///
    /// MarenPay pulls the MUSD with `transferFrom`, so this still needs the one-time MarenPay
    /// approval a send does. `linkKey` is the ADDRESS of a one-time keypair the caller
    /// generated; the private key never reaches this function or the chain.
    ///
    /// The REAL link id comes back in the receipt: `LinkCreated` declares `linkId` as its first
    /// indexed parameter, so `Receipt.confirm` reads it out of `topics[1]` of the same receipt
    /// that proved the transaction succeeded. If that log is missing the id is reported as
    /// unknown; it is never derived from a block number or a counter guess.
    func createLink(loadedAddress: String, linkKey: String, amountWei: BigUInt, expiry: UInt64, memo: String) async -> ActionResult {
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
        do {
            let data = try MarenEncoding.createLinkCalldata(linkKey: linkKey, amount: amountWei,
                                                            expiry: expiry, memo: memo)
            let hash = try await sendSelfPaid(privateKey: key, loadedAddress: loadedAddress,
                                              to: maren.marenPay, value: 0, data: data, gasLimit: 400_000)
            return await confirmSelfPaid(hash, mintedIdFrom: MintedIdSource(contract: maren.marenPay,
                                                                            topic0: MarenEncoding.linkCreatedTopic))
        } catch { return .declined(reason: prepFailed) }
    }

    // MARK: payment requests

    /// Create a payment request (relayed). It moves no MUSD and needs no allowance — it only
    /// records the ask — so unlike a send there is nothing to approve first. `payer` may be the
    /// zero address, which the contract reads as "anyone may fulfil this".
    ///
    /// The real request id is read from `RequestCreated`'s indexed `requestId` in the receipt,
    /// on exactly the same terms as `createLink` above.
    func createRequest(loadedAddress: String, payer: String, amountWei: BigUInt, memo: String) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        do {
            let data = try MarenEncoding.createRequestCalldata(payer: payer, amount: amountWei, memo: memo)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenPay, data: data,
                                   mintedIdFrom: MintedIdSource(contract: maren.marenPay,
                                                                topic0: MarenEncoding.requestCreatedTopic))
        } catch { return .declined(reason: prepFailed) }
    }

    /// Settle a request somebody sent you (relayed). The amount and the recipient are the ones
    /// the contract already stored, so they are read here ONLY to size the MUSD approval and to
    /// decline early on a request that cannot be paid — never to alter what is paid.
    func fulfillRequest(loadedAddress: String, requestId: BigUInt) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)

        // Read the record first. Paying a cancelled or already-fulfilled request reverts, and
        // discovering that after the relayer has spent gas is the wrong order to learn it in.
        let record: MezoRPC.RequestRead
        do { record = try await rpc.paymentRequest(requestId) }
        catch { return .declined(reason: "Request #\(requestId) could not be read from Mezo, so nothing was submitted.") }

        guard record.exists else {
            return .declined(reason: "There is no request #\(requestId) on Mezo, so nothing was submitted.")
        }
        guard record.isOpen else {
            return .declined(reason: "Request #\(requestId) is \(record.statusLabel.lowercased()), so nothing was submitted.")
        }
        guard record.openToAnyone || record.payer.lowercased() == loadedAddress.lowercased() else {
            return .declined(reason: "Request #\(requestId) names a different payer, so nothing was submitted.")
        }
        guard record.requester.lowercased() != loadedAddress.lowercased() else {
            return .declined(reason: "That request is your own, and MarenPay refuses a self-payment. Nothing was submitted.")
        }

        if let approveDecline = await ensureMusdAllowance(privateKey: key, loadedAddress: loadedAddress,
                                                          spender: maren.marenPay, needed: record.amountWei) {
            return .declined(reason: approveDecline)
        }
        do {
            let data = try MarenEncoding.fulfillRequestCalldata(requestId: requestId)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenPay, data: data)
        } catch { return .declined(reason: prepFailed) }
    }

    // MARK: @handle registration — commit-reveal

    /// Step one: publish `keccak256(abi.encode(handle, owner, secret))` (relayed).
    ///
    /// The digest is computed locally by the golden-tested `MarenEncoding.handleCommitment` AND
    /// cross-checked against the contract's own `pure` `makeCommitment` before anything is
    /// signed. If the two disagree, this declines: a commitment that does not match the
    /// contract's encoding can be published and can NEVER be revealed, and the user would only
    /// find out 60 seconds later, having already paid for it. If the cross-check read cannot be
    /// reached, the locally computed value is used — it is pinned byte-for-byte to Foundry.
    func commitHandle(loadedAddress: String, handle: String, secret: Data) async -> ActionResult {
        let clean = Self.bareHandle(handle)
        if let problem = Self.handleProblem(clean) { return .declined(reason: problem) }
        return await submitCommit(loadedAddress: loadedAddress, handle: clean, secret: secret)
    }

    private func submitCommit(loadedAddress: String, handle: String, secret: Data) async -> ActionResult {
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        do {
            let local = try MarenEncoding.handleCommitment(handle: handle, owner: loadedAddress, secret: secret)
            if let onChain = try? await rpc.makeCommitment(handle: handle, owner: loadedAddress, secret: secret),
               onChain != local {
                return .declined(reason: "This device and MarenRegistry disagree about how to hash that commitment, so it would be impossible to reveal. Nothing was submitted.")
            }
            let data = try MarenEncoding.commitHandleCalldata(commitment: local)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenRegistry, data: data)
        } catch { return .declined(reason: prepFailed) }
    }

    /// Step two: reveal the secret and take the handle (relayed). The contract enforces the
    /// 60-second minimum age itself; this checks it first only so a user is not charged a
    /// signature for a revert it can see coming.
    func registerHandle(loadedAddress: String, handle: String, secret: Data) async -> ActionResult {
        let clean = Self.bareHandle(handle)
        if let problem = Self.handleProblem(clean) { return .declined(reason: problem) }
        let key: Data
        switch await accessKey(loadedAddress) {
        case .ok(let k): key = k
        case .fail(let reason): return .declined(reason: reason)
        }
        let maren = MarenAddresses.of(chain.network)
        do {
            let commitment = try MarenEncoding.handleCommitment(handle: clean, owner: loadedAddress, secret: secret)
            if let committedAt = try? await rpc.handleCommittedAt(commitment) {
                if committedAt == 0 {
                    return .declined(reason: "MarenRegistry is not holding a commitment for @\(clean) from this address, so there is nothing to reveal. Nothing was submitted.")
                }
                let now = BigUInt(UInt64(Date().timeIntervalSince1970))
                if now < committedAt + BigUInt(HANDLE_MIN_COMMITMENT_AGE) {
                    let wait = Int((committedAt + BigUInt(HANDLE_MIN_COMMITMENT_AGE) - now))
                    return .declined(reason: "That commitment is \(wait)s away from being revealable. Nothing was submitted.")
                }
                if now > committedAt + BigUInt(HANDLE_MAX_COMMITMENT_AGE) {
                    return .declined(reason: "That commitment expired after 7 days and can no longer be revealed. Claim @\(clean) again from the start. Nothing was submitted.")
                }
            }
            let data = try MarenEncoding.registerHandleCalldata(handle: clean, secret: secret)
            return await relayCall(privateKey: key, loadedAddress: loadedAddress, to: maren.marenRegistry, data: data)
        } catch { return .declined(reason: prepFailed) }
    }

    /// A handle with any leading `@` removed. The contract hashes the raw bytes, so the `@` is
    /// display only and must never reach the calldata.
    static func bareHandle(_ handle: String) -> String {
        let trimmed = handle.trimmingCharacters(in: .whitespaces)
        return trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
    }

    /// `MarenRegistry._validateHandle`, transcribed. Checked before a transaction rather than
    /// inside one: the contract is the authority and refuses anything invalid regardless, but
    /// discovering `HandleInvalidCharacter(4, 0x2e)` after paying gas is a worse way to learn
    /// you cannot use a full stop. Returns nil when the handle is fine.
    static func handleProblem(_ handle: String) -> String? {
        let clean = bareHandle(handle)
        if clean.count < 3 { return "Handles are at least 3 characters." }
        if clean.count > 32 { return "Handles are at most 32 characters." }
        if let bad = clean.first(where: { !("a"..."z" ~= $0 || "0"..."9" ~= $0 || $0 == "_") }) {
            return "“\(bad)” is not allowed. Handles use lowercase letters, digits and underscores only."
        }
        return nil
    }

    private func confirmSelfPaid(_ hash: String, mintedIdFrom: MintedIdSource? = nil) async -> ActionResult {
        let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
        let outcome = await Receipt.confirm(client: client, hash: hash, sponsored: false,
                                            mintedIdFrom: mintedIdFrom)
        // A confirmed write makes every cached read wrong. The snapshot has a 2s TTL to
        // coalesce concurrent screen loads, and without this the refresh that fires straight
        // after a deposit could be served the PRE-transaction balance — the exact "it went
        // through but nothing moved" that the receipt-gating elsewhere exists to prevent.
        await MezoSnapshotStore.shared.invalidate()
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
        let current: BigUInt
        do { current = try await rpc.musdAllowance(owner: loadedAddress, spender: spender) }
        catch { return "The MUSD allowance could not be checked. No approval or payment was submitted." }
        if current >= needed { return nil }
        do {
            let data = try MarenEncoding.approveCalldata(spender: spender, amount: BigUInt(2).power(256) - 1)
            let hash = try await sendSelfPaid(privateKey: privateKey, loadedAddress: loadedAddress,
                                              to: MusdAddresses.of(chain.network).musd, value: 0, data: data, gasLimit: 120_000)
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            if case .delivered = await Receipt.confirm(client: client, hash: hash, sponsored: false) { return nil }
            return "The one-time MUSD approval has not confirmed. It may still settle and spend BTC gas. The payment has not been submitted. Check the approval on the explorer before retrying: \(hash)"
        } catch {
            return "The one-time MUSD approval could not be submitted, so nothing was sent."
        }
    }

    // The shared relayed-write flow (the caller has already done Face ID): signed ForwardRequest
    // → relay → receipt. A hash is never a success on its own — `Receipt.confirm` decides.
    private func relayCall(privateKey: Data, loadedAddress: String, to: String, data: Data,
                           mintedIdFrom: MintedIdSource? = nil) async -> ActionResult {
        guard let relayerURL = RelayerConfig.url else {
            return .declined(reason: MarenClientError.liveWritesUnavailable.errorDescription ?? "Live writes unavailable.")
        }
        let maren = MarenAddresses.of(chain.network)
        do {
            let gasLimit: BigUInt
            if to.lowercased() == maren.marenVault.lowercased() {
                let estimate: BigUInt
                do {
                    estimate = try await rpc.estimateGas(from: loadedAddress, to: to, data: data)
                } catch {
                    return .declined(reason: "Mezo could not estimate this vault transaction. The vault limits or RPC may have changed. The vault transaction was not submitted. Refresh and try again.")
                }
                guard let padded = Self.vaultRelayGasLimit(directEstimate: estimate) else {
                    return .declined(reason: "This vault transaction needs more gas than sponsorship currently allows. The vault transaction was not submitted.")
                }
                gasLimit = padded
            } else {
                let estimate = (try? await rpc.estimateGas(from: loadedAddress, to: to, data: data)) ?? BigUInt(400_000)
                gasLimit = Self.relayGasLimit(directEstimate: estimate)
            }
            let nonce = try await rpc.forwarderNonce(hub: maren.marenForwarder, owner: loadedAddress)
            let deadline = UInt64(Date().timeIntervalSince1970) + RELAY_DEADLINE_SECONDS
            let request = MarenEncoding.ForwardRequest(
                from: loadedAddress, to: to, value: 0,
                gas: gasLimit, nonce: nonce,
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
            let outcome = await Receipt.confirm(client: client, hash: accepted.hash, sponsored: true,
                                                mintedIdFrom: mintedIdFrom)
            await MezoSnapshotStore.shared.invalidate()  // cached reads are stale now
            if case .delivered(let d) = outcome { return .ok(d) }
            return .failed(outcome)
        } catch let refused as RelayRefused {
            if refused.reason.submissionMayExist {
                if let hash = refused.reason.knownHash {
                    let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
                    let outcome = await Receipt.confirm(client: client, hash: hash, sponsored: true,
                                                        mintedIdFrom: mintedIdFrom)
                    await MezoSnapshotStore.shared.invalidate()
                    if case .delivered(let delivered) = outcome { return .ok(delivered) }
                    return .failed(outcome)
                }
                return .failed(.submissionUnknown(reason: refused.reason.detail))
            }
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
        let gasPrice = try await client.eth_gasPrice()
        let nonce = try await client.eth_getTransactionCount(address: account.address, block: .Pending)
        let tx = EthereumTransaction(
            from: EthereumAddress(loadedAddress), to: EthereumAddress(to),
            value: value, data: data, nonce: nonce, gasPrice: gasPrice,
            gasLimit: BigUInt(gasLimit), chainId: chain.chainId
        )
        guard let raw = try account.sign(transaction: tx).raw else { throw EthereumClientError.encodeIssue }
        // Establish the identity BEFORE external submission. Even a lost RPC response leaves
        // a real hash to reconcile; never misclassify an attempted broadcast as a decline.
        let hash = raw.web3.keccak256.web3.hexString
        _ = try? await client.networkProvider.send(method: "eth_sendRawTransaction",
                                                   params: [raw.web3.hexString], receive: String.self)
        return hash
    }
}
