import SwiftUI

// MARK: - Split
//
// Pay many at once. Each leg is an independent payer→recipient transfer; nothing pools. A leg
// needs a valid recipient and a positive amount to count; Review is blocked until at least two
// complete legs exist.

struct SplitFlow: View {
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private struct Leg: Identifiable { let id = UUID(); var recipient = ""; var amount = "" }
    private enum Stage: Equatable { case entry, review, submitting, done }

    @State private var legs: [Leg] = [Leg(), Leg()]
    @State private var stage: Stage = .entry
    @State private var outcome: SubmitOutcome?

    private struct ValidLeg { let recipient: String; let amount: Decimal }

    private var validLegs: [ValidLeg] {
        legs.compactMap { leg in
            let to = leg.recipient.trimmingCharacters(in: .whitespaces)
            guard PaymentLinks.isRecipient(to), let amount = Amount.parse(leg.amount) else { return nil }
            return ValidLeg(recipient: to, amount: amount)
        }
    }

    private var total: Decimal { validLegs.reduce(0) { $0 + $1.amount } }
    private var canProceed: Bool { validLegs.count >= 2 }

    var body: some View {
        FlowScreen(title: "Split") {
            switch stage {
            case .entry: entry
            case .review, .submitting: review
            case .done: outcomeView
            }
        }
    }

    @ViewBuilder private var entry: some View {
        Text("Pay several people at once. Each leg is its own transfer — nothing is pooled.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)

        ForEach($legs) { $leg in
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    HStack {
                        Text("Recipient").labelStyle()
                        Spacer()
                        if legs.count > 2 {
                            Button {
                                legs.removeAll { $0.id == leg.id }
                            } label: {
                                Image(systemName: "minus.circle")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(Theme.Palette.tertiary)
                                    .frame(width: 44, height: 44, alignment: .trailing)
                            }
                            .accessibilityLabel("Remove this recipient")
                        }
                    }
                    TextField("@handle or 0x address", text: $leg.recipient)
                        .font(.figure(15, weight: .regular))
                        .foregroundStyle(Theme.Palette.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Recipient")
                    Divider().overlay(Theme.Palette.ink.opacity(0.07))
                    HStack {
                        TextField("0", text: $leg.amount)
                            .font(.figure(20, weight: .semibold))
                            .foregroundStyle(Theme.Palette.ink)
                            .keyboardType(.decimalPad)
                            .accessibilityLabel("Amount in MUSD")
                        Text("MUSD").font(.figure(15, weight: .semibold)).foregroundStyle(Theme.Palette.tertiary)
                    }
                }
            }
        }

        Button {
            legs.append(Leg())
        } label: {
            Label("Add recipient", systemImage: "plus")
                .pillLabel(dark: false)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Add another recipient")

        GasNote(mode: .sponsored)
        SubmitBar(title: "Review", enabled: canProceed) { stage = .review }
    }

    @ViewBuilder private var review: some View {
        MCard {
            VStack(alignment: .leading, spacing: 4) {
                Text("Total across \(validLegs.count) recipients").labelStyle()
                MoneyText(text: MoneyFormat.musd(total), size: 34, weight: .bold)
            }
        }
        ReviewList(rows: validLegs.map {
            ReviewRow(label: shortRecipient($0.recipient), value: MoneyFormat.musd($0.amount))
        })
        GasNote(mode: .sponsored)
        SubmitBar(title: "Send to \(validLegs.count)", submitting: stage == .submitting) {
            Task { await submit() }
        }
        if stage != .submitting {
            PillButton(title: "Back", variant: .quiet) { stage = .entry }
        }
    }

    private func shortRecipient(_ s: String) -> String {
        if s.hasPrefix("@") { return s }
        guard s.count > 12 else { return s }
        return String(s.prefix(6)) + "…" + String(s.suffix(4))
    }

    private func submit() async {
        stage = .submitting
        let intent = Intent(kind: .split(recipients: validLegs.map(\.recipient)), amount: total, unit: .musd)
        outcome = await actions.submit(intent)
        stage = .done
    }

    @ViewBuilder private var outcomeView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
