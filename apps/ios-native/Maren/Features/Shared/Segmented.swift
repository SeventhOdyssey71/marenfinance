import SwiftUI

// MARK: - Segmented
//
// A soft pill segmented control — the selected segment rides on a white pill inside a grey
// well, no outlines. Used for Vault/Earn and deposit/withdraw. Selection is carried by a
// filled pill AND the ink/tertiary text weight, never colour alone.

struct Segmented<T: Hashable>: View {
    let options: [(value: T, label: String)]
    @Binding var selection: T
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                let isSelected = option.value == selection
                Button {
                    if reduceMotion {
                        selection = option.value
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) { selection = option.value }
                    }
                } label: {
                    Text(option.label)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(isSelected ? Theme.Palette.ink : Theme.Palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .padding(.vertical, 4)
                        .background {
                            if isSelected {
                                Capsule()
                                    .fill(Theme.Palette.card)
                                    .softCardShadow()
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
            }
        }
        .padding(4)
        .background(Theme.Palette.inset, in: Capsule())
    }
}
