import Foundation
import BigInt
import web3

// MARK: - Mezo RPC reads
//
// Interactive reads against the Mezo testnet RPC, mirroring `apps/ios/src/data/live.ts`. Two
// disciplines are carried over verbatim:
//
//   FAILOVER IS NOT OPTIONAL. Mezo's public RPCs are transiently flaky, and one has been
//   observed answering `-32601 method not found` for methods it fully supports and then
//   serving them correctly an hour later. `call` walks the endpoint list in the order
//   `chains.ts` argues for and only gives up when every endpoint has failed.
//
//   HONEST DATA. A read that fails throws (or, for price, returns `.unavailable`). It never
//   substitutes a fabricated zero or a plausible-looking value. "Your borrowing ceiling is 0"
//   and "we could not read your borrowing ceiling" are different sentences and only one of
//   them is true.

enum MezoRPCError: Error, Sendable, Equatable {
    case allEndpointsFailed(String)
    case emptyResult
    case decode(String)
}

struct MezoRPC: Sendable {
    let chain: MezoChain

    init(_ chain: MezoChain) { self.chain = chain }

    private func makeClient(_ url: URL) -> EthereumHttpClient {
        EthereumHttpClient(url: url, network: .custom(String(chain.chainId)))
    }

    // MARK: low-level

