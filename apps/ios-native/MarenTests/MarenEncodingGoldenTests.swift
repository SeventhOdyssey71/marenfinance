import XCTest
import BigInt
import web3
@testable import Maren

// MARK: - Golden encoding & signing tests
//
// These are the point of Wave 2. Every expected value below was computed INDEPENDENTLY with
// Foundry's `cast` (v1.4.3), and the exact command is quoted above each constant so the test
// is self-contained and reproducible. If any assertion here fails, the Swift chain layer
// disagrees with Foundry about a consensus-critical byte, and the fix is the Swift side —
// never a weakened assertion.
//
// Fixed inputs used throughout:
//   chainId    = 31611                                            (Mezo matsnet)
//   marenPay   = 0xe475Ff919D54E055809f516E3bed8a5c7a101836        (testnet deployment)
//   hub        = 0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C        (MarenRelayHub / forwarder)
//   recipient  = 0x54196397D6f01b48739dB3957257cB33cD341885
//   from       = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266        (derives from the test key)
//   linkId     = 42
//   privateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

final class MarenEncodingGoldenTests: XCTestCase {

    let chainId = 31611
    let marenPay = "0xe475Ff919D54E055809f516E3bed8a5c7a101836"
    let hub = "0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C"
    let recipient = "0x54196397D6f01b48739dB3957257cB33cD341885"
    let from = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

    // MARK: 1 — MarenPay.claimLink abi.encode + keccak256

    // cast abi-encode "f(string,uint256,address,uint256,address)" \
    //   "MarenPay.claimLink" 31611 0xe475Ff919D54E055809f516E3bed8a5c7a101836 42 \
    //   0x54196397D6f01b48739dB3957257cB33cD341885
    let expectedClaimLinkAbiEncode =
        "0x00000000000000000000000000000000000000000000000000000000000000a0" +
        "0000000000000000000000000000000000000000000000000000000000007b7b" +
        "000000000000000000000000e475ff919d54e055809f516e3bed8a5c7a101836" +
        "000000000000000000000000000000000000000000000000000000000000002a" +
        "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
        "0000000000000000000000000000000000000000000000000000000000000012" +
        "4d6172656e5061792e636c61696d4c696e6b0000000000000000000000000000"

    // cast keccak <the abi-encode output above>
    let expectedClaimLinkInner = "0x52ff7c196124e186249074fee44f4d0627eb92380774f2aaeed15b3b199066e6"

    func testClaimLinkAbiEncodeAndKeccakMatchCast() throws {
        let encoded = try MarenEncoding.claimLinkAbiEncoded(chainId: chainId, marenPay: marenPay, linkId: 42, recipient: recipient)
        XCTAssertEqual(encoded.web3.hexString, expectedClaimLinkAbiEncode, "claimLink abi.encode must match cast abi-encode")

        let inner = try MarenEncoding.claimLinkInner(chainId: chainId, marenPay: marenPay, linkId: 42, recipient: recipient)
        XCTAssertEqual(inner.web3.hexString, expectedClaimLinkInner, "keccak256 of the encoding must match cast keccak")
    }

    // MARK: 2 — MarenPay.pay(address,uint256,string) calldata

    // cast calldata "pay(address,uint256,string)" \
    //   0x54196397D6f01b48739dB3957257cB33cD341885 1000000000000000000 "coffee"
    let expectedPayCalldata =
        "0x4a4bdb30" +
        "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
        "0000000000000000000000000000000000000000000000000000000000000060" +
        "0000000000000000000000000000000000000000000000000000000000000006" +
        "636f666665650000000000000000000000000000000000000000000000000000"

    func testPayCalldataMatchesCast() throws {
        let amount = BigUInt("1000000000000000000") // 1e18 wei
        let data = try MarenEncoding.payCalldata(to: recipient, amount: amount, memo: "coffee")
        XCTAssertEqual(data.web3.hexString, expectedPayCalldata, "pay() calldata must match cast calldata")
    }

    // MARK: 3 — EIP-712 ForwardRequest domain separator, struct hash, digest

    // Domain separator, built stepwise with cast:
    //   DTH = cast keccak "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    //   NH  = cast keccak "Maren Forwarder"
    //   VH  = cast keccak "1"
    //   cast keccak $(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" $DTH $NH $VH 31611 <hub>)
    let expectedDomainSeparator = "0x18401e05fb440cf4513241101054b82804f03e594d47cac450db466dc30d3385"

