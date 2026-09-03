import SwiftUI

// MARK: - MarenSession
//
// The app's identity: which wallet is loaded, and the client/actions pointed at it. A wallet's
// address and display name are public, so they persist unprotected in UserDefaults — the
// SIGNING KEY stays in the Keychain (see Keystore) and is never held here. When an address is
// present the app runs live against Mezo testnet; when it is absent the app is in the demo
// stub and shows the "Demo data" badge. So `isDemo` — not the relayer's `canSettle` — is what
// drives that badge, and once a real wallet exists the badge is honestly gone even though
// gasless writes still wait on a relayer.

@MainActor
@Observable
final class MarenSession {
    private(set) var address: String?
    private(set) var displayName: String
    let network: MezoNetwork = .testnet

    private var cachedClient: (any MarenClient)?
    private var cachedActions: (any MarenActions)?

    /// Screenshot/testing hook: `MAREN_DEMO` shows the app shell on the demo stub with a
    /// friendly name, so the tabbed UI can be captured without a real wallet. Inert otherwise.
    private let demoShell: Bool

    init() {
        let demo = ProcessInfo.processInfo.environment["MAREN_DEMO"] != nil
        demoShell = demo
        address = Self.load(Self.addressKey).flatMap(Self.validAddress)
        displayName = demo ? "Sele" : (Self.load(Self.nameKey) ?? "")
    }

    var hasWallet: Bool { address != nil || demoShell }
    var isDemo: Bool { address == nil }

    /// The name shown in the greeting: the chosen display name, else a short address.
    var greetingName: String {
        if !displayName.isEmpty { return displayName }
        if let a = address { return Self.shortAddress(a) }
        return "there"
    }

    var client: any MarenClient {
        if let c = cachedClient { return c }
        let made: any MarenClient = address.map {
            MezoMarenClient(network: network, accountAddress: $0, handle: displayName)
        } ?? StubMarenClient()
        cachedClient = made
        return made
    }

    var actions: any MarenActions {
        if let a = cachedActions { return a }
        let made: any MarenActions = address.map {
            LiveMarenActions(network: network, loadedAddress: $0)
        } ?? DemoMarenActions()
        cachedActions = made
        return made
    }

    /// Adopt a wallet after onboarding stores its key (or clear it on sign-out). The signing key
    /// itself lives only in the Keychain; only the public address + name are recorded here.
    func adopt(address: String?, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Self.save(Self.addressKey, address)
        Self.save(Self.nameKey, trimmed.isEmpty ? nil : trimmed)
        self.address = address.flatMap(Self.validAddress)
        self.displayName = trimmed
        cachedClient = nil
        cachedActions = nil
    }

    func signOut() { adopt(address: nil, name: "") }

    // MARK: persistence (public values only)

    private static let addressKey = "finance.maren.swift.walletAddress"
    private static let nameKey = "finance.maren.swift.displayName"

    private nonisolated static func load(_ key: String) -> String? { UserDefaults.standard.string(forKey: key) }
    private nonisolated static func save(_ key: String, _ value: String?) {
        if let value { UserDefaults.standard.set(value, forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
    }
    private nonisolated static func validAddress(_ a: String) -> String? {
        (a.hasPrefix("0x") && a.count == 42) ? a : nil
    }
    nonisolated static func shortAddress(_ a: String) -> String {
        a.count > 10 ? "\(a.prefix(6))…\(a.suffix(4))" : a
    }
}

// MARK: - isDemoData environment
//
// True when the app is on the demo stub (no wallet). Drives the "Demo data" badge, separate
// from the relayer's `canSettle`.

private struct IsDemoDataKey: EnvironmentKey { static let defaultValue = true }

extension EnvironmentValues {
    var isDemoData: Bool {
        get { self[IsDemoDataKey.self] }
        set { self[IsDemoDataKey.self] = newValue }
    }
}
