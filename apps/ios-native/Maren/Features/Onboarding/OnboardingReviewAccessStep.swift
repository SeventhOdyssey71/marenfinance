import SwiftUI
import UIKit

// MARK: - App Review sign-in
//
// This is intentionally labelled for App Review. It restores one dedicated TESTNET wallet from
// the credentials supplied privately in App Store Connect, then hands the key to the ordinary
// biometric protection step. It does not create a general Maren account or send credentials
// to a server.

struct OnboardingReviewAccessStep: View {
    var onBack: () -> Void
    var onWallet: (Data, String) -> Void

    @State private var email = ""
    @State private var accessCode = ""
    @State private var error: String?

    var body: some View {
        OnboardingScreen(onBack: onBack, stepCount: 2, stepIndex: 0) {
            Spacer(minLength: Theme.Space.sm)
            OnboardingSymbolFocal(symbol: "checkmark.seal.fill", diameter: 104, symbolSize: 43)
            OnboardingTitle(
                headline: "App Review access",
                subhead: "Use the credentials in Beta App Review Information to open the dedicated Mezo testnet wallet for this build."
            )
            OnboardingField(
                label: "Review email",
                placeholder: "review@example.com",
                text: $email,
                keyboardType: .emailAddress,
                submitLabel: .next
            )
            OnboardingField(
                label: "Access code",
                placeholder: "Enter access code",
                text: $accessCode,
                secure: true,
                submitLabel: .go,
                onSubmit: submit
            )
            if let error {
                OnboardingNote(text: error, symbol: "exclamationmark.triangle.fill", tone: .bad)
                    .accessibilityAddTraits(.isStaticText)
            }
            OnboardingNote(
                text: "This account contains testnet assets only. Its key is reconstructed on this device and protected by the same Keychain flow as every Maren wallet.",
                symbol: "testtube.2",
                tone: .neutral
            )
            Spacer(minLength: Theme.Space.sm)
        } footer: {
            OnboardingCTA(title: "Open review account", icon: "arrow.right", action: submit)
        }
    }

    private func submit() {
        switch AppReviewAccess.unlock(email: email, accessCode: accessCode) {
        case .success(let wallet):
            error = nil
            accessCode = ""
            OnboardingHaptics.success()
            onWallet(wallet.privateKey, wallet.address)
        case .failure(let failure):
            error = failure.message
            OnboardingHaptics.failure()
            UIAccessibility.post(notification: .announcement, argument: failure.message)
        }
    }
}
