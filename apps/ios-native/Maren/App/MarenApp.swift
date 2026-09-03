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

// MARK: - Client selection
//
// Reads can run for real against the public Mezo testnet RPC with no wallet, so the live
// client is fully wired. It is NOT the default: without an onboarding flow there is no
// "your" account to point it at, and showing a stranger's address as the user's balance
// would be the exact fabricated-data dishonesty the rest of the app avoids. So the default
// stays the clearly-badged demo stub, and live is opt-in via `MAREN_READ_ADDRESS` in the
// Info.plist (set it to an address to read that account live against testnet).
enum MarenClientFactory {
    static func make() -> any MarenClient {
        if let addr = Bundle.main.object(forInfoDictionaryKey: "MAREN_READ_ADDRESS") as? String,
           addr.hasPrefix("0x"), addr.count == 42 {
            return MezoMarenClient(network: .testnet, accountAddress: addr)
        }
        return StubMarenClient()
    }
}

@main
struct MarenApp: App {
    private let client: any MarenClient = MarenClientFactory.make()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.marenClient, client)
                .tint(Theme.Palette.accent)
        }
    }
}
