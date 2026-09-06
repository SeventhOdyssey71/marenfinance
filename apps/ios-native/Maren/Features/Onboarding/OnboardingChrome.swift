import SwiftUI
import UIKit

// MARK: - Onboarding chrome
//
// The shared vocabulary of the onboarding world: one gradient, one mark, one violet CTA, one
// white card, one step bar, one set of haptics. The intro story (IntroOnboardingView) and the
// key flow (OnboardingView and its steps) both build from these, so the hand-off from the last
// story page to "Create a new wallet" is a cut inside one continuous world rather than a jump
// between two screens that happen to share a colour.
//
// The world is LIGHT, and it is the same light world the app proper lives in: a violet wash at
// the very top of the page falling into white, ink type on white, and a violet accent that is
// used for the one thing you are meant to touch. Hierarchy is carried by weight and tone, never
// by opacity — the previous dark build expressed secondary text as white at 0.58–0.74 alpha and
// it read as thin and unfinished. Nothing here is theme-reactive, and nothing here touches key
// material.

// MARK: - Palette
//
// Semantic names for the roles this flow needs, all resolving to the app's own tokens so the
// onboarding world and the app world cannot drift apart. `caption` and `track` are the only two
// values that do not already exist in Theme: a slightly cooler grey for footnotes, and the rail
// colour for an unfilled step.

enum OnboardingPalette {
    /// Headlines and any text that has to be read first.
    static let heading = Theme.Palette.ink          // #101013
    /// Body and supporting copy. 5.1:1 on white — comfortably past AA.
    static let body = Theme.Palette.muted           // #6E6E6E
    /// Footnotes and field labels. 4.9:1 on white.
    static let caption = Color(hex: 0x6E6E7A)
    /// Placeholder text only — never used for content.
    static let placeholder = Theme.Palette.tertiary // #9A9AA2
    /// The one thing you are meant to touch.
    static let accent = Theme.Palette.accent        // #5B3DF5
    /// Brand violet as small text, darkened to hold AA on the violet wash chips.
    static let accentInk = Theme.Palette.accentText // #4A2BE0
    /// A faint violet chip behind Copy / Paste.
    static let accentWash = Theme.Palette.accentWash // #EDEAFF
    /// The quiet second choice.
    static let quiet = Theme.Palette.inset          // #F1F0F6
    /// An unfilled step rail or page dot.
    static let track = Color(hex: 0xD9D7E3)
}

// MARK: - Background

/// The Maren brand gradient: a decorative violet wash across the very top of the page, falling
/// into white by the time it reaches anything you have to read. Every content region — the mark,
/// the headline, the body, the buttons, the footnote — lands on near-white or white.
struct OnboardingGradient: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(hex: 0x6E4BFF), location: 0.00),
                .init(color: Color(hex: 0xA38FFF), location: 0.18),
                .init(color: Color(hex: 0xEDE9FF), location: 0.38),
                .init(color: Color(hex: 0xFFFFFF), location: 0.60),
                .init(color: Color(hex: 0xFFFFFF), location: 1.00),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Mark

/// The Maren mark alone, sitting straight on the background. No circle, no plate, no ring, no
/// border: the page is light, so the mark has something to contrast against and needs nothing
/// behind it to hold it up.
///
/// This uses `MarenMarkViolet`, not the primary `MarenMark`. The primary cut carries the logo's
/// violet-to-WHITE gradient, which is right on a violet field and wrong here: on a white page its
/// tip fades into the paper and the glyph reads as though it were clipped. `MarenMarkViolet` is
/// the same silhouette filled violet-to-lighter-violet along the same diagonal, so it keeps the
/// artwork's direction but never reaches white and cannot dissolve.
/// `size` is the width the glyph is fitted into; the asset is trimmed to its own bounds, so that
/// is the size you actually see.
struct MarenBrandMark: View {
    var size: CGFloat = 96

    var body: some View {
        Image("MarenMarkViolet")
            .resizable()
            .scaledToFit()
            .frame(width: size)
            // The mark is the one object the whole flow is built around, so it is the one thing
            // that is alive: a real Metal shader turns the flat violet cut into a piece of glass
            // with light moving through it. See DesignSystem/LiquidGlass.swift — Reduce Motion
            // freezes it on a lit still, and a device that cannot compile the shader gets exactly
            // the artwork above.
            .liquidGlass(.brand)
            .accessibilityHidden(true)
    }
}

