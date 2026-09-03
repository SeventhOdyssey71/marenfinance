import SwiftUI

// MARK: - App shell
//
// Four tabs — Home · Finance · Activity · Profile — with a pink active tint. A
// consumer money app: clean, simple, easy.

struct RootView: View {
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
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }
            FinanceView()
                .tabItem { Label("Finance", systemImage: "chart.pie.fill") }
            ActivityView()
                .tabItem { Label("Activity", systemImage: "clock.arrow.circlepath") }
            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.fill") }
        }
    }
}
