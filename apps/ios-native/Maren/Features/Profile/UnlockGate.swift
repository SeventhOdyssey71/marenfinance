import SwiftUI
import LocalAuthentication

// MARK: - UnlockGate
//
// A biometric app-lock. When a signing key exists on the device, the app opens locked and asks
// for Face ID / Touch ID before revealing anything. When there is no key (the demo default),
// there is nothing to protect, so the gate stays open and the app shows straight away.
//
// This is a presentation lock in front of the UI; the real security is the Keychain's own
// biometric gate on the key, which fires again on every signature regardless of this screen.

@MainActor
@Observable
final class AppLock {
    /// Locked until proven otherwise, but only meaningful once we know a key exists.
    private(set) var locked = false
    private(set) var determined = false

    func prepare() async {
        let hasKey = await Keystore.shared.hasKey()
        locked = hasKey
        determined = true
        if hasKey { await authenticate() }
    }

    func authenticate() async {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            // No way to evaluate — do not hard-lock the user out of their own app; the key's
            // own Keychain gate still protects every signature.
            locked = false
            return
        }
        let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                    localizedReason: "Unlock Maren")) ?? false
        locked = !ok
    }
}

struct UnlockGate<Content: View>: View {
    @State private var lock = AppLock()
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            content
            if lock.determined && lock.locked {
                lockScreen
                    .transition(.opacity)
            }
        }
        .task { await lock.prepare() }
    }

    private var lockScreen: some View {
        ZStack {
            Theme.Palette.canvas.ignoresSafeArea()
            VStack(spacing: Theme.Space.lg) {
                Text("MAREN")
                    .font(.display(52)).tracking(-0.5).foregroundStyle(Theme.Palette.ink)
                Image(systemName: "lock.fill")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Theme.Palette.tertiary)
                    .accessibilityHidden(true)
                Text("Maren is locked")
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                PillButton(title: "Unlock", icon: "faceid", variant: .primary, fullWidth: false) {
                    Task { await lock.authenticate() }
                }
            }
            .padding(Theme.Space.xl)
        }
        .accessibilityAddTraits(.isModal)
    }
}
