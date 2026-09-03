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
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Theme.Palette.tertiary)
            Spacer(minLength: Theme.Space.md)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.Palette.muted)
            }
        }
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
    @ViewBuilder var value: Value

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.md) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: true, vertical: false)
                    if let hint {
                        Text("· \(hint)")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.Palette.tertiary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .layoutPriority(1)
                Spacer(minLength: Theme.Space.sm)
                value
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
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
                .font(.system(size: 13, weight: .semibold))
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
                .font(.system(size: 12, weight: .semibold))
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
                .font(.figure(15, weight: .medium))
        }
        .foregroundStyle(Theme.Palette.tertiary)
        .accessibilityLabel("\(label). This value could not be loaded and is not shown as zero.")
    }
}
