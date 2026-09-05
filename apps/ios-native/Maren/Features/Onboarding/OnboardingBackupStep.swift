import SwiftUI
import UIKit

// MARK: - Backup step
//
// The only screen in Maren that ever shows a private key, and the last one before Home. Three
// decisions shape it:
//
//   1. It is SKIPPABLE. A wallet you are locked out of is worse than one you have not written
//      down yet, and a person who cannot get past this screen at 1am will not come back. "Back
//      up later" sets a flag (OnboardingFlags.backupPending) that Profile can nag on for as long
//      as it takes. Setup never blocks.
//   2. The key is behind a blur you have to hold to lift, so it cannot be shoulder-surfed by
//      someone glancing at a screen left open, and cannot end up in a screen recording by
//      accident.
//   3. The warning is specific about the consequence — anyone with this key can move the money,
//      and nobody can recover it — rather than a generic "keep it safe".
//
// The string shown is the key the coordinator is already holding in memory. This view does not
// read the Keychain, does not write anywhere, and does not log.

struct OnboardingBackupStep: View {
    var stepCount: Int
    var stepIndex: Int
    let privateKeyHex: String
    var onSaved: () -> Void
    var onLater: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var held = false
    @State private var revealedForVoiceOver = false
    @State private var everRevealed = false

    private var revealed: Bool { held || revealedForVoiceOver }

    var body: some View {
        OnboardingScreen(stepCount: stepCount, stepIndex: stepIndex) {
            // This is the only step with no focal element and the most words, so left to centre
            // itself its headline and subhead ride up into the violet wash at the top of the
            // page, where grey body copy stops being readable. Anchoring the block low keeps
            // every word on white and puts the two warnings right above the button they are
            // warning about. The spacers collapse to their minimums on a short screen.
            Spacer(minLength: Theme.Space.sm)
            OnboardingTitle(
                headline: "Back up your key",
                subhead: "This is the whole wallet. Write it down somewhere only you can reach, or put it in your password manager."
            )

            keyCard

            OnboardingCard {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    OnboardingNote(text: "Anyone who has this key can move your money. Never share it, never type it into a website.",
                                   symbol: "exclamationmark.triangle.fill", tone: .caution)
                    OnboardingNote(text: "Maren cannot recover it for you. There is no reset, because there is no account.",
                                   symbol: "key.slash", tone: .neutral)
                }
            }
            Spacer(minLength: 0).frame(maxHeight: Theme.Space.xl)
        } footer: {
            OnboardingCTA(title: "I have saved my key") {
                OnboardingHaptics.success()
                onSaved()
            }
            .accessibilityHint("Finishes setup and opens Maren.")
            OnboardingTextButton(title: "Back up later") {
                OnboardingHaptics.warning()
                onLater()
            }
            .accessibilityHint("Skips the backup. Maren will keep reminding you from Profile until it is done.")
        }
    }

    // MARK: - The key, behind a blur

    private var keyCard: some View {
        OnboardingCard(padding: Theme.Space.md) {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Text("Private key")
                        .font(.text(13, weight: .medium))
                        .foregroundStyle(OnboardingPalette.caption)
                    Spacer(minLength: 0)
                    OnboardingCopyButton(value: privateKeyHex, describes: "your private key")
                }

                ZStack {
                    Text(HexDisplay.grouped(privateKeyHex))
                        .font(.figure(16, weight: .medium))
                        .foregroundStyle(OnboardingPalette.heading)
                        .lineSpacing(5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .blur(radius: revealed ? 0 : 9)
                        .opacity(revealed ? 1 : 0.9)
                        // The key text is never read aloud: VoiceOver announcing 64 hex
                        // characters in a room is not a backup, it is a leak. Copy is the
                        // accessible path, and it is right above this.
                        .accessibilityHidden(true)

                    if !revealed {
                        HStack(spacing: 7) {
                            Image(systemName: "hand.tap.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .accessibilityHidden(true)
                            Text("Touch and hold to reveal")
                                .font(.text(14, weight: .medium))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(OnboardingPalette.heading, in: Capsule())
                        .allowsHitTesting(false)
                        .transition(.opacity)
                    }
                }
                .frame(minHeight: 72)
                .contentShape(Rectangle())
                .gesture(holdGesture)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: revealed)
            }
        }
        // One VoiceOver element with a real action, because touch-and-hold is not reachable
        // with the screen curtain on.
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: revealedForVoiceOver ? "Hide the private key" : "Reveal the private key") {
            revealedForVoiceOver.toggle()
            if revealedForVoiceOver { markRevealed() }
        }
    }

    /// Press to lift the blur, release to drop it back. A zero-distance drag rather than a long
    /// press so the key appears the moment the finger lands, and is gone the moment it leaves.
    private var holdGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard !held else { return }
                held = true
                markRevealed()
            }
            .onEnded { _ in held = false }
    }

    private func markRevealed() {
        guard !everRevealed else { return }
        everRevealed = true
        OnboardingHaptics.reveal()
    }
}
