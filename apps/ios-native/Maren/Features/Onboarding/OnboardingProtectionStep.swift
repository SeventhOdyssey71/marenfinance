import SwiftUI

// MARK: - Protection step
//
// Where the key actually gets stored. The screen asks Keystore what this device can do, offers
// the honest option, and then reports what Keystore says actually happened — not what we hoped
// would happen. There are only two outcomes and the UI has a real state for each:
//
//   • keychainBiometric — the key is in the Keychain behind a biometry-current-set access
//     control, and every signature will prompt for it.
//   • sessionOnly — the device could not offer that, so the key is held in memory for this run
//     only. Said in those words, with what it costs, and never dressed up as protected.
//
// This screen makes no security decision of its own. It calls `Keystore.store(privateKey:)`
// once and renders the answer.

struct OnboardingProtectionStep: View {
    var stepCount: Int
    var stepIndex: Int
    @Binding var protection: KeyProtection?
    var onEnable: () async -> Void
    var onContinue: () -> Void
    var continueTitle: String = "Continue"
    /// False on the restore path, where the key is already in its owner's hands and no backup
    /// step follows — so the session-only warning must not point at a step that never comes.
    var hasBackupStep: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var working = false
    private let capability = Keystore.shared.capability()

    private var biometricsUsable: Bool { capability.available && capability.enrolled }

    var body: some View {
        OnboardingScreen(stepCount: stepCount, stepIndex: stepIndex) {
            Spacer(minLength: Theme.Space.md)
            focal
            if let protection {
                outcome(protection)
            } else {
                offer
            }
            Spacer(minLength: Theme.Space.md)
        } footer: {
            if protection == nil {
                OnboardingCTA(
                    title: biometricsUsable ? "Turn on \(capability.displayName)" : "Store key for this session",
                    icon: working ? nil : (biometricsUsable ? glyph : "lock"),
                    busy: working
                ) {
                    Task {
                        working = true
                        await onEnable()
                        working = false
                    }
                }
                .accessibilityHint(biometricsUsable
                    ? "Stores your key in this device's Keychain, unlocked by \(capability.displayName)."
                    : "Holds your key in memory until you close Maren.")
            } else {
                OnboardingCTA(title: continueTitle, action: onContinue)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.28), value: protection)
    }

    // MARK: - Focal element

    private var focal: some View {
        OnboardingFocal(diameter: 132) {
            Image(systemName: resolvedGlyph)
                .font(.system(size: 54, weight: .medium))
                .foregroundStyle(resolvedTint)
                .contentTransition(.symbolEffect(.replace))
                // This is the one focal whose colour changes with the outcome, so the glass is
                // told about it: the highlight is warmed towards whatever the glyph currently
                // is, rather than staying violet over a green shield.
                .liquidGlass(.symbol.tinted(resolvedTint))
        }
        .accessibilityHidden(true)
    }

    /// The focal takes the tone of the outcome once there is one: brand violet while it is still
    /// an offer, then the app's AA-on-white success or warning. The words below it say the same
    /// thing, so the colour is reinforcement and never the only signal.
    private var resolvedTint: Color {
        guard let protection else { return OnboardingPalette.accent }
        switch protection {
        case .keychainBiometric: return Theme.Palette.success
        case .sessionOnly: return Theme.Palette.warning
        }
    }

    private var glyph: String {
        switch capability.kind {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.shield"
        }
    }

    private var resolvedGlyph: String {
        guard let protection else { return glyph }
        switch protection {
        case .keychainBiometric: return "checkmark.shield.fill"
        case .sessionOnly: return "clock.badge.exclamationmark"
        }
    }

    // MARK: - Before

    @ViewBuilder private var offer: some View {
        if biometricsUsable {
            OnboardingTitle(
                headline: "Protect it with\n\(capability.displayName)",
                subhead: "Your key goes into this device's Keychain, locked behind \(capability.displayName). Maren asks for it every single time you sign, and cannot read it any other way."
            )
            OnboardingCard {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    OnboardingNote(text: "The key never leaves this device and is never sent to Maren.",
                                   symbol: "iphone", tone: .good)
                    OnboardingNote(text: "Changing the faces or fingerprints enrolled on this device invalidates the stored key, so keep your backup.",
                                   symbol: "arrow.triangle.2.circlepath", tone: .neutral)
                }
            }
        } else {
            OnboardingTitle(
                headline: "No biometrics\non this device",
                subhead: capability.reason ?? "This device cannot offer biometric protection."
            )
            OnboardingCard {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    OnboardingNote(text: "Your key will be held in memory for this session only. It is gone when Maren closes, and you will need your backup to get back in.",
                                   symbol: "exclamationmark.triangle.fill", tone: .caution)
                    OnboardingNote(text: "Maren will not store an unprotected key on disk and tell you it is protected.",
                                   symbol: "hand.raised.fill", tone: .neutral)
                }
            }
        }
    }

    // MARK: - After

    @ViewBuilder private func outcome(_ protection: KeyProtection) -> some View {
        switch protection {
        case .keychainBiometric(let label):
            OnboardingTitle(
                headline: "\(label) is on",
                subhead: "Your key is in this device's Keychain. Every signature asks for \(label) first."
            )
            .accessibilityLabel("\(label) is on. Your key is in this device's Keychain. Every signature asks for \(label) first.")
        case .sessionOnly(let reason):
            OnboardingTitle(
                headline: "Held for this session",
                subhead: reason
            )
            OnboardingCard {
                OnboardingNote(text: hasBackupStep
                               ? "Back up your key on the next step. Without it you cannot return to this wallet after Maren closes."
                               : "Keep the key you just pasted. Without it you cannot return to this wallet after Maren closes.",
                               symbol: "exclamationmark.triangle.fill", tone: .caution)
            }
        }
    }
}
