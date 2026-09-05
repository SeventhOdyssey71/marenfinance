import Foundation

// MARK: - Handle registration: the secret, and where it lives
//
// The Swift twin of `apps/web/src/lib/chain/handle.ts`, and it exists for the same reason.
//
// MarenRegistry is commit-reveal. `register("sele")` alone in a public mempool is a free
// option for anyone watching — copy the calldata, pay more gas, take the name — so step one
// publishes `keccak256(abi.encode(handle, owner, secret))`, which is opaque, and step two
// reveals the secret at least 60 seconds later. The commitment binds the handle to the OWNER,
// so a copied commitment is worthless to whoever copied it.
//
// THE SECRET IS THE WHOLE PROBLEM. After step one the chain holds only its hash. Lose it
// between the two steps and the handle is unrecoverable until the commitment expires seven
// days later — from the user's point of view, they typed a name, paid for a transaction, and
// got nothing. A backgrounded app, a crash, a phone call and a force-quit all happen inside a
// 60-second wait, and "quit and reopen" is exactly what people do when a countdown looks
// stuck. So the secret is written to disk BEFORE the commit is even offered for signature,
// keyed by network and handle — holding it in `@State` would lose it on the first relaunch.
//
// WHY UserDefaults AND NOT THE KEYCHAIN. This is not a signing key and it can move no money;
// it only reserves a name, and only for the address that made the commitment. The web stores
// the same value in `localStorage`, and matching that keeps the two apps' threat models
// identical and inspectable. It is deleted the moment the handle is registered, which is the
// first moment it is genuinely worthless.

/// A commitment this device is still holding the secret for.
struct PendingCommitment: Sendable, Equatable, Codable {
    let handle: String
    /// 32 random bytes as 0x hex. After the commit lands, the only copy in existence.
    let secret: String
    let owner: String
    let network: MezoNetwork
    /// Set once the commit transaction has a CONFIRMED receipt. Absent means the commit has
    /// not been established on-chain, and the UI says "not submitted yet" rather than
    /// counting down a wait that never started.
    var txHash: String?
    /// When this device recorded the commit. The authoritative clock is the chain's
    /// `commitments[commitment]`, which is read live; this is only the fallback for showing a
    /// countdown while that read is in flight.
    var committedAt: Date?
}

/// The on-disk store. A namespaced key per (network, handle), exactly like the web's.
enum HandleCommitmentStore {
    private static let prefix = "maren.handle-commitment"

    private static func key(_ network: MezoNetwork, _ handle: String) -> String {
        "\(prefix).\(network.rawValue).\(handle.lowercased())"
    }

    /// A 32-byte secret from the platform CSPRNG. `SecRandomCopyBytes`, never `arc4random` or
    /// a seeded generator: this value is the only thing standing between a user and someone
    /// else revealing their handle. Returns nil if the CSPRNG refuses rather than falling back
    /// to a weaker source — a predictable secret is worse than no registration.
    static func newSecret() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, 32, &bytes) == errSecSuccess else { return nil }
        return "0x" + bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func save(_ pending: PendingCommitment) {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        UserDefaults.standard.set(data, forKey: key(pending.network, pending.handle))
    }

    static func load(network: MezoNetwork, handle: String) -> PendingCommitment? {
        guard let data = UserDefaults.standard.data(forKey: key(network, handle)),
              let parsed = try? JSONDecoder().decode(PendingCommitment.self, from: data) else { return nil }
        // A stored blob with no secret is worse than none: it would let the UI show a
        // "ready to reveal" step that cannot possibly succeed.
        guard !parsed.secret.isEmpty, !parsed.handle.isEmpty else { return nil }
        return parsed
    }

    static func clear(network: MezoNetwork, handle: String) {
        UserDefaults.standard.removeObject(forKey: key(network, handle))
    }

    /// Every commitment this device is still holding a secret for, on this network. Used to
    /// re-offer the reveal step after a relaunch, which is the whole point of persisting it.
    static func all(network: MezoNetwork) -> [PendingCommitment] {
        let scope = "\(prefix).\(network.rawValue)."
        return UserDefaults.standard.dictionaryRepresentation().keys
            .filter { $0.hasPrefix(scope) }
            .compactMap { storedKey in
                guard let data = UserDefaults.standard.data(forKey: storedKey) else { return nil }
                return try? JSONDecoder().decode(PendingCommitment.self, from: data)
            }
            .filter { !$0.secret.isEmpty && !$0.handle.isEmpty }
    }

    /// Where a pending claim is in the two-step flow, decided from the chain's own
    /// `commitments[commitment]` timestamp wherever possible. Every case is a sentence the UI
    /// can show without dressing up an unknown as a known.
    enum Phase: Equatable {
        /// The secret exists on this device but no commit has confirmed on-chain.
        case notCommitted
        /// Committed, and the 60-second minimum age has not elapsed. `secondsRemaining` is
        /// derived from the chain's timestamp, never from a local stopwatch.
        case waiting(secondsRemaining: Int)
        /// Committed, aged past the minimum, still inside the 7-day window.
        case revealable
        /// Past `MAX_COMMITMENT_AGE`. The commitment is dead and the claim must restart.
        case expired
        /// The chain could not be read, so which of the above is true is unknown.
        case unknown(reason: String)
    }

    /// Classify a commitment from the on-chain `committedAt` (0 = not on-chain) and the
    /// current wall clock.
    static func phase(committedAt: UInt64, now: UInt64) -> Phase {
        if committedAt == 0 { return .notCommitted }
        let revealableAt = committedAt + HANDLE_MIN_COMMITMENT_AGE
        let expiresAt = committedAt + HANDLE_MAX_COMMITMENT_AGE
        if now > expiresAt { return .expired }
        if now < revealableAt { return .waiting(secondsRemaining: Int(revealableAt - now)) }
        return .revealable
    }
}
