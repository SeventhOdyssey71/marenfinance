import SwiftUI

// MARK: - Send
//
// Amount → recipient (@handle or 0x) → review → submit. Relayed, so gasless. The recipient is
// validated to the same allowlist the scanner uses; a malformed one blocks Review rather than
// being passed through unchecked.

struct SendFlow: View {
    var prefill: PaymentLinks.PaymentPayload? = nil
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, review, submitting, done }
    @State private var stage: Stage = .entry
    @State private var amountText = ""
    @State private var recipient = ""
    @State private var memo = ""
    @State private var outcome: SubmitOutcome?

    private var amount: Decimal? { Amount.parse(amountText) }
    private var recipientValid: Bool { PaymentLinks.isRecipient(recipient.trimmingCharacters(in: .whitespaces)) }
    private var canProceed: Bool { amount != nil && recipientValid }

    var body: some View {
        FlowScreen(title: "Send") {
            switch stage {
            case .entry: entry
            case .review, .submitting: review
            case .done: outcomeView
            }
        }
        .onAppear {
            if let prefill {
                recipient = prefill.to
                if let amount = prefill.amount { amountText = amount }
            }
        }
    }

    @ViewBuilder private var entry: some View {
        AmountField(unit: "MUSD", text: $amountText)
        TextEntryCard(
            label: "To",
            placeholder: "@handle or 0x address",
            text: $recipient,
            footnote: recipient.isEmpty || recipientValid ? nil : "Not a valid @handle or 0x address."
        )
        TextEntryCard(label: "Memo", placeholder: "Optional note (on-chain)", text: $memo,
                      autocapitalization: .sentences)
        GasNote(mode: .sponsored)
        SubmitBar(title: "Review", enabled: canProceed) { stage = .review }
    }

    @ViewBuilder private var review: some View {
        if let amount {
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Sending")
                        .labelStyle()
                    MoneyText(text: MoneyFormat.musd(amount), size: 34, weight: .bold)
                }
            }
            ReviewList(rows: reviewRows(amount))
            GasNote(mode: .sponsored)
            SubmitBar(title: "Send \(MoneyFormat.musd(amount, unit: false)) MUSD", submitting: stage == .submitting) {
                Task { await submit(amount) }
            }
            if stage != .submitting {
                PillButton(title: "Back", variant: .quiet) { stage = .entry }
            }
        }
    }

    private func reviewRows(_ amount: Decimal) -> [ReviewRow] {
        var rows = [ReviewRow(label: "To", value: recipient.trimmingCharacters(in: .whitespaces), plain: true)]
        let trimmedMemo = memo.trimmingCharacters(in: .whitespaces)
        if !trimmedMemo.isEmpty {
            rows.append(ReviewRow(label: "Memo", value: "“\(trimmedMemo)”", plain: true))
        }
        return rows
    }

    private func submit(_ amount: Decimal) async {
        stage = .submitting
        let trimmedMemo = memo.trimmingCharacters(in: .whitespaces)
        let intent = Intent(kind: .send(to: recipient.trimmingCharacters(in: .whitespaces), memo: trimmedMemo),
                            amount: amount, unit: .musd)
        outcome = await actions.submit(intent)
        stage = .done
    }

    @ViewBuilder private var outcomeView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