    // Struct hash:
    //   FTH = cast keccak "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    //   DH  = cast keccak <pay calldata above>          (the ForwardRequest's `data`)
    //   cast keccak $(cast abi-encode "f(bytes32,address,address,uint256,uint256,uint256,uint256,bytes32)" \
    //       $FTH <from> <marenPay> 0 200000 7 1893456000 $DH)
    let expectedStructHash = "0x3179cb52ca74a7cab0042a02b14a6fdff5a263de43a6a11cdb894707f6a2b008"

    // Full digest: cast keccak 0x1901<domainSeparator><structHash>
    let expectedDigest = "0x1933d72ccd51a2cadcc9228c4ccae90c1c1a7b2beb9315c8a74447431e2e795f"

    /// The ForwardRequest fixed inputs: `to` = marenPay, `data` = the pay() calldata, gas
    /// 200000, nonce 7, deadline 1893456000 (2030-01-01), value 0.
    func makeForwardRequest() throws -> MarenEncoding.ForwardRequest {
        let data = try MarenEncoding.payCalldata(to: recipient, amount: BigUInt("1000000000000000000"), memo: "coffee")
        return MarenEncoding.ForwardRequest(
            from: from, to: marenPay, value: 0, gas: 200_000, nonce: 7,
            deadline: 1_893_456_000, data: data
        )
    }

    func testForwardRequestDomainSeparatorMatchesCast() throws {
        let typed = try MarenEncoding.forwardRequestTypedData(chainId: chainId, verifyingContract: hub, request: try makeForwardRequest())
        let ds = try MarenEncoding.domainSeparator(typed)
        XCTAssertEqual(ds.web3.hexString, expectedDomainSeparator, "EIP-712 domain separator must match cast")
    }

    func testForwardRequestStructHashMatchesCast() throws {
        let typed = try MarenEncoding.forwardRequestTypedData(chainId: chainId, verifyingContract: hub, request: try makeForwardRequest())
        let sh = try MarenEncoding.structHash(typed)
        XCTAssertEqual(sh.web3.hexString, expectedStructHash, "EIP-712 ForwardRequest struct hash must match cast")
    }

    func testForwardRequestDigestMatchesCast() throws {
        let typed = try MarenEncoding.forwardRequestTypedData(chainId: chainId, verifyingContract: hub, request: try makeForwardRequest())
        let digest = try MarenEncoding.digest(typed)
        XCTAssertEqual(digest.web3.hexString, expectedDigest, "EIP-712 signable digest must match cast (0x1901 ‖ DS ‖ SH)")
    }

    // MARK: 4 — secp256k1 sign/recover round trip

    // cast wallet address --private-key 0xac09...ff80
    let expectedAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    // cast wallet sign --no-hash --private-key 0xac09...ff80 <expectedDigest>
    let expectedSignature =
        "0x490872a18e6e7f1195e8a8e1d5682700452c65e2259d749e0a97c195d830d461" +
        "50aac9971a7d57147c1024fdf0dfd7b46f174b41b0ec3c32c11d7497b2d505db1c"

    func testSecp256k1SignsKnownDigestToKnownSignature() throws {
        let pk = Data(hex: "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")!
        let digest = Data(hex: expectedDigest)!

        // Sign the raw 32-byte digest (hashing: false). KeyUtil returns v as the recovery id
        // (0/1); normalise to 27/28 to match `cast wallet sign`.
        var sig = try KeyUtil.sign(message: digest, with: pk, hashing: false)
        XCTAssertEqual(sig.count, 65)
        if sig[64] < 27 { sig[64] += 27 }
        XCTAssertEqual(sig.web3.hexString, expectedSignature, "signature must match cast wallet sign --no-hash")

        // Round-trip: the signature recovers to the known address.
        let recovered = try KeyUtil.recoverPublicKey(message: digest, signature: sig)
        XCTAssertEqual(recovered.lowercased(), expectedAddress.lowercased(), "signature must recover to the key's address")

        // And the key independently derives that same address.
        let derived = try Keystore.address(of: pk)
        XCTAssertEqual(derived.lowercased(), expectedAddress.lowercased(), "private key must derive the known address")
    }

    // MARK: 5 — the production ForwardRequest signer recovers to the signer

    /// Not a `cast` golden, but a consistency check that the full production signing path
    /// (`MezoActions.signForwardRequest` → EIP-712 digest → v=27/28) produces a signature that
    /// recovers to the signer. This is the exact recovery `MarenRelayHub` performs.
    func testForwardRequestSignatureRecoversToSigner() throws {
        let pk = Data(hex: "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")!
        let sigHex = try MezoActions.signForwardRequest(
            privateKey: pk, chainId: chainId, verifyingContract: hub, request: try makeForwardRequest()
        )
        let sig = Data(hex: sigHex)!
        let digest = Data(hex: expectedDigest)!
        let recovered = try KeyUtil.recoverPublicKey(message: digest, signature: sig)
        XCTAssertEqual(recovered.lowercased(), expectedAddress.lowercased())
    }

