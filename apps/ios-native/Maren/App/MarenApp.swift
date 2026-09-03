import SwiftUI

// MARK: - Client injection
//
// The MarenClient is handed down through the environment so the real Mezo impl can
// replace the stub in a later wave without a view knowing which it is holding.

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
    private let client: any MarenClient = StubMarenClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.marenClient, client)
                .tint(Theme.Palette.accent)
        }
    }
}
