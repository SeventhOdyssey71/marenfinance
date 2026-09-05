import SwiftUI

// MARK: - Name step
//
// One question, one field. The name is cosmetic — it is the greeting on Home and nothing else —
// so it is optional and the CTA never goes dead waiting for it. What the copy has to be careful
// about is not implying this is a username or an account: it is a label stored on this device.
// The public @name people can claim for their address is a separate thing, and Profile owns it.

struct OnboardingNameStep: View {
    @Binding var name: String
    var stepCount: Int
    var stepIndex: Int
    var onBack: () -> Void
    var onContinue: () -> Void

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        OnboardingScreen(onBack: onBack, stepCount: stepCount, stepIndex: stepIndex) {
            Spacer(minLength: Theme.Space.md)
            OnboardingSymbolFocal(symbol: "person.text.rectangle", diameter: 108, symbolSize: 44)
            OnboardingTitle(
                headline: "What should we call you?",
                subhead: "Just for the greeting inside the app. It stays on this device and is never published or sent anywhere."
            )
            OnboardingField(
                label: "Your name",
                placeholder: "e.g. Sele",
                text: $name,
                autocapitalization: .words,
                submitLabel: .continue,
                onSubmit: submit
            )
            .padding(.top, Theme.Space.xs)
            OnboardingNote(
                text: "You can claim a public @name for your wallet later, from Profile.",
                symbol: "at",
                tone: .neutral
            )
            Spacer(minLength: Theme.Space.md)
        } footer: {
            OnboardingCTA(title: "Continue", action: submit)
                .accessibilityHint(trimmed.isEmpty
                                   ? "Continues without a name. Your short address is used in the greeting instead."
                                   : "Continues with the name \(trimmed).")
        }
    }

    private func submit() {
        name = trimmed
        onContinue()
    }
}