// MARK: - Focal element
//
// One focal element per screen, at one shared diameter so every screen in the flow has the same
// optical centre. It is a size and nothing else — no disc, no ring, no bloom. On a light page a
// translucent plate behind a symbol only muddies it.

struct OnboardingFocal<Content: View>: View {
    var diameter: CGFloat = 132
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(width: diameter, height: diameter)
    }
}

/// The common case: an SF Symbol, in brand violet, at the focal size.
struct OnboardingSymbolFocal: View {
    let symbol: String
    var diameter: CGFloat = 132
    var symbolSize: CGFloat = 56

    var body: some View {
        OnboardingFocal(diameter: diameter) {
            Image(systemName: symbol)
                .font(.system(size: symbolSize, weight: .medium))
                .foregroundStyle(OnboardingPalette.accent)
                // The same glass as the mark, dialled back: an SF Symbol has to be read as an
                // ICON first, so it takes less refraction than the brand cut does.
                .liquidGlass(.symbol)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Card
//
// The card surface, identical to the app's: a white face separated from the page by a soft
// shadow and never by an outline.

struct OnboardingCard<Content: View>: View {
    var padding: CGFloat = Theme.Space.md
    var radius: CGFloat = Theme.Radius.card
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .softCardShadow()
    }
}

// MARK: - Buttons
//
// A solid violet pill with white text is the one high-contrast focal control on the page — the
// same primary the app uses, so the CTA never changes species halfway through setup. Both pills
// are 54pt tall, comfortably past the 44pt minimum target.

struct OnboardingCTA: View {
    let title: String
    var icon: String? = nil
    var enabled: Bool = true
    var busy: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                        .accessibilityHidden(true)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.text(17, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(OnboardingPalette.accent, in: Capsule())
            .softCardShadow()
        }
        .buttonStyle(OnboardingPressStyle())
        .disabled(!enabled || busy)
    }
}

/// The quiet second choice: the app's soft-grey pill. Never a bare text link — the two choices
/// on the welcome screen are both real, tappable pills with the same height.
struct OnboardingGhostButton: View {
    let title: String
    var icon: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .semibold))
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.text(17, weight: .semibold))
            }
            .foregroundStyle(OnboardingPalette.heading)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(OnboardingPalette.quiet, in: Capsule())
        }
        .buttonStyle(OnboardingPressStyle())
    }
}

/// The smallest voice: plain muted-ink text, still with a 44pt target.
struct OnboardingTextButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.text(15, weight: .medium))
                .foregroundStyle(OnboardingPalette.body)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(OnboardingPressStyle())
    }
}

/// A small violet-wash chip: Copy, Paste. Text-safe violet on a faint violet field (6.6:1).
struct OnboardingChipLabel: View {
    let symbol: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .contentTransition(.symbolEffect(.replace))
                .accessibilityHidden(true)
            Text(title)
        }
        .font(.text(13, weight: .semibold))
        .foregroundStyle(OnboardingPalette.accentInk)
        .padding(.horizontal, 14)
        .frame(minHeight: 34)
        .background(OnboardingPalette.accentWash, in: Capsule())
    }
}

struct OnboardingPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(isEnabled ? 1 : Theme.Opacity.disabled)
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: - Page dots (the intro story)

struct OnboardingDots: View {
    let count: Int
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i == index ? OnboardingPalette.accent : OnboardingPalette.track)
                    .frame(width: i == index ? 22 : 7, height: 7)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: index)
        .accessibilityHidden(true)
    }
}

// MARK: - Step bar
//
// Setup progress as a row of thin rails, one per step, filling left to right. Quieter than a
// "Step 2 of 4" label and still legible at a glance; the spoken version is on the header, so
// VoiceOver gets the count in words rather than a decorative bar.
//
// The filled rail is INK, not the brand violet the page dots use. The header is the one region
// the gradient still tints, and violet-on-violet would vanish there; ink holds 5:1 on the wash
// and 19:1 once a shorter screen drops the bar onto white.

