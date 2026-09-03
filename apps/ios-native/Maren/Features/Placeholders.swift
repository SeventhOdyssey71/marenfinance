import SwiftUI

// MARK: - Screen scaffold
//
// A shared page frame — canvas background, a loud condensed title, and a body. Used by the
// simpler tab screens for a consistent header with Home.

struct Screen<Content: View>: View {
    let title: String
    var badge: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                HStack(alignment: .center) {
                    Text(title)
                        .font(.display(40))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.Palette.ink)
                    Spacer()
                    if badge { DemoBadge() }
                }
                .padding(.top, Theme.Space.xs)
                content
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, Theme.Space.xl)
        }
        .background(Theme.Palette.canvas)
    }
}

/// A quiet "coming in a later wave" note inside a card — honest about what is not built.
struct ComingSoon: View {
    let text: String
    var body: some View {
        MCard {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "hammer")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.tertiary)
                    .accessibilityHidden(true)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
