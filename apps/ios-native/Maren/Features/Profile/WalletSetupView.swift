import SwiftUI

/// Manage the loaded wallet without silently replacing the key behind its public address.
struct WalletSetupView: View {
    var onComplete: (KeyProtection?) -> Void = { _ in }
    @Environment(MarenSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var importing = false
    @State private var importText = ""
    @State private var working = false
    @State private var error: String?
    @State private var hasKey = false
    @State private var backupKey: String?
    @State private var confirmRemoval = false
    @State private var backupPending = OnboardingFlags.backupPending

    var body: some View {
        Group {
            if let backupKey {
                OnboardingBackupStep(stepCount: 1, stepIndex: 0, privateKeyHex: backupKey,
                    onSaved: {
                        OnboardingFlags.markBackedUp()
                        backupPending = false
                        self.backupKey = nil
                    },
                    onLater: { self.backupKey = nil })
            } else {
                FlowScreen(title: "Your wallet", canDismiss: !working) {
                    if let address = session.address {
                        Text(MarenSession.shortAddress(address))
                            .font(.figure(20, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                    }
                    if importing { importer } else { manager }
                    if let error {
                        Text(error).font(.text(14)).foregroundStyle(Theme.Palette.warning)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .task { hasKey = await Keystore.shared.hasKey() }
        .onDisappear { backupKey = nil; importText = "" }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { backupKey = nil; importText = "" }
        }
        .confirmationDialog("Remove this wallet from Maren?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("I saved my key. Remove wallet", role: .destructive) {
                Task {
                    await Keystore.shared.clear()
                    onComplete(nil)
                    dismiss()
                }
            }
        } message: {
            Text("This deletes this device's signing key. Your funds stay on Mezo. You will need your saved private key to restore access; Maren cannot recover it.")
        }
    }

    @ViewBuilder private var manager: some View {
        Text(hasKey
             ? (backupPending ? "Your backup is still needed. Save your key before removing this wallet or closing a session-only wallet." : "Keep your private key somewhere only you can reach. It is the only way to restore this wallet on another device.")
             : "The signing key is no longer available on this device. Your wallet address and funds are unchanged. Restore the saved key for this address to transact again.")
            .font(.text(15)).foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        if hasKey {
            PillButton(title: "Back up private key", icon: "key", variant: .primary) {
                Task { await revealBackup() }
            }.disabled(working)
        }
        PillButton(title: "Restore this wallet", icon: "arrow.down.doc", variant: .quiet) {
            importing = true; error = nil
        }.disabled(working)
        PillButton(title: "Remove wallet from this device", variant: .quiet) {
            confirmRemoval = true
        }.disabled(working)
    }

    @ViewBuilder private var importer: some View {
        Text("Use the saved private key for the address above. Keys for other wallets are rejected so this wallet cannot be accidentally replaced.")
            .font(.text(15)).foregroundStyle(Theme.Palette.muted)
        SecureField("Private key", text: $importText)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .font(.figure(16, weight: .regular)).padding(Theme.Space.md)
            .background(Theme.Palette.card, in: RoundedRectangle(cornerRadius: Theme.Radius.inset))
        PillButton(title: "Restore key", variant: .primary) { Task { await restore() } }
            .disabled(working || Keystore.normalise(importText) == nil)
        PillButton(title: "Back", variant: .quiet) { importing = false; importText = ""; error = nil }
            .disabled(working)
    }

    private func revealBackup() async {
        guard !working else { return }
        working = true; error = nil
        defer { working = false }
        switch await Keystore.shared.access() {
        case .ok(let key):
            guard let address = try? Keystore.address(of: key),
                  address.lowercased() == session.address?.lowercased() else {
                error = "The stored key does not match this wallet. Restore the correct key first."
                return
            }
            backupKey = "0x" + key.map { String(format: "%02x", $0) }.joined()
        case .denied(let reason): error = reason
        case .missing: hasKey = false; error = "Restore your saved key to access this wallet."
        }
    }

    private func restore() async {
        guard !working, let key = Keystore.normalise(importText) else { return }
        working = true; error = nil
        defer { working = false }
        guard let address = try? Keystore.address(of: key),
              address.lowercased() == session.address?.lowercased() else {
            error = "That key belongs to a different wallet. Use the key for the address shown above."
            return
        }
        do {
            let protection = try await Keystore.shared.store(privateKey: key)
            importText = ""; importing = false; hasKey = true
            OnboardingFlags.markBackedUp(); backupPending = false
            onComplete(protection)
        } catch { self.error = "The key could not be stored. Please try again." }
    }
}
