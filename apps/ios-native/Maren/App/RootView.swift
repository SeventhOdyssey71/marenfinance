import SwiftUI

// MARK: - App shell
//
// Four tabs — Home · Finance · Activity · Profile — with a pink active tint, wrapped in the
// biometric unlock gate. A consumer money app: clean, simple, easy. The AppRouter lets one
// screen send you to another (Home's Borrow/Earn jump to Finance).

struct RootView: View {
    @State private var router = AppRouter()
    /// A screenshot/testing hook: `MAREN_SCREEN` preselects a tab and, for pay flows, presents
    /// the sheet at launch. Absent in normal use, so it changes nothing for a real user.
    @State private var launchDestination: PayDestination?
    private let launchScreen = ProcessInfo.processInfo.environment["MAREN_SCREEN"]

    init() {
        // The tab bar renders on a soft, near-canvas surface with no hard top line.
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Theme.Palette.card)
        appearance.shadowColor = UIColor(Theme.Palette.ink.opacity(0.06))
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    var body: some View {
        @Bindable var router = router
        return UnlockGate {
            TabView(selection: $router.tab) {
                HomeView()
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(AppTab.home)
                FinanceView()
                    .tabItem { Label("Finance", systemImage: "chart.pie.fill") }
                    .tag(AppTab.finance)
                ActivityView()
                    .tabItem { Label("Activity", systemImage: "clock.arrow.circlepath") }
                    .tag(AppTab.activity)
                ProfileView()
                    .tabItem { Label("Profile", systemImage: "person.fill") }
                    .tag(AppTab.profile)
            }
            .sheet(item: $launchDestination) { $0.view }
        }
        .environment(router)
        .onAppear(perform: applyLaunchScreen)
    }

    private func applyLaunchScreen() {
        switch launchScreen {
        case "finance": router.goToVault()
        case "earn": router.goToEarn()
        case "activity": router.tab = .activity
        case "profile": router.tab = .profile
        case "send": launchDestination = .send
        case "receive": launchDestination = .receive
        case "link": launchDestination = .link
        default: break
        }
    }
}
