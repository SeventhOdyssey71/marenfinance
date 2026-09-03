import SwiftUI

// MARK: - Type voice
//
// Clean and light, not heavy. Two roles:
//
//   • Display / headings and all numbers → SF Pro Rounded. Friendly, legible, and — at the
//     moderate weights used here — never shouty. Numbers carry monospaced digits so they
//     don't jitter as values update (the SwiftUI equivalent of `tabular-nums`).
//   • Body / leading text → the system text face at regular/medium weight. This is the
//     stand-in for Neue Montreal: drop `NeueMontreal-*.otf` into the bundle and point
//     `Font.body(_:)` at it to switch the body face over without touching call sites.
//
// The old condensed-black display voice (an Anton stand-in) is gone — it read as "too bold".

extension Font {
    /// Display / leading headings — SF Pro Rounded, moderate weight by default.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    /// A section heading — rounded, semibold, sentence case (never uppercased/tracked).
    static func sectionDisplay(_ size: CGFloat = 16) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }

    /// Numbers — SF Pro Rounded with monospaced digits. The balance, ratios, counts.
    static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }

    /// Body / leading text. SF text face today; swap to Neue Montreal here when bundled.
    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight)
    }
}

extension View {
    /// A small, quiet label — sentence case, medium, grey. No uppercasing, no tracking.
    func labelStyle() -> some View {
        self
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(Theme.Palette.muted)
    }
}
