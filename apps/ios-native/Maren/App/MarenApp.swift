import SwiftUI

// MARK: - Client injection
//
// The MarenClient is handed down through the environment. RootView owns the MarenSession and
// injects the live client for the loaded wallet — a view never knows which it is holding.
//
// The default is `UnconfiguredMarenClient` in every configuration, Debug and Release alike:
// a view rendered outside a configured session reads nothing and shows an honest gap, rather
// than silently inheriting invented figures. Previews inject the demo stub explicitly.

private struct MarenClientKey: EnvironmentKey {
    static let defaultValue: any MarenClient = UnconfiguredMarenClient()
}

extension EnvironmentValues {
    var marenClient: any MarenClient {
        get { self[MarenClientKey.self] }
        set { self[MarenClientKey.self] = newValue }
    }
}

@main
struct MarenApp: App {
    init() { AppFont.register() }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
