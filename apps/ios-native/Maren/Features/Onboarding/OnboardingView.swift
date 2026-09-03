import SwiftUI
import Security

// MARK: - Onboarding
//
// The first-run gate that replaces the demo stub: create a fresh wallet or import an existing
// key, give yourself a name, and you're in — reading live against Mezo testnet. The signing
// key is stored in the Keychain behind biometrics (Keystore, honest about how it ends up
// held); only the public address + name are recorded in the session. The key is never shown
// after creation and never logged.

struct OnboardingView: View {
    @Environment(MarenSession.self) private var session
    private let capability = Keystore.shared.capability()

    private enum Mode { case choose, importing }
    @State private var mode: Mode = .choose
    @State private var name = ""
    @State private var importText = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                Spacer(minLength: Theme.Space.xl)
                Image("MarenMark")
                    .resizable().scaledToFit().frame(height: 40)
                    .accessibilityLabel("Maren")
                VStack(alignment: .leading, spacing: Theme.Space.xs) {
                    Text("Welcome to Maren")
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                    Text("Spend Bitcoin without selling it. Create a wallet or import one to begin — your key is stored on this device, behind your biometrics, and never leaves it.")
                        .font(.body(15))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                switch mode {
                case .choose: chooser
                case .importing: importer
                }
                if let error { errorNote(error) }
                Spacer(minLength: Theme.Space.xl)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.bottom, Theme.Space.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.Palette.canvas)
    }

    // MARK: choose

    private var chooser: some View {
        VStack(spacing: Theme.Space.md) {
            nameField
            biometricNote
            PillButton(title: "Create a new wallet", icon: "plus", variant: .primary) {
                Task { await createKey() }
            }
            .disabled(working)
            PillButton(title: "Import an existing key", icon: "square.and.arrow.down", variant: .quiet) {
                mode = .importing; error = nil
            }
        }
    }

    private var importer: some View {
        VStack(spacing: Theme.Space.md) {
            nameField
            TextEntryCard(label: "Private key", placeholder: "0x…", text: $importText,
                          footnote: "Never paste a key you use with real funds into a pre-audit build.")
            PillButton(title: "Import key", variant: .primary) {
                Task { await importKey() }
            }
            .disabled(working || importText.trimmingCharacters(in: .whitespaces).isEmpty)
            PillButton(title: "Back", variant: .quiet) { mode = .choose; error = nil }
        }
    }

    private var nameField: some View {
        TextEntryCard(label: "Your name", placeholder: "e.g. Sele", text: $name,
                      autocapitalization: .words,
                      footnote: "Shown in your greeting. You can change it later.")
    }

    // MARK: actions

    private func createKey() async {
        working = true; error = nil
        defer { working = false }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
        await store(Data(bytes))
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
            let address = try Keystore.address(of: key)
            _ = try await Keystore.shared.store(privateKey: key)
            session.adopt(address: address, name: name)
        } catch {
            self.error = "The key could not be stored on this device."
        }
    }

    // MARK: notes

    private var biometricNote: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: capability.available && capability.enrolled ? "faceid" : "exclamationmark.triangle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(capability.available && capability.enrolled ? Theme.Palette.accentText : Theme.Palette.warning)
                .accessibilityHidden(true)
            Text(capability.available && capability.enrolled
                 ? "\(capability.displayName) is enrolled. Your key will be stored behind it."
                 : (capability.reason ?? "No biometrics enrolled. Your key will be held for this session only."))
                .font(.body(14))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }

    private func errorNote(_ message: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 13, weight: .semibold))
            Text(message).font(.body(14, weight: .medium))
        }
        .foregroundStyle(Theme.Palette.danger)
    }
}
