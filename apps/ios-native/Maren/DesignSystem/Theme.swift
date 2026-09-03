import SwiftUI

// MARK: - Soft-UGLYCASH design system
//
// A single source of truth for colour, type, spacing, radii and shadow, ported
// verbatim from the web /app's light "soft-UGLYCASH" world (apps/web globals.css,
// `[data-app-theme='light']`). The app runs light-only: a paper-cream canvas, soft
// white cards separated by tone and a whisper of shadow (never an outline), ink type
// with greyed tertiary/decimals, and a Riot-Pink brand accent.
//
// Text-safe values matter: neon pink (#FA00FF) fails contrast as text on white, so a
// darker #C400C9 is used wherever pink becomes small text. BTC orange, success,
// warning and danger are the darkened, AA-on-white variants the web theme derived.

enum Theme {
    enum Palette {
        // Base surfaces
        static let canvas = Color(hex: 0xF2F2F2)      // paper-cream page
        static let card = Color(hex: 0xFFFFFF)        // soft-white card
        static let inset = Color(hex: 0xECECEF)        // quiet grey well — tone, not a border

        // Ink / text
        static let ink = Color(hex: 0x101013)         // primary text
        static let muted = Color(hex: 0x6E6E6E)        // secondary (AA on paper + card)
        static let tertiary = Color(hex: 0x9A9AA2)     // tertiary / greyed decimals

        // Brand — Riot Pink
        static let accent = Color(hex: 0xFA00FF)       // vivid pink: fills, dots, the CTA glow
        static let accentText = Color(hex: 0xC400C9)   // text-safe deep magenta for small pink text
        static let accentWash = Color(hex: 0xFFE3FF)   // faint pink wash for chips/haloes

        // Accent family (used sparingly, for meaning or category)
        static let lime = Color(hex: 0xADFF02)
        static let cyan = Color(hex: 0x02BBFF)
        static let khaki = Color(hex: 0xE7E3BF)

        // Semantic — only where they carry meaning. Darkened to hold AA on white.
        static let success = Color(hex: 0x0F9D6A)
        static let warning = Color(hex: 0xB45309)
        static let danger = Color(hex: 0xDC2626)

        // Asset — BTC orange as text fails on the light page; this is the text-safe value.
        static let btc = Color(hex: 0x9A5300)
        static let musd = Color(hex: 0x0D9E70)
    }

    // Corner radii. Cards ~22, inset rows a touch tighter, pills are full.
    enum Radius {
        static let card: CGFloat = 22
        static let inset: CGFloat = 16
        static let control: CGFloat = 14
        static let pill: CGFloat = 999
    }

    // Spacing scale. Group spacing is >= 2x intra-group spacing.
    enum Space {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 16
        static let lg: CGFloat = 22
        static let xl: CGFloat = 32
    }
}

// MARK: - Soft shadow (a whisper of drop, never an outline)

extension View {
    /// The soft-white card shadow: a tight contact shadow plus a soft ambient drop.
    func softCardShadow() -> some View {
        self
            .shadow(color: Color(hex: 0x101013).opacity(0.04), radius: 1, x: 0, y: 1)
            .shadow(color: Color(hex: 0x101013).opacity(0.10), radius: 20, x: 0, y: 14)
    }

    /// The Riot-Pink glow that lives entirely behind the primary pill, so the pill
    /// face stays high-contrast and the bloom never intercepts touches.
    func pinkGlow() -> some View {
        self
            .shadow(color: Theme.Palette.accent.opacity(0.42), radius: 16, x: 0, y: 0)
            .shadow(color: Theme.Palette.accent.opacity(0.40), radius: 20, x: 0, y: 6)
    }
}

// MARK: - Color hex helper

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}
