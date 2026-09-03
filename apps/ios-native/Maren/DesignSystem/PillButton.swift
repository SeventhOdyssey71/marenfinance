import SwiftUI

// MARK: - PillButton
//
// Borderless pills in three voices: a soft-grey quiet pill, a black pill, and the
// PRIMARY pink-glow pill (a clean pill face wrapped in a pink bloom that lives entirely
// in the shadow, so the face stays high-contrast and the glow never intercepts touches).
// Press-scales to 0.97, respecting Reduce Motion.

struct PillButton: View {
    enum Variant { case quiet, dark, primary }

    let title: String
    var icon: String? = nil
    var variant: Variant = .quiet
    var fullWidth: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                }
                Text(title)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(foreground)
            .padding(.vertical, 15)
            .padding(.horizontal, 22)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 48)
        }
        .buttonStyle(PillButtonStyle(variant: variant))
    }

    private var foreground: Color {
        switch variant {
        case .quiet: return Theme.Palette.ink
        case .dark, .primary: return .white
        }
    }
}

private struct PillButtonStyle: ButtonStyle {
    let variant: PillButton.Variant
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(background)
            .clipShape(Capsule())
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }

    // The primary CTA is a clean, solid violet pill — no glow, no ring. High contrast on
    // white, and it never blooms behind a disabled state.
    @ViewBuilder private var background: some View {
        switch variant {
        case .quiet: Theme.Palette.inset
        case .dark: Theme.Palette.ink
        case .primary: Theme.Palette.accent
        }
    }
}

// MARK: - PressableStyle
//
// The shared press-dip for tappable surfaces that aren't a PillButton or ActionTile —
// preset chips, "Add recipient", the Activity rows. Same 0.97 scale + Reduce-Motion
// discipline, so every touchable thing dips the same instead of some feeling dead.

struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: - pillLabel
//
// The PillButton face as a modifier, for `ShareLink` / `Link` — system controls that can't
// be a PillButton but should read identically to one. `dark` gives the ink face with white
// text; otherwise the quiet grey face. Mirrors PillButton's type, padding and radius.

extension View {
    func pillLabel(dark: Bool = true) -> some View {
        self
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(dark ? Color.white : Theme.Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(dark ? Theme.Palette.ink : Theme.Palette.inset, in: Capsule())
    }
}

// MARK: - ActionTile
//
// The Home action row: a soft-white square card with an icon well and a label. Same
// press-scale + Reduce-Motion discipline as the pills.

struct ActionTile: View {
    let title: String
    let icon: String
    var emphasized: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(emphasized ? Theme.Palette.accentWash : Theme.Palette.inset)
                        .frame(width: 46, height: 46)
                    Image(systemName: icon)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(emphasized ? Theme.Palette.accentText : Theme.Palette.ink)
                }
                Text(title)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Theme.Palette.ink)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        }
        .buttonStyle(ActionTileStyle())
    }
}

private struct ActionTileStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Theme.Palette.card, in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
            .softCardShadow()
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }
}
