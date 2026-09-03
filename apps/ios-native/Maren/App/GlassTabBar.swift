import SwiftUI

// MARK: - GlassTabBar
//
// A floating tab bar in the spirit of Apple's Liquid Glass. True Liquid Glass (deep
// refraction) is an iOS 26 API and this target builds against the iOS 18 SDK, so this is
// the faithful approximation available on iOS 17: a frosted `.ultraThinMaterial` capsule
// floating above the content, a bright top-edge specular highlight, a soft depth shadow,
// and a violet selection pill that slides between items. Swap in `.glassEffect` when the
// toolchain moves to Xcode 26.

struct GlassTabBar: View {
    @Binding var selection: AppTab
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var indicator

    private let items: [(tab: AppTab, label: String, icon: String)] = [
        (.home, "Home", "home"),
        (.finance, "Finance", "finance"),
        (.activity, "Activity", "activity"),
        (.profile, "Profile", "profile"),
    ]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.tab) { item in
                let selected = item.tab == selection
                Button {
                    if reduceMotion { selection = item.tab }
                    else { withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { selection = item.tab } }
                } label: {
                    VStack(spacing: 3) {
                        HugeIcon(name: item.icon, size: 22)
                        Text(item.label)
                            .font(.text(11, weight: .medium))
                    }
                    .foregroundStyle(selected ? Theme.Palette.accentText : Theme.Palette.muted)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background {
                        if selected {
                            Capsule()
                                .fill(Theme.Palette.accentWash)
                                .matchedGeometryEffect(id: "selection", in: indicator)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.label)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(6)
        .background {
            Capsule()
                .fill(.ultraThinMaterial)
                .overlay(
                    // A bright top edge fading down — the specular cue that reads as glass.
                    Capsule().strokeBorder(
                        LinearGradient(
                            colors: [.white.opacity(0.7), .white.opacity(0.05)],
                            startPoint: .top, endPoint: .bottom
                        ),
                        lineWidth: 1
                    )
                )
                .shadow(color: Theme.Palette.ink.opacity(0.16), radius: 22, x: 0, y: 10)
                .shadow(color: Theme.Palette.ink.opacity(0.06), radius: 2, x: 0, y: 1)
        }
        .padding(.horizontal, 20)
    }
}