struct OnboardingStepBar: View {
    let count: Int
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(i <= index ? OnboardingPalette.heading : OnboardingPalette.track)
                    .frame(height: 3)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: index)
        .accessibilityHidden(true)
    }
}

// MARK: - Screen scaffold
//
// Every step screen is: an optional back button and step bar, a scrolling body, and a footer
// that stays put above the keyboard. Keeping the footer in a `safeAreaInset` is what makes the
// name step keyboard-aware without any manual keyboard maths.

struct OnboardingScreen<Body: View, Footer: View>: View {
    var onBack: (() -> Void)? = nil
    var stepCount: Int = 0
    var stepIndex: Int = 0
    /// Spoken progress, e.g. "Step 2 of 4". Announced on the header rather than drawn twice.
    var progressLabel: String? = nil
    @ViewBuilder var content: Body
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(spacing: 0) {
            header
            // The body is centred in whatever height is left over, so a short step does not
            // sit jammed under the header with a hole above the footer. Measuring the leftover
            // area (rather than the screen) is also what keeps the centring honest when the
            // keyboard shrinks the stack on the name and key steps.
            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: Theme.Space.lg) {
                        content
                    }
                    .padding(.horizontal, Theme.Space.lg)
                    .padding(.vertical, Theme.Space.md)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }
            VStack(spacing: Theme.Space.sm) { footer }
                .padding(.horizontal, Theme.Space.lg)
                .padding(.top, Theme.Space.sm)
                .padding(.bottom, Theme.Space.sm)
        }
    }

    private var header: some View {
        HStack(spacing: Theme.Space.md) {
            if let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OnboardingPalette.heading)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(OnboardingPressStyle())
                .accessibilityLabel("Go back")
            } else {
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            }

            if stepCount > 1 {
                OnboardingStepBar(count: stepCount, index: stepIndex)
                    .frame(maxWidth: 180)
                    .accessibilityElement()
                    .accessibilityLabel(progressLabel ?? "Step \(stepIndex + 1) of \(stepCount)")
            } else {
                Spacer(minLength: 0)
            }

            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
        }
        .padding(.horizontal, Theme.Space.sm)
        .frame(height: 48)
    }
}

// MARK: - Titles

/// The one headline + one subhead pairing every step uses, combined into a single VoiceOver
/// element so the screen reads as a sentence instead of two fragments. The subhead is Medium,
/// not Light: it is the sentence that explains what a wallet is, and it has to be readable.
struct OnboardingTitle: View {
    let headline: String
    var subhead: String? = nil
    var alignment: TextAlignment = .center

