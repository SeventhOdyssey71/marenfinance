import Foundation
import BigInt

// MARK: - Amount parsing
//
// The UI collects amounts as text; the chain speaks wei (BigUInt). This is the only place a
// typed figure becomes wei, and it goes through the base-10 string — never a binary Double —
// so nothing is lost between the keypad and the calldata. Both BTC (the gas token) and MUSD
// are 18-decimal on Mezo, so one converter serves both.

enum Amount {
    static let decimals = 18

    /// Parse a user-typed amount into a positive `Decimal`, or nil if it is empty, malformed,
    /// or not strictly greater than zero. Grouping separators are tolerated.
    static func parse(_ raw: String) -> Decimal? {
        let cleaned = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
        guard !cleaned.isEmpty, PaymentLinks.isAmount(cleaned) else { return nil }
        guard let value = Decimal(string: cleaned), value > 0 else { return nil }
        return value
    }

    /// Whole tokens as a `Decimal` into wei, exactly, via the decimal string. Returns nil on a
    /// value that is not finite or is negative.
    static func toWei(_ value: Decimal) -> BigUInt? {
        guard value >= 0 else { return nil }
        // Scale by 10^18 and truncate any sub-wei remainder rather than rounding up into funds
        // the user did not enter.
        var scaled = value * Decimal(sign: .plus, exponent: decimals, significand: 1)
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .down)
        return BigUInt(NSDecimalNumber(decimal: rounded).stringValue)
    }
}
