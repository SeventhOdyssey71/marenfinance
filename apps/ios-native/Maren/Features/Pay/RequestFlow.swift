import SwiftUI

// MARK: - Request
//
// Two halves of the same idea, on one screen.
//
//   ASK — `MarenPay.createRequest`. A real on-chain record: it moves no funds and creates no
//   obligation, it just states the ask so the payer can settle it in one press without
//   re-typing an amount. The contract mints the request id and reports it in `RequestCreated`;
//   this screen shows the id it was ACTUALLY given, read from the receipt, or says plainly
//   that the id did not arrive. It never guesses one.
//
//   SETTLE — `MarenPay.fulfillRequest`. Pay a request somebody sent you. Nothing but the id is
//   submitted: the amount and the recipient are the ones the contract already stored, so the
//   payer cannot alter either. The record is read first and shown before anything is signed,
//   and a request that is cancelled, already paid, or addressed to someone else is declined
//   before a signature is asked for rather than after gas is spent discovering it.

struct RequestFlow: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Mode: Hashable { case ask, settle }
    @State private var mode: Mode = .ask

    var body: some View {
        FlowScreen(title: "Request") {
            Segmented(options: [(.ask, "Ask"), (.settle, "Settle")], selection: $mode)
            switch mode {
            case .ask: AskSection()
            case .settle: SettleSection()
            }
        }
    }
}

// MARK: Ask — create a request on-chain

private struct AskSection: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, submitting, created, idUnknown, walked, failed }
    @State private var stage: Stage = .entry
    @State private var account: Account?
    @State private var amountText = ""
    @State private var payerText = ""
    @State private var memoText = ""
    @State private var requestId: UInt64?
    @State private var outcome: SubmitOutcome?

    private var amount: Decimal? { Amount.parse(amountText) }
    private var payer: String { payerText.trimmingCharacters(in: .whitespaces) }
    private var payerIsUsable: Bool { payer.isEmpty || PaymentLinks.isRecipient(payer) }

    var body: some View {
        Group {
            switch stage {
            case .entry, .submitting: entry
            case .created: created
            case .idUnknown: idUnknownView
            case .walked, .failed: outcomeOnly
            }
        }
        .task { account = try? await client.account() }
    }

    @ViewBuilder private var entry: some View {
        Text("Record an ask on Mezo. It moves no funds and puts nobody under an obligation, it just states the amount so whoever you send it to can settle it in one press.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        AmountField(unit: "MUSD", text: $amountText)
        TextEntryCard(
            label: "From (optional)",
            placeholder: "@handle or 0x…",
            text: $payerText,
            footnote: payerIsUsable
                ? "Leave this empty and anyone holding the request can settle it."
                : "That is not a 0x address or an @handle.",
            showsPaste: true
        )
        TextEntryCard(label: "Note (optional)", placeholder: "Dinner", text: $memoText,
                      autocapitalization: .sentences)
        GasNote(mode: .sponsored)
        SubmitBar(title: "Create request", enabled: amount != nil && payerIsUsable,
                  submitting: stage == .submitting) {
            Task { await submit() }
        }
        if let account, stage != .submitting {
            // The shareable link is the existing pay link, addressed to you. It is a
            // convenience for someone who has no request id, not a substitute for one.
            // Addressed to a name only when MarenRegistry confirmed the name is this account's;
            // otherwise the address, which cannot resolve to anybody else.
            let target = account.payTarget
            let figure = amount.map { MoneyFormat.musd($0, unit: false).replacingOccurrences(of: ",", with: "") }
            let link = PaymentLinks.buildPayment(to: target, amount: figure)
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("Or just share a pay link").labelStyle()
                QRCode(string: link, size: 180).frame(maxWidth: .infinity)
                Text("This link opens Send addressed to you. It records nothing on-chain.")
                    .font(.system(size: 13)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ShareLink(item: link) { Text("Share pay link").pillLabel() }
                    .accessibilityLabel("Share a pay link addressed to you")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func submit() async {
        guard let amount else { return }
        stage = .submitting
        let result = await actions.submit(
            Intent(kind: .request(payer: payer.isEmpty ? nil : payer, memo: memoText), amount: amount, unit: .musd)
        )
        outcome = result
        switch result {
        case .demo:
            stage = .walked
        case let .delivered(delivered):
            if let id = delivered.mintedId {
                requestId = id
                stage = .created
            } else {
                stage = .idUnknown
            }
        case .declined, .failed:
            stage = .failed
        }
    }

    @ViewBuilder private var created: some View {
        if let requestId, let amount {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "checkmark").font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.Palette.success).accessibilityHidden(true)
                Text("Request #\(String(requestId))").font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Theme.Palette.ink)
            }
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("You’re asking for").labelStyle()
                    MoneyText(text: MoneyFormat.musd(amount), size: 34, weight: .bold)
                }
            }
            Text("MarenPay minted this id and reported it on the receipt. Give it to whoever is paying. They settle it under Request, then Settle, and the contract pays you the amount above.")
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Theme.Space.sm) {
                CopyButton(value: String(requestId), describes: "the request id", style: .filled)
                ShareLink(item: "Maren request #\(String(requestId)) for \(MoneyFormat.musd(amount))") {
                    Label("Share", systemImage: "square.and.arrow.up").pillLabel()
                }
                .accessibilityLabel("Share the request id")
            }
            PillButton(title: "Done", variant: .quiet) { dismiss() }
        }
    }

    @ViewBuilder private var idUnknownView: some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.Palette.warning).accessibilityHidden(true)
            Text("Recorded, id not read").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.Palette.ink)
        }
        Text("The receipt confirmed the request was recorded, but it did not carry a RequestCreated log this app could read, so Maren does not know the id and will not guess one. It is on the explorer, in this transaction's logs.")
            .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        outcomeOnly
    }

    @ViewBuilder private var outcomeOnly: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}

