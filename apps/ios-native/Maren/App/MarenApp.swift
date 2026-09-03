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
    /// The live read address, if the build was pointed at one. When present, reads run live and
    /// the write seam is the live runner; otherwise both are the clearly-badged demo pair.
    private static var liveAddress: String? {
        guard let addr = Bundle.main.object(forInfoDictionaryKey: "MAREN_READ_ADDRESS") as? String,
              addr.hasPrefix("0x"), addr.count == 42 else { return nil }
        return addr
    }

    static func makeClient() -> any MarenClient {
        if let addr = liveAddress {
            return MezoMarenClient(network: .testnet, accountAddress: addr)
        }
        return StubMarenClient()
    }

    static func makeActions() -> any MarenActions {
        if let addr = liveAddress {
            return LiveMarenActions(network: .testnet, loadedAddress: addr)
        }
        return DemoMarenActions()
    }
}

@main
struct MarenApp: App {
    private let client: any MarenClient = MarenClientFactory.makeClient()
    private let actions: any MarenActions = MarenClientFactory.makeActions()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.marenClient, client)
                .environment(\.marenActions, actions)
                .tint(Theme.Palette.accent)
        }
    }
}
