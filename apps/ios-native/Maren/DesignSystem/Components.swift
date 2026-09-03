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

// MARK: - AvatarPlaceholder
//
// A clean, designed placeholder for a profile image — the brand swoosh on the violet
// gradient. Never a face and never a bare initial; used until a real avatar exists.

struct AvatarPlaceholder: View {
    var size: CGFloat = 38

    var body: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [Theme.Palette.accent, Theme.Palette.accentText],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
            MarenGlyph()
                .fill(Color.white)
                .frame(width: size * 0.52, height: size * 0.52)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The Maren mark as a Shape: a rising swoosh/wing. Filled, so it scales crisply at any size.
struct MarenGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        var p = Path()
        p.move(to: CGPoint(x: w * 0.10, y: h * 0.76))
        p.addQuadCurve(to: CGPoint(x: w * 0.50, y: h * 0.40),
                       control: CGPoint(x: w * 0.24, y: h * 0.46))
        p.addQuadCurve(to: CGPoint(x: w * 0.90, y: h * 0.26),
                       control: CGPoint(x: w * 0.70, y: h * 0.66))
        return p.strokedPath(StrokeStyle(lineWidth: w * 0.14, lineCap: .round, lineJoin: .round))
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
