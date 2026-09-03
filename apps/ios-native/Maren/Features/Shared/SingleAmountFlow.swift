import SwiftUI

// MARK: - SingleAmountFlow
//
// The workhorse for any flow that is "enter one amount, review it, submit it": deposit,
// borrow, repay, withdraw, Earn supply/withdraw. Three stages — entry, review, outcome —
// with the honest submit discipline handled once here, so no screen re-implements it and
// none can drift on what "done" means.

struct AmountFlowConfig {
    let navTitle: String
    let unit: Intent.Unit
    var explainer: String? = nil
    /// Preset chips, in the amount's unit. Empty for none.
    var presets: [Decimal] = []
    /// The spendable/available ceiling and its label, when there is one to enforce.
    var available: Decimal? = nil
    var availableLabel: String? = nil
    let gas: GasMode
    var gasDetail: String? = nil
    let submitTitle: String
    /// Builds the intent to submit for a validated amount.
    let makeIntent: (Decimal) -> Intent
    /// The review rows to state back before submitting.
    let reviewRows: (Decimal) -> [ReviewRow]
}

private func unitLabel(_ unit: Intent.Unit) -> String { unit == .musd ? "MUSD" : "BTC" }

struct SingleAmountFlow: View {
    let config: AmountFlowConfig
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case entry, review, submitting, done }

    @State private var stage: Stage = .entry
    @State private var amountText = ""
    @State private var outcome: SubmitOutcome?

    private var amount: Decimal? { Amount.parse(amountText) }
    private var overMax: Bool {
        guard let amount, let available = config.available else { return false }
        return amount > available
    }
    private var canProceed: Bool { amount != nil && !overMax }

    var body: some View {
        FlowScreen(title: config.navTitle) {
            switch stage {
            case .entry: entry
            case .review, .submitting: review
            case .done: outcomeView
            }
        }
    }

    // MARK: entry

    @ViewBuilder private var entry: some View {
        if let explainer = config.explainer {
            Text(explainer)
                .font(.system(size: 15))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        AmountField(unit: unitLabel(config.unit), text: $amountText, caption: overMax ? overMaxCaption : nil)
        if !config.presets.isEmpty {
            presetRow
        }
        if let available = config.available, let label = config.availableLabel {
            MCard(padding: Theme.Space.md) {
                StatRow(label: label, showsDivider: false) {
                    MoneyText(text: figure(available), size: 17, weight: .semibold)
                }
            }
        }
        GasNote(mode: config.gas, detail: config.gasDetail)
        SubmitBar(title: "Review", enabled: canProceed) { stage = .review }
    }

    private var overMaxCaption: String {
        config.unit == .musd ? "More than your available MUSD." : "More than you can use."
    }

    private var presetRow: some View {
        HStack(spacing: Theme.Space.sm) {
            ForEach(config.presets, id: \.self) { preset in
                Button {
                    amountText = MoneyFormat.musd(preset, unit: false).replacingOccurrences(of: ",", with: "")
                    if config.unit == .btc { amountText = MoneyFormat.btc(preset, unit: false) }
                } label: {
                    Text(config.unit == .musd ? MoneyFormat.musd(preset, unit: false) : MoneyFormat.btc(preset, unit: false))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Theme.Palette.inset, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Use \(figure(preset)) \(unitLabel(config.unit))")
            }
            if let available = config.available {
                Button {
                    amountText = config.unit == .musd ? MoneyFormat.musd(available, unit: false).replacingOccurrences(of: ",", with: "") : MoneyFormat.btc(available, unit: false)
                } label: {
                    Text("Max")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Theme.Palette.inset, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Use the maximum")
            }
        }
    }

    // MARK: review

    @ViewBuilder private var review: some View {
        if let amount {
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text("You’re submitting")
                        .labelStyle()
                    MoneyText(text: "\(figure(amount)) \(unitLabel(config.unit))", size: 34, weight: .bold)
                }
            }
            ReviewList(rows: config.reviewRows(amount))
            GasNote(mode: config.gas, detail: config.gasDetail)
            SubmitBar(title: config.submitTitle, submitting: stage == .submitting) {
                Task { await submit(amount) }
            }
            if stage != .submitting {
                PillButton(title: "Back", variant: .quiet) { stage = .entry }
            }
        }
    }

    private func submit(_ amount: Decimal) async {
        stage = .submitting
        let result = await actions.submit(config.makeIntent(amount))
        outcome = result
        stage = .done
    }

    // MARK: outcome

    @ViewBuilder private var outcomeView: some View {
        if let outcome {
            OutcomeView(outcome: outcome, network: .testnet) { dismiss() }
        }
    }

    private func figure(_ value: Decimal) -> String {
        config.unit == .musd ? MoneyFormat.musd(value, unit: false) : MoneyFormat.btc(value, unit: false)
    }
}
