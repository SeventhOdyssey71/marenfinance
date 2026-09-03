import SwiftUI

// MARK: - Receive
//
// A QR of the user's own public payment link, plus the @handle and address to copy or share.
// Everything here is public — there is no secret on this screen — so it is safe to render as a
// code and to share.

struct ReceiveView: View {
    @Environment(\.marenClient) private var client
    @State private var account: Account?

    var body: some View {
        FlowScreen(title: "Receive") {
            if let account {
                let link = PaymentLinks.buildPayment(to: primaryTarget(account))
                VStack(spacing: Theme.Space.md) {
                    QRCode(string: link, size: 220)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Theme.Space.sm)
                    Text("Scan to pay you in MUSD")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.Palette.tertiary)
                }
                .frame(maxWidth: .infinity)

                copyCard(label: "Your handle", value: account.handle, copyValue: account.handle,
                         show: account.handle.hasPrefix("@"))
                copyCard(label: "Your address", value: account.address, copyValue: account.address, show: true)

                ShareLink(item: link) {
                    Text("Share payment link").pillLabel()
                }
                .accessibilityLabel("Share your payment link")
            } else {
                MCard { Text("Loading your account…").foregroundStyle(Theme.Palette.tertiary) }
            }
        }
        .task { account = try? await client.account() }
    }

    private func primaryTarget(_ account: Account) -> String {
        account.handle.hasPrefix("@") ? account.handle : account.address
    }

    @ViewBuilder private func copyCard(label: String, value: String, copyValue: String, show: Bool) -> some View {
        if show {
            MCard {
                HStack(spacing: Theme.Space.sm) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(label).labelStyle()
                        Text(value)
                            .font(.figure(15, weight: .medium))
                            .foregroundStyle(Theme.Palette.ink)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: Theme.Space.sm)
                    CopyButton(value: copyValue, describes: label.lowercased())
                }
            }
        }
    }
}
