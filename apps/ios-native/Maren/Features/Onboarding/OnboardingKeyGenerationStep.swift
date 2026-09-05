import SwiftUI
import Security
import UIKit

// MARK: - Key generation moment
//
// The beat where the wallet starts existing. Two honest stages — the device produces 32 random
// bytes (SecRandomCopyBytes, the same call the old flow made), then secp256k1 derives the public
// address from them — and then the motion resolves into the address itself, wearing the identity
// colour the rest of the app already gives it (GeneratedAvatar, seeded by the address).
//
// The animation is a beat, not a loading bar pretending to measure something: it holds for a
// minimum so the moment lands, and the real work finishes long before that. Reduce Motion gets
// the same two stages and the same reveal with no rotation and no scale.
//
// The key never leaves this process. It is handed straight to the coordinator, which passes it
// to Keystore on the next step; nothing here writes, prints or transmits it.

struct OnboardingKeyGenerationStep: View {
    var stepCount: Int
    var stepIndex: Int
    /// Screenshot hook: holds the forming animation so the moment itself can be captured.
    var holdForCapture: Bool = false
    var onReady: (Data, String) -> Void
    var onContinue: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Phase: Equatable {
        case entropy
        case deriving
        case revealed(address: String)
        case failed(String)
    }

    @State private var phase: Phase = .entropy
    @State private var spin = false
    @State private var started = false

    var body: some View {
        OnboardingScreen(stepCount: stepCount, stepIndex: stepIndex) {
            Spacer(minLength: Theme.Space.md)
            focal
            switch phase {
            case .entropy, .deriving:
                forming
            case .revealed(let address):
                revealed(address)
            case .failed(let reason):
                failure(reason)
            }
            Spacer(minLength: Theme.Space.md)
        } footer: {
            switch phase {
            case .revealed:
                OnboardingCTA(title: "Continue", action: onContinue)
            case .failed:
                OnboardingCTA(title: "Try again") { restart() }
            case .entropy, .deriving:
                // No dead pill sitting under an animation it cannot affect. The footer keeps
                // its height so the CTA does not shove the layout when it arrives.
                Color.clear.frame(height: 54).accessibilityHidden(true)
            }
        }
        .task { await run() }
    }

    // MARK: - Focal element

    @ViewBuilder private var focal: some View {
        ZStack {
            if case .revealed(let address) = phase {
                OnboardingFocal(diameter: 148) {
                    // The address wearing the identity colour the rest of the app already gives
                    // it. A white ring and the app's soft shadow lift it off the page and pick
                    // up the weight of the mark it just replaced, so the swap reads as the same
                    // object resolving.
                    GeneratedAvatar(seed: address, size: 104)
                        .overlay(Circle().strokeBorder(.white, lineWidth: 3))
                        .softCardShadow()
                }
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.86)))
            } else {
                FormingRings(spin: spin, reduceMotion: reduceMotion)
                    .transition(.opacity)
            }
        }
        .frame(height: 200)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 9).repeatForever(autoreverses: false)) { spin = true }
        }
    }

    // MARK: - States

    private var forming: some View {
        VStack(spacing: Theme.Space.sm) {
            Text("Creating your wallet")
                .font(.rounded(30, weight: .semibold))
                .foregroundStyle(OnboardingPalette.heading)
                .multilineTextAlignment(.center)
            Text(phase == .entropy
                 ? "Gathering randomness from this device."
                 : "Deriving the address only your key can sign for.")
                .font(.text(16, weight: .medium))
                .foregroundStyle(OnboardingPalette.body)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 320)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: phase)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Creating your wallet. \(phase == .entropy ? "Gathering randomness from this device." : "Deriving the address only your key can sign for.")")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private func revealed(_ address: String) -> some View {
        VStack(spacing: Theme.Space.lg) {
            OnboardingTitle(
                headline: "Your wallet is ready",
                subhead: "This is your address on Mezo. It is public: share it and people can pay you."
            )
            OnboardingCard(padding: Theme.Space.md) {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    HStack {
                        Text("Your address")
                            .font(.text(13, weight: .medium))
                            .foregroundStyle(OnboardingPalette.caption)
                        Spacer(minLength: 0)
                        OnboardingCopyButton(value: address, describes: "your address")
                    }
                    Text(HexDisplay.grouped(address))
                        .font(.figure(16, weight: .medium))
                        .foregroundStyle(OnboardingPalette.heading)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Your address, \(HexDisplay.spelled(address))")
                }
            }
        }
    }

    private func failure(_ reason: String) -> some View {
        VStack(spacing: Theme.Space.md) {
            OnboardingTitle(headline: "That did not work", subhead: reason)
        }
    }

    // MARK: - Work
    //
    // Generation is the same two operations the previous screen performed, in the same order,
    // with the same APIs. The only addition is a minimum duration so the moment is legible.

    private func run() async {
        guard !started else { return }
        started = true

        let beat: Duration = reduceMotion ? .milliseconds(450) : .milliseconds(1_500)
        let clock = ContinuousClock()
        let began = clock.now

        guard let key = Self.generateKey() else {
            phase = .failed("This device would not produce secure random bytes, so no key was created.")
            OnboardingHaptics.failure()
            return
        }

        // Stage two, announced honestly: the address really is derived after the bytes exist.
        if !reduceMotion {
            try? await Task.sleep(for: .milliseconds(650))
            withAnimation(.easeInOut(duration: 0.25)) { phase = .deriving }
        } else {
            phase = .deriving
        }

        let address: String
        do {
            address = try Keystore.address(of: key)
        } catch {
            phase = .failed("The address could not be derived from the new key.")
            OnboardingHaptics.failure()
            return
        }

        onReady(key, address)

        guard !holdForCapture else { return }

        let elapsed = began.duration(to: clock.now)
        if elapsed < beat { try? await Task.sleep(for: beat - elapsed) }

        OnboardingHaptics.success()
        if reduceMotion {
            phase = .revealed(address: address)
        } else {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.78)) {
                phase = .revealed(address: address)
            }
        }
        // Move VoiceOver to the reveal rather than leaving focus on a label that no longer exists.
        UIAccessibility.post(notification: .screenChanged, argument: nil)
    }

    private func restart() {
        started = false
        phase = .entropy
        Task { await run() }
    }

    /// 32 bytes from the system CSPRNG. Kept static so the screenshot hook can mint a throwaway
    /// wallet without duplicating the call.
    static func generateKey() -> Data? {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
        guard status == errSecSuccess else { return nil }
        return Data(bytes)
    }
}

