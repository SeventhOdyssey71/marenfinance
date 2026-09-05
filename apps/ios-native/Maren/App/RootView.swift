import SwiftUI

// MARK: - App shell
//
// Four tabs — Home · Finance · Activity · Profile — with a pink active tint, wrapped in the
// biometric unlock gate. A consumer money app: clean, simple, easy. The AppRouter lets one
// screen send you to another (Home's Borrow/Earn jump to Finance).

struct RootView: View {
    @State private var session = MarenSession()
    @State private var router = AppRouter()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// First-run intro. Shown once, then persisted so it never returns. This is a UI flag only —
    /// no key, no wallet state — so UserDefaults is the right home for it.
    @AppStorage("hasOnboarded") private var hasOnboarded = false
    /// A screenshot/testing hook: `MAREN_SCREEN` preselects a tab and, for pay flows, presents
    /// the sheet at launch. Absent in normal use, so it changes nothing for a real user.
    @State private var launchDestination: PayDestination?
    private let launchScreen = ScreenshotHooks.screen

    /// The intro gates the very first launch, ahead of the wallet gate. It is bypassed for the
    /// screenshot/demo hooks (which expect the shell or a specific screen), and can be forced on
    /// with `MAREN_SCREEN=intro` to capture it. Both hooks are DEBUG-only, so in Release this is
    /// simply `!hasOnboarded`.
    private var showIntro: Bool {
        if launchScreen == "intro" { return true }
        return !hasOnboarded && !ScreenshotHooks.isCapturing
    }

    var body: some View {
        @Bindable var router = router
        return Group {
            if showIntro {
                IntroOnboardingView { hasOnboarded = true }
            } else if session.hasWallet {
                UnlockGate {
                    ZStack(alignment: .bottom) {
                        // All four tabs stay in the hierarchy so switching preserves scroll and
                        // model state; only the selected one is visible and receives touches.
                        ZStack {
                            tab(.home) { HomeView() }
                            tab(.finance) { FinanceView() }
                            tab(.activity) { ActivityView() }
                            tab(.profile) { ProfileView() }
                        }
                        GlassTabBar(selection: $router.tab)
                    }
                    .background(Theme.Palette.canvas)
                    .fullScreenCover(item: $launchDestination) { $0.view }
                }
                .onAppear(perform: applyLaunchScreen)
            } else {
                OnboardingView()
            }
        }
        .environment(session)
        .environment(router)
        .environment(\.marenClient, session.client)
        // Wrap the injected actions so a confirmed settlement posts `.marenDidSettle` once,
        // centrally, at the action→confirm boundary — the screens reload off that note.
        .environment(\.marenActions, SettleBroadcaster(base: session.actions))
        .environment(\.isDemoData, session.isDemo)
        .tint(Theme.Palette.accent)
    }

    /// One tab layer: visible and interactive only when selected. The visible/hidden opacity
    /// crossfades so switching tabs never flashes; hit-testing flips instantly so the incoming
    /// tab is live the moment it is selected. Reduce Motion drops the crossfade.
    @ViewBuilder private func tab<V: View>(_ which: AppTab, @ViewBuilder _ content: () -> V) -> some View {
        content()
            .opacity(router.tab == which ? 1 : 0)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: router.tab)
            .allowsHitTesting(router.tab == which)
    }

    private func applyLaunchScreen() {
        switch launchScreen {
        case "finance", "borrow", "deposit": router.goToVault()
        case "earn": router.goToEarn()
        case "activity": router.tab = .activity
        case "profile": router.tab = .profile
        case "send", "sendamount", "sendloading": launchDestination = .send
        case "receive": launchDestination = .receive
        case "link": launchDestination = .link
        default: break
        }
    }
}
