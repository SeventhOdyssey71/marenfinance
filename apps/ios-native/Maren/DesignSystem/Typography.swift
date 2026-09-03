import SwiftUI

// MARK: - Type voice
//
// A condensed-black display voice for headers and the wordmark — the Anton stand-in,
// built from SF with `.fontWeight(.black)` + `.fontWidth(.compressed)` (iOS 16+). SF
// body for everything else. Every changing figure uses monospaced digits so numerals
// do not jitter as values update (the SwiftUI equivalent of `tabular-nums`).

extension Font {
    /// The loud condensed-black display face. Used by the MAREN wordmark and hero headers.
    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black).width(.compressed)
    }

    /// A section header — condensed-black, smaller.
    static func sectionDisplay(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .heavy).width(.compressed)
    }

    /// Monospaced-digit figures for anything that changes (balances, ratios, counts).
    static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight).monospacedDigit()
    }
}

extension View {
    /// A small uppercase label, letter-spaced — the `t-label` from the web theme.
    func labelStyle() -> some View {
        self
            .font(.system(size: 12, weight: .semibold))
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Theme.Palette.tertiary)
    }
}
