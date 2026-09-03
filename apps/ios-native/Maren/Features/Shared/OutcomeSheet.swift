import SwiftUI

// MARK: - Outcome visuals
//
// The custom success language for every money flow: a starburst seal (not the stock
// SF checkmark-in-a-circle) and the pieces the redesigned OutcomeView composes. Kept in
// one place so send, borrow, split and claim all read the same.

/// A spiky seal — points radiating from a solid centre. Drawn, not an SF symbol.
struct BurstShape: Shape {
    var points: Int = 12
    /// Depth of the notches between points. Higher = shallower, softer spikes.
    var innerRatio: CGFloat = 0.82

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * innerRatio
        var path = Path()
        let count = points * 2
        let step = (.pi * 2) / Double(count)
        for i in 0 ..< count {
            let radius = i.isMultiple(of: 2) ? outer : inner
            let angle = Double(i) * step - .pi / 2
            let point = CGPoint(x: center.x + CGFloat(cos(angle)) * radius,
                                y: center.y + CGFloat(sin(angle)) * radius)
            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}

/// The outcome badge. Success is a green starburst seal; every other state is a calm
/// filled disc in its tone — a burst would read as celebratory where it shouldn't.
struct OutcomeBadge: View {
    let tone: Color
    let symbol: String
    var isSuccess: Bool
    var size: CGFloat = 92

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    private var fill: LinearGradient {
        LinearGradient(colors: [tone.opacity(0.92), tone],
                       startPoint: .top, endPoint: .bottom)
    }

    var body: some View {
        ZStack {
            if isSuccess {
                BurstShape(points: 12, innerRatio: 0.8)
                    .fill(fill)
                    .frame(width: size * 1.28, height: size * 1.28)
            }
            Circle()
                .fill(isSuccess ? fill : LinearGradient(colors: [tone.opacity(0.16), tone.opacity(0.16)],
                                                        startPoint: .top, endPoint: .bottom))
                .frame(width: size, height: size)
            // Soft top-light so the seal reads as a raised object, not a flat sticker.
            if isSuccess {
                Circle()
                    .fill(RadialGradient(colors: [.white.opacity(0.35), .clear],
                                         center: .init(x: 0.35, y: 0.28),
                                         startRadius: 0, endRadius: size * 0.7))
                    .frame(width: size, height: size)
            }
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .heavy))
                .foregroundStyle(isSuccess ? Color.white : tone)
        }
        .shadow(color: tone.opacity(isSuccess ? 0.35 : 0), radius: 22, x: 0, y: 10)
        .scaleEffect(shown ? 1 : 0.6)
        .opacity(shown ? 1 : 0)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { shown = true; return }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.62)) { shown = true }
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
