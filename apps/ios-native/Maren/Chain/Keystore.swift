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
        guard s.count == 64, s.allSatisfy({ $0.isHexDigit }) else { return nil }
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
        guard privateKey.count == 32 else { throw KeystoreError.invalidPrivateKey }
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
