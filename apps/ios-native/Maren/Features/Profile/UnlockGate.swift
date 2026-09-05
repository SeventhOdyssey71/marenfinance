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
// That is why this gate DEGRADES OPEN: a device that cannot evaluate a policy at all must not
// be able to shut someone out of their own app, because the thing that actually needs
// protecting — the key — is still protected either way. The lock screen below is a facelift
// only; every line of the decision logic in `AppLock` is unchanged.

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

    /// Screenshot/testing hook: `MAREN_SCREEN=unlock` presents the lock screen without asking
    /// the system for a biometric prompt the Simulator cannot satisfy. It only ever forces the
    /// lock ON, so it can never be used to skip one.
    func presentForCapture() {
        locked = true
        determined = true
    }
}

struct UnlockGate<Content: View>: View {
    @State private var lock = AppLock()
    @ViewBuilder var content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let captureLock = ScreenshotHooks.screen == "unlock"

    var body: some View {
        ZStack {
            content
            if lock.determined && lock.locked {
                UnlockScreen(kind: Keystore.shared.capability()) {
                    Task { await lock.authenticate() }
                }
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: lock.locked)
        .task {
            if captureLock { lock.presentForCapture() } else { await lock.prepare() }
        }
    }
}

// MARK: - Lock screen
//
// One focal element: the Maren mark, lifted off the page by a soft violet bloom and the app's
// own card shadow — depth, never an outline. Calm copy that says what is true (the app is
// locked, the money is not going anywhere) instead of alarming anyone, and a single button
// labelled with the biometry this device actually has.

private struct UnlockScreen: View {
    let kind: BiometricCapability
    let onUnlock: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var arrived = false

    var body: some View {
        ZStack {
            Theme.Palette.canvas.ignoresSafeArea()

            // A soft violet bloom behind the mark. Decorative: it never takes a touch.
            RadialGradient(
                colors: [Theme.Palette.accent.opacity(0.16), Theme.Palette.accent.opacity(0.0)],
                center: .center, startRadius: 0, endRadius: 260
            )
            .frame(width: 520, height: 520)
            .offset(y: -110)
            .allowsHitTesting(false)
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                markPlate
                    .padding(.bottom, Theme.Space.lg)

                VStack(spacing: Theme.Space.xs) {
                    Text("Maren is locked")
                        .font(.rounded(28, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                    Text(subhead)
                        .font(.text(15))
                        .foregroundStyle(Theme.Palette.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: 300)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Maren is locked. \(subhead)")
                .accessibilityAddTraits(.isHeader)

                Spacer()

                PillButton(title: buttonTitle, icon: glyph, variant: .primary, fullWidth: false, action: onUnlock)
                    .accessibilityHint("Asks this device to confirm it is you, then opens Maren.")
                    .padding(.bottom, Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.xl)
            .padding(.vertical, Theme.Space.xl)
            .opacity(arrived ? 1 : 0)
            .scaleEffect(arrived || reduceMotion ? 1 : 0.97)
        }
        .accessibilityAddTraits(.isModal)
        .onAppear {
            if reduceMotion { arrived = true }
            else { withAnimation(.spring(response: 0.5, dampingFraction: 0.9)) { arrived = true } }
        }
    }

    /// The mark on a white plate, lifted by the app's own soft shadow rather than a border.
    private var markPlate: some View {
        Image("MarenMark")
            .resizable()
            .scaledToFit()
            .frame(width: 52, height: 52)
            .frame(width: 104, height: 104)
            .background(Theme.Palette.card, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
            .softCardShadow()
            .overlay(alignment: .bottomTrailing) {
                Image(systemName: glyph)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.Palette.accent, in: Circle())
                    .overlay(Circle().strokeBorder(Theme.Palette.canvas, lineWidth: 4))
                    .offset(x: 10, y: 8)
            }
            .accessibilityHidden(true)
    }

    private var glyph: String {
        switch kind.kind {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.fill"
        }
    }

    private var buttonTitle: String {
        switch kind.kind {
        case .faceID: return "Unlock with Face ID"
        case .touchID: return "Unlock with Touch ID"
        default: return "Unlock"
        }
    }

    private var subhead: String {
        switch kind.kind {
        case .faceID, .touchID:
            return "Your balances are hidden until \(kind.displayName) confirms it is you. Your key stays in the Keychain either way."
        default:
            return "Your balances are hidden until this device confirms it is you. Your key stays in the Keychain either way."
        }
    }
}
