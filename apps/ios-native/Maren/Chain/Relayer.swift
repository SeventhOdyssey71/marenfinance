import Foundation

// MARK: - Relayer client
// Signed requests go to the configured relayer; only a successful chain receipt confirms
// settlement. Lost responses and ambiguous broadcasts stay uncertain, with no retry or
// self-pay recommendation. A known local hash is retained for receipt reconciliation.

enum RelayerConfig {
    /// Read from `MAREN_RELAYER_URL` in the app's Info.plist (injected at build time). Absent
    /// values disable sponsorship. A signed
    /// ForwardRequest exposes the user's address, target and amount, so a plain-`http://`
    /// remote host is refused; only https, or http to localhost, is accepted.
    static var url: URL? {
        // A process-environment MAREN_RELAYER_URL wins, so a dev/sim run can point at a local
        // relayer without a rebuild; the Info.plist value (a real build's hosted relayer) is the
        // default under it. Both go through the same https-or-localhost guard.
        #if DEBUG
        if let env = ProcessInfo.processInfo.environment["MAREN_RELAYER_URL"], let u = normalise(env) {
            return u
        }
        #endif
        if let raw = Bundle.main.object(forInfoDictionaryKey: "MAREN_RELAYER_URL") as? String,
           let u = normalise(raw) {
            return u
        }
        return nil
    }

    static func normalise(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s = String(s.dropLast()) }
        guard !s.isEmpty else { return nil }
        guard let parts = URLComponents(string: s), let host = parts.host?.lowercased(),
              !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil else { return nil }
        let scheme = parts.scheme?.lowercased()
        let isLocal = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)
        guard scheme == "https" || (scheme == "http" && isLocal) else { return nil }
        return parts.url
    }

    static var isConfigured: Bool { url != nil }
}

/// How long a request stays signable, comfortably inside the relayer's default max deadline.
let RELAY_DEADLINE_SECONDS: UInt64 = 600
/// Ceiling on the `gas` we will ask a user to sign for. Mirrors the relayer's default.
let MAX_RELAY_GAS: UInt64 = 1_500_000
let RELAY_TIMEOUT_SECONDS: TimeInterval = 30

/// A stated, human-readable reason nothing was submitted — never a raw stack string.
struct RelayReason: Error, Sendable, Equatable {
    let name: String
    let title: String
    let detail: String
    var submissionMayExist: Bool = false
    var knownHash: String? = nil
}

struct RelayRefused: Error, Sendable, Equatable {
    let reason: RelayReason
}

/// A relayer's 202 body. The only success shape.
struct RelayAccepted: Sendable, Equatable {
    let hash: String
    let payer: String
}

struct Relayer {
    let baseURL: URL
    var session: URLSession = .shared