// MARK: - Forming rings
//
// Three trimmed violet arcs turning at different speeds around the mark: enough motion to read
// as work happening, no spinner cliché, and nothing that claims to be a progress measurement.
// Every arc is trimmed, so none of them ever closes into a plate behind the mark, and the soft
// white-on-violet core the dark build used is gone — on a light page it only muddied the mark.
// Reduce Motion keeps the composition and drops every rotation.

private struct FormingRings: View {
    let spin: Bool
    let reduceMotion: Bool

    var body: some View {
        ZStack {
            ring(diameter: 176, trim: 0.62, width: 2.0, tint: Self.quiet, clockwise: true, factor: 1)
            ring(diameter: 140, trim: 0.34, width: 2.5, tint: Self.loud, clockwise: false, factor: 1.6)
            ring(diameter: 110, trim: 0.78, width: 2.0, tint: Self.faint, clockwise: true, factor: 2.4)

            // The same mark the welcome screen shows, so the three beats of setup are one object
            // changing: the brand, then the work, then your address.
            MarenBrandMark(size: 76)
        }
    }

    /// Three steps of the brand violet, mixed towards the page rather than faded out with alpha,
    /// so a quiet arc is a lighter violet and never a grey ghost.
    private static let loud = Color(hex: 0x5B3DF5)
    private static let quiet = Color(hex: 0xA894FA)
    private static let faint = Color(hex: 0xCFC5FD)

    private func ring(diameter: CGFloat, trim: CGFloat, width: CGFloat,
                      tint: Color, clockwise: Bool, factor: Double) -> some View {
        Circle()
            .trim(from: 0, to: trim)
            .stroke(tint, style: StrokeStyle(lineWidth: width, lineCap: .round))
            .frame(width: diameter, height: diameter)
            .rotationEffect(.degrees(reduceMotion ? (clockwise ? 0 : 140)
                                     : (spin ? (clockwise ? 360 : -360) * factor : 0)))
    }
}

// MARK: - Copy control for the onboarding world
//
// The app's shared CopyButton carries its own layout assumptions; this is the same behaviour —
// pasteboard, success haptic, spoken "Copied", a glyph that reverts after a beat — wearing the
// onboarding violet-wash chip so it sits right inside a card.

struct OnboardingCopyButton: View {
    let value: String
    var describes: String
    var title: String = "Copy"

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: copy) {
            OnboardingChipLabel(symbol: copied ? "checkmark" : "doc.on.doc",
                                title: copied ? "Copied" : title)
                .frame(minHeight: 44)     // 44pt touch target around a 34pt chip
                .contentShape(Rectangle())
        }
        .buttonStyle(OnboardingPressStyle())
        .accessibilityLabel(copied ? "Copied" : "Copy \(describes)")
    }

    private func copy() {
        UIPasteboard.general.string = value
        OnboardingHaptics.success()
        UIAccessibility.post(notification: .announcement, argument: "Copied")
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { copied = true }

        resetTask?.cancel()
        resetTask = Task {
            try? await Task.sleep(for: .milliseconds(1_600))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { copied = false }
            }
        }
    }
}
