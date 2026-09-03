import SwiftUI

// MARK: - Client injection
//
// The MarenClient is handed down through the environment. RootView owns the MarenSession and
// injects the live client (a real wallet loaded) or the demo stub (no wallet) — a view never
// knows which it is holding. The default here is only a fallback for previews.

private struct MarenClientKey: EnvironmentKey {
    static let defaultValue: any MarenClient = StubMarenClient()
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