    /// `eth_call` with failover across the chain's endpoint list. Returns the raw hex result.
    func call(to: String, data: Data) async throws -> Data {
        var lastError = "no endpoints configured"
        for url in chain.rpcURLs {
            do {
                let client = makeClient(url)
                let tx = EthereumTransaction(to: EthereumAddress(to), data: data)
                let hex = try await client.eth_call(tx, block: .Latest)
                guard let out = Data(hex: hex) else { throw MezoRPCError.decode("non-hex eth_call result") }
                return out
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    /// Native BTC balance via `eth_getBalance`, with failover.
    func nativeBalance(_ address: String) async throws -> BigUInt {
        var lastError = "no endpoints configured"
        for url in chain.rpcURLs {
            do {
                return try await makeClient(url).eth_getBalance(address: EthereumAddress(address), block: .Latest)
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    /// `MarenRelayHub.nonces(owner)`. The only forwarder read the write path performs; the
    /// nonce is inside the signed struct, so it is read on-chain and never guessed.
    func forwarderNonce(hub: String, owner: String) async throws -> BigUInt {
        let enc = ABIFunctionEncoder("nonces")
        try enc.encode(EthereumAddress(owner))
        let out = try await call(to: hub, data: try enc.encoded())
        return Self.word(out, 0)
    }

    /// A direct-call gas estimate, with failover. Used to size the relayed gas cap.
    func estimateGas(from: String, to: String, data: Data) async throws -> BigUInt {
        var lastError = "no endpoints configured"
        for url in chain.rpcURLs {
            do {
                let tx = EthereumTransaction(from: EthereumAddress(from), to: EthereumAddress(to),
                                             value: 0, data: data, nonce: nil, gasPrice: nil, gasLimit: nil,
                                             chainId: chain.chainId)
                return try await makeClient(url).eth_estimateGas(tx)
            } catch {
                lastError = String(describing: error)
                continue
            }
        }
        throw MezoRPCError.allEndpointsFailed(lastError)
    }

    // MARK: typed reads

    /// MUSD `balanceOf(account)`, in wei.
    func musdBalance(_ account: String) async throws -> BigUInt {
        let enc = ABIFunctionEncoder("balanceOf")
        try enc.encode(EthereumAddress(account))
        let out = try await call(to: MusdAddresses.of(chain.network).musd, data: try enc.encoded())
        return Self.word(out, 0)
    }

    /// The user's Earn balance in MUSD wei: MarenEarn (ERC-4626) `convertToAssets(balanceOf(user))`.
    /// Reads the actual redeemable MUSD, with any realised Bitcoin gains already compounded in.
    /// Zero shares short-circuits to zero.
    func earnBalance(_ account: String) async throws -> BigUInt {
        let earn = MarenAddresses.of(chain.network).marenEarn
        let balEnc = ABIFunctionEncoder("balanceOf")
        try balEnc.encode(EthereumAddress(account))
        let shares = Self.word(try await call(to: earn, data: try balEnc.encoded()), 0)
        if shares == 0 { return 0 }
        let convEnc = ABIFunctionEncoder("convertToAssets")
        try convEnc.encode(shares)
        return Self.word(try await call(to: earn, data: try convEnc.encoded()), 0)
    }

    /// MarenEarn's asset composition, read from `assetBreakdown()` (selector 0x6a938424). All
    /// five words are 18-decimal: `musdIdle` + `musdInPool` is the MUSD backing; `btcHeld` +
    /// `btcPending` is Bitcoin the pool SEIZED absorbing liquidations (18-dec BTC, not 8), and
    /// `btcValued` is that Bitcoin valued in MUSD at the oracle price. A short/failed read is a
    /// throw upstream in `call`, never a fabricated zero breakdown.
    struct EarnBreakdownRead: Sendable {
        let musdIdleWei: BigUInt
        let musdInPoolWei: BigUInt
        let btcHeldWei: BigUInt
        let btcPendingWei: BigUInt
        let btcValuedWei: BigUInt
    }

    func earnAssetBreakdown() async throws -> EarnBreakdownRead {
        let earn = MarenAddresses.of(chain.network).marenEarn
        let enc = ABIFunctionEncoder("assetBreakdown")
        let out = try await call(to: earn, data: try enc.encoded())
        // Five 32-byte words = 160 bytes. A shorter reply means the node answered with a
        // truncated result, which is a decode failure, not five zeroes.
        guard out.count >= 160 else { throw MezoRPCError.decode("assetBreakdown returned a short result") }
        return EarnBreakdownRead(
            musdIdleWei: Self.word(out, 0),
            musdInPoolWei: Self.word(out, 1),
            btcHeldWei: Self.word(out, 2),
            btcPendingWei: Self.word(out, 3),
            btcValuedWei: Self.word(out, 4)
        )
    }

    /// MarenEarn `isUsingStalePrice()` (selector 0xc1095f9f). True when the vault is valuing its
    /// seized Bitcoin off a price the oracle would otherwise reject as too old — so `btcValued`
    /// may understate the real figure and must not be presented as authoritative.
    func earnIsUsingStalePrice() async throws -> Bool {
        let earn = MarenAddresses.of(chain.network).marenEarn
        let enc = ABIFunctionEncoder("isUsingStalePrice")
        let out = try await call(to: earn, data: try enc.encoded())
        guard out.count >= 32 else { throw MezoRPCError.decode("isUsingStalePrice returned a short result") }
        return Self.word(out, 0) != 0
    }

    /// MUSD `allowance(owner, spender)`, in wei — how much MUSD `spender` may pull via
    /// transferFrom. Read before a send so a first payment approves MarenPay once.
    func musdAllowance(owner: String, spender: String) async throws -> BigUInt {
        let enc = ABIFunctionEncoder("allowance")
        try enc.encode(EthereumAddress(owner))
        try enc.encode(EthereumAddress(spender))
        let out = try await call(to: MusdAddresses.of(chain.network).musd, data: try enc.encoded())
        return Self.word(out, 0)
    }

    /// The BTC/USD price and its age, from the Mezo oracle PRECOMPILE. `latestRoundData()`
    /// carries `updatedAt`, which is what a staleness read needs — `PriceFeed.fetchPrice()`
    /// only returns a number or reverts and can never say HOW OLD a price is. The answer is
    /// scaled up to 1e18. A non-positive answer is treated as unavailable, never as zero.
    func priceObservation() async throws -> (priceWei: BigUInt, updatedAt: BigUInt) {
        let oracle = MEZO_PRICE_ORACLE_PRECOMPILE
        let decEnc = ABIFunctionEncoder("decimals")
        let decimalsOut = try await call(to: oracle, data: try decEnc.encoded())
        let decimals = Int(Self.word(decimalsOut, 0))

        let roundEnc = ABIFunctionEncoder("latestRoundData")
        let round = try await call(to: oracle, data: try roundEnc.encoded())
        // (roundId, answer int256, startedAt, updatedAt, answeredInRound)
        let answer = Self.signedWord(round, 1)
        let updatedAt = Self.word(round, 3)
        guard answer.sign != .minus, answer.magnitude > 0 else {
            throw MezoRPCError.decode("oracle returned a non-positive price")
        }
        let scale = BigUInt(10).power(max(0, 18 - decimals))
        return (answer.magnitude * scale, updatedAt)
    }

    /// The pooled/direct position, read from MUSD's TroveManager, mirroring `readPosition` in
    /// live.ts. `getEntireDebtAndColl(account)` returns
    /// (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest).
    struct TroveRead: Sendable {
        let collWei: BigUInt
        let principalWei: BigUInt   // includes the 200 MUSD gas compensation
        let interestWei: BigUInt
    }

    func trove(_ account: String) async throws -> TroveRead {
        let enc = ABIFunctionEncoder("getEntireDebtAndColl")
        try enc.encode(EthereumAddress(account))
        let out = try await call(to: MusdAddresses.of(chain.network).troveManager, data: try enc.encoded())
        let coll = Self.word(out, 0) + Self.word(out, 3)
        let principal = Self.word(out, 1) + Self.word(out, 4)
        let interest = Self.word(out, 2) + Self.word(out, 5)
        return TroveRead(collWei: coll, principalWei: principal, interestWei: interest)
    }

    /// A pooled position in `MarenVault`, keyed by the user's EOA. Most Maren loans live here,
    /// NOT in the raw TroveManager (whose trove is owned by the vault, not the user) — so a
    /// position read that only hit `trove()` reported "no debt" for a real pooled borrower.
    ///
    /// `collateralOf` is the redemption-adjusted collateral a UI should show; `previewDebtOf`
    /// is the debt including interest accrued since the last on-chain accrual. A pooled debt
    /// carries NO 200 MUSD gas compensation (the pool's seed position paid it once), so unlike
    /// the direct trove nothing is subtracted back out.
    struct VaultRead: Sendable {
        let collWei: BigUInt
        let debtWei: BigUInt
    }

    func vaultPosition(_ account: String) async throws -> VaultRead {
        let vault = MarenAddresses.of(chain.network).marenVault
        // `collateralOf` (the redemption-adjusted view) reverts in the deployed testnet
        // bytecode — its `_pendingRedemptionDebit` path reverts with no reason. The raw
        // `collateral(address)` mapping getter returns the on-book collateral and works; the
        // two differ only in the window between a redemption landing and the next reconcile,
        // so this is the honest, available figure. `previewDebtOf` includes accrued interest.
        let coll = try await callAddressUint(to: vault, function: "collateral", account: account)
        let debt = try await callAddressUint(to: vault, function: "previewDebtOf", account: account)
        return VaultRead(collWei: coll, debtWei: debt)
    }

    /// An `fn(address) -> uint256` view call, decoding the first word.
    private func callAddressUint(to: String, function: String, account: String) async throws -> BigUInt {
        let enc = ABIFunctionEncoder(function)
        try enc.encode(EthereumAddress(account))
        let out = try await call(to: to, data: try enc.encoded())
        return Self.word(out, 0)
    }

    /// Resolve a `@handle` to its address via `MarenRegistry.tryResolve(string)`. Mirrors the
    /// web app's `resolveHandle`: `tryResolve` returns `address(0)` rather than reverting for an
    /// unregistered handle, so `nil` here means "no such handle", not a transport failure — the
    /// caller declines cleanly instead of paying anyone the zero address.
    func resolveHandle(_ handle: String) async throws -> String? {
        let clean = handle.hasPrefix("@") ? String(handle.dropFirst()) : handle
        let enc = ABIFunctionEncoder("tryResolve")
        try enc.encode(clean)
        let out = try await call(to: MarenAddresses.of(chain.network).marenRegistry, data: try enc.encoded())
        guard out.count >= 32 else { return nil }
        let addr = out.subdata(in: 12..<32) // low 20 bytes of the 32-byte word
        if addr.allSatisfy({ $0 == 0 }) { return nil }
        return "0x" + addr.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: MarenPay records

    /// A `MarenPay.requests(requestId)` row. `status` follows the contract's enum:
    /// 0 None, 1 Open, 2 Fulfilled, 3 Cancelled. A request that was never created reads as
    /// `None` with a zero requester, which the UI states as "no such request" — it never
    /// renders a zero-address requester or a zero amount as if they were a real ask.
    struct RequestRead: Sendable, Equatable {
        let requester: String
        let payer: String
        let amountWei: BigUInt
        let createdAt: BigUInt
        let status: Int

        var exists: Bool { status != 0 }
        var isOpen: Bool { status == 1 }
        /// True when anyone may fulfil it (the contract stores address(0) for that).
        var openToAnyone: Bool { payer == "0x0000000000000000000000000000000000000000" }

        var statusLabel: String {
            switch status {
            case 1: return "Open"
            case 2: return "Already paid"
            case 3: return "Cancelled"
            default: return "No such request"
            }
        }
    }

    /// Read one payment request. Five words: requester, payer, amount, createdAt, status.
    /// A short reply is a decode failure, never five zeroes read as a real record.
    func paymentRequest(_ requestId: BigUInt) async throws -> RequestRead {
        let enc = ABIFunctionEncoder("requests")
        try enc.encode(requestId)
        let out = try await call(to: MarenAddresses.of(chain.network).marenPay, data: try enc.encoded())
        guard out.count >= 160 else { throw MezoRPCError.decode("requests() returned a short result") }
        return RequestRead(
            requester: Self.address(out, 0),
            payer: Self.address(out, 1),
            amountWei: Self.word(out, 2),
            createdAt: Self.word(out, 3),
            status: Int(Self.word(out, 4))
        )
    }

    // MARK: MarenRegistry — commit-reveal

    /// `MarenRegistry.makeCommitment(handle, owner, secret)`, asked of the CONTRACT.
    ///
    /// `makeCommitment` is `pure`, so this is a free `eth_call`, and it removes an entire class
    /// of bug: a locally computed digest that disagrees with the contract's encoding by one
    /// byte produces a commitment that can be published and can never be revealed, and the
    /// failure only shows up 60 seconds later as `CommitmentNotFound`. Mirrors the web's
    /// `computeCommitment` in `apps/web/src/lib/chain/handle.ts`.
    func makeCommitment(handle: String, owner: String, secret: Data) async throws -> Data {
        let data = try MarenEncoding.makeCommitmentCalldata(handle: handle, owner: owner, secret: secret)
        let out = try await call(to: MarenAddresses.of(chain.network).marenRegistry, data: data)
        guard out.count >= 32 else { throw MezoRPCError.decode("makeCommitment returned a short result") }
        return out.subdata(in: 0..<32)
    }

    /// `MarenRegistry.commitments(commitment)` — the block timestamp the commitment was
    /// recorded at. Zero means it is not on-chain (yet), which is a different sentence from
    /// "it expired", and the UI says whichever is true.
    func handleCommittedAt(_ commitment: Data) async throws -> BigUInt {
        let enc = ABIFunctionEncoder("commitments")
        try enc.encode(Data32(data: commitment))
        let out = try await call(to: MarenAddresses.of(chain.network).marenRegistry, data: try enc.encoded())
        guard out.count >= 32 else { throw MezoRPCError.decode("commitments() returned a short result") }
        return Self.word(out, 0)
    }

    /// `MarenRegistry.available(handle)` — false for a taken OR invalid handle. A read failure
    /// throws, so the UI shows "couldn't check" rather than a green tick it did not earn.
    func handleAvailable(_ handle: String) async throws -> Bool {
        let clean = handle.hasPrefix("@") ? String(handle.dropFirst()) : handle
        let enc = ABIFunctionEncoder("available")
        try enc.encode(clean)
        let out = try await call(to: MarenAddresses.of(chain.network).marenRegistry, data: try enc.encoded())
        guard out.count >= 32 else { throw MezoRPCError.decode("available() returned a short result") }
        return Self.word(out, 0) != 0
    }

    /// `MarenRegistry.primaryHandle(owner)` — reverse resolution. An empty string is the
    /// contract's honest "this address has no primary handle", not a failure.
    func primaryHandle(of owner: String) async throws -> String {
        let enc = ABIFunctionEncoder("primaryHandle")
        try enc.encode(EthereumAddress(owner))
        let out = try await call(to: MarenAddresses.of(chain.network).marenRegistry, data: try enc.encoded())
        return Self.dynamicString(out) ?? ""
    }

    // MARK: word decoding
    //
    // eth_call returns ABI-encoded 32-byte words. These pull one word by index; a request for
    // a word past the end of a short/empty result throws rather than reading zero, so a
    // truncated response can never be mistaken for a valid all-zero answer.

    static func word(_ data: Data, _ index: Int) -> BigUInt {
        let start = index * 32
        guard start + 32 <= data.count else { return BigUInt(0) }
        return BigUInt(data.subdata(in: start..<start + 32))
    }

    /// The low 20 bytes of word `index`, as a 0x address.
    static func address(_ data: Data, _ index: Int) -> String {
        let start = index * 32
        guard start + 32 <= data.count else { return "0x0000000000000000000000000000000000000000" }
        let raw = data.subdata(in: start + 12..<start + 32)
        return "0x" + raw.map { String(format: "%02x", $0) }.joined()
    }

    /// A single ABI-encoded `string` return value: offset word, length word, then the bytes.
    /// Anything short or non-UTF8 returns nil, so a truncated reply is never rendered as an
    /// empty-but-valid handle.
    static func dynamicString(_ data: Data) -> String? {
        guard data.count >= 64 else { return nil }
        let offset = Int(word(data, 0))
        guard offset >= 0, offset + 32 <= data.count else { return nil }
        let length = Int(BigUInt(data.subdata(in: offset..<offset + 32)))
        guard length >= 0, offset + 32 + length <= data.count else { return nil }
        if length == 0 { return "" }
        return String(data: data.subdata(in: offset + 32..<offset + 32 + length), encoding: .utf8)
    }

    static func signedWord(_ data: Data, _ index: Int) -> BigInt {
        let start = index * 32
        guard start + 32 <= data.count else { return BigInt(0) }
        let raw = data.subdata(in: start..<start + 32)
        let magnitude = BigUInt(raw)
        // Two's-complement: top bit set means negative.
        if raw.first! & 0x80 != 0 {
            let modulus = BigUInt(1) << 256
            return BigInt(magnitude) - BigInt(modulus)
        }
        return BigInt(magnitude)
    }
}
