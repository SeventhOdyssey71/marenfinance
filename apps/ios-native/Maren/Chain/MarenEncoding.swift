import Foundation
import BigInt
import web3

// MARK: - Maren encoding & signing
//
// The consensus-critical seam. Every byte produced here is checked against an independently
// `cast`-computed value in MarenTests (see MarenEncodingGoldenTests). A one-character drift
// in an ABI type or an EIP-712 field order is "every sponsored transaction fails signature
// recovery in production and nothing catches it first", so nothing here is trusted until a
// golden test proves it matches Foundry.
//
// No crypto is hand-rolled: keccak256, ABI encoding, secp256k1 signing and EIP-712 hashing
// all come from argentlabs/web3.swift. This file only arranges the inputs exactly as the
// deployed Solidity does.

enum MarenEncoding {

    // ---------------------------------------------------------------------------
    // MarenPay.pay(address,uint256,string) calldata
    // ---------------------------------------------------------------------------

    /// The calldata for `MarenPay.pay`, selector + ABI-encoded args. Mirrors `actions.ts`
    /// `encodeFunctionData({ functionName: 'pay', args: [to, amount, memo] })`.
    static func payCalldata(to: String, amount: BigUInt, memo: String) throws -> Data {
        let enc = ABIFunctionEncoder("pay")
        try enc.encode(EthereumAddress(to))
        try enc.encode(amount)
        try enc.encode(memo)
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // MarenVault writes — borrow / repay / withdraw (uint256 amount, address, address)
    // ---------------------------------------------------------------------------

    private static let zeroAddress = "0x0000000000000000000000000000000000000000"

    /// Calldata for `MarenVault.borrow/repay/withdraw(amount, upperHint, lowerHint)`. The two
    /// hints are the pooled trove's insertion position in SortedTroves; passing the zero
    /// address makes the contract search from the list head — more gas, but correct, and the
    /// relayer pays that gas. `function` is "borrow" | "repay" | "withdraw", which fixes the
    /// selector via the (uint256,address,address) argument types.
    static func vaultWriteCalldata(function: String, amount: BigUInt) throws -> Data {
        let enc = ABIFunctionEncoder(function)
        try enc.encode(amount)
        try enc.encode(EthereumAddress(zeroAddress))
        try enc.encode(EthereumAddress(zeroAddress))
        return try enc.encoded()
    }

    /// Calldata for `MarenVault.deposit(upperHint, lowerHint)` — the BTC is sent as msg.value,
    /// so there is no amount argument. Self-paid (a relayer would fund the deposit itself).
    static func depositCalldata() throws -> Data {
        let enc = ABIFunctionEncoder("deposit")
        try enc.encode(EthereumAddress(zeroAddress))
        try enc.encode(EthereumAddress(zeroAddress))
        return try enc.encoded()
    }

    /// Calldata for `IERC20.approve(spender, amount)`. `MarenPay.pay` moves MUSD with
    /// transferFrom, so a first send needs MarenPay approved; a one-time max approval means
    /// every send after it is fully gasless.
    static func approveCalldata(spender: String, amount: BigUInt) throws -> Data {
        let enc = ABIFunctionEncoder("approve")
        try enc.encode(EthereumAddress(spender))
        try enc.encode(amount)
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // MarenEarn — ERC-4626 deposit / withdraw of MUSD (self-paid)
    // ---------------------------------------------------------------------------

    /// Calldata for `MarenEarn.deposit(uint256 assets, address receiver)` — supply MUSD to the
    /// Stability Pool. Needs a prior MUSD approval to MarenEarn (transferFrom).
    static func earnDepositCalldata(assets: BigUInt, receiver: String) throws -> Data {
        let enc = ABIFunctionEncoder("deposit")
        try enc.encode(assets)
        try enc.encode(EthereumAddress(receiver))
        return try enc.encoded()
    }

    /// Calldata for `MarenEarn.withdraw(uint256 assets, address receiver, address owner)` —
    /// take MUSD back out. `receiver` and `owner` are both the user.
    static func earnWithdrawCalldata(assets: BigUInt, receiver: String, owner: String) throws -> Data {
        let enc = ABIFunctionEncoder("withdraw")
        try enc.encode(assets)
        try enc.encode(EthereumAddress(receiver))
        try enc.encode(EthereumAddress(owner))
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // MarenPay.claimLink(uint256 linkId, address recipient, bytes signature) calldata
    // ---------------------------------------------------------------------------

    /// Calldata for claiming a payment link. `signature` is the link key's ECDSA signature over
    /// `linkClaimDigest(linkId, recipient)` (see `MezoActions.signClaimLink`), which binds the
    /// payout to `recipient`.
    static func claimLinkCalldata(linkId: BigUInt, recipient: String, signature: Data) throws -> Data {
        let enc = ABIFunctionEncoder("claimLink")
        try enc.encode(linkId)
        try enc.encode(EthereumAddress(recipient))
        try enc.encode(signature)
        return try enc.encoded()
    }

    /// Calldata for `MarenPay.split(address[] recipients, uint256[] amounts, string memo)` —
    /// one payment to each recipient in a single relayed call. Needs a MUSD approval to MarenPay.
    static func splitCalldata(recipients: [String], amounts: [BigUInt], memo: String) throws -> Data {
        let enc = ABIFunctionEncoder("split")
        try enc.encode(recipients.map { EthereumAddress($0) })
        try enc.encode(amounts)
        try enc.encode(memo)
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // MarenPay.createLink / createRequest / fulfillRequest
    // ---------------------------------------------------------------------------

    /// Calldata for `MarenPay.createLink(address linkKey, uint256 amount, uint64 expiry, string memo)`
    /// — escrow MUSD to whoever holds the one-time key. Mirrors the web `createLink` in
    /// `apps/web/src/lib/chain/write.ts`, argument for argument.
    ///
    /// `expiry` IS `uint64`, NOT `uint256`. The Solidity declares `uint64 expiry`, so a
    /// uint256 here would produce the selector `0x…` of a function MarenPay does not have and
    /// the relayer would answer `SELECTOR_NOT_ALLOWED`. The golden test pins the uint64
    /// selector to `cast sig "createLink(address,uint256,uint64,string)"`.
    ///
    /// `linkKey` is the ADDRESS of a one-time keypair; its PRIVATE key travels in the link's
    /// URL fragment and never touches the chain. The contract escrows the MUSD under that key
    /// and only a signature by it (see `claimLinkCalldata`) releases it.
    static func createLinkCalldata(linkKey: String, amount: BigUInt, expiry: UInt64, memo: String) throws -> Data {
        let enc = ABIFunctionEncoder("createLink")
        try enc.encode(EthereumAddress(linkKey))
        try enc.encode(amount)
        try enc.encode(expiry)
        try enc.encode(memo)
        return try enc.encoded()
    }

    /// Calldata for `MarenPay.createRequest(address payer, uint256 amount, string memo)` — ask
    /// to be paid. It moves no funds and creates no obligation; it only records the ask and
    /// emits `RequestCreated`, whose indexed `requestId` is how the app learns the real id.
    /// `payer` is the zero address when anyone may fulfil it, exactly as the web passes it.
    static func createRequestCalldata(payer: String, amount: BigUInt, memo: String) throws -> Data {
        let enc = ABIFunctionEncoder("createRequest")
        try enc.encode(EthereumAddress(payer))
        try enc.encode(amount)
        try enc.encode(memo)
        return try enc.encoded()
    }

    /// Calldata for `MarenPay.fulfillRequest(uint256 requestId)` — settle a request somebody
    /// else created. Nothing about the payment is passed: the amount and the recipient live in
    /// the record the contract stored at `requestId`, so the caller cannot alter either. It
    /// pulls MUSD with `transferFrom`, so it needs a prior MarenPay allowance like any pay.
    static func fulfillRequestCalldata(requestId: BigUInt) throws -> Data {
        let enc = ABIFunctionEncoder("fulfillRequest")
        try enc.encode(requestId)
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // MarenRegistry — commit-reveal handle registration
    // ---------------------------------------------------------------------------

    /// Calldata for `MarenRegistry.commit(bytes32 commitment)` — step one of registration.
    /// The commitment is opaque on-chain, so watching this transaction tells an observer
    /// nothing about which handle is being claimed. The web calls this `commitHandle`; the
    /// SOLIDITY FUNCTION IS `commit`, and the selector follows the Solidity.
    static func commitHandleCalldata(commitment: Data) throws -> Data {
        let enc = ABIFunctionEncoder("commit")
        try enc.encode(Data32(data: commitment))
        return try enc.encoded()
    }

    /// Calldata for `MarenRegistry.register(string handle, bytes32 secret)` — step two, at
    /// least `MIN_COMMITMENT_AGE` (60s) after the commit and within `MAX_COMMITMENT_AGE`
    /// (7 days). The web calls it `registerHandle`; the Solidity function is `register`.
    /// The handle must arrive WITHOUT its leading `@` — the contract hashes the raw bytes.
    static func registerHandleCalldata(handle: String, secret: Data) throws -> Data {
        let enc = ABIFunctionEncoder("register")
        try enc.encode(handle)
        try enc.encode(Data32(data: secret))
        return try enc.encoded()
    }

    /// The raw `abi.encode(handle, owner, secret)` bytes behind a commitment, BEFORE keccak256,
    /// with abi types [string, address, bytes32]. Exposed so a golden test can assert the
    /// encoding matches `cast abi-encode` independently of the hash.
    static func handleCommitmentAbiEncoded(handle: String, owner: String, secret: Data) throws -> Data {
        let enc = ABIFunctionEncoder("f")
        try enc.encode(handle)
        try enc.encode(EthereumAddress(owner))
        try enc.encode(Data32(data: secret))
        return Data(try enc.encoded().dropFirst(4))
    }

    /// `MarenRegistry.makeCommitment(handle, owner, secret)` reproduced locally:
    ///   keccak256(abi.encode(handle, owner, secret))
    ///
    /// A commitment that disagrees with the contract by ONE BYTE can be published and can
    /// never be revealed — the failure surfaces 60 seconds later as `CommitmentNotFound`,
    /// after the user has already paid for a transaction. So this is pinned to `cast` in a
    /// golden test AND cross-checked at runtime against the contract's own `pure`
    /// `makeCommitment` before anything is committed (see `MezoActions.commitHandle`).
    static func handleCommitment(handle: String, owner: String, secret: Data) throws -> Data {
        try handleCommitmentAbiEncoded(handle: handle, owner: owner, secret: secret).web3.keccak256
    }

    /// Calldata for the free `eth_call` that asks the CONTRACT for the same digest.
    static func makeCommitmentCalldata(handle: String, owner: String, secret: Data) throws -> Data {
        let enc = ABIFunctionEncoder("makeCommitment")
        try enc.encode(handle)
        try enc.encode(EthereumAddress(owner))
        try enc.encode(Data32(data: secret))
        return try enc.encoded()
    }

    // ---------------------------------------------------------------------------
    // Event topic0s — how a receipt reports the id it just minted
    // ---------------------------------------------------------------------------

    /// topic0 of `LinkCreated(uint256 indexed linkId, address indexed creator, address indexed
    /// linkKey, uint256 amount, uint64 expiry)`. The linkId is INDEXED, so it rides in
    /// `topics[1]` of the log and needs no data decoding. Pinned to `cast keccak` in a golden
    /// test: a wrong byte here means the app silently fails to learn its own link id.
    static let linkCreatedTopic =
        "LinkCreated(uint256,address,address,uint256,uint64)".web3.keccak256.web3.hexString.lowercased()

    /// topic0 of `RequestCreated(uint256 indexed requestId, address indexed requester,
    /// address indexed payer, uint256 amount, string memo)`. requestId is `topics[1]`.
    static let requestCreatedTopic =
        "RequestCreated(uint256,address,address,uint256,string)".web3.keccak256.web3.hexString.lowercased()

    /// topic0 of `HandleRegistered(bytes32 indexed node, address indexed owner, string handle)`.
    static let handleRegisteredTopic =
        "HandleRegistered(bytes32,address,string)".web3.keccak256.web3.hexString.lowercased()

    /// topic0 of `Committed(bytes32 indexed commitment, uint256 committedAt)`.
    static let committedTopic =
        "Committed(bytes32,uint256)".web3.keccak256.web3.hexString.lowercased()

    // ---------------------------------------------------------------------------
    // MarenPay.claimLink digest
    // ---------------------------------------------------------------------------

    /// The inner hash a link's one-time key signs, BEFORE the EIP-191 prefix:
    ///   keccak256(abi.encode("MarenPay.claimLink", chainId, marenPay, linkId, recipient))
    /// with abi types [string, uint256, address, uint256, address]. Reproduced byte-for-byte
    /// from `MarenPay.linkClaimDigest`; a mismatch recovers to the wrong signer and the
    /// contract reverts `InvalidLinkSignature`, spending nothing.
    /// The raw `abi.encode(...)` bytes for the claimLink tuple, BEFORE keccak256. Exposed so a
    /// golden test can assert the encoding matches `cast abi-encode` independently of the hash.
    static func claimLinkAbiEncoded(chainId: Int, marenPay: String, linkId: BigUInt, recipient: String) throws -> Data {
        let enc = ABIFunctionEncoder("f")
        try enc.encode("MarenPay.claimLink")
        try enc.encode(BigUInt(chainId))
        try enc.encode(EthereumAddress(marenPay))
        try enc.encode(linkId)
        try enc.encode(EthereumAddress(recipient))
        return Data(try enc.encoded().dropFirst(4))
    }

    static func claimLinkInner(chainId: Int, marenPay: String, linkId: BigUInt, recipient: String) throws -> Data {
        // web3.swift exposes no public "encode a bare argument tuple", but `ABIFunctionEncoder`
        // emits exactly `selector ++ abi.encode(tuple)`. Encoding under a throwaway function
        // name and dropping the 4-byte selector (see `claimLinkAbiEncoded`) yields the same
        // bytes `abi.encode(...)` (and `cast abi-encode`) produce, using only public API.
        try claimLinkAbiEncoded(chainId: chainId, marenPay: marenPay, linkId: linkId, recipient: recipient)
            .web3.keccak256
    }

    /// The full digest passed to `ECDSA.recover` on-chain: the EIP-191
    /// `toEthSignedMessageHash` of the inner hash. Exposed for the golden test; the signing
    /// path uses `EthereumAccount.signMessage(message:)`, which applies the identical prefix.
    static func ethSignedMessageHash(_ inner: Data) -> Data {
        let prefix = "\u{19}Ethereum Signed Message:\n\(inner.count)"
        var data = prefix.data(using: .ascii) ?? Data()
        data.append(inner)
        return data.web3.keccak256
    }

    // ---------------------------------------------------------------------------
    // EIP-712 ForwardRequest (MarenRelayHub / MarenForwarder)
    // ---------------------------------------------------------------------------

    /// The domain, byte-identical to the contract. `MarenForwarder` passes this name to
    /// OpenZeppelin's `ERC2771Forwarder` (an `EIP712` with version "1"), and `MarenRelayHub`
    /// extends it, so `verifyingContract` is the HUB's own address.
    static let forwarderDomainName = "Maren Forwarder"
    static let forwarderDomainVersion = "1"

    /// A ForwardRequest ready to sign. `value` is pinned at zero — the hub reverts
    /// `ValueNotRelayable` on anything else. FIELD ORDER IS CONSENSUS-CRITICAL: nonce precedes
    /// deadline, matching OpenZeppelin's `ForwardRequest` typehash.
    struct ForwardRequest: Sendable {
        let from: String
        let to: String
        let value: BigUInt
        let gas: BigUInt
        let nonce: BigUInt
        let deadline: UInt64      // uint48 on-chain
        let data: Data
    }

    /// Build the web3.swift `TypedData` for a ForwardRequest. Constructed by decoding a JSON
    /// document (TypedData is Codable) so no GenericJSON types leak into this module. All
    /// integers are exact decimal strings — never JSON numbers — so nothing routes through a
    /// lossy `Double`.
    static func forwardRequestTypedData(chainId: Int, verifyingContract: String, request: ForwardRequest) throws -> TypedData {
        let json: [String: Any] = [
            "types": [
                "EIP712Domain": [
                    ["name": "name", "type": "string"],
                    ["name": "version", "type": "string"],
                    ["name": "chainId", "type": "uint256"],
                    ["name": "verifyingContract", "type": "address"],
                ],
                "ForwardRequest": [
                    ["name": "from", "type": "address"],
                    ["name": "to", "type": "address"],
                    ["name": "value", "type": "uint256"],
                    ["name": "gas", "type": "uint256"],
                    ["name": "nonce", "type": "uint256"],
                    ["name": "deadline", "type": "uint48"],
                    ["name": "data", "type": "bytes"],
                ],
            ],
            "primaryType": "ForwardRequest",
            "domain": [
                "name": forwarderDomainName,
                "version": forwarderDomainVersion,
                "chainId": String(chainId),
                "verifyingContract": verifyingContract,
            ],
            "message": [
                "from": request.from,
                "to": request.to,
                "value": String(request.value),
                "gas": String(request.gas),
                "nonce": String(request.nonce),
                "deadline": String(request.deadline),
                "data": request.data.web3.hexString,
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: json, options: [])
        return try JSONDecoder().decode(TypedData.self, from: data)
    }

    /// The EIP-712 domain separator, keccak256(encodeData(domain,"EIP712Domain")).
    static func domainSeparator(_ typedData: TypedData) throws -> Data {
        try typedData.encodeData(data: typedData.domain, type: "EIP712Domain").web3.keccak256
    }

    /// The EIP-712 struct hash of the primary type's message.
    static func structHash(_ typedData: TypedData) throws -> Data {
        try typedData.encodeData(data: typedData.message, type: typedData.primaryType).web3.keccak256
    }

    /// The full signable digest: keccak256(0x1901 ++ domainSeparator ++ structHash).
    static func digest(_ typedData: TypedData) throws -> Data {
        try typedData.signableHash()
    }
}
