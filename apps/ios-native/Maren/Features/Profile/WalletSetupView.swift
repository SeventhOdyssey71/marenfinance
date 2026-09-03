import SwiftUI

// MARK: - Wallet setup
//
// Create a fresh signing key or import one, then store it behind the device's biometrics.
// Honest about protection: `Keystore.store` reports how the key actually ended up held, and
// this screen shows exactly that — a session-only key is never dressed up as Face-ID-backed.
// The private key is never shown after creation and never logged.

struct WalletSetupView: View {
    var onComplete: (KeyProtection?) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    private let capability = Keystore.shared.capability()

    private enum Mode: Hashable { case choose, importing }
    @State private var mode: Mode = .choose
    @State private var importText = ""
    @State private var working = false
    @State private var result: KeyProtection?
    @State private var address: String?
    @State private var error: String?
    @State private var hasKey = false

    var body: some View {
        FlowScreen(title: "Wallet") {
            if let result {
                done(result)
            } else {
                switch mode {
                case .choose: chooser
                case .importing: importer
                }
            }
        }
        .task { hasKey = await Keystore.shared.hasKey() }
    }

    // MARK: chooser

    @ViewBuilder private var chooser: some View {
        biometricNote
        if hasKey {
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("A wallet already exists on this device").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                    Text("Creating or importing another will replace it. If you have not backed up the current key, it will be gone.")
                        .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        PillButton(title: "Create a new wallet", icon: "plus", variant: .primary) { Task { await createKey() } }
            .disabled(working)
        PillButton(title: "Import an existing key", icon: "square.and.arrow.down", variant: .quiet) { mode = .importing }
        if hasKey {
            PillButton(title: "Remove wallet from this device", variant: .quiet) { Task { await removeKey() } }
        }
        if let error { errorNote(error) }
    }

    // MARK: importer

    @ViewBuilder private var importer: some View {
        Text("Paste a 32-byte private key (with or without 0x). It is validated, stored behind your biometrics, and never shown again or logged.")
            .font(.system(size: 15)).foregroundStyle(Theme.Palette.muted).fixedSize(horizontal: false, vertical: true)
        TextEntryCard(label: "Private key", placeholder: "0x…", text: $importText,
                      footnote: "Never paste a key you use with real funds into a pre-audit demo build.")
        PillButton(title: "Import key", variant: .primary) { Task { await importKey() } }
            .disabled(working || importText.trimmingCharacters(in: .whitespaces).isEmpty)
        PillButton(title: "Back", variant: .quiet) { mode = .choose; error = nil }
        if let error { errorNote(error) }
    }

    // MARK: done

    @ViewBuilder private func done(_ protection: KeyProtection) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: protectionIcon(protection)).font(.system(size: 20, weight: .bold)).foregroundStyle(protectionTone(protection))
                .accessibilityHidden(true)
            Text("Wallet ready").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.Palette.ink)
        }
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text(protectionTitle(protection)).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                Text(protectionBody(protection)).font(.system(size: 14)).foregroundStyle(Theme.Palette.muted).fixedSize(horizontal: false, vertical: true)
                if let address {
                    Divider().overlay(Theme.Palette.ink.opacity(0.07))
                    Text("Address").labelStyle()
                    Text(address).font(.figure(14, weight: .regular)).foregroundStyle(Theme.Palette.ink)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
        }
        PillButton(title: "Done", variant: .quiet) { dismiss() }
    }

    // MARK: actions

    private func createKey() async {
        working = true; error = nil
        defer { working = false }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
        let key = Data(bytes)
        await store(key)
    }

    private func importKey() async {
        working = true; error = nil
        defer { working = false }
        guard let key = Keystore.normalise(importText) else {
            error = "That is not a valid 32-byte private key."
            return
        }
        await store(key)
    }

    private func store(_ key: Data) async {
        do {
            let derived = try Keystore.address(of: key)
            let protection = try await Keystore.shared.store(privateKey: key)
            address = derived
            result = protection
            onComplete(protection)
        } catch {
            self.error = "The key could not be stored on this device."
        }
    }

    private func removeKey() async {
        await Keystore.shared.clear()
        hasKey = false
        error = nil
        onComplete(nil)
    }

    // MARK: protection presentation

    private func protectionIcon(_ p: KeyProtection) -> String {
        if case .keychainBiometric = p { return capability.kind == .touchID ? "touchid" : "faceid" }
        return "exclamationmark.lock"
    }
    private func protectionTone(_ p: KeyProtection) -> Color {
        if case .keychainBiometric = p { return Theme.Palette.success }
        return Theme.Palette.warning
    }
    private func protectionTitle(_ p: KeyProtection) -> String {
        switch p {
        case let .keychainBiometric(label): return "Protected by \(label)"
        case .sessionOnly: return "Held for this session only"
        }
    }
    private func protectionBody(_ p: KeyProtection) -> String {
        switch p {
        case .keychainBiometric:
            return "Your key is in the Keychain and needs a biometric check before every signature. It never leaves this device and is never logged."
        case let .sessionOnly(reason):
            return "\(reason) The key is kept in memory for this session only and will be gone when the app closes — this is stated plainly rather than shown as protected."
        }
    }

    @ViewBuilder private var biometricNote: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: capability.available && capability.enrolled ? "faceid" : "exclamationmark.triangle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(capability.available && capability.enrolled ? Theme.Palette.accentText : Theme.Palette.warning)
                .accessibilityHidden(true)
            Text(capability.available && capability.enrolled
                 ? "\(capability.displayName) is enrolled. A new key will be stored behind it."
                 : (capability.reason ?? "No biometrics are enrolled. A key would be held for this session only."))
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted).fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }

    private func errorNote(_ message: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 13, weight: .semibold))
            Text(message).font(.system(size: 14, weight: .medium))
        }
        .foregroundStyle(Theme.Palette.danger)
    }
}
