import Foundation

// MARK: - Payment & claim link parsing
//
// The Swift port of `apps/ios/src/lib/payment.ts` + `claimHandoff.ts`. A scanned or pasted
// link is untrusted input handed over by a stranger, so this is a strict, allowlisted parse
// with no clever fallbacks — a malformed link fails closed rather than reaching for the chain.
//
// Accepted, and nothing else:
//   https://maren.finance/pay?to=@handle|0xaddress[&amount=…]
//   https://maren.finance/claim?id=N#<0x…64-hex bearer secret>
//   a bare 0x-prefixed 20-byte address
//
// THE CLAIM SECRET LIVES IN THE URL FRAGMENT, DELIBERATELY. `#secret` is never sent to a
// server, so the one-time bearer key that authorises a claim does not leak to maren.finance's
// logs or any proxy. It is read ONLY from the fragment, never a query parameter, and never
// logged anywhere in this app.

enum PaymentLinks {
    static let host = "maren.finance"

    private static let addressPattern = "^0x[0-9a-fA-F]{40}$"
    /// MarenRegistry handles: 3–32 chars of [a-z0-9_].
    private static let handlePattern = "^@[a-z0-9_]{3,32}$"
    /// A one-time secp256k1 private key: 0x + exactly 32 bytes of hex.
    private static let secretPattern = "^0x[0-9a-fA-F]{64}$"
    private static let amountPattern = "^\\d+(\\.\\d+)?$"

    struct PaymentPayload: Equatable {
        let to: String
        var amount: String?
    }

    struct ClaimLink: Equatable {
        let linkId: UInt64
        /// The bearer signing key. A secret — hold it only as long as the claim needs it.
        let secret: String
    }

    /// What a scanned code resolved to, so the scanner can route to the right flow.
    enum Scanned: Equatable {
        case payment(PaymentPayload)
        case claim(ClaimLink)
    }

    // MARK: matching helpers

    static func isAddress(_ s: String) -> Bool { matches(s, addressPattern) }
    static func isHandle(_ s: String) -> Bool { matches(s, handlePattern) }
    static func isRecipient(_ s: String) -> Bool { isAddress(s) || isHandle(s) }
    static func isAmount(_ s: String) -> Bool { matches(s, amountPattern) }

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    // MARK: parse

    static func parsePayment(_ raw: String) -> PaymentPayload? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if isAddress(value) { return PaymentPayload(to: value, amount: nil) }

        guard let comps = URLComponents(string: value),
              comps.scheme?.lowercased() == "https",
              comps.host?.lowercased() == host,
              comps.path == "/pay" else { return nil }

        let items = comps.queryItems ?? []
        guard let to = items.first(where: { $0.name == "to" })?.value, isRecipient(to) else {
            return nil
        }
        // A malformed amount drops the amount, never the whole payload: the recipient is still
        // trustworthy and the figure can be typed. It is never passed through unvalidated.
        let amount = items.first(where: { $0.name == "amount" })?.value
        if let amount, isAmount(amount) { return PaymentPayload(to: to, amount: amount) }
        return PaymentPayload(to: to, amount: nil)
    }

    static func parseClaim(_ raw: String) -> ClaimLink? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let comps = URLComponents(string: value),
              comps.scheme?.lowercased() == "https",
              comps.host?.lowercased() == host,
              comps.path == "/claim" else { return nil }

        guard let id = comps.queryItems?.first(where: { $0.name == "id" })?.value,
              matches(id, "^\\d+$"), let linkId = UInt64(id), linkId > 0 else { return nil }

        // Only the fragment. Anything not exactly a 32-byte hex key is rejected, so a truncated
        // or tampered fragment fails closed.
        let secret = comps.fragment ?? ""
        guard matches(secret, secretPattern) else { return nil }
        return ClaimLink(linkId: linkId, secret: secret.lowercased())
    }

    /// Route a scanned string to the flow that can honour it, or nil if it is neither.
    static func parse(_ raw: String) -> Scanned? {
        if let claim = parseClaim(raw) { return .claim(claim) }
        if let payment = parsePayment(raw) { return .payment(payment) }
        return nil
    }

    // MARK: build

    static func buildPayment(to: String, amount: String? = nil) -> String {
        var comps = URLComponents()
        comps.scheme = "https"
        comps.host = host
        comps.path = "/pay"
        var items = [URLQueryItem(name: "to", value: to)]
        if let amount, isAmount(amount) { items.append(URLQueryItem(name: "amount", value: amount)) }
        comps.queryItems = items
        return comps.string ?? "https://\(host)/pay"
    }

    /// Build the shareable link for a claimable payment. The secret goes in the fragment so it
    /// never reaches a server; it is a bearer token, shown once and never logged.
    static func buildClaim(linkId: UInt64, secret: String) -> String {
        "https://\(host)/claim?id=\(linkId)#\(secret)"
    }

    // NOTE: there is deliberately no secret-minting helper here.
    //
    // A `freshSecret()` used to live at this spot: it called `SecRandomCopyBytes` and DISCARDED
    // the status, so a CSPRNG failure would have returned 32 zero bytes as a bearer key that
    // anyone could guess. It had no callers, and it has been deleted rather than left where a
    // future flow could reach for it. The one place the app really does mint key material,
    // `HandleCommitmentStore.newSecret()`, checks the status and returns nil on failure.
}

// MARK: - Claim handoff
//
// A one-slot, in-memory handoff for a scanned claim link. The scanner and the claim screen are
// two routes, and the bearer secret must not travel between them as a navigation parameter.
// Memory only — never disk, never a log. Losing it to a reload just means re-scanning.

@MainActor
final class ClaimHandoff {
    static let shared = ClaimHandoff()
    private var pending: PaymentLinks.ClaimLink?

    func stash(_ link: PaymentLinks.ClaimLink) { pending = link }

    /// Read and clear the pending link.
    func take() -> PaymentLinks.ClaimLink? {
        let value = pending
        pending = nil
        return value
    }
}
