import SwiftUI

// MARK: - Request
//
// Ask to be paid a set amount. This builds a shareable payment link addressed to you with the
// amount baked in — it moves no funds and records nothing on-chain until someone actually pays
// it, and the screen says exactly that rather than implying a request was "sent".

struct RequestFlow: View {
    @Environment(\.marenClient) private var client
    @State private var account: Account?
    @State private var amountText = ""
    @State private var built = false

    private var amount: Decimal? { Amount.parse(amountText) }

    var body: some View {
        FlowScreen(title: "Request") {
            if built, let amount, let account {
                requested(amount: amount, account: account)
            } else {
                entry
            }
        }
        .task { account = try? await client.account() }
    }

    @ViewBuilder private var entry: some View {
        Text("Create a link that asks someone to pay you a set amount of MUSD. It moves no funds and records nothing on-chain until they pay it.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        AmountField(unit: "MUSD", text: $amountText)
        SubmitBar(title: "Create request link", enabled: amount != nil) { built = true }
    }

    @ViewBuilder private func requested(amount: Decimal, account: Account) -> some View {
        let target = account.handle.hasPrefix("@") ? account.handle : account.address
        let amountString = MoneyFormat.musd(amount, unit: false).replacingOccurrences(of: ",", with: "")
        let link = PaymentLinks.buildPayment(to: target, amount: amountString)
        MCard {
            VStack(alignment: .leading, spacing: 4) {
                Text("You’re asking for").labelStyle()
                MoneyText(text: MoneyFormat.musd(amount), size: 34, weight: .bold)
            }
        }
        VStack(spacing: Theme.Space.md) {
            QRCode(string: link, size: 200).frame(maxWidth: .infinity)
            Text("Have them scan this, or share the link.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.Palette.tertiary)
        }
        .frame(maxWidth: .infinity)
        ShareLink(item: link) {
            Text("Share request")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Theme.Palette.ink, in: Capsule())
        }
        .accessibilityLabel("Share this payment request")
        PillButton(title: "New request", variant: .quiet) { built = false; amountText = "" }
    }
}
