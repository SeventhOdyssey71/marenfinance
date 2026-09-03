import SwiftUI

// MARK: - MCard
//
// The soft-white surface: ~22pt radius, a whisper of shadow, NO border. Separation is
// tone + drop, never an outline.

struct MCard<Content: View>: View {
    var padding: CGFloat = Theme.Space.lg
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .softCardShadow()
    }
}

// MARK: - SectionHeader

struct SectionHeader: View {
    let title: String
    var trailing: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.sectionDisplay())
                .foregroundStyle(Theme.Palette.ink)
            Spacer(minLength: Theme.Space.md)
            if let trailing {
                Text(trailing)
                    .font(.text(13, weight: .medium))
                    .foregroundStyle(Theme.Palette.muted)
            }
        }
    }
}

// MARK: - HugeIcon
//
// A HugeIcons glyph, bundled as a template SVG in Assets.xcassets (hgi-<name>). Template
// rendering means `.foregroundStyle` tints it like an SF Symbol. One clean icon set across
// the app, replacing the SF Symbols on the primary surfaces.

struct HugeIcon: View {
    let name: String
    var size: CGFloat = 20

    var body: some View {
        Image("hgi-\(name)")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

// MARK: - GeneratedAvatar
//
// A colourful profile image generated deterministically from a seed (the wallet address),
// so every account gets its own distinct mix of colours — the wallet-identicon pattern. No
// faces, no bundled images: two hues derived from a hash, blended over an angular gradient
// with a soft light bloom for depth. Same seed always yields the same avatar.

struct GeneratedAvatar: View {
    let seed: String
    var size: CGFloat = 38

    var body: some View {
        let palette = Self.palette(for: seed)
        ZStack {
            AngularGradient(colors: palette.ring, center: .center, angle: .degrees(palette.angle))
            RadialGradient(colors: [.white.opacity(0.45), .clear],
                           center: .topLeading, startRadius: 0, endRadius: size)
            RadialGradient(colors: [palette.deep.opacity(0.55), .clear],
                           center: .bottomTrailing, startRadius: 0, endRadius: size * 0.9)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    /// Deterministic two-hue palette from a djb2 hash of the seed — full hue range, so
    /// accounts read as visibly different (violet, teal, coral, lime…), never washed out.
    private static func palette(for seed: String) -> (ring: [Color], deep: Color, angle: Double) {
        var hash: UInt64 = 5381
        for byte in seed.lowercased().utf8 { hash = (hash &* 33) ^ UInt64(byte) }
        let h1 = Double(hash % 360) / 360
        let h2 = Double((hash / 7) % 360) / 360
        let angle = Double((hash / 13) % 360)
        let a = Color(hue: h1, saturation: 0.72, brightness: 0.92)
        let b = Color(hue: h2, saturation: 0.78, brightness: 0.80)
        return (ring: [a, b, a], deep: b, angle: angle)
    }
}

// MARK: - DottedDivider
//
// The very slight dotted hairline from the reference — an airy separator under the header
// and between sections, quieter than a solid rule.

struct DottedDivider: View {
    var body: some View {
        HorizontalDottedLine()
            .stroke(Theme.Palette.ink.opacity(0.16),
                    style: StrokeStyle(lineWidth: 1, dash: [1.5, 4]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

private struct HorizontalDottedLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// MARK: - StatRow
//
// A label/value row on a hairline, one line tall. Value is any view so it can carry a
// MoneyText with greyed decimals, or an explicit unavailable state.

struct StatRow<Value: View>: View {
    let label: String
    var hint: String? = nil
    var showsDivider: Bool = true
    /// Money figures are short and pin to their intrinsic width; a long plain value (a 0x
    /// address, a memo) must instead be allowed to truncate, or it blows the row — and the
    /// whole sheet — wider than the screen. Pass false for those.
    var fixedValue: Bool = true
    @ViewBuilder var value: Value

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.md) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.text(15))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: true, vertical: false)
                    if let hint {
                        Text("· \(hint)")
                            .font(.text(15))
                            .foregroundStyle(Theme.Palette.tertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .layoutPriority(1)
                Spacer(minLength: Theme.Space.sm)
                value
                    .lineLimit(1)
                    .fixedSize(horizontal: fixedValue, vertical: false)
            }
            .padding(.vertical, 12)

            if showsDivider {
                Rectangle()
                    .fill(Theme.Palette.ink.opacity(0.07))
                    .frame(height: 1)
            }
        }
    }
}

// MARK: - HealthChip
//
// The one coloured element on the position card. Status changes never rely on colour
// alone — a filled dot plus the label carry the meaning too.

struct HealthChip: View {
    let status: HealthStatus

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(status.tone)
                .frame(width: 7, height: 7)
            Text(status.label)
                .font(.text(13, weight: .medium))
                .foregroundStyle(status.tone)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(status.tone.opacity(0.12), in: Capsule())
    }
}

// MARK: - DemoBadge
//
// Honest-data discipline, worn on the sleeve: every screen fed by the stub says so.

struct DemoBadge: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flask.fill")
                .font(.system(size: 10, weight: .bold))
            Text("Demo data")
                .font(.text(12, weight: .medium))
                .tracking(0.3)
        }
        .foregroundStyle(Theme.Palette.accentText)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Theme.Palette.accentWash, in: Capsule())
        .accessibilityLabel("Demo data. Figures on this screen are placeholder values, not real balances.")
    }
}

// MARK: - Unavailable
//
// The explicit "we don't have this" state. Never a fabricated zero — an em dash with a
// reason, so an honest gap reads as a gap.

struct Unavailable: View {
    var label: String = "Unavailable"

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 11, weight: .semibold))
            Text(label)
                .font(.text(15, weight: .medium))
        }
        .foregroundStyle(Theme.Palette.tertiary)
        .accessibilityLabel("\(label). This value could not be loaded and is not shown as zero.")
    }
}