    var body: some View {
        VStack(spacing: Theme.Space.sm) {
            Text(headline)
                .font(.rounded(32, weight: .semibold))
                .foregroundStyle(OnboardingPalette.heading)
                .multilineTextAlignment(alignment)
                .fixedSize(horizontal: false, vertical: true)
            if let subhead {
                Text(subhead)
                    .font(.text(16, weight: .medium))
                    .foregroundStyle(OnboardingPalette.body)
                    .multilineTextAlignment(alignment)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 330)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel([headline.replacingOccurrences(of: "\n", with: " "), subhead]
            .compactMap { $0 }.joined(separator: ". "))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Notes
//
// Status is never carried by colour alone: each note pairs a glyph with its words. The tones are
// the app's own semantic colours, all of which are the darkened AA-on-white variants.

struct OnboardingNote: View {
    enum Tone { case neutral, good, caution, bad }

    let text: String
    var symbol: String = "info.circle"
    var tone: Tone = .neutral

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(glyphTint)
                .accessibilityHidden(true)
            Text(text)
                .font(.text(14, weight: .medium))
                .foregroundStyle(OnboardingPalette.body)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    private var glyphTint: Color {
        switch tone {
        case .neutral: return OnboardingPalette.body       // #6E6E6E
        case .good: return Theme.Palette.success           // #0F9D6A
        case .caution: return Theme.Palette.warning        // #B45309
        case .bad: return Theme.Palette.danger             // #DC2626
        }
    }
}

// MARK: - Field
//
// One large rounded field per step, on a white card. `.figure` (SF Pro Rounded, monospaced
// digits) for anything hex, Neue Montreal for words. Focus is shown with a violet ring, because
// the card itself is borderless and there would otherwise be nothing to show it on.

struct OnboardingField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var mono: Bool = false
    var axis: Axis = .horizontal
    var autocapitalization: TextInputAutocapitalization = .never
    var submitLabel: SubmitLabel = .continue
    var showsPaste: Bool = false
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        OnboardingCard(padding: Theme.Space.md, radius: Theme.Radius.card) {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack(spacing: Theme.Space.sm) {
                    Text(label)
                        .font(.text(13, weight: .medium))
                        .foregroundStyle(OnboardingPalette.caption)
                    Spacer(minLength: 0)
                    if showsPaste {
                        Button {
                            if let clip = UIPasteboard.general.string {
                                text = clip.trimmingCharacters(in: .whitespacesAndNewlines)
                                OnboardingHaptics.tap()
                            }
                        } label: {
                            OnboardingChipLabel(symbol: "doc.on.clipboard", title: "Paste")
                                .frame(minHeight: 44)     // 44pt touch target around a 34pt chip
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(OnboardingPressStyle())
                        .accessibilityLabel("Paste from the clipboard")
                    }
                }
                TextField("", text: $text, axis: axis)
                    .placeholderOverlay(placeholder, mono: mono, visible: text.isEmpty)
                    .font(mono ? .figure(17, weight: .medium) : .text(22, weight: .medium))
                    .foregroundStyle(OnboardingPalette.heading)
                    .tint(OnboardingPalette.accent)
                    .textInputAutocapitalization(autocapitalization)
                    .autocorrectionDisabled()
                    .submitLabel(submitLabel)
                    .focused($focused)
                    .onSubmit(onSubmit)
                    .accessibilityLabel(label)
                    .frame(minHeight: 34, alignment: .leading)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .strokeBorder(focused ? OnboardingPalette.accent : .clear, lineWidth: 2)
                .allowsHitTesting(false)
        }
        .onAppear { focused = true }
    }
}

private extension View {
    /// SwiftUI's own placeholder inherits the field's font but not its colour, and the default
    /// grey is neither the app's nor reliably legible. This draws it explicitly, at the same
    /// weight as the value so the field does not change shape when you start typing.
    @ViewBuilder func placeholderOverlay(_ text: String, mono: Bool, visible: Bool) -> some View {
        overlay(alignment: .leading) {
            if visible {
                Text(text)
                    .font(mono ? .figure(17, weight: .medium) : .text(22, weight: .medium))
                    .foregroundStyle(OnboardingPalette.placeholder)
                    .allowsHitTesting(false)
            }
        }
    }
}

// MARK: - Haptics
//
// One vocabulary for the whole flow so a step, a success and a refusal never feel alike:
//   tap      — a choice was taken
//   step     — the flow advanced
//   success  — something real now exists (a wallet, a stored key)
//   warning  — you chose the honest lesser path (skipped backup, session-only key)
//   failure  — the input was refused

@MainActor
enum OnboardingHaptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func step() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func reveal() { UIImpactFeedbackGenerator(style: .rigid).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func failure() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

// MARK: - Step transition

extension AnyTransition {
    /// Forward/back paging between steps. Reduce Motion collapses it to a cross-fade.
    static func onboardingStep(reduceMotion: Bool) -> AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }
}

// MARK: - Hex formatting
//
// Addresses and keys are read by eye in chunks. Grouping into fours makes a mistyped or
// mismatched character findable; the value copied to the pasteboard is always the raw string.

enum HexDisplay {
    static func grouped(_ value: String, size: Int = 4) -> String {
        var body = value
        var prefix = ""
        if body.hasPrefix("0x") || body.hasPrefix("0X") {
            prefix = String(body.prefix(2))
            body = String(body.dropFirst(2))
        }
        let chunks = stride(from: 0, to: body.count, by: size).map { offset -> String in
            let start = body.index(body.startIndex, offsetBy: offset)
            let end = body.index(start, offsetBy: min(size, body.count - offset))
            return String(body[start..<end])
        }
        return prefix.isEmpty ? chunks.joined(separator: " ") : prefix + " " + chunks.joined(separator: " ")
    }

    /// A spoken form for VoiceOver: characters separated so "0xB4" is not read as a word.
    static func spelled(_ value: String) -> String {
        value.map(String.init).joined(separator: " ")
    }
}
