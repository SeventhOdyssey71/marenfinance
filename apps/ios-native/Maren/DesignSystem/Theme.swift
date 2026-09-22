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
        static let canvas = Color(hex: 0xFFFFFF)      // pure white page
        static let card = Color(hex: 0xFFFFFF)        // white card — separated by shadow, not tone
        static let inset = Color(hex: 0xF1F0F6)        // quiet well — a whisper of violet-grey, chosen not default

        // Ink / text
        static let ink = Color(hex: 0x101013)         // primary text
        static let muted = Color(hex: 0x6E6E6E)        // secondary (AA on white)
        static let tertiary = Color(hex: 0x9A9AA2)     // tertiary / greyed decimals

        // Brand — Maren violet, taken from the logo mark (a violet gradient swoosh).
        static let accent = Color(hex: 0x5B3DF5)       // primary violet: fills, dots, the CTA
        static let accentText = Color(hex: 0x4A2BE0)   // text-safe deep violet for small brand text on white
        static let accentWash = Color(hex: 0xEDEAFF)   // faint violet wash for chips/haloes

        // Home header wash: one restrained lavender, fading into the white canvas.
        static let balanceLavender = Color(hex: 0xEEEAFE)

        // Accent family (used sparingly, for meaning or category)
        static let lime = Color(hex: 0xADFF02)
        static let cyan = Color(hex: 0x02BBFF)
        static let khaki = Color(hex: 0xE7E3BF)

        // Semantic — only where they carry meaning. Darkened to hold AA on white.
        static let success = Color(hex: 0x0F9D6A)
        static let warning = Color(hex: 0xB45309)
        static let danger = Color(hex: 0xDC2626)

        // TEXT-SAFE variants of the three semantic colours, for small text sitting on a
        // tinted panel of its own colour. Their own roles, not a reuse of the fills above:
        // measured on a 6% tint over white, the fills give 3.24 / 4.64 / 4.41 : 1, so
        // `success` fails AA outright for 13pt text and `danger` misses it. These pass at
        // 4.81 / 6.54 / 5.90 : 1, and stay comfortable on plain white too.
        static let successText = Color(hex: 0x0B7D54)
        static let warningText = Color(hex: 0x92400E)
        static let dangerText = Color(hex: 0xB91C1C)

        // Money direction in ledgers — their own roles, not reused success/danger. A
        // fresh green and a soft, desaturated red that sit easy on white.
        static let moneyIn = Color(hex: 0x12A66F)
        static let moneyOut = Color(hex: 0xE5484D)

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

    // One value for "this control is disabled", so every dimmed control matches instead of
    // each call site guessing its own opacity. Applied by the shared button styles off the
    // environment's isEnabled, so a plain `.disabled(_)` is all a call site ever needs.
    enum Opacity {
        static let disabled: Double = 0.5
    }
}

// MARK: - Soft shadow (a whisper of drop, never an outline)

extension View {
    /// The card shadow: a tight contact shadow plus a soft ambient drop. On a pure-white
    /// page the shadow is the ONLY thing separating a white card from the canvas, so it
    /// carries a touch more weight than it would over tone.
    func softCardShadow() -> some View {
        self
            .shadow(color: Color(hex: 0x101013).opacity(0.05), radius: 2, x: 0, y: 1)
            .shadow(color: Color(hex: 0x101013).opacity(0.09), radius: 24, x: 0, y: 12)
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
