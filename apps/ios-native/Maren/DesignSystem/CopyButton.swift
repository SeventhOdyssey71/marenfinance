import SwiftUI
import UIKit

// MARK: - CopyButton
//
// One copy control for the whole app. A copy should always *say* it copied, and every
// copy site should say it the same way — before this, four buttons each behaved
// differently and two were silent. Tapping confirms three ways: the glyph replaces to a
// check, a success haptic fires, and VoiceOver announces "Copied", then it quietly
// reverts after a beat. Reduce Motion drops only the symbol animation, never the
// confirmation itself.

struct CopyButton: View {
    enum Style { case icon, inline, filled }

    /// The exact string placed on the pasteboard.
    let value: String
    /// The noun for the accessibility label — "your address", "the claim link". The
    /// spoken label reads "Copy {describes}", then "Copied" after a tap.
    var describes: String
    /// Visible verb for `.inline` / `.filled` (ignored by `.icon`).
    var title: String = "Copy"
    var style: Style = .icon

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: copy) { content }
            .buttonStyle(.plain)
            .accessibilityLabel(copied ? "Copied" : "Copy \(describes)")
            .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var content: some View {
        switch style {
        case .icon:
            glyph
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.Palette.accentText)
                .frame(width: 44, height: 44)
        case .inline:
            Text(copied ? "Copied" : title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.Palette.ink)
                .frame(maxWidth: .infinity, minHeight: 44)
        case .filled:
            HStack(spacing: 8) {
                glyph
                Text(copied ? "Copied" : title)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Theme.Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Theme.Palette.inset, in: Capsule())
        }
    }

    /// doc.on.doc ⇄ checkmark, cross-faded via the native SF Symbol replace transition —
    /// the platform's expression of the cheat sheet's icon cross-fade.
    private var glyph: some View {
        Image(systemName: copied ? "checkmark" : "doc.on.doc")
            .contentTransition(.symbolEffect(.replace))
            .accessibilityHidden(true)
    }

    private func copy() {
        UIPasteboard.general.string = value
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        UIAccessibility.post(notification: .announcement, argument: "Copied")
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { copied = true }

        resetTask?.cancel()
        resetTask = Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { copied = false }
            }
        }
    }
}