    // MARK: MarenVault write calldata (borrow / repay / withdraw / deposit)
    //
    // amount = 1e18, both hints = the zero address.
    // cast calldata "borrow(uint256,address,address)"   1000000000000000000 0x0…0 0x0…0
    // cast calldata "repay(uint256,address,address)"    1000000000000000000 0x0…0 0x0…0
    // cast calldata "withdraw(uint256,address,address)" 1000000000000000000 0x0…0 0x0…0
    // cast calldata "deposit(address,address)"          0x0…0 0x0…0

    func testVaultWriteCalldataMatchesCast() throws {
        let amount = BigUInt(10).power(18)
        let expected: [String: String] = [
            "borrow": "0xd5164184",
            "repay": "0xc883b2e5",
            "withdraw": "0xb460af94",
        ]
        // Full 100-byte body: selector + amount(32) + zero(32) + zero(32).
        let tail =
            "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
            "0000000000000000000000000000000000000000000000000000000000000000" +
            "0000000000000000000000000000000000000000000000000000000000000000"
        for (fn, selector) in expected {
            let data = try MarenEncoding.vaultWriteCalldata(function: fn, amount: amount, hints: .none)
            XCTAssertEqual(data.web3.hexString, selector + tail, "\(fn) calldata must match cast")
        }
    }

    func testDepositCalldataMatchesCast() throws {
        let data = try MarenEncoding.depositCalldata(hints: .none)
        let expected = "0xf9609f08" +
            "0000000000000000000000000000000000000000000000000000000000000000" +
            "0000000000000000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "deposit calldata must match cast")
    }

    // cast calldata "approve(address,uint256)" 0x54196397D6f01b48739dB3957257cB33cD341885 1000000000000000000
    func testApproveCalldataMatchesCast() throws {
        let data = try MarenEncoding.approveCalldata(spender: recipient, amount: BigUInt(10).power(18))
        let expected = "0x095ea7b3" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
        XCTAssertEqual(data.web3.hexString, expected, "approve calldata must match cast")
    }

    // cast calldata "deposit(uint256,address)"          1e18 0x5419…1885
    // cast calldata "withdraw(uint256,address,address)" 1e18 0x5419…1885 0x5419…1885
    func testEarnCalldataMatchesCast() throws {
        let amt = BigUInt(10).power(18)
        let amtWord = "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
        let addrWord = "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885"

        let deposit = try MarenEncoding.earnDepositCalldata(assets: amt, receiver: recipient)
        XCTAssertEqual(deposit.web3.hexString, "0x6e553f65" + amtWord + addrWord, "earn deposit calldata must match cast")

        let withdraw = try MarenEncoding.earnWithdrawCalldata(assets: amt, receiver: recipient, owner: recipient)
        XCTAssertEqual(withdraw.web3.hexString, "0xb460af94" + amtWord + addrWord + addrWord, "earn withdraw calldata must match cast")
    }

    // cast calldata "claimLink(uint256,address,bytes)" 42 0x5419…1885 0x1111…03  (65-byte sig)
    func testClaimLinkCalldataMatchesCast() throws {
        let sig = Data(hex: "0x1111111111111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222222222222203")!
        let data = try MarenEncoding.claimLinkCalldata(linkId: 42, recipient: recipient, signature: sig)
        let expected = "0xaf4be47b" +
            "000000000000000000000000000000000000000000000000000000000000002a" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "0000000000000000000000000000000000000000000000000000000000000060" +
            "0000000000000000000000000000000000000000000000000000000000000041" +
            "1111111111111111111111111111111111111111111111111111111111111111" +
            "2222222222222222222222222222222222222222222222222222222222222222" +
            "0300000000000000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "claimLink calldata must match cast")
    }

    // MARK: MarenEarn Harvested event topic0
    //
    // The realised-yield scan recognises a liquidation-gain log by topic0. A wrong byte here
    // would silently drop every harvest and under-report yield, so it is pinned to cast.
    // cast keccak "Harvested(uint256,uint256,uint256,uint256)"
    func testHarvestedEventTopicMatchesCast() {
        let expected = "0x4c0f499ffe6befa0ca7c826b0916cf87bea98de658013e76938489368d60d509"
        XCTAssertEqual(MezoMarenClient.harvestedTopic, expected,
                       "Harvested topic0 must match cast keccak of the event signature")
    }

