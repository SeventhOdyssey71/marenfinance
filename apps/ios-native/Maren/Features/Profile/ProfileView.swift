import SwiftUI

// MARK: - Profile
//
// Who you are and how your key is held. @handle, address (copy), network, a security entry
// into wallet setup, and sign-out. The security copy is honest about how the key is actually
// protected — a session-only key is never described as Face-ID-protected.

struct ProfileView: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @State private var account: Account?
    @State private var showSetup = false
    @State private var protection: KeyProtection?
    private let capability = Keystore.shared.capability()

    var body: some View {
        Screen(title: "PROFILE", badge: !actions.canSettle) {
            accountCard
            securityCard
            howItWorksCard
            if !actions.canSettle {
                Text("This build runs on demo data. Creating a wallet stores a real key on this device, but there is no relayer configured, so no transaction can be settled from here yet.")
                    .font(.system(size: 13)).foregroundStyle(Theme.Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task { account = try? await client.account() }
        .sheet(isPresented: $showSetup) {
            WalletSetupView { protection = $0 }
        }
        .onAppear(perform: refreshProtection)
    }

    private func refreshProtection() {
        // A session-only key never survives a cold launch, so a key found at startup is a
        // Keychain item — honestly reported as biometric-protected. In-session, the setup
        // callback supplies the real protection, so this only fills the cold-start gap.
        Task {
            if protection == nil, await Keystore.shared.hasKey() {
                protection = .keychainBiometric(label: capability.displayName)
            }
        }
    }

    private var accountCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Account").labelStyle()
                Text(account?.handle ?? "—")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Theme.Palette.ink)
                HStack(spacing: Theme.Space.sm) {
                    Text(account?.address ?? "—")
                        .font(.figure(14, weight: .regular))
                        .foregroundStyle(Theme.Palette.muted)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: Theme.Space.sm)
                    if let addr = account?.address {
                        CopyButton(value: addr, describes: "your address")
                    }
                }
                Divider().overlay(Theme.Palette.ink.opacity(0.07))
                StatRow(label: "Network", showsDivider: false) {
                    Text("Mezo testnet").font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                }
            }
        }
    }

    private var securityCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Security").labelStyle()
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: keyIcon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(keyTone)
                        .frame(width: 32)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(keyTitle).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                        Text(keySubtitle).font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                PillButton(title: protection == nil ? "Set up wallet" : "Manage wallet", variant: .quiet) {
                    showSetup = true
                }
            }
        }
    }

    private var howItWorksCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("How Maren works").labelStyle()
                Text("Deposit BTC, borrow MUSD, pay by @handle — on Mezo. Your first deposit pays BTC gas; borrowing and every payment after are relayed and gasless. Minimum deposit \(MoneyFormat.btc(MarenPolicy.minCollateralBtc)).")
                    .font(.system(size: 15)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var keyIcon: String {
        switch protection {
        case .keychainBiometric: return capability.kind == .faceID ? "faceid" : "touchid"
        case .sessionOnly: return "exclamationmark.lock"
        case .none: return "lock.open"
        }
    }
    private var keyTone: Color {
        switch protection {
        case .keychainBiometric: return Theme.Palette.success
        case .sessionOnly: return Theme.Palette.warning
        case .none: return Theme.Palette.tertiary
        }
    }
    private var keyTitle: String {
        switch protection {
        case let .keychainBiometric(label): return "Protected by \(label)"
        case .sessionOnly: return "Held for this session only"
        case .none: return "No wallet yet"
        }
    }
    private var keySubtitle: String {
        switch protection {
        case .keychainBiometric:
            return "Your signing key is in the Keychain and needs a biometric check before every transaction."
        case let .sessionOnly(reason):
            return "\(reason) The key lives in memory for this session and is not described as biometrically protected."
        case .none:
            return capability.available && capability.enrolled
                ? "Create or import a key to sign transactions. It will be protected by \(capability.displayName)."
                : "Create or import a key to sign transactions."
        }
    }
}
