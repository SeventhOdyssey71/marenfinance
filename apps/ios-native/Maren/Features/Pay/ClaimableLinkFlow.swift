import SwiftUI

// MARK: - Claimable link (create)
//
// Escrow MUSD to whoever holds a one-time link. Amount → review → submit → the link is shown
// ONCE. The bearer secret lives in the URL fragment (never sent to a server), is a bearer
// token — anyone with the string can claim — and is therefore shown a single time, shared by
// the user, and NEVER logged or persisted anywhere in this app.

struct ClaimableLinkFlow: View {
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, review, submitting, created, failed }
    @State private var stage: Stage = .entry
    @State private var amountText = ""
    /// Held only for the lifetime of this view, in memory. Generated at submit, revealed once.
    @State private var link: String?
    @State private var outcome: SubmitOutcome?

    private var amount: Decimal? { Amount.parse(amountText) }

    var body: some View {
        FlowScreen(title: "Claimable link") {
            switch stage {
            case .entry: entry
            case .review, .submitting: review
            case .created: created
            case .failed: failedView
            }
        }
    }

    @ViewBuilder private var entry: some View {
        Text("Escrow MUSD to a one-time link. Whoever opens it can claim the funds into their own wallet, so treat the link like cash.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        AmountField(unit: "MUSD", text: $amountText)
        GasNote(mode: .sponsored)
        SubmitBar(title: "Review", enabled: amount != nil) { stage = .review }
    }

    @ViewBuilder private var review: some View {
        if let amount {
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Escrowing").labelStyle()
                    MoneyText(text: MoneyFormat.musd(amount), size: 34, weight: .bold)
                }
            }
            ReviewList(rows: [
                ReviewRow(label: "Claimable by", value: "Anyone with the link", plain: true),
                ReviewRow(label: "Reclaim", value: "You, after expiry", plain: true),
            ])
            GasNote(mode: .sponsored)
            SubmitBar(title: "Create link", submitting: stage == .submitting) {
                Task { await submit(amount) }
            }
            if stage != .submitting {
                PillButton(title: "Back", variant: .quiet) { stage = .entry }
            }
        }
    }

    private func submit(_ amount: Decimal) async {
        stage = .submitting
        let result = await actions.submit(Intent(kind: .createLink, amount: amount, unit: .musd))
        outcome = result
        switch result {
        case .demo, .delivered:
            // The one-time secret is generated here and put in the fragment. In a live build the
            // linkId comes back from the receipt; demo uses a placeholder id. Either way the
            // secret is fresh, revealed once below, and never logged.
            let secret = PaymentLinks.freshSecret()
            let linkId: UInt64 = { if case let .delivered(d) = result { return UInt64(d.blockNumber % 100000) } ; return 1 }()
            link = PaymentLinks.buildClaim(linkId: linkId, secret: secret)
            stage = .created
        case .declined, .failed:
            stage = .failed
        }
    }

    @ViewBuilder private var created: some View {
        if let link {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "checkmark").font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.Palette.success).accessibilityHidden(true)
                Text("Link created").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.Palette.ink)
            }
            // The one and only place the secret is shown.
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    HStack(spacing: 6) {
                        Image(systemName: "eye.trianglebadge.exclamationmark")
                            .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.Palette.warning)
                            .accessibilityHidden(true)
                        Text("Shown once, save it now").labelStyle().foregroundStyle(Theme.Palette.warning)
                    }
                    Text(link)
                        .font(.figure(13, weight: .regular))
                        .foregroundStyle(Theme.Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("This link holds the claim secret. Anyone with it can claim the funds, and Maren cannot show it to you again.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(spacing: Theme.Space.sm) {
                CopyButton(value: link, describes: "the claim link", style: .filled)
                ShareLink(item: link) {
                    Label("Share", systemImage: "square.and.arrow.up").pillLabel()
                }
                .accessibilityLabel("Share the claim link")
            }
            if !actions.canSettle {
                Text("Demo: nothing was escrowed on-chain. This link demonstrates the one-time-secret handling only.")
                    .font(.system(size: 13)).foregroundStyle(Theme.Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            PillButton(title: "Done", variant: .quiet) { dismiss() }
        }
    }

    @ViewBuilder private var failedView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
