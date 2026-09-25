import SwiftUI

// MARK: - Amount entry building blocks
//
// The pieces the full-screen money flows are built from: a big animated amount readout, a
// custom numeric keypad, and the glossy spinning-coin loader shown while a submit is in
// flight. Kept together so send/deposit/borrow/… all type an amount the same way.

// MARK: AmountReadout — the big $ figure with a clean typing animation

struct AmountReadout: View {
    /// The raw typed string, e.g. "3.0". Empty renders as a greyed "0".
    let raw: String
    let unitLabel: String            // "MUSD" or "BTC"
    /// The big-figure prefix — "$" for MUSD, empty for BTC.
    var prefix: String = "$"
    /// Only show a toggle when the caller provides a real conversion action.
    var showToggle: Bool = false
    var onToggle: () -> Void = {}

    private var isZero: Bool { raw.isEmpty || Decimal(string: raw) == 0 }
    private var shown: String { raw.isEmpty ? "0" : raw }

    var body: some View {
        VStack(spacing: Theme.Space.sm) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                if !prefix.isEmpty {
                    Text(prefix).font(.figure(34, weight: .bold))
                }
                // .figure is the same rounded face with monospaced digits. Every other number
                // in the app already goes through it; this one bypassed it, so the widest and
                // most-typed figure on screen re-flowed on each keystroke — and
                // .numericText() made the shifting more obvious, not less.
                Text(shown).font(.figure(60, weight: .bold))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(isZero ? Theme.Palette.muted : Theme.Palette.ink)
            .animation(.snappy(duration: 0.18), value: raw)
            .lineLimit(1)
            .minimumScaleFactor(0.5)

            Button(action: onToggle) {
                HStack(spacing: 6) {
                    Text(unitLabel).font(.text(15, weight: .medium))
                    if showToggle {
                        Image(systemName: "arrow.up.arrow.down").font(.system(size: 13, weight: .semibold))
                    }
                }
                .foregroundStyle(Theme.Palette.muted)
            }
            .buttonStyle(.plain)
            .disabled(!showToggle)
            .accessibilityLabel("Amount \(shown) \(unitLabel)")
        }
    }
}

// MARK: AmountKeypad — the custom numeric pad

struct AmountKeypad: View {
    var onDigit: (String) -> Void
    var onDot: () -> Void
    var onDelete: () -> Void

    private let keys: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "⌫"]]

    var body: some View {
        VStack(spacing: Theme.Space.xs) {
            ForEach(keys, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(row, id: \.self) { key in
                        Button { tap(key) } label: {
                            Group {
                                if key == "⌫" {
                                    Image(systemName: "delete.left").font(.system(size: 22, weight: .regular))
                                } else {
                                    Text(key).font(.system(size: 28, weight: .regular, design: .rounded))
                                }
                            }
                            .foregroundStyle(Theme.Palette.ink)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(KeypadKeyStyle())
                        .accessibilityLabel(key == "⌫" ? "Delete" : key)
                    }
                }
            }
        }
    }

    private func tap(_ key: String) {
        switch key {
        case "⌫": onDelete()
        case ".": onDot()
        default: onDigit(key)
        }
    }
}

/// A round grey press highlight behind the key, plus a small dip — the tactile keypad feel.
private struct KeypadKeyStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle()
                    .fill(Theme.Palette.inset)
                    .frame(width: 62, height: 62)
                    .opacity(configuration.isPressed ? 1 : 0)
            )
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.92 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

// MARK: LogoLoader — a glossy, glassmorphic coin that flips while a submit is in flight

struct LogoLoader: View {
    var size: CGFloat = 84
    @State private var spin = false
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // Indeterminate ring — an arc sweeping around the mark, not a full spinner.
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(
                    AngularGradient(colors: [Theme.Palette.accent.opacity(0), Theme.Palette.accent],
                                    center: .center),
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .frame(width: size + 22, height: size + 22)
                .rotationEffect(.degrees(spin ? 360 : 0))

            // The actual Maren logo, breathing gently.
            Image("MarenMark")
                .resizable()
                .scaledToFit()
                .frame(width: size * 0.66)
                .scaleEffect(pulse ? 1 : 0.9)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { spin = true }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityLabel("Submitting")
    }
}