    /// POST the signed request. A transport error cannot prove whether the relayer saw it.
    func post(body: [String: String]) async throws -> RelayAccepted {
        var request = URLRequest(url: baseURL.appendingPathComponent("relay"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.timeoutInterval = RELAY_TIMEOUT_SECONDS
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let expectedPayer = body["from"]
        let status: Int
        let data: Data
        do {
            let (d, response) = try await session.data(for: request)
            data = d
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            // A lost response can follow a successful broadcast. Never invite a second payment.
            throw RelayRefused(reason: Self.uncertainResponse)
        }

        let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        switch decode(status: status, body: parsed ?? nil, expectedPayer: expectedPayer) {
        case .success(let accepted):
            return accepted
        case .failure(let reason):
            throw RelayRefused(reason: reason)
        }
    }

    /// A 202 that names OUR signer and carries a hash is the only success; anything else is a
    /// `RelayReason`. `expectedPayer` is checked because `Receipt.confirm` reads a receipt for
    /// whatever hash it is handed — a 202 carrying somebody else's confirmed hash would
    /// otherwise render as this action succeeding.
    func decode(status: Int, body: [String: Any]?, expectedPayer: String?) -> Result<RelayAccepted, RelayReason> {
        if status == 202 {
            if let body,
               let hash = body["hash"] as? String,
               hash.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil,
               (body["state"] as? String) == "submitted" {
                let payer = body["payer"] as? String
                if let expectedPayer, payer?.lowercased() != expectedPayer.lowercased() {
                    return .failure(unrecognised)
                }
                return .success(RelayAccepted(hash: hash, payer: payer ?? ""))
            }
            return .failure(unrecognised)
        }
        var reason = failureReason(status: status, code: (body?["error"] as? String),
                                   detail: (body?["detail"] as? String))
        if (body?["error"] as? String) == "SUBMISSION_UNCERTAIN",
           let meta = body?["meta"] as? [String: Any], let hash = meta["hash"] as? String,
           hash.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil {
            reason.knownHash = hash
        }
        return .failure(reason)
    }

    private var unrecognised: RelayReason {
        RelayReason(
            name: "RELAYER_ANSWER_UNRECOGNISED",
            title: "Maren's relayer answered with something unrecognisable",
            detail: "It accepted the request but did not return a broadcast this app can tie back to what you signed. Check Activity and your balances before retrying; this action may still settle.",
            submissionMayExist: true
        )
    }

    static let uncertainResponse = RelayReason(
        name: "SUBMISSION_UNKNOWN", title: "Submission status unknown",
        detail: "The connection ended before Maren could verify the response. The signed action may already be on its way. Check Activity and your balances before trying again or sending it yourself.",
        submissionMayExist: true
    )

    private static let nothingSent = "Nothing was submitted and no gas was spent."

    /// Turn a relayer refusal into the app's own copy. Every branch says the same two things:
    /// nothing moved, and what to do instead. Mirrors `relayFailureReason` in relay.ts.
    /// Turn MUSD's own revert string into something a person can act on.
    ///
    /// The relayer already sends the reason — its `detail` reads "the forwarded call reverts
    /// in simulation: <the protocol's own require message>" — and this app was throwing it
    /// away, so every on-chain refusal looked identical. A tester hit "exceeds
    /// maxBorrowingCapacity" and was told only that something reverted, with nothing to do
    /// next and no way to know a smaller amount would have worked.
    ///
    /// Matching is on distinctive substrings, never whole sentences: several of these carry
    /// the protocol's own typos ("doesnt"), and the same condition is phrased differently by
    /// different contracts.
    private static func explainRevert(_ detail: String?) -> String? {
        guard let d = detail?.lowercased() else { return nil }
        if d.contains("exceeds maxborrowingcapacity") {
            return "This trove is at the borrowing ceiling Mezo fixed when it opened. That ceiling does not rise when collateral is added — only a refinance moves it — so a smaller amount may go through even though your collateral ratio looks healthy."
        }
        if d.contains("net debt must be greater than minimum") {
            return "MUSD requires every loan to stay above its $1,800 minimum. Repaying this much would leave the position below it, so either repay less or repay all of it."
        }
        if d.contains("amount repaid must not be larger") {
            return "That is more than the position currently owes. Interest accrues every block, so the figure moves — reopen the screen for the current amount."
        }
        if d.contains("result in icr") || d.contains("icr < mcr") {
            return "This would put the collateral ratio below the level MUSD allows. Borrow less, or add collateral first."
        }
        if d.contains("result in tcr") || d.contains("tcr < ccr") {
            return "MUSD is in Recovery Mode across the whole system, so it is refusing new debt from everyone. This is not about your position and it clears when the system recovers."
        }
        if d.contains("cannot withdraw while there are troves") {
            return "MUSD's Stability Pool blocks every withdrawal while any loan on Mezo is under-collateralised. Nobody in Earn caused it and it usually clears within minutes."
        }
        if d.contains("oracle is stale") || d.contains("pricefeed") {
            return "Mezo's price feed is older than the 60 seconds the protocol accepts, so it refused the call. Try again shortly."
        }
        if d.contains("doesnt have enough musd") || d.contains("insufficient") {
            return "There is not enough MUSD in the account to cover this."
        }
        return nil
    }

    func failureReason(status: Int, code: String?, detail: String? = nil) -> RelayReason {
        let code = code ?? "UPSTREAM_ERROR"
        let ns = Relayer.nothingSent
        switch code {
        case "SPONSORSHIP_FEE_REQUIRED", "SPONSORSHIP_UNAVAILABLE", "FEE_BELOW_REQUIRED",
             "GLOBAL_DAILY_BUDGET_EXHAUSTED", "RELAYER_UNDERFUNDED":
            return RelayReason(name: code, title: "Maren cannot cover the gas for this right now",
                detail: "The sponsorship budget is spent. \(ns) You can send this yourself and pay the Bitcoin gas.")
        case "ADDRESS_RATE_LIMIT", "IP_RATE_LIMIT":
            return RelayReason(name: code, title: "Too many sponsored actions in one day",
                detail: "This address reached its daily limit for actions Maren pays for. \(ns) It resets at 00:00 UTC, or you can send this yourself now.")
        case "RELAYER_NOT_ACCEPTING", "RELAYER_SHUTTING_DOWN", "STORE_UNAVAILABLE":
            return RelayReason(name: code, title: "Maren's relayer is not taking work",
                detail: "The service that would have paid your gas is not accepting requests. \(ns) Try again, or send it yourself.")
        case "DUPLICATE_REQUEST_IN_FLIGHT":
            return RelayReason(name: code, title: "This action is already in progress",
                detail: "An identical signed action is still in progress and may settle. Check Activity and your balances before trying again or sending it yourself.", submissionMayExist: true)
        case "NONCE_MISMATCH":
            return RelayReason(name: code, title: "This action was signed against a stale position in the queue",
                detail: "Another action from this account is still in flight. \(ns) Wait for it to confirm and try again.")
        case "REQUEST_EXPIRED", "DEADLINE_TOO_FAR":
            return RelayReason(name: code, title: "The signature timed out before it was submitted",
                detail: "A relayed action is only valid for a few minutes after you sign it. \(ns) Try again.")
        case "INVALID_SIGNATURE", "SIGNER_MISMATCH":
            return RelayReason(name: code, title: "The relayer would not accept that signature",
                detail: "What arrived did not match what your wallet signed, so it was refused. \(ns)")
        case "TARGET_NOT_ALLOWED", "SELECTOR_NOT_ALLOWED", "CALLDATA_UNDECODABLE", "VALUE_NOT_PERMITTED",
             "GAS_LIMIT_TOO_HIGH", "CALLDATA_TOO_LARGE", "MALFORMED_REQUEST", "UNSUPPORTED_CHAIN":
            return RelayReason(name: code, title: "Maren does not sponsor this action",
                detail: "The relayer only forwards a fixed set of calls to Maren's own contracts, and this is not one of them. \(ns) You can send it yourself.")
        case "SIMULATION_REVERTED":
            // Lead with WHY when the protocol told us. The generic sentence is the fallback
            // for a revert we have no plain-language reading of, not the default.
            if let why = Self.explainRevert(detail) {
                return RelayReason(name: code, title: "Mezo refused this", detail: "\(why) \(ns)")
            }
            return RelayReason(name: code, title: "This would have failed on-chain",
                detail: "The relayer ran the call against Mezo before paying for it and it reverted, so it was never broadcast. \(ns)")
        case "SUBMISSION_FAILED", "SUBMISSION_UNCERTAIN", "SUBMISSION_UNKNOWN":
            return Self.uncertainResponse
        default:
            return Self.uncertainResponse
        }
    }
}
