import SwiftUI

// MARK: - Receive
//
// A clean receive sheet: a centred prompt, the QR of the user's own public payment link, a
// grouped network/address card, and copy/share actions. Everything here is public — there is
// no secret on this screen — so it is safe to render as a code and to share.

struct ReceiveView: View {
    @Environment(\.marenClient) private var client
    @State private var account: Account?

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Space.lg) {
                if let account {
                    // `payTarget` is the address unless MarenRegistry has CONFIRMED a handle for
                    // it. A device-local nickname never reaches this line: a link built from an
                    // unconfirmed name would resolve to whoever actually registered it.
                    let link = PaymentLinks.buildPayment(to: account.payTarget)
                    header
                    QRCode(string: link, size: 230)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Space.xs)
                    infoCard(account)
                    actions(link: link, address: account.address)
                } else {
                    MCard { Text("Loading your account…").font(.text(15)).foregroundStyle(Theme.Palette.tertiary) }
                }
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.xl)
            .padding(.bottom, Theme.Space.lg)
        }
        .background(Theme.Palette.canvas)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { account = try? await client.account() }
    }

    private var header: some View {
        VStack(spacing: Theme.Space.xs) {
            Text("Receive MUSD")
                .font(.display(24, weight: .medium))
                .foregroundStyle(Theme.Palette.ink)
            Text("Share your wallet address or QR code to receive MUSD on Mezo.")
                .font(.text(15))
                .foregroundStyle(Theme.Palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private func infoCard(_ account: Account) -> some View {
        MCard(padding: Theme.Space.md) {
            VStack(spacing: 0) {
                StatRow(label: "Network") {
                    Text("MUSD · Mezo").font(.text(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                }
                // Shown only when MarenRegistry confirmed it, because this row is a claim that
                // paying that name pays this account.
                if let handle = account.handle {
                    StatRow(label: "Your name") {
                        Text(handle).font(.text(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                    }
                }
                StatRow(label: "Wallet address", showsDivider: false, fixedValue: false) {
                    Text(MarenSession.shortAddress(account.address))
                        .font(.figure(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.ink)
                }
            }
        }
    }

    private func actions(link: String, address: String) -> some View {
        HStack(spacing: Theme.Space.sm) {
            CopyButton(value: address, describes: "your address", title: "Copy address", style: .filled)
            ShareLink(item: link) {
                Label("Share QR", systemImage: "square.and.arrow.up").pillLabel()
            }
            .accessibilityLabel("Share your payment link")
        }
    }

}
