import SwiftUI

// MARK: - Outcome visuals
//
// The custom success language for every money flow: a clean, simple success mark and the
// pieces the redesigned OutcomeView composes. Kept in one place so send, borrow, split and
// claim all read the same.

/// The outcome badge — a simple filled disc with a soft halo. Success is a solid green
/// mark with a white check; every other state is a calm tinted disc in its tone.
struct OutcomeBadge: View {
    let tone: Color
    let symbol: String
    var isSuccess: Bool
    var size: CGFloat = 92

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        ZStack {
            // Soft halo — the only flourish.
            Circle()
                .fill(RadialGradient(colors: [tone.opacity(isSuccess ? 0.22 : 0.10), .clear],
                                     center: .center, startRadius: size * 0.2, endRadius: size * 0.95))
                .frame(width: size * 1.8, height: size * 1.8)

            Circle()
                .fill(isSuccess
                      ? LinearGradient(colors: [tone.opacity(0.92), tone], startPoint: .top, endPoint: .bottom)
                      : LinearGradient(colors: [tone.opacity(0.16), tone.opacity(0.16)], startPoint: .top, endPoint: .bottom))
                .frame(width: size, height: size)

            Image(systemName: symbol)
                .font(.system(size: size * 0.44, weight: .bold))
                .foregroundStyle(isSuccess ? Color.white : tone)
        }
        .shadow(color: tone.opacity(isSuccess ? 0.28 : 0), radius: 20, x: 0, y: 10)
        .scaleEffect(shown ? 1 : 0.6)
        .opacity(shown ? 1 : 0)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { shown = true; return }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.64)) { shown = true }
        }
    }
}

// MARK: - Detail model

/// A labelled line in the outcome's detail card, with a leading glyph.
struct OutcomeRow: Identifiable {
    let id = UUID()
    let icon: String
    let label: String
    let value: String
}

/// The context a flow hands the outcome so it can lead with the amount, the way the
/// reference receipts do. All optional — a flow that passes nothing still gets the
/// redesigned badge, message and Done button.
struct OutcomeDetail {
    var caption: String? = nil   // "You sent"
    var hero: String? = nil      // "1.40 MUSD"
    var rows: [OutcomeRow] = []  // e.g. To · @sele
}