    // cast calldata "split(address[],uint256[],string)" "[R,R]" "[1e18,2e18]" "hi"
    // (An EMPTY memo is verified separately: web3.swift pads a 0-length string to a full zero
    //  word where cast emits none — a trailing byte the contract's decoder ignores, proven by a
    //  live split of my encoder's exact bytes settling status-1. A non-empty memo matches cast
    //  byte-for-byte, which is what this asserts.)
    func testSplitCalldataMatchesCast() throws {
        let data = try MarenEncoding.splitCalldata(recipients: [recipient, recipient],
                                                   amounts: [BigUInt(10).power(18), BigUInt(2) * BigUInt(10).power(18)],
                                                   memo: "hi")
        let expected = "0xad0ffab1" +
            "0000000000000000000000000000000000000000000000000000000000000060" +
            "00000000000000000000000000000000000000000000000000000000000000c0" +
            "0000000000000000000000000000000000000000000000000000000000000120" +
            "0000000000000000000000000000000000000000000000000000000000000002" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "0000000000000000000000000000000000000000000000000000000000000002" +
            "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
            "0000000000000000000000000000000000000000000000001bc16d674ec80000" +
            "0000000000000000000000000000000000000000000000000000000000000002" +
            "6869000000000000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "split calldata must match cast")
    }

    // MARK: MarenPay.createLink(address,uint256,uint64,string)
    //
    // `expiry` IS uint64, not uint256 — a uint256 here is a DIFFERENT selector and the relayer
    // would answer SELECTOR_NOT_ALLOWED, so the selector is pinned on its own as well.
    //
    // cast sig      "createLink(address,uint256,uint64,string)"                  -> 0xd93a901c
    // cast calldata "createLink(address,uint256,uint64,string)" \
    //   0x54196397D6f01b48739dB3957257cB33cD341885 1000000000000000000 1893456000 "gift"
    func testCreateLinkCalldataMatchesCast() throws {
        let data = try MarenEncoding.createLinkCalldata(linkKey: recipient,
                                                        amount: BigUInt(10).power(18),
                                                        expiry: 1_893_456_000,
                                                        memo: "gift")
        let expected = "0xd93a901c" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
            "0000000000000000000000000000000000000000000000000000000070dbd880" +
            "0000000000000000000000000000000000000000000000000000000000000080" +
            "0000000000000000000000000000000000000000000000000000000000000004" +
            "6769667400000000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "createLink calldata must match cast")
        XCTAssertEqual(data.web3.hexString.prefix(10), "0xd93a901c",
                       "createLink selector must be the uint64-expiry one, not a uint256 lookalike")
    }

    // MARK: MarenPay.createRequest(address,uint256,string)
    //
    // cast sig      "createRequest(address,uint256,string)"                      -> 0xba9a7a9e
    // cast calldata "createRequest(address,uint256,string)" \
    //   0x54196397D6f01b48739dB3957257cB33cD341885 1000000000000000000 "dinner"
    func testCreateRequestCalldataMatchesCast() throws {
        let data = try MarenEncoding.createRequestCalldata(payer: recipient,
                                                           amount: BigUInt(10).power(18),
                                                           memo: "dinner")
        let expected = "0xba9a7a9e" +
            "00000000000000000000000054196397d6f01b48739db3957257cb33cd341885" +
            "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
            "0000000000000000000000000000000000000000000000000000000000000060" +
            "0000000000000000000000000000000000000000000000000000000000000006" +
            "64696e6e65720000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "createRequest calldata must match cast")
    }

    // MARK: MarenPay.fulfillRequest(uint256)
    //
    // cast sig      "fulfillRequest(uint256)"     -> 0x9a91eb0d
    // cast calldata "fulfillRequest(uint256)" 7
    func testFulfillRequestCalldataMatchesCast() throws {
        let data = try MarenEncoding.fulfillRequestCalldata(requestId: 7)
        let expected = "0x9a91eb0d" +
            "0000000000000000000000000000000000000000000000000000000000000007"
        XCTAssertEqual(data.web3.hexString, expected, "fulfillRequest calldata must match cast")
    }

    // MARK: MarenRegistry.makeCommitment(string,address,bytes32) — the commitment digest
    //
    // handle "sele", owner 0xf39F…2266, secret 0x2222…2222.
    //
    // cast abi-encode "f(string,address,bytes32)" "sele" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
    //   0x2222222222222222222222222222222222222222222222222222222222222222
    let expectedCommitmentAbiEncode =
        "0x0000000000000000000000000000000000000000000000000000000000000060" +
        "000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266" +
        "2222222222222222222222222222222222222222222222222222222222222222" +
        "0000000000000000000000000000000000000000000000000000000000000004" +
        "73656c6500000000000000000000000000000000000000000000000000000000"

