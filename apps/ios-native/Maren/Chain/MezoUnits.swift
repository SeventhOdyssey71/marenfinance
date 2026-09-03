import Foundation
import BigInt

// MARK: - Units
//
// BTC (the gas token) and MUSD are both 18-decimal on Mezo. The chain speaks in wei
// (BigUInt); the UI models speak in `Decimal` of whole tokens. This is the only place the
// two are converted, and the conversion is exact: it goes through the decimal string, never
// through a binary `Double`, so no precision is lost on the way to the screen.

enum Wei {
    static let decimals = 18

    /// wei -> whole tokens as a `Decimal`, via the exact base-10 string. A BigUInt that
    /// overflows `Decimal` (astronomically larger than any real balance) returns nil rather
    /// than a rounded lie.
    static func toDecimal(_ wei: BigUInt, decimals: Int = decimals) -> Decimal? {
        let s = String(wei)
        let padded = String(repeating: "0", count: max(0, decimals - s.count + 1)) + s
        let cut = padded.index(padded.endIndex, offsetBy: -decimals)
        let intPart = String(padded[..<cut])
        let fracPart = String(padded[cut...])
        let literal = fracPart.isEmpty ? intPart : "\(intPart).\(fracPart)"
        return Decimal(string: literal)
    }

    /// Signed variant for int256 reads (a price answer is `int256`).
    static func toDecimal(_ wei: BigInt, decimals: Int = decimals) -> Decimal? {
        let mag = toDecimal(wei.magnitude, decimals: decimals)
        guard let mag else { return nil }
        return wei.sign == .minus ? -mag : mag
    }
}
