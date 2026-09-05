import SwiftUI

// MARK: - Intro onboarding (first-run only)
//
// The very first thing a new person sees: a brief splash on the Maren gradient, then a short
// paged story about what the app honestly does — spend Bitcoin without selling it, gasless
// writes, live on-chain reads — ending on a non-custodial "you hold the keys" screen. Its single
// job is to hand off to the real key-setup flow (OnboardingView): "Get started" just marks
// onboarding done, and RootView then shows wallet creation because no wallet exists yet. No fake
// accounts, no data, no security decisions live here.
//
// Shown once and never again (RootView persists a `hasOnboarded` flag). It is the app's own
// light world from the first frame: a violet wash across the top of the page falling into white,
// with ink type on white.
//
// The gradient, the mark, the violet CTA and the page dots all come from OnboardingChrome, which
// the key-setup flow builds from too, so "Get started" is a cut inside one continuous world
// rather than a jump between two screens that merely happen to share a colour.

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
            OnboardingGradient().ignoresSafeArea()

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
        // The onboarding world is light on every device, whatever the system appearance is set
        // to — so the page, and any system chrome drawn over it, stay one thing.
        .preferredColorScheme(.light)
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

            OnboardingDots(count: pages.count, index: page)
                .padding(.bottom, Theme.Space.lg)

            OnboardingCTA(title: isLast ? "Get started" : "Continue", action: advance)
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
                    .foregroundStyle(OnboardingPalette.heading)
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
            OnboardingSymbolFocal(symbol: page.symbol)
            VStack(spacing: Theme.Space.md) {
                Text(page.headline)
                    .font(.rounded(34, weight: .semibold))
                    .foregroundStyle(OnboardingPalette.heading)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Text(page.subhead)
                    .font(.text(16, weight: .medium))
                    .foregroundStyle(OnboardingPalette.body)
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

// MARK: - Splash

private struct SplashContent: View {
    var body: some View {
        // The mark alone, at size, on the background. No circle, no plate, no wordmark beside
        // it: the first thing anyone sees is the symbol, and the name is on the very next screen.
        MarenBrandMark(size: 140)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Maren")
    }
}
