import SwiftUI

// MARK: - Screen scaffold
//
// A shared page frame — canvas background, a loud condensed title, and a body. Used by the
// simpler tab screens for a consistent header with Home.

struct Screen<Content: View>: View {
    let title: String
    var badge: Bool = false
    /// Shows the shared "Refreshing" chip in the title row during a background reload, so the
    /// values already on screen stay put while fresher ones are fetched.
    var refreshing: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                HStack(alignment: .center) {
                    Text(title)
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                    if refreshing {
                        RefreshingChip()
                            .padding(.leading, Theme.Space.sm)
                            .transition(.opacity)
                    }
                    Spacer()
                    if badge { DemoBadge() }
                }
                .animation(.easeInOut(duration: 0.2), value: refreshing)
                .padding(.top, Theme.Space.xs)
                content
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, 120)   // clear the floating glass tab bar
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
