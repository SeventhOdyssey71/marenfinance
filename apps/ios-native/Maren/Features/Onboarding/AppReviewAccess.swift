import CryptoKit
import Foundation
import web3

// MARK: - App Review access
//
// Apple needs a stable account with which to exercise every TestFlight flow. Maren normally
// has no server account: a wallet is a secp256k1 key generated or restored on the device. This
// adapter gives App Review familiar email + access-code fields without adding custody or an
// authentication service. The high-entropy code is supplied only in App Store Connect. It is
// combined with the email locally, hashed into a testnet-only private key, and accepted only
// when that key derives the configured public review address.
//
// The access code and private key are deliberately absent from the app bundle and repository.
// Knowing the public address, derivation rule and email does not make a high-entropy code
// recoverable. The result enters the same biometric Keychain path as every restored wallet.

enum AppReviewAccess {
    struct Wallet: Equatable {
        let privateKey: Data
        let address: String
    }

    enum Failure: Error, Equatable {
        case notConfigured
        case incomplete
        case refused

        var message: String {
            switch self {
            case .notConfigured:
                return "App Review access is not configured in this build."
            case .incomplete:
                return "Enter the review email and access code from Beta App Review Information."
            case .refused:
                return "Those review credentials do not match this build. Check both fields and try again."
            }
        }
    }

    private static let domain = "maren-app-review-v1"

    static var configuredEmail: String {
        (Bundle.main.object(forInfoDictionaryKey: "MAREN_REVIEW_EMAIL") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    static var configuredAddress: String {
        (Bundle.main.object(forInfoDictionaryKey: "MAREN_REVIEW_ADDRESS") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func unlock(email: String, accessCode: String,
                       expectedEmail: String = configuredEmail,
                       expectedAddress: String = configuredAddress) -> Result<Wallet, Failure> {
        let expectedEmail = expectedEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let expectedAddress = expectedAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !expectedEmail.isEmpty, PaymentLinks.isAddress(expectedAddress) else {
            return .failure(.notConfigured)
        }

        let email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let accessCode = accessCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty, !accessCode.isEmpty else { return .failure(.incomplete) }
        guard email == expectedEmail, accessCode.utf8.count >= 24 else { return .failure(.refused) }

        var material = Data(domain.utf8)
        material.append(0)
        material.append(contentsOf: email.utf8)
        material.append(0)
        material.append(contentsOf: accessCode.utf8)
        let privateKey = Data(SHA256.hash(data: material))

        guard Keystore.normalise(privateKey.web3.hexString) != nil,
              let address = try? Keystore.address(of: privateKey),
              address.lowercased() == expectedAddress.lowercased() else {
            return .failure(.refused)
        }
        return .success(Wallet(privateKey: privateKey, address: address))
    }
}
