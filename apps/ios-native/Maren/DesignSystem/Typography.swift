import SwiftUI
import CoreText

// MARK: - Type voice
//
// Two roles:
//   • Body / headings / labels → Neue Montreal (bundled), used as a mix of Light and Medium
//     as Sele asked: Light for airy secondary text, Medium for emphasis, headings and labels.
//   • Numbers → SF Pro Rounded with monospaced digits (the balance, ratios, counts) — kept
//     rounded because Sele liked that treatment and it reads cleanly in columns.
//
// The .otf files ship in the app bundle (Maren/Resources/Fonts) and register at launch via
// `AppFont.register()` — no Info.plist UIAppFonts entry needed.

enum AppFont {
    /// Register the bundled Neue Montreal faces for the process. Idempotent-safe: a
    /// re-registration just no-ops with an (ignored) error.
    static func register() {
        for face in ["NeueMontreal-Light", "NeueMontreal-Regular", "NeueMontreal-Medium", "NeueMontreal-Bold"] {
            guard let url = Bundle.main.url(forResource: face, withExtension: "otf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// Neue Montreal at a weight, mapped to the shipped faces. The app uses only Light and
    /// Medium in practice; regular falls to Light for the intended thin, clean feel.
    static func neue(_ size: CGFloat, _ weight: Font.Weight) -> Font {
        .custom(psName(weight), size: size)
    }

    private static func psName(_ weight: Font.Weight) -> String {
        switch weight {
        case .ultraLight, .thin, .light, .regular: return "NeueMontreal-Light"
        case .medium, .semibold: return "NeueMontreal-Medium"
        default: return "NeueMontreal-Bold"
        }
    }
}

extension Font {
    /// Display / leading headings — Neue Montreal, Medium by default.
    static func display(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        AppFont.neue(size, weight)
    }

    /// A section heading — Neue Montreal Medium, sentence case.
    static func sectionDisplay(_ size: CGFloat = 16) -> Font {
        AppFont.neue(size, .medium)
    }

    /// Numbers — SF Pro Rounded with monospaced digits.
    static func figure(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }

    /// Leading type in SF Pro Rounded — the same face as `figure`, without the monospaced
    /// digits that only earn their keep in a column of numbers. Onboarding and the lock screen
    /// lead in this voice; the rest of the app leads in `display` (Neue Montreal). Adding an
    /// alias rather than repointing `display` keeps that a per-screen choice instead of a
    /// silent change to every heading in the app.
    static func rounded(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    /// Body / leading text — Neue Montreal. `.regular` reads as Light (airy); `.medium` for emphasis.
    static func text(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        AppFont.neue(size, weight)
    }
}

extension View {
    /// A small, quiet label — Neue Montreal Medium, grey.
    func labelStyle() -> some View {
        self
            .font(.text(13, weight: .medium))
            .foregroundStyle(Theme.Palette.muted)
    }
}