    // cast keccak <the abi-encode output above>
    let expectedCommitment = "0xca5fcf1135c694e70219f7a7885c1a13547d5074b58615e173c67e015f4e9366"

    let handleSecret = "0x2222222222222222222222222222222222222222222222222222222222222222"

    func testHandleCommitmentMatchesCast() throws {
        let secret = Data(hex: handleSecret)!
        let encoded = try MarenEncoding.handleCommitmentAbiEncoded(handle: "sele", owner: from, secret: secret)
        XCTAssertEqual(encoded.web3.hexString, expectedCommitmentAbiEncode,
                       "commitment abi.encode must match cast abi-encode")

        let digest = try MarenEncoding.handleCommitment(handle: "sele", owner: from, secret: secret)
        XCTAssertEqual(digest.web3.hexString, expectedCommitment,
                       "commitment digest must match cast keccak — a one-byte drift here is a commitment that can never be revealed")
    }

    // cast calldata "makeCommitment(string,address,bytes32)" "sele" 0xf39F…2266 0x2222…2222
    func testMakeCommitmentCalldataMatchesCast() throws {
        let data = try MarenEncoding.makeCommitmentCalldata(handle: "sele", owner: from,
                                                            secret: Data(hex: handleSecret)!)
        XCTAssertEqual(data.web3.hexString, "0xf49826be" + String(expectedCommitmentAbiEncode.dropFirst(2)),
                       "makeCommitment calldata must match cast")
    }

    // MARK: MarenRegistry.commit(bytes32) — step one of registration
    //
    // cast sig      "commit(bytes32)"    -> 0xf14fcbc8
    // cast calldata "commit(bytes32)" 0xca5fcf1135c694e70219f7a7885c1a13547d5074b58615e173c67e015f4e9366
    func testCommitHandleCalldataMatchesCast() throws {
        let data = try MarenEncoding.commitHandleCalldata(commitment: Data(hex: expectedCommitment)!)
        let expected = "0xf14fcbc8" +
            "ca5fcf1135c694e70219f7a7885c1a13547d5074b58615e173c67e015f4e9366"
        XCTAssertEqual(data.web3.hexString, expected, "commit calldata must match cast")
    }

    // MARK: MarenRegistry.register(string,bytes32) — step two
    //
    // cast sig      "register(string,bytes32)"    -> 0x656afdee
    // cast calldata "register(string,bytes32)" "sele" \
    //   0x2222222222222222222222222222222222222222222222222222222222222222
    func testRegisterHandleCalldataMatchesCast() throws {
        let data = try MarenEncoding.registerHandleCalldata(handle: "sele", secret: Data(hex: handleSecret)!)
        let expected = "0x656afdee" +
            "0000000000000000000000000000000000000000000000000000000000000040" +
            "2222222222222222222222222222222222222222222222222222222222222222" +
            "0000000000000000000000000000000000000000000000000000000000000004" +
            "73656c6500000000000000000000000000000000000000000000000000000000"
        XCTAssertEqual(data.web3.hexString, expected, "register calldata must match cast")
    }

    // MARK: event topic0s — how a receipt reports the id it just minted
    //
    // cast keccak "LinkCreated(uint256,address,address,uint256,uint64)"
    // cast keccak "RequestCreated(uint256,address,address,uint256,string)"
    // cast keccak "HandleRegistered(bytes32,address,string)"
    // cast keccak "Committed(bytes32,uint256)"
    func testMintedIdEventTopicsMatchCast() {
        XCTAssertEqual(MarenEncoding.linkCreatedTopic,
                       "0xdf15c4cbacfc2b31e63a6e5d69d4bf8e4a7e43b4009022229982cc0ac28b5327",
                       "LinkCreated topic0 must match cast keccak")
        XCTAssertEqual(MarenEncoding.requestCreatedTopic,
                       "0xfab7026c201703a6ce65999fa587d7f23b07a13c3f7f6c86456e6195e37f3c16",
                       "RequestCreated topic0 must match cast keccak")
        XCTAssertEqual(MarenEncoding.handleRegisteredTopic,
                       "0xb51e24ca9479f1f48c99c45f4d89c5a1853cfab00d1852d28bb3ea9f1feb58c6",
                       "HandleRegistered topic0 must match cast keccak")
        XCTAssertEqual(MarenEncoding.committedTopic,
                       "0xcc4c1525c958b2fb4f1467dc8ccd3c4d1837a460574a7980d2b9daa8dcc1507c",
                       "Committed topic0 must match cast keccak")
    }
}
