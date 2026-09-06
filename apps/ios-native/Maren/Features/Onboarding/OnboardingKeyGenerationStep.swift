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
                    // up the weight of the orb it just replaced — same diameter, same optical
                    // centre — so the swap reads as one object resolving rather than a cut.
                    GeneratedAvatar(seed: address, size: 104)
                        .overlay(Circle().strokeBorder(.white, lineWidth: 3))
                        .softCardShadow()
                }
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.86)))
            } else {
                FormingOrb(reduceMotion: reduceMotion)
                    .transition(.opacity)
            }
        }
        .frame(height: 200)
        .accessibilityHidden(true)
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

// MARK: - Forming orb
//
// The beat that replaced three trimmed arcs turning around the mark. Rings were read as a
// spinner, and a spinner is a promise about duration that this screen cannot keep.
//
// What is here instead is a SPHERE: ~760 points laid out along meridian lines on a unit sphere,
// spun about a tilted axis and projected orthographically into a 146pt disc. Nothing about it is
// a loading indicator — it is one object, turning, while the device does real work.
//
// Why it reads as a sphere and not as a flat circle of dots
// --------------------------------------------------------
// Four cues, all of which fall out of the projection rather than being drawn on:
//
//   PARALLAX. Points on the near face sweep across the disc quickly; points near the silhouette
//   crawl, because their motion is mostly along the view axis. That difference in apparent speed
//   across one frame is the strongest depth cue the eye has, and it is the reason this cannot be
//   mistaken for a rotating 2D pattern.
//   SIZE. Dot radius runs 0.7pt at the back to 1.9pt at the front, so the far face is finer.
//   OCCLUSION BY FADE. There is no depth buffer, so the far face is not hidden — it is faded to
//   ~8% instead. Two densities of point at once is what a sphere of dots actually looks like.
//   LIGHT. A fixed lamp up and to the left lifts the points facing it, so the body has a lit
//   flank and a falling one instead of being uniformly violet.
//
// The meridian layout matters: latitude lines would draw a set of nested ellipses, which reads
// as a flat target. Meridians converge at the poles, and the poles are tilted 21° toward the
// viewer, so their convergence is visible as a point ON THE SURFACE rather than at the rim.
//
// Cost. One `Canvas`, ~760 point transforms and TEN fill calls per frame — the points are
// bucketed by their final opacity and each bucket is one path. No per-point SwiftUI view, no
// per-point animation, nothing in the view graph that a frame tick has to diff.

private struct FormingOrb: View {
    var diameter: CGFloat = 152
    let reduceMotion: Bool

    var body: some View {
        Group {
            if reduceMotion {
                // Not a slowed orb: no TimelineView is built at all, so there is no clock and
                // nothing to invalidate. One still, lit frame of the same sphere.
                OrbSphere(turn: OrbGeometry.stillTurn)
            } else {
                TimelineView(.animation) { context in
                    OrbSphere(turn: OrbGeometry.turn(at: context.date))
                }
            }
        }
        .frame(width: diameter, height: diameter)
    }
}

/// The sphere itself: geometry that never changes, held once, plus the two angles that do.
private enum OrbGeometry {
    /// One full revolution every 13 seconds. Slow enough to read as a body turning rather than
    /// as a thing being spun, and slow enough that a 1.5s screen is only ever a slice of a turn.
    static let period: Double = 13

    /// Measured from first use rather than from the reference date, so the numbers stay small
    /// and the phase is shared by anything else that asks.
    private static let epoch = Date.timeIntervalSinceReferenceDate

    static func turn(at date: Date) -> Double {
        let elapsed = date.timeIntervalSinceReferenceDate - epoch
        return (elapsed / period).truncatingRemainder(dividingBy: 1) * 2 * .pi
    }

    /// The frozen frame for Reduce Motion. Chosen, not arbitrary: at 0.62rad a meridian runs
    /// down the centre of the lit flank and the near pole is clear of the silhouette, so the
    /// still frame still reads as a sphere. A frame with a meridian exactly on the rim reads as
    /// a circle with a line through it.
    static let stillTurn: Double = 0.62

    /// The spin axis leans toward the viewer, so the near pole sits well inside the disc and the
    /// far one falls behind the body where the fade swallows it. At a shallower lean both poles
    /// land on the rim and the meridians fan out of the silhouette at top and bottom, which
    /// reads as a wireframe drawing rather than as a solid.
    static let tilt: Double = 21 * .pi / 180

    /// Lamp direction in the sphere's own space: up, to the left, and toward the viewer.
    static let light = SIMD3<Double>(-0.42, 0.55, 0.72)