// MARK: Settle — fulfil a request someone sent you

private struct SettleSection: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, loading, ready, submitting, done }
    @State private var stage: Stage = .entry
    @State private var idText = ""
    @State private var record: PaymentRequestRecord?
    @State private var readProblem: String?
    @State private var outcome: SubmitOutcome?

    private var requestId: UInt64? {
        let trimmed = idText.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard let value = UInt64(trimmed), value > 0 else { return nil }
        return value
    }

    var body: some View {
        Group {
            switch stage {
            case .entry, .loading: entry
            case .ready, .submitting: ready
            case .done: doneView
            }
        }
    }

    @ViewBuilder private var entry: some View {
        Text("Settle a request somebody sent you. Only the id is submitted. The amount and who gets paid are the ones MarenPay already recorded, so neither can be changed here.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        TextEntryCard(
            label: "Request id",
            placeholder: "42",
            text: $idText,
            footnote: readProblem,
            showsPaste: true
        )
        SubmitBar(title: "Look it up", enabled: requestId != nil, submitting: stage == .loading) {
            Task { await lookUp() }
        }
    }

    /// Read the record BEFORE anything is signed, and show it. A request that is cancelled,
    /// already paid, or addressed to somebody else is visible as such here rather than
    /// discovered inside a revert somebody paid for.
    private func lookUp() async {
        guard let requestId else { return }
        stage = .loading
        readProblem = nil
        do {
            guard let read = try await client.paymentRequest(requestId) else {
                readProblem = "MarenPay holds no request #\(String(requestId))."
                stage = .entry
                return
            }
            record = read
            stage = .ready
        } catch {
            // "Couldn't read it" and "there is no such request" are different sentences, and
            // this branch is only ever the first one.
            readProblem = (error as? LocalizedError)?.errorDescription
                ?? "That request could not be read from Mezo, so nothing is being shown for it."
            stage = .entry
        }
    }

    @ViewBuilder private var ready: some View {
        if let read = record {
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Request #\(String(read.id))").labelStyle()
                    MoneyText(text: MoneyFormat.musd(read.amount), size: 34, weight: .bold)
                }
            }
            ReviewList(rows: [
                ReviewRow(label: "Pays", value: read.requester, plain: true),
                ReviewRow(label: "Payable by", value: read.payer ?? "Anyone holding this id", plain: true),
                ReviewRow(label: "Status", value: read.status.label, plain: true),
            ])
            GasNote(mode: .sponsored)
            if read.isOpen {
                SubmitBar(title: "Pay this request", submitting: stage == .submitting) {
                    Task { await submit(read) }
                }
            } else {
                Text("This request is \(read.status.label.lowercased()), so there is nothing to settle. Ids are never reused.")
                    .font(.system(size: 14)).foregroundStyle(Theme.Palette.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if stage != .submitting {
                PillButton(title: "Try another id", variant: .quiet) {
                    record = nil
                    idText = ""
                    stage = .entry
                }
            }
        }
    }

    private func submit(_ read: PaymentRequestRecord) async {
        stage = .submitting
        // The figure is the contract's, not this screen's; the outcome carries the truth.
        outcome = await actions.submit(Intent(kind: .fulfillRequest(requestId: read.id),
                                              amount: read.amount, unit: .musd))
        stage = .done
    }

    @ViewBuilder private var doneView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
