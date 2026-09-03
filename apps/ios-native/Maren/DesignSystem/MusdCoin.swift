import SwiftUI

// MARK: - MusdCoin
//
// The MUSD token mark — the real Mezo USD logo (asset `MusdCoin`), replacing the
// earlier violet-$ placeholder. The artwork is already a circular mark on a clear
// background, so it needs no added ring; it just scales to a fixed footprint and
// carries its own label for VoiceOver.

struct MusdCoin: View {
    var size: CGFloat = 38

    var body: some View {
        Image("MusdCoin")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityLabel("MUSD")
    }
}

/// A token coin for ledger rows — the real Bitcoin or MUSD mark, clipped to a clean circle.
/// Both source images are already circular, so this just sizes and masks them consistently.
struct TokenCoin: View {
    let isBtc: Bool
    var size: CGFloat = 34

    var body: some View {
        Image(isBtc ? "BitcoinCoin" : "MusdCoin")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}
