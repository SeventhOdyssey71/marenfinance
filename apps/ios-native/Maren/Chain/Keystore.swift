import Foundation
import LocalAuthentication
import Security
import BigInt
import web3

// MARK: - Keystore
//
// The signing key: a secp256k1 private key stored in the iOS Keychain behind a biometric
// SecAccessControl, mirroring the RN `wallet/keystore.ts`. Two rules this module exists to
// enforce:
//
//   1. THE KEY IS NEVER LOGGED and never held longer than one signature. It is read from the
//      Keychain for the duration of a signature and dropped. Every read costs a Face ID / Touch
//      ID prompt, which is the point.
//   2. WE NEVER QUIETLY DOWNGRADE. If the device cannot offer biometric protection we do NOT
//      store an unprotected Keychain item while the UI says "protected by Face ID". The key
//      stays in memory for the session only and the caller is told so, in as many words.
//
// No `print`/`os_log` in this file touches key bytes. There is no code path that emits them.

/// How the key for this session is actually held. The UI must never describe a
/// `session-only` key as biometrically protected.
enum KeyProtection: Sendable, Equatable {
    case keychainBiometric(label: String)
    case sessionOnly(reason: String)
}

enum BiometricKind: String, Sendable { case faceID, touchID, other, none }

struct BiometricCapability: Sendable {
    let available: Bool
    let enrolled: Bool
    let kind: BiometricKind
    let reason: String?

    var displayName: String {
        switch kind {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "Biometrics"
        }
    }
}

enum KeyAccess: Sendable {
    case ok(privateKey: Data)
    case denied(reason: String)
    case missing
}

/// Errors surfaced to the caller. None carries key material.
enum KeystoreError: Error, Sendable {
    case invalidPrivateKey
    case keychainRefused(String)
}