    /// Unit-sphere positions, built once. 24 meridians of 32 points, staggered a half step on
    /// alternate meridians so the layout does not resolve into a rectangular grid, plus the two
    /// poles the meridians converge on.
    ///
    /// The grain is deliberately fine: coarser dots on fewer lines read as a beach ball, and a
    /// beach ball is a toy. At ~6.5pt spacing along a meridian and a 3.8pt dot at the front, the
    /// line is legible AS a line and the sphere is legible as a surface.
    static let points: [SIMD3<Double>] = {
        let meridians = 24
        let perMeridian = 32
        // Stop short of the poles: the last few latitudes crowd into a knot that reads as a
        // blob rather than as convergence. The two pole dots close the lines instead.
        let latMax = 80.0 * .pi / 180

        var out: [SIMD3<Double>] = []
        out.reserveCapacity(meridians * perMeridian + 2)

        for i in 0..<meridians {
            let lon = 2 * .pi * Double(i) / Double(meridians)
            let sinLon = sin(lon), cosLon = cos(lon)
            let stagger = i.isMultiple(of: 2) ? 0.0 : 0.5
            for j in 0..<perMeridian {
                let f = (Double(j) + stagger) / Double(perMeridian - 1)
                guard f <= 1 else { continue }
                let lat = -latMax + 2 * latMax * f
                let cosLat = cos(lat)
                out.append(SIMD3(cosLat * sinLon, sin(lat), cosLat * cosLon))
            }
        }
        out.append(SIMD3(0, 1, 0))
        out.append(SIMD3(0, -1, 0))
        return out
    }()
}

/// One frame of the sphere. Split from `FormingOrb` so the still path and the animated path are
/// provably the same drawing, differing only in where the angle comes from.
private struct OrbSphere: View {
    let turn: Double

    /// Opacity is quantised into this many steps so the whole sphere is drawn in this many fill
    /// calls. Ten steps is well under what the eye can separate on a 2pt dot.
    private static let bucketCount = 10

    /// Back of the sphere is a pale lilac, front is the brand violet. Mixed in colour rather
    /// than only faded, so a far point is a lighter violet and never a grey ghost — the same
    /// rule the rest of the onboarding world follows.
    private static let shades: [Color] = (0..<bucketCount).map { i in
        let f = (Double(i) + 0.5) / Double(bucketCount)
        let back = (r: 0.725, g: 0.663, b: 0.984)   // #B9A9FB
        let front = (r: 0.294, g: 0.165, b: 0.910)  // #4B2AE8
        return Color(
            .sRGB,
            red: back.r + (front.r - back.r) * f,
            green: back.g + (front.g - back.g) * f,
            blue: back.b + (front.b - back.b) * f,
            opacity: f
        )
    }

    var body: some View {
        Canvas(opaque: false, colorMode: .linear, rendersAsynchronously: false) { context, size in
            let side = min(size.width, size.height)
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            // Room for the outermost dot's radius so the silhouette is never clipped.
            let radius = side / 2 - 3
            guard radius > 4 else { return }

            // A soft violet core under the points, so the sphere has an inside and the middle of
            // the disc is not a hole. Drawn on a circle wider than the sphere, with the gradient
            // reaching zero at that circle's own edge, so there is no visible cut anywhere.
            let bloomRadius = radius * 1.24
            let bloom = Gradient(stops: [
                .init(color: Color(hex: 0x6E4BFF).opacity(0.14), location: 0.00),
                .init(color: Color(hex: 0x6E4BFF).opacity(0.075), location: 0.42),
                .init(color: Color(hex: 0x6E4BFF).opacity(0.00), location: 1.00),
            ])
            context.fill(
                Path(ellipseIn: CGRect(x: centre.x - bloomRadius, y: centre.y - bloomRadius,
                                       width: bloomRadius * 2, height: bloomRadius * 2)),
                with: .radialGradient(bloom, center: centre, startRadius: 0, endRadius: bloomRadius)
            )

            let cosTurn = cos(turn), sinTurn = sin(turn)
            let cosTilt = cos(OrbGeometry.tilt), sinTilt = sin(OrbGeometry.tilt)
            let light = OrbGeometry.light
            // Dot sizes are quoted against a 66pt sphere, then scaled, so the orb is optically
            // the same object at any diameter a call site asks for.
            let dotScale = radius / 66

            var buckets = [Path](repeating: Path(), count: Self.bucketCount)

            for p in OrbGeometry.points {
                // Spin about the sphere's own vertical axis...
                let x = p.x * cosTurn + p.z * sinTurn
                let zSpun = p.z * cosTurn - p.x * sinTurn
                // ...then lean that axis toward the viewer.
                let y = p.y * cosTilt - zSpun * sinTilt
                let z = p.y * sinTilt + zSpun * cosTilt

                // 0 at the far pole of the view axis, 1 at the near one. Raised to 1.5 so the
                // fall-off is weighted toward the back and the near face stays crisp.
                let front = (z + 1) / 2
                let depth = front * front.squareRoot()
                // The point is on a unit sphere, so its position IS its surface normal.
                let lambert = max(0, x * light.x + y * light.y + z * light.z)

                let alpha = min(1, (0.08 + 0.87 * depth) * (0.68 + 0.42 * lambert))
                let bucket = min(Self.bucketCount - 1, max(0, Int(alpha * Double(Self.bucketCount))))

                let dot = CGFloat(0.62 + 1.10 * depth) * dotScale
                let cx = centre.x + CGFloat(x) * radius
                // Screen y grows downward; the sphere's does not.
                let cy = centre.y - CGFloat(y) * radius
                buckets[bucket].addEllipse(in: CGRect(x: cx - dot, y: cy - dot,
                                                      width: dot * 2, height: dot * 2))
            }

            // Far side first, so where a near dot and a far dot overlap the near one wins.
            for i in 0..<Self.bucketCount where !buckets[i].isEmpty {
                context.fill(buckets[i], with: .color(Self.shades[i]))
            }
        }
        .accessibilityHidden(true)
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
