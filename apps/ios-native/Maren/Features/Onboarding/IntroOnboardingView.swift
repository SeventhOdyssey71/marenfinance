import SwiftUI

// MARK: - Intro onboarding (first-run only)
//
// The very first thing a new person sees: a brief splash on the Maren violet gradient, then a
// short paged story about what the app honestly does — spend Bitcoin without selling it,
// gasless writes, live on-chain reads — ending on a non-custodial "you hold the keys" screen.
// Its single job is to hand off to the real key-setup flow (OnboardingView): "Get started"
// just marks onboarding done, and RootView then shows wallet creation because no wallet exists
// yet. No fake accounts, no data, no security decisions live here.
//
// Shown once and never again (RootView persists a `hasOnboarded` flag). The whole screen
// commits to one deliberate look — a violet→near-black gradient with white content — so it does
// not follow the app's light theme; that is intentional, not an un-themed oversight.

struct IntroOnboardingView: View {
    /// Called when the person taps "Get started" or "Skip". RootView persists the flag and
    /// swaps to the real key-setup flow.
    var onComplete: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showSplash = true
    @State private var page = 0

    private let pages = IntroPage.all

    var body: some View {
        ZStack {
            IntroGradient().ignoresSafeArea()

            if showSplash {
                SplashContent()
                    .transition(reduceMotion
                                ? .opacity
                                : .opacity.combined(with: .scale(scale: 1.05)))
            } else {
                pager
                    .transition(.opacity)
            }
        }
        .task {
            // A brief splash, then reveal the story. Reduce Motion shortens it and drops the
            // scale so it simply cross-fades.
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.5 : 1.4))
            if reduceMotion { showSplash = false }
            else { withAnimation(.easeInOut(duration: 0.5)) { showSplash = false } }
        }
    }

    // MARK: paged story

    private var pager: some View {
        VStack(spacing: 0) {
            topBar
            TabView(selection: $page) {
                ForEach(Array(pages.enumerated()), id: \.offset) { index, item in
                    IntroPageView(page: item).tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            PageDots(count: pages.count, index: page)
                .padding(.bottom, Theme.Space.lg)

            IntroCTA(title: isLast ? "Get started" : "Continue", action: advance)
                .padding(.horizontal, Theme.Space.md)
                .padding(.bottom, Theme.Space.sm)
        }
    }

    private var topBar: some View {
        HStack {
            Spacer()
            // Hidden on the final screen — there is nothing left to skip past.
            if !isLast {
                Button("Skip", action: onComplete)
                    .font(.text(15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .padding(.horizontal, Theme.Space.sm)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
        }
        .padding(.horizontal, Theme.Space.sm)
        .frame(height: 48)
    }

    private var isLast: Bool { page == pages.count - 1 }

    private func advance() {
        guard !isLast else { onComplete(); return }
        if reduceMotion { page += 1 }
        else { withAnimation(.easeInOut(duration: 0.35)) { page += 1 } }
    }
}

// MARK: - Content model

private struct IntroPage: Identifiable {
    let id = UUID()
    let symbol: String
    let headline: String
    let subhead: String

    static let all: [IntroPage] = [
        IntroPage(
            symbol: "bitcoinsign.circle.fill",
            headline: "Spend Bitcoin,\nnever sell it",
            subhead: "Borrow MUSD against your BTC and keep every satoshi. Your Bitcoin stays yours."),
        IntroPage(
            symbol: "bolt.fill",
            headline: "Gasless by design",
            subhead: "Maren covers the network fee on your transactions. Only your very first deposit pays its own gas."),
        IntroPage(
            symbol: "checkmark.seal.fill",
            headline: "Honest by default",
            subhead: "Every figure is read live from the chain, and a receipt says done only when the blockchain does."),
        IntroPage(
            symbol: "lock.shield.fill",
            headline: "You hold the keys",
            subhead: "Maren is non-custodial. Your key is created on this device and stays in the Secure Enclave — never on our servers."),
    ]
}

// MARK: - One story screen

private struct IntroPageView: View {
    let page: IntroPage

    var body: some View {
        VStack(spacing: Theme.Space.xl) {
            Spacer(minLength: Theme.Space.lg)
            IconHalo(symbol: page.symbol)
            VStack(spacing: Theme.Space.md) {
                Text(page.headline)
                    .font(.display(34, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text(page.subhead)
                    .font(.text(16))
                    .foregroundStyle(.white.opacity(0.74))
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 320)
            }
            Spacer(minLength: Theme.Space.lg)
            Spacer()
        }
        .padding(.horizontal, Theme.Space.lg)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(page.headline.replacingOccurrences(of: "\n", with: " ")). \(page.subhead)")
    }
}

// MARK: - Illustration

private struct IconHalo: View {
    let symbol: String
    private let diameter: CGFloat = 132

    var body: some View {
        ZStack {
            Circle().fill(.white.opacity(0.10))
            Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
            Image(systemName: symbol)
                .font(.system(size: 56, weight: .medium))
                .foregroundStyle(.white)
        }
        .frame(width: diameter, height: diameter)
        .accessibilityHidden(true)
    }
}

// MARK: - Splash

private struct SplashContent: View {
    var body: some View {
        VStack(spacing: Theme.Space.lg) {
            MarkTile(size: 108)
            Text("Maren")
                .font(.display(30, weight: .semibold))
                .foregroundStyle(.white)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Maren")
    }
}

/// The real MarenMark asset on a white app-icon tile — high contrast on the violet gradient,
/// where the violet mark alone would disappear. Concentric radius: tile corner scales with
/// size, the mark is inset so its own rounding never fights the tile's.
private struct MarkTile: View {
    var size: CGFloat = 108

    var body: some View {
        Image("MarenMark")
            .resizable()
            .scaledToFit()
            .padding(size * 0.22)
            .frame(width: size, height: size)
            .background(.white, in: RoundedRectangle(cornerRadius: size * 0.26, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Page dots

private struct PageDots: View {
    let count: Int
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(.white.opacity(i == index ? 0.95 : 0.30))
                    .frame(width: i == index ? 22 : 7, height: 7)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: index)
        .accessibilityHidden(true)
    }
}

// MARK: - CTA
//
// A white pill with violet text — the one high-contrast focal control on the gradient. The app's
// PillButton primary is a violet fill, which would vanish here, so this is its light counterpart.

private struct IntroCTA: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.text(17, weight: .medium))
                .foregroundStyle(Theme.Palette.accent)
                .frame(maxWidth: .infinity, minHeight: 54)
                .background(.white, in: Capsule())
        }
        .buttonStyle(IntroCTAStyle())
    }
}

private struct IntroCTAStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect((configuration.isPressed && !reduceMotion) ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: - Background

/// The Maren brand gradient: violet (the logo/accent) deepening into a near-black violet.
/// A single committed look, not theme-reactive.
private struct IntroGradient: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(hex: 0x6E4BFF), location: 0.0),
                .init(color: Color(hex: 0x5B3DF5), location: 0.42),
                .init(color: Color(hex: 0x2A1E52), location: 0.78),
                .init(color: Color(hex: 0x141019), location: 1.0),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
