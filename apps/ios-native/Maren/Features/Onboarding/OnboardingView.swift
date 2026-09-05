import SwiftUI

// MARK: - Onboarding
//
// Sign up and sign in for a non-custodial app. There is no account, no email and no password:
// "create a wallet" means generate a secp256k1 key on this device, and "I already have a wallet"
// means restore one from a key you are holding. Nothing is sent anywhere, and nothing here can
// be recovered by us — the copy says so on every screen rather than borrowing the comfort of
// words like "sign up with" that would imply otherwise.
//
// This file is the coordinator: it owns the step machine, the in-flight key, and the two calls
// that actually change anything (Keystore.store, MarenSession.adopt). Each step is a dumb view
// that reports back. The security logic is untouched:
//
//   • the key is generated with SecRandomCopyBytes, exactly as before;
//   • it is handed to `Keystore.store` once, which decides — and honestly reports — whether it
//     ends up behind biometrics or held for the session only;
//   • it is never written anywhere else, never logged, and the in-memory copy this flow holds
//     (so the backup step can show it) is dropped the moment setup ends.
//
// The whole flow lives in the intro story's world, and that world is the app's own light one —
// a violet wash at the top of the page falling into white, ink type on white — so arriving on
// Home at the end of setup is a continuation rather than a theme change.

struct OnboardingView: View {
    @Environment(MarenSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The key that has been generated or pasted but not yet adopted. Held in memory for the
    /// length of the flow because the backup step has to show it; cleared in `finish`. This is
    /// the same lifetime the old single-screen flow gave it — no new persistence of any kind.
    private struct PendingWallet {
        let key: Data
        let address: String
    }

    private enum Step: Hashable {
        case welcome
        case restore     // sign in: paste or scan an existing key
        case name        // "What should we call you?"
        case generate    // the key-generation moment, resolving into the address reveal
        case protect     // Face ID enrollment (or the honest session-only state)
        case backup      // hold-to-reveal private key, skippable by design
    }

    @State private var step: Step = .welcome
    @State private var pending: PendingWallet?
    @State private var name = ""
    @State private var protection: KeyProtection?
    /// Restore skips the backup step: you are already holding the key you just pasted.
    @State private var isRestoring = false

    /// Screenshot/testing hook. `MAREN_SCREEN` can open the flow directly on one step so each
    /// screen can be captured. Absent in normal use, so it changes nothing for a real user.
    private let launchScreen = ProcessInfo.processInfo.environment["MAREN_SCREEN"]

    var body: some View {
        ZStack {
            OnboardingGradient().ignoresSafeArea()

            Group {
                switch step {
                case .welcome:
                    welcome
                case .restore:
                    OnboardingRestoreStep(
                        onBack: { go(to: .welcome) },
                        onKey: { key, address in
                            pending = PendingWallet(key: key, address: address)
                            isRestoring = true
                            // A restored key is by definition already in its owner's hands, so
                            // there is nothing for the app to nag about later.
                            OnboardingFlags.markBackedUp()
                            go(to: .name)
                        }
                    )
                case .name:
                    OnboardingNameStep(
                        name: $name,
                        stepCount: stepCount,
                        stepIndex: isRestoring ? 1 : 0,
                        onBack: { go(to: isRestoring ? .restore : .welcome) },
                        onContinue: { go(to: isRestoring ? .protect : .generate) }
                    )
                case .generate:
                    OnboardingKeyGenerationStep(
                        stepCount: stepCount,
                        stepIndex: 1,
                        holdForCapture: launchScreen == "generation",
                        onReady: { key, address in
                            pending = PendingWallet(key: key, address: address)
                        },
                        onContinue: { go(to: .protect) }
                    )
                case .protect:
                    OnboardingProtectionStep(
                        stepCount: stepCount,
                        stepIndex: 2,
                        protection: $protection,
                        onEnable: storeKey,
                        onContinue: { isRestoring ? finish() : go(to: .backup) },
                        continueTitle: isRestoring ? "Enter Maren" : "Continue",
                        hasBackupStep: !isRestoring
                    )
                case .backup:
                    OnboardingBackupStep(
                        stepCount: stepCount,
                        stepIndex: 3,
                        privateKeyHex: pendingKeyHex,
                        onSaved: {
                            OnboardingFlags.markBackedUp()
                            finish()
                        },
                        onLater: {
                            OnboardingFlags.backupPending = true
                            finish()
                        }
                    )
                }
            }
            .transition(.onboardingStep(reduceMotion: reduceMotion))
        }
        // Light on every device, whatever the system appearance is set to — the page, the
        // keyboard on the name and restore steps, and the status bar all stay one thing.
        .preferredColorScheme(.light)
        .onAppear(perform: applyLaunchScreen)
    }

    // MARK: - Welcome choice
    //
    // The decision point the intro story hands off to. One focal element (the mark, straight on
    // the background with nothing behind it), two real choices as full-height pills, and an
    // honest footnote about what "no account" costs.

    private var welcome: some View {
        OnboardingScreen {
            Spacer(minLength: Theme.Space.lg)
            OnboardingFocal(diameter: 148) {
                MarenBrandMark(size: 108)
            }
            .accessibilityHidden(true)
            OnboardingTitle(
                headline: "Set up your wallet",
                subhead: "Maren has no accounts and no passwords. Your wallet is a key created on this device, and only you ever hold it."
            )
            .padding(.top, Theme.Space.sm)
            Spacer(minLength: Theme.Space.lg)
        } footer: {
            OnboardingCTA(title: "Create a new wallet", icon: "plus") {
                OnboardingHaptics.tap()
                isRestoring = false
                go(to: .name)
            }
            .accessibilityHint("Generates a new key on this device and takes you through setup.")
            OnboardingGhostButton(title: "I already have a wallet", icon: "arrow.down.doc") {
                OnboardingHaptics.tap()
                isRestoring = true
                go(to: .restore)
            }
            .accessibilityHint("Restore a wallet from a private key you already hold.")
            Text("Nothing is sent to a server. There is no password to reset, so keep your key safe.")
                .font(.text(13, weight: .medium))
                .foregroundStyle(OnboardingPalette.caption)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, Theme.Space.sm)
                .padding(.top, 2)
        }
    }

