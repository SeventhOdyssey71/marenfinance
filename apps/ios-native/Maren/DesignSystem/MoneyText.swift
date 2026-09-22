import SwiftUI

// MARK: - Money formatting
//
// BTC trims trailing zeros to at most 6 dp. Stablecoin money figures use a dollar
// prefix and exactly 2 dp with grouped thousands. Decimal keeps values precise;
// unit:false stays numeric for amount inputs, payment links and MAX controls.

enum MoneyFormat {
    static func btc(_ value: Decimal, unit: Bool = true) -> String {
        let s = trimmed(value, maxFractionDigits: 6)
        return unit ? "\(s) BTC" : s
    }

    static func musd(_ value: Decimal, unit: Bool = true) -> String {
        let s = fixed(value, fractionDigits: 2)
        return unit ? (s.hasPrefix("-") ? "-$" + String(s.dropFirst()) : "$" + s) : s
    }

    static func usd(_ value: Decimal) -> String {
        musd(value)
    }

    /// A collateral ratio, rounded DOWN to one decimal — a position at 179.9% must never
    /// read as 180%, the borrow threshold. Matches the web `formatCollateralRatio`.
    static func ratio(_ percent: Decimal) -> String {
        var scaled = percent * 10
        var floored = Decimal()
        NSDecimalRound(&floored, &scaled, 0, .down)
        let tenths = (floored as NSDecimalNumber).intValue
        return "\(tenths / 10).\(abs(tenths % 10))%"
    }

    static func percent(_ value: Decimal, fractionDigits: Int = 1) -> String {
        fixed(value, fractionDigits: fractionDigits) + "%"
    }

    // MARK: private

    private static func fixed(_ value: Decimal, fractionDigits: Int) -> String {
        var source = value
        var rounded = Decimal()
        NSDecimalRound(&rounded, &source, fractionDigits, value < 0 ? .up : .down)
        let fmt = NumberFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.numberStyle = .decimal
        fmt.groupingSeparator = ","
        fmt.usesGroupingSeparator = true
        fmt.minimumFractionDigits = fractionDigits
        fmt.maximumFractionDigits = fractionDigits
        fmt.roundingMode = .down
        return fmt.string(from: rounded as NSDecimalNumber) ?? "0"
    }

    private static func trimmed(_ value: Decimal, maxFractionDigits: Int) -> String {
        let fmt = NumberFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.numberStyle = .decimal
        fmt.groupingSeparator = ","
        fmt.usesGroupingSeparator = true
        fmt.minimumFractionDigits = 0
        fmt.maximumFractionDigits = maxFractionDigits
        fmt.roundingMode = .down
        return fmt.string(from: value as NSDecimalNumber) ?? "0"
    }
}

// MARK: - MoneyText
//
// A figure with the fractional part (and any trailing unit after it) greyed to the
// tertiary tone, so the eye lands on the whole number that matters — the soft-UGLYCASH
// balance treatment. Monospaced digits keep it from jittering as values update.

struct MoneyText: View {
    let text: String
    var size: CGFloat = 34
    var weight: Font.Weight = .bold
    /// Letter spacing. Large balances read tighter (negative) so the digits group cleanly.
    var tracking: CGFloat = 0
    /// The whole-number colour. Fraction + unit always fall to the tertiary tone.
    var tint: Color = Theme.Palette.ink

    var body: some View {
        let (head, tail) = Self.split(text)
        return (
            Text(head).foregroundColor(tint)
            + Text(tail).foregroundColor(Theme.Palette.tertiary)
        )
        .font(.figure(size, weight: weight))
        .tracking(tracking)
    }

    /// Split at the first decimal point. Everything from the point on (decimals and a
    /// trailing unit) is greyed. Values with no decimal point grey nothing.
    static func split(_ text: String) -> (String, String) {
        guard let dot = text.firstIndex(of: ".") else { return (text, "") }
        return (String(text[text.startIndex ..< dot]), String(text[dot...]))
    }
}
