import SwiftUI
import web3

// MARK: - Claimable link (create)
//
// Escrow MUSD to whoever holds a one-time link. Amount, review, submit, and the link is shown
// ONCE. The bearer secret lives in the URL fragment (never sent to a server), is a bearer
// token — anyone with the string can claim — and is therefore shown a single time, shared by
// the user, and NEVER logged or persisted anywhere in this app.
//
// THE LINK ID IS NEVER INVENTED. `MarenPay.createLink` mints the id itself and reports it in
// `LinkCreated`, whose indexed `linkId` `Receipt.confirm` reads out of the same receipt that
// proved the transaction succeeded. If that log cannot be read, this screen says the escrow
// landed but the id did not arrive, and points at the explorer — because a guessed id builds a
// link that points at somebody else's escrow, which is the worst thing this screen could do.

struct ClaimableLinkFlow: View {
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, review, submitting, created, idUnknown, walked, failed }
    @State private var stage: Stage = .entry
    @State private var amountText = ""
    /// Held only for the lifetime of this view, in memory. Generated at submit, revealed once.
    @State private var link: String?
    /// The bearer key on its own, for the branch where the escrow landed but the id did not.
    @State private var secret: String?
    @State private var outcome: SubmitOutcome?

    private var amount: Decimal? { Amount.parse(amountText) }

    /// The expiry this link is created with, fixed at the moment the screen opens so the review
    /// step and the submitted calldata can never quote different dates.
    private let expiry = UInt64(Date().timeIntervalSince1970) + CLAIM_LINK_EXPIRY_SECONDS
    private var expiryDate: Date { Date(timeIntervalSince1970: TimeInterval(expiry)) }

    var body: some View {
        FlowScreen(title: "Claimable link") {
            switch stage {
            case .entry: entry
            case .review, .submitting: review
            case .created: created
            case .idUnknown: idUnknownView
            case .walked: walkedView
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
        GasNote(mode: .youPayBtc, detail: "MarenRelayHub allowlists claiming a link but not creating one, so you sign this and pay the Bitcoin gas yourself. Whoever claims it pays nothing.")
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
                ReviewRow(label: "Reclaimable by you", value: expiryDate.formatted(date: .abbreviated, time: .shortened), plain: true),
            ])
            Text("MarenPay holds this MUSD against a link id until it is claimed. If nobody claims it, you can take it back after the date above and not before, which is what stops a creator front-running a real claim.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.Palette.tertiary)
                .fixedSize(horizontal: false, vertical: true)
            GasNote(mode: .youPayBtc, detail: "MarenRelayHub allowlists claiming a link but not creating one, so you sign this and pay the Bitcoin gas yourself. Whoever claims it pays nothing.")
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

        // The one-time keypair. Its ADDRESS goes on-chain as the link key; its PRIVATE key goes
        // in the URL fragment and is never sent to a server, never logged, and never stored.
        guard let secretHex = HandleCommitmentStore.newSecret(),
              let secretData = Data(hex: secretHex),
              let linkKey = try? Keystore.address(of: secretData) else {
            outcome = .declined(reason: "A one-time link key could not be generated on this device, so nothing was submitted.")
            stage = .failed
            return
        }

        let result = await actions.submit(
            Intent(kind: .createLink(linkKey: linkKey, expiry: expiry, memo: ""), amount: amount, unit: .musd)
        )
        outcome = result

        switch result {
        case .demo:
            // Nothing was escrowed, so there is no link id and therefore no link. Showing a
            // plausible URL here would be a link that points at somebody else's escrow.
            stage = .walked
        case let .delivered(delivered):
            if let linkId = delivered.mintedId {
                link = PaymentLinks.buildClaim(linkId: linkId, secret: secretHex)
                stage = .created
            } else {
                secret = secretHex
                stage = .idUnknown
            }
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
            Text("An on-chain receipt confirmed the escrow and reported this link's id.")
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
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
            PillButton(title: "Done", variant: .quiet) { dismiss() }
        }
    }

    // The escrow settled, but the receipt did not carry a readable `LinkCreated`. The money is
    // safe and reclaimable after expiry; what is missing is the id, and this says exactly that
    // rather than guessing one.
    @ViewBuilder private var idUnknownView: some View {
        if let secret {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.Palette.warning).accessibilityHidden(true)
                Text("Escrowed, id not read").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.Palette.ink)
            }
            Text("The receipt confirmed the MUSD is escrowed, but it did not carry a LinkCreated log this app could read, so Maren does not know the link's id and will not guess one. Find the id on the explorer and pair it with the key below to build the link. You can reclaim the escrow after \(expiryDate.formatted(date: .abbreviated, time: .shortened)).")
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("Claim key, shown once").labelStyle().foregroundStyle(Theme.Palette.warning)
                    Text(secret)
                        .font(.figure(13, weight: .regular))
                        .foregroundStyle(Theme.Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            CopyButton(value: secret, describes: "the claim key", style: .filled)
            if let outcome {
                OutcomeView(outcome: outcome, network: .testnet) { dismiss() }
            }
        }
    }

    // Demo: nothing was submitted, so there is no escrow and no id, and therefore no link.
    @ViewBuilder private var walkedView: some View {
        if let outcome {
            OutcomeView(
                outcome: outcome,
                network: .testnet,
                detail: OutcomeDetail(caption: "No link was created", rows: [])
            ) { dismiss() }
            Text("A claimable link only exists once MarenPay has escrowed the MUSD and reported the link's id. Nothing was escrowed here, so there is no link to show.")
                .font(.system(size: 13)).foregroundStyle(Theme.Palette.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var failedView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