    // MARK: - Step machine

    /// Four steps when creating (name, wallet, protection, backup), three when restoring
    /// (key, name, protection).
    private var stepCount: Int { isRestoring ? 3 : 4 }

    private var pendingKeyHex: String {
        guard let pending else { return "" }
        return "0x" + pending.key.map { String(format: "%02x", $0) }.joined()
    }

    private func go(to next: Step) {
        OnboardingHaptics.step()
        if reduceMotion {
            step = next
        } else {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { step = next }
        }
    }

    // MARK: - The two calls that change anything

    /// Store the key behind biometrics. Exactly the call the previous flow made, with exactly
    /// the same argument: `Keystore.store` alone decides whether the key ends up in the Keychain
    /// behind a biometric access control or is held for this session only, and it reports which.
    /// This screen shows that answer verbatim and never dresses one up as the other.
    private func storeKey() async {
        guard let pending else { return }
        do {
            let result = try await Keystore.shared.store(privateKey: pending.key)
            protection = result
            switch result {
            case .keychainBiometric: OnboardingHaptics.success()
            case .sessionOnly: OnboardingHaptics.warning()
            }
        } catch {
            // A refused store is a refused store. No retry loop that quietly writes the key
            // somewhere weaker.
            protection = .sessionOnly(reason: "This device would not store the key. It is held for this session only.")
            OnboardingHaptics.warning()
        }
    }

    /// The end of setup: record the public address and display name, and drop the key from
    /// memory. RootView sees `session.hasWallet` flip and swaps to Home.
    private func finish() {
        guard let pending else { return }
        // HOOK: @name claim. This is the natural end-of-signup point — the wallet exists, the key
        // is protected, and the address is about to be adopted. Handle registration (claiming a
        // public @name for this address) belongs here, between `adopt` and landing on Home, once
        // that flow exists. Until then setup tells people they can claim one later from Profile.
        session.adopt(address: pending.address, name: name)
        self.pending = nil
        OnboardingHaptics.success()
    }

    // MARK: - Screenshot hook

    /// Opens the flow on a named step for capture. The steps that need a key generate a real,
    /// throwaway one on the spot rather than displaying an invented value — this is a simulator
    /// key that is never stored and never adopted.
    private func applyLaunchScreen() {
        guard let launchScreen else { return }
        switch launchScreen {
        case "welcome", "onboarding": step = .welcome
        case "signin", "restore": isRestoring = true; step = .restore
        case "name": step = .name
        // "generation" holds the forming beat for capture; "reveal" lets it resolve into the
        // address so both halves of the moment can be photographed.
        case "generation", "generate", "reveal": step = .generate
        case "protection", "protect":
            pending = Self.throwawayWallet()
            step = .protect
        case "backup":
            pending = Self.throwawayWallet()
            step = .backup
        default: break
        }
    }

    private static func throwawayWallet() -> PendingWallet? {
        guard let key = OnboardingKeyGenerationStep.generateKey(),
              let address = try? Keystore.address(of: key) else { return nil }
        return PendingWallet(key: key, address: address)
    }
}
