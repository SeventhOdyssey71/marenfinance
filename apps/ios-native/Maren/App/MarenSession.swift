import SwiftUI

// MARK: - ScreenshotHooks
//
// The two launch-environment hooks we use to capture App Store screenshots, in ONE place so
// they can be proven absent from a shipping build. Both read as "off" in Release regardless of
// what is in the process environment: `#if DEBUG` compiles the `ProcessInfo` lookups out
// entirely, so no environment variable can put a Release build on demo data, reroute it to a
// screen, or prefill a flow. Every caller goes through here rather than reading the variables.

enum ScreenshotHooks {
    /// `MAREN_SCREEN` opens the app directly on one screen or flow stage for capture.
    /// Always nil in Release.
    static var screen: String? {
        #if DEBUG
        return ProcessInfo.processInfo.environment["MAREN_SCREEN"]
        #else
        return nil
        #endif
    }

    /// `MAREN_DEMO` shows the tabbed shell fed by the DEBUG demo stub, with the "Demo data"
    /// badge on. Always false in Release, where the stub is not compiled at all.
    static var demoShell: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["MAREN_DEMO"] != nil
        #else
        return false
        #endif
    }

    /// True while either hook is driving the app, so first-run gates can step aside for a
    /// capture. Always false in Release.
    static var isCapturing: Bool { screen != nil || demoShell }
}

// MARK: - MarenSession
//
// The app's identity: which wallet is loaded, and the client/actions pointed at it. A wallet's
// address and display name are public, so they persist unprotected in UserDefaults — the
// SIGNING KEY stays in the Keychain (see Keystore) and is never held here. When an address is
// present the app runs live against Mezo testnet.
//
// NO WALLET MEANS NO CLIENT. With no address there is nothing true to read, so the session
// hands out `UnconfiguredMarenClient` / `UnconfiguredMarenActions`: every read is absent and
// every submit declines. There is no fabricating fallback in a shipping build.
//
// The demo stub is reachable ONLY in a DEBUG build and ONLY when the `MAREN_DEMO` screenshot
// hook is set, so we can capture the tabbed shell without a wallet. The hook, the stub and the
// "Demo data" badge are all compiled out of Release, which makes the dangerous combination —
// invented figures shown without the badge — structurally impossible rather than merely
// avoided. `isDemo` is therefore always false in Release.

@MainActor
@Observable
final class MarenSession {
    private(set) var address: String?
    private(set) var displayName: String
    let network: MezoNetwork = .testnet

    private var cachedClient: (any MarenClient)?
    private var cachedActions: (any MarenActions)?

    #if DEBUG
    /// Screenshot/testing hook: `MAREN_DEMO` shows the app shell on the demo stub with a
    /// friendly name, so the tabbed UI can be captured without a real wallet. DEBUG ONLY —
    /// the property, the environment read and the stub it selects are all absent from Release.
    private let demoShell: Bool
    #endif

    init() {
        #if DEBUG
        let demo = ScreenshotHooks.demoShell
        demoShell = demo
        displayName = demo ? "Sele" : (Self.load(Self.nameKey) ?? "")
        #else
        displayName = Self.load(Self.nameKey) ?? ""
        #endif
        address = Self.load(Self.addressKey).flatMap(Self.validAddress)
    }

    var hasWallet: Bool {
        #if DEBUG
        return address != nil || demoShell
        #else
        return address != nil
        #endif
    }

    /// True only when the screens are being fed the DEBUG demo stub, which is the only thing
    /// the "Demo data" badge is ever allowed to describe. Always false in Release, where no
    /// fabricating client exists to badge.
    var isDemo: Bool {
        #if DEBUG
        return demoShell
        #else
        return false
        #endif
    }

    /// The name shown in the greeting: the chosen display name, else a short address.
    var greetingName: String {
        if !displayName.isEmpty { return displayName }
        if let a = address { return Self.shortAddress(a) }
        return "there"
    }

    var client: any MarenClient {
        if let c = cachedClient { return c }
        let made: any MarenClient = address.map {
            MezoMarenClient(network: network, accountAddress: $0, nickname: displayName)
        } ?? noWalletClient
        cachedClient = made
        return made
    }

    var actions: any MarenActions {
        if let a = cachedActions { return a }
        let made: any MarenActions = address.map {
            LiveMarenActions(network: network, loadedAddress: $0)
        } ?? noWalletActions
        cachedActions = made
        return made
    }

    /// The no-wallet client. Release has exactly ONE answer: the unconfigured client, which
    /// reads nothing and can state nothing. DEBUG substitutes the demo stub only for the
    /// `MAREN_DEMO` screenshot shell, which is also the only thing `isDemo` is true for — so
    /// the "Demo data" badge is on precisely when the stub is feeding the screens.
    private var noWalletClient: any MarenClient {
        #if DEBUG
        if demoShell { return StubMarenClient() }
        #endif
        return UnconfiguredMarenClient()
    }

    /// The no-wallet runner, on the same rule: unconfigured in Release, and in DEBUG unless the
    /// screenshot shell asked for the demo walk.
    private var noWalletActions: any MarenActions {
        #if DEBUG
        if demoShell { return DemoMarenActions() }
        #endif
        return UnconfiguredMarenActions()
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
// True when the app is on the DEBUG demo stub. Drives the "Demo data" badge, separate from the
// relayer's `canSettle`.
//
// The default differs by configuration on purpose, and each default is the safe one for its
// build. In DEBUG it defaults to TRUE so an unwired view over-declares rather than under-
// declares. In Release the stub does not exist, so nothing can be demo data and a badge would
// itself be the false statement; it defaults to FALSE and `MarenSession.isDemo` never sets it
// otherwise.

private struct IsDemoDataKey: EnvironmentKey {
    #if DEBUG
    static let defaultValue = true
    #else
    static let defaultValue = false
    #endif
}

extension EnvironmentValues {
    var isDemoData: Bool {
        get { self[IsDemoDataKey.self] }
        set { self[IsDemoDataKey.self] = newValue }
    }
}