actor Keystore {
    static let shared = Keystore()

    /// Keychain item label. Distinct from the RN app's so the two never collide on a device
    /// that has both installed.
    private let account = "finance.maren.swift.signingKey.v1"
    private let service = "finance.maren.swift"
    private let authPrompt = "Unlock your Maren signing key"

    /// In-memory fallback for devices with no enrolled biometrics. Cleared on process exit;
    /// never written to disk.
    private var sessionKey: Data?

    // MARK: capability

    nonisolated func capability() -> BiometricCapability {
        let ctx = LAContext()
        var error: NSError?
        let canEvaluate = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        let kind: BiometricKind
        switch ctx.biometryType {
        case .faceID: kind = .faceID
        case .touchID: kind = .touchID
        case .none: kind = .none
        default: kind = .other   // .opticID and any future biometry
        }

        if canEvaluate {
            return BiometricCapability(available: true, enrolled: true, kind: kind, reason: nil)
        }
        // Distinguish "no hardware" from "hardware present, not enrolled": both mean we cannot
        // biometrically protect the item, and both are reported honestly rather than hidden.
        let code = error.map { LAError.Code(rawValue: $0.code) }
        let notEnrolled = code == .biometryNotEnrolled
        return BiometricCapability(
            available: kind != .none,
            enrolled: false,
            kind: kind,
            reason: notEnrolled ? "No Face ID or Touch ID is enrolled on this device."
                                : "This device has no usable biometric sensor."
        )
    }

    // MARK: key lifecycle

    /// Validate and normalise a hex private key (with or without 0x). Returns 32 bytes.
    static func normalise(_ input: String) -> Data? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("0x") || s.hasPrefix("0X") { s = String(s.dropFirst(2)) }
        guard s.count == 64, s.utf8.allSatisfy({ (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }),
              let scalar = BigUInt(s, radix: 16), scalar > 0,
              scalar < BigUInt("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", radix: 16)! else { return nil }
        return Data(hex: s)
    }

    /// The 0x address a private key derives, via web3.swift's secp256k1 + keccak. Used to
    /// bind the loaded account to the key that will sign for it.
    static func address(of privateKey: Data) throws -> String {
        let pub = try KeyUtil.generatePublicKey(from: privateKey)
        return KeyUtil.generateAddress(from: pub).asString()
    }

    /// Persist a key. Returns how it ended up being held so the caller can tell the truth —
    /// this never silently degrades.
    func store(privateKey: Data) throws -> KeyProtection {
        guard privateKey.count == 32, Self.normalise(privateKey.web3.hexString) != nil else { throw KeystoreError.invalidPrivateKey }
        let cap = capability()

        guard cap.available, cap.enrolled else {
            sessionKey = privateKey
            return .sessionOnly(reason: cap.reason ?? "Biometrics are unavailable on this device.")
        }

        var accessError: Unmanaged<CFError>?
        // biometryCurrentSet: invalidated if the enrolled set changes. ThisDeviceOnly keeps it
        // off iCloud Keychain and out of any restored backup.
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            sessionKey = privateKey
            return .sessionOnly(reason: "The Keychain refused a biometry-backed item on this device.")
        }

        // Remove any prior item first; SecItemAdd fails with errSecDuplicateItem otherwise.
        SecItemDelete(baseQuery() as CFDictionary)

        var add = baseQuery()
        add[kSecValueData as String] = privateKey
        add[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            sessionKey = privateKey
            return .sessionOnly(reason: "The Keychain refused to store the key (status \(status)).")
        }
        sessionKey = nil
        return .keychainBiometric(label: cap.displayName)
    }

    /// Read the key, forcing a biometric prompt. Called once per signing action, never cached.
    /// The Face ID gate on every signature is guaranteed by making the bytes physically
    /// unavailable without one.
    func access() -> KeyAccess {
        if let key = sessionKey {
            // A session-only key still gets an explicit presence check where the hardware
            // allows, so the "biometrics on every signature" promise holds wherever possible.
            let cap = capability()
            if cap.available && cap.enrolled {
                let ctx = LAContext()
                let sem = DispatchSemaphore(value: 0)
                var ok = false
                ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: authPrompt) { success, _ in
                    ok = success; sem.signal()
                }
                sem.wait()
                if !ok { return .denied(reason: "Authentication was not completed.") }
            }
            return .ok(privateKey: key)
        }

        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecUseOperationPrompt as String] = authPrompt
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return .missing }
            return .ok(privateKey: data)
        case errSecItemNotFound:
            return .missing
        case errSecUserCanceled, errSecAuthFailed:
            return .denied(reason: "The biometric prompt was cancelled, so nothing was signed.")
        default:
            return .denied(reason: "The Keychain refused to read the key (status \(status)).")
        }
    }

    /// Whether a key exists, without prompting for biometrics.
    func hasKey() -> Bool {
        if sessionKey != nil { return true }
        var query = baseQuery()
        query[kSecReturnData as String] = false
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // errSecInteractionNotAllowed means the item exists but needs biometry to read.
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    func protection() -> KeyProtection? {
        if sessionKey != nil {
            return .sessionOnly(reason: "This key is held only while Maren is running. Back it up before closing the app.")
        }
        return hasKey() ? .keychainBiometric(label: capability().displayName) : nil
    }

    func clear() {
        sessionKey = nil
        SecItemDelete(baseQuery() as CFDictionary)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// A single recoverable escrow creation per wallet. Stored only in biometric Keychain.
/// No raw wallet signing key is included; `secret` is the link's separate bearer key.
struct PendingClaimLink: Codable, Sendable, Equatable {
    let owner: String
    let secret: String
    let linkKey: String
    let amount: String
    let expiry: UInt64
    let startBlock: Int
    var txHash: String?
    var linkId: UInt64?

    func validated(owner expectedOwner: String) -> Bool {
        guard PaymentLinks.isAddress(owner), owner.lowercased() == expectedOwner.lowercased(),
              let key = Keystore.normalise(secret),
              let derived = try? Keystore.address(of: key), derived.lowercased() == linkKey.lowercased(),
              Amount.parse(amount) != nil, startBlock >= 0, expiry > 0 else { return false }
        if let txHash, txHash.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) == nil { return false }
        if let linkId, linkId == 0 || txHash == nil { return false }
        return true
    }

    /// Returns false only when the action proves no escrow was created.
    mutating func retain(after result: SubmitOutcome) -> Bool {
        switch result {
        case .delivered(let delivered):
            txHash = delivered.hash; linkId = delivered.mintedId
        case .failed(let tx):
            switch tx {
            case .reverted: return false
            case .timeout(let hash), .unreachable(let hash, _): txHash = hash
            case .delivered(let delivered): txHash = delivered.hash; linkId = delivered.mintedId
            case .submissionUnknown: break
            }
        case .declined, .demo: return false
        }
        return true
    }

    /// A restart may precede saving the returned hash. LinkCreated indexes the unique bearer
    /// address, so logs can recover the exact transaction without guessing an escrow id.
    func recoverHash(chain: MezoChain) async throws -> String? {
        if let txHash { return txHash }
        let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
        let head = try await client.eth_blockNumber()
        var from = startBlock
        let topics: [String?] = [MarenEncoding.linkCreatedTopic, nil,
            "0x" + String(repeating: "0", count: 24) + owner.dropFirst(2).lowercased(),
            "0x" + String(repeating: "0", count: 24) + linkKey.dropFirst(2).lowercased()]
        // One hundred RPC windows cover 1,000,000 blocks. A partial scan never means failure.
        for _ in 0..<100 {
            guard from <= head else { return nil }
            let to = min(head, from + MEZO_MAX_LOG_RANGE - 1)
            let logs = try await client.eth_getLogs(addresses: [EthereumAddress(MarenAddresses.of(chain.network).marenPay)],
                topics: topics, fromBlock: .Number(from), toBlock: .Number(to))
            if let hash = matchingHash(in: logs, contract: MarenAddresses.of(chain.network).marenPay) { return hash }
            from = to + 1
        }
        return nil
    }

    func matchingHash(in logs: [EthereumLog], contract: String) -> String? {
        let ownerTopic = "0x" + String(repeating: "0", count: 24) + owner.dropFirst(2).lowercased()
        let keyTopic = "0x" + String(repeating: "0", count: 24) + linkKey.dropFirst(2).lowercased()
        return logs.first { log in
            log.removed != true && log.address.asString().lowercased() == contract.lowercased()
                && log.topics.count == 4 && log.topics[0].lowercased() == MarenEncoding.linkCreatedTopic
                && log.topics[2].lowercased() == ownerTopic && log.topics[3].lowercased() == keyTopic
        }?.transactionHash
    }
}

extension Keystore {
    private func claimQuery(owner: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "finance.maren.swift.pendingClaim.v1",
         kSecAttrAccount as String: owner.lowercased()]
    }

    func loadPendingClaim(owner: String) throws -> PendingClaimLink? {
        var query = claimQuery(owner: owner)
        query[kSecReturnData as String] = true
        query[kSecUseOperationPrompt as String] = "Recover your saved Maren claim link"
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let record = try? JSONDecoder().decode(PendingClaimLink.self, from: data),
              record.validated(owner: owner) else {
            throw KeystoreError.keychainRefused("The pending claim could not be unlocked. Nothing new was created.")
        }
        return record
    }

    func savePendingClaim(_ record: PendingClaimLink, replacing: Bool = false) throws {
        guard record.validated(owner: record.owner) else { throw KeystoreError.invalidPrivateKey }
        let data = try JSONEncoder().encode(record)
        let query = claimQuery(owner: record.owner)
        if replacing {
            let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            guard status == errSecSuccess else { throw KeystoreError.keychainRefused("Claim recovery details could not be updated.") }
            return
        }
        let cap = capability()
        guard cap.available, cap.enrolled,
              let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                  .biometryCurrentSet, nil) else {
            throw KeystoreError.keychainRefused("Claim creation needs biometric Keychain storage so the link can survive an interrupted app. Enrol Face ID or Touch ID first.")
        }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessControl as String] = access
        // Do not overwrite an unsaved link. The owner must recover/save it first.
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
            throw KeystoreError.keychainRefused("An unsaved claim may already exist, or secure storage is unavailable. Reopen Claimable link to recover it before creating another.")
        }
    }

    func clearPendingClaim(owner: String) throws {
        let status = SecItemDelete(claimQuery(owner: owner) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeystoreError.keychainRefused("The saved recovery copy could not be removed.")
        }
    }
}
