import SwiftUI

// MARK: - SingleAmountFlow
//
// The workhorse for any flow that is "enter one amount, review it, submit it": deposit,
// borrow, repay, withdraw, Earn supply/withdraw. Full screen, the same shape as Send: a
// custom keypad and a big animated figure, then an honest review, then the glossy loader,
// then the one honest outcome — so every money flow reads and behaves identically.

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

struct SingleAmountFlow: View {
    let config: AmountFlowConfig
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage { case amount, review, submitting, done }
    @State private var stage: Stage = .amount
    @State private var raw = ""
    @State private var outcome: SubmitOutcome?

    private var isMusd: Bool { config.unit == .musd }
    private var unitLabel: String { isMusd ? "MUSD" : "BTC" }
    private var amount: Decimal? { Decimal(string: raw.isEmpty ? "0" : raw) }
    private var overMax: Bool { if let a = amount, let m = config.available { return a > m }; return false }
    private var amountValid: Bool { (amount ?? 0) > 0 && !overMax }

    var body: some View {
        VStack(spacing: 0) {
            switch stage {
            case .amount:     amountStage
            case .review:     reviewStage
            case .submitting: submittingStage
            case .done:       doneStage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.Palette.canvas)
    }

    private func header(_ title: String) -> some View {
        HStack {
            Text(title).font(.display(24, weight: .medium)).foregroundStyle(Theme.Palette.ink)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.Palette.muted).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, Theme.Space.md).padding(.top, Theme.Space.sm)
    }

    // MARK: amount

    private var amountStage: some View {
        VStack(spacing: Theme.Space.md) {
            header(config.navTitle)
            if let explainer = config.explainer {
                Text(explainer).font(.text(13)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Theme.Space.md)
            }
            Spacer(minLength: 0)
            AmountReadout(raw: raw, unitLabel: unitLabel,
                          prefix: isMusd ? "$" : "", showToggle: isMusd)
            if overMax {
                Text(isMusd ? "More than your available MUSD" : "More than you can use")
                    .font(.text(13, weight: .medium)).foregroundStyle(Theme.Palette.warning)
            }
            Spacer(minLength: 0)
            if let available = config.available, let label = config.availableLabel {
                availableCard(available, label)
            }
            AmountKeypad(onDigit: digit, onDot: dot, onDelete: del)
                .padding(.horizontal, Theme.Space.sm)
            GasNote(mode: config.gas, detail: config.gasDetail).padding(.horizontal, Theme.Space.md)
            PillButton(title: "Review", variant: .primary) { stage = .review }
                .disabled(!amountValid)
                .opacity(amountValid ? 1 : 0.5)
                .padding(.horizontal, Theme.Space.md).padding(.bottom, Theme.Space.md)
        }
    }

    private func availableCard(_ available: Decimal, _ label: String) -> some View {
        HStack(spacing: Theme.Space.sm) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                Text(figure(available) + " " + unitLabel)
                    .font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
            }
            Spacer()
            Button { raw = figure(available) } label: {
                Text("Use Max").font(.text(14, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(Theme.Palette.card, in: Capsule())
            }
            .buttonStyle(PressableStyle())
        }
        .padding(Theme.Space.sm)
        .background(Theme.Palette.inset, in: RoundedRectangle(cornerRadius: Theme.Radius.pill, style: .continuous))
        .padding(.horizontal, Theme.Space.md)
    }

    // MARK: review

    private var reviewStage: some View {
        VStack(spacing: Theme.Space.md) {
            header(config.navTitle)
            if let amount {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Space.lg) {
                        MCard {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("You’re submitting").labelStyle()
                                MoneyText(text: "\(figure(amount)) \(unitLabel)", size: 34, weight: .bold)
                            }
                        }
                        ReviewList(rows: config.reviewRows(amount))
                        GasNote(mode: config.gas, detail: config.gasDetail)
                    }
                    .padding(.horizontal, Theme.Space.md)
                }
                VStack(spacing: Theme.Space.sm) {
                    PillButton(title: config.submitTitle, variant: .primary) { Task { await submit(amount) } }
                    PillButton(title: "Back", variant: .quiet) { stage = .amount }
                }
                .padding(.horizontal, Theme.Space.md).padding(.bottom, Theme.Space.md)
            }
        }
    }

    // MARK: submitting + done

    private var submittingStage: some View {
        VStack(spacing: Theme.Space.lg) {
            header(config.navTitle)
            Spacer()
            LogoLoader()
            Text("Working…").font(.text(16, weight: .medium)).foregroundStyle(Theme.Palette.muted)
            Spacer()
        }
    }

    private var doneStage: some View {
        VStack(alignment: .leading, spacing: Theme.Space.lg) {
            header(config.navTitle)
            if let outcome {
                OutcomeView(outcome: outcome, network: .testnet) { dismiss() }
                    .padding(.horizontal, Theme.Space.md)
            }
            Spacer()
        }
    }

    // MARK: keypad + submit

    private func digit(_ d: String) {
        if raw == "0" { raw = d; return }
        let maxDp = isMusd ? 2 : 8
        if let dot = raw.firstIndex(of: "."), raw.distance(from: dot, to: raw.endIndex) > maxDp { return }
        if raw.count >= 14 { return }
        raw += d
    }
    private func dot() { if !raw.contains(".") { raw = raw.isEmpty ? "0." : raw + "." } }
    private func del() { if !raw.isEmpty { raw.removeLast() } }

    private func figure(_ value: Decimal) -> String {
        (isMusd ? MoneyFormat.musd(value, unit: false) : MoneyFormat.btc(value, unit: false))
            .replacingOccurrences(of: ",", with: "")
    }

    private func submit(_ amount: Decimal) async {
        stage = .submitting
        outcome = await actions.submit(config.makeIntent(amount))
        stage = .done
    }
}
