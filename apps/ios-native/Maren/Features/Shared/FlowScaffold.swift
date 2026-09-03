import SwiftUI
import UIKit

// MARK: - Flow scaffolding
//
// The shared pieces every money flow is built from — one amount keypad, one gas note, one
// review list, one submit bar, one honest outcome view — so a send, a deposit and a claim
// read as the same app and can never disagree about what "done" or "nothing happened" looks
// like. Soft-UGLYCASH throughout: cream canvas, borderless cards, greyed decimals, the one
// pink-glow primary.

// MARK: FlowScreen — a sheet frame

struct FlowScreen<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.lg) {
                    content
                }
                .padding(.horizontal, Theme.Space.md)
                .padding(.top, Theme.Space.sm)
                .padding(.bottom, Theme.Space.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Theme.Palette.canvas)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .tint(Theme.Palette.ink)
                }
            }
            .toolbarBackground(Theme.Palette.card, for: .navigationBar)
        }
    }
}

// MARK: AmountField — the one keypad

struct AmountField: View {
    let unit: String                 // "MUSD" or "BTC"
    @Binding var text: String
    var caption: String? = nil
    @FocusState private var focused: Bool

    var body: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Amount")
                    .labelStyle()
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    TextField("0", text: $text)
                        .font(.figure(40, weight: .bold))
                        .foregroundStyle(Theme.Palette.ink)
                        .keyboardType(.decimalPad)
                        .focused($focused)
                        .accessibilityLabel("Amount in \(unit)")
                    Text(unit)
                        .font(.figure(20, weight: .semibold))
                        .foregroundStyle(Theme.Palette.tertiary)
                }
                if let caption {
                    Text(caption)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .onAppear { focused = true }
    }
}

// MARK: TextEntryCard — recipient, memo, pasted link

struct TextEntryCard: View {
    let label: String
    var placeholder: String
    @Binding var text: String
    var autocapitalization: TextInputAutocapitalization = .never
    var footnote: String? = nil
    /// Shows a Paste button in the label row. On for fields you actually paste into (an
    /// address, a key), so entry never depends on the keyboard's paste gesture — which is
    /// unreliable in the Simulator.
    var showsPaste: Bool = false

    var body: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack(spacing: Theme.Space.sm) {
                    Text(label).labelStyle()
                    Spacer(minLength: 0)
                    if showsPaste {
                        Button {
                            if let clip = UIPasteboard.general.string {
                                text = clip.trimmingCharacters(in: .whitespacesAndNewlines)
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.on.clipboard")
                                Text("Paste")
                            }
                            .font(.text(13, weight: .medium))
                            .foregroundStyle(Theme.Palette.accentText)
                            .padding(.vertical, 8).padding(.horizontal, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("Paste from clipboard")
                    }
                }
                TextField(placeholder, text: $text, axis: .vertical)
                    .font(.figure(16, weight: .regular))
                    .foregroundStyle(Theme.Palette.ink)
                    .textInputAutocapitalization(autocapitalization)
                    .autocorrectionDisabled()
                    .accessibilityLabel(label)
                if let footnote {
                    Text(footnote)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

// MARK: GasNote — the honest cost line

struct GasNote: View {
    let mode: GasMode
    /// Overrides the default body — Earn uses this, being unsponsored for its own reason.
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: mode == .sponsored ? "sparkles" : "bitcoinsign.circle")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(mode == .sponsored ? Theme.Palette.accentText : Theme.Palette.btc)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(mode.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                Text(detail ?? mode.body)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            (mode == .sponsored ? Theme.Palette.accentWash : Theme.Palette.inset).opacity(0.6),
            in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous)
        )
    }
}

// MARK: ReviewList — labelled figures a submit will act on

struct ReviewRow: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    var hint: String? = nil
    /// When true the value is rendered as an explicit unavailable state, not a number.
    var unavailable: Bool = false
    /// When true the value is plain text (an address, a memo), not a money figure.
    var plain: Bool = false
}

struct ReviewList: View {
    let rows: [ReviewRow]

    var body: some View {
        MCard(padding: Theme.Space.md) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    StatRow(label: row.label, hint: row.hint, showsDivider: index < rows.count - 1,
                            fixedValue: !row.plain) {
                        if row.unavailable {
                            Unavailable()
                        } else if row.plain {
                            Text(row.value)
                                .font(.figure(15, weight: .medium))
                                .foregroundStyle(Theme.Palette.ink)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } else {
                            MoneyText(text: row.value, size: 17, weight: .semibold)
                        }
                    }
                }
            }
        }
    }
}

// MARK: SubmitBar — the one primary action, with a submitting state

struct SubmitBar: View {
    let title: String
    var enabled: Bool = true
    var submitting: Bool = false
    let action: () -> Void

    var body: some View {
        ZStack {
            PillButton(title: submitting ? "Submitting…" : title, variant: .primary) {
                if enabled && !submitting { action() }
            }
            .disabled(!enabled || submitting)
            .opacity(enabled ? 1 : 0.5)
            if submitting {
                ProgressView()
                    .tint(.white)
                    .padding(.trailing, Theme.Space.md)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityLabel(submitting ? "Submitting" : title)
    }
}

// MARK: OutcomeView — R15, the only honest ending
//
// Renders exactly what a submit resolved to and nothing more. A demo says nothing was
// submitted; a delivered receipt names its gas and links the explorer; a decline and a
// failure both say plainly that no funds moved.

struct OutcomeView: View {
    let outcome: SubmitOutcome
    let network: MezoNetwork
    var detail: OutcomeDetail? = nil
    var onDone: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: Theme.Space.lg) {
            Spacer(minLength: Theme.Space.md)

            OutcomeBadge(tone: tone, symbol: symbol, isSuccess: isSuccess)

            VStack(spacing: Theme.Space.xs) {
                Text(headline)
                    .font(.display(26, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if let caption = detail?.caption {
                    Text(caption).font(.text(14)).foregroundStyle(Theme.Palette.tertiary)
                }
                if let hero = detail?.hero {
                    Text(hero)
                        .font(.figure(34, weight: .bold))
                        .foregroundStyle(Theme.Palette.ink)
                        .monospacedDigit()
                }
            }

            Text(message)
                .font(.text(14))
                .foregroundStyle(Theme.Palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if !rows.isEmpty { detailCard }

            Spacer(minLength: Theme.Space.md)

            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, Theme.Space.md)
    }

    // The detail card — icon-led rows with hairline separators, like a receipt.
    private var detailCard: some View {
        MCard {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    HStack(spacing: Theme.Space.sm) {
                        Image(systemName: row.icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.Palette.tertiary)
                            .frame(width: 18)
                        Text(row.label).font(.text(14)).foregroundStyle(Theme.Palette.muted)
                        Spacer(minLength: Theme.Space.sm)
                        Text(row.value)
                            .font(.text(14, weight: .medium))
                            .foregroundStyle(Theme.Palette.ink)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    .padding(.vertical, 11)
                    if index < rows.count - 1 {
                        Rectangle().fill(Theme.Palette.ink.opacity(0.06)).frame(height: 1)
                    }
                }
            }
        }
    }

    private var footer: some View {
        Group {
            if let hash = explorerHash {
                HStack(spacing: Theme.Space.sm) {
                    PillButton(title: "Explorer", variant: .quiet) { openURL(explorerURL(hash)) }
                    PillButton(title: "Done", variant: .primary, action: onDone)
                }
            } else {
                PillButton(title: "Done", variant: .primary, action: onDone)
            }
        }
    }

    private var isSuccess: Bool {
        if case .delivered = outcome { return true }
        return false
    }

    private var explorerHash: String? {
        if case let .delivered(d) = outcome { return d.hash }
        if case let .failed(o) = outcome { return failedHash(o) }
        return nil
    }

    // Context rows from the flow, plus Network + Gas once a receipt exists.
    private var rows: [OutcomeRow] {
        var out = detail?.rows ?? []
        if case let .delivered(d) = outcome {
            out.append(OutcomeRow(icon: "link", label: "Network",
                                  value: network == .testnet ? "Mezo testnet" : "Mezo"))
            out.append(OutcomeRow(icon: "fuelpump.fill", label: "Gas",
                                  value: d.sponsored ? "Paid by Maren" : "You paid BTC"))
        }
        return out
    }

    private func explorerURL(_ hash: String) -> URL {
        MezoChain.of(network).explorerURL.appendingPathComponent("tx").appendingPathComponent(hash)
    }

    private func failedHash(_ outcome: TxOutcome) -> String? {
        switch outcome {
        case let .reverted(hash, _): return hash
        case let .timeout(hash): return hash
        case let .unreachable(hash, _): return hash
        case .delivered: return nil
        }
    }

    // MARK: presentation of each case

    private var tone: Color {
        switch outcome {
        case .demo: return Theme.Palette.accentText
        case .delivered: return Theme.Palette.success
        case .declined: return Theme.Palette.warning
        case .failed: return Theme.Palette.danger
        }
    }

    private var symbol: String {
        switch outcome {
        case .demo: return "flask.fill"
        case .delivered: return "checkmark"
        case .declined: return "hand.raised"
        case .failed: return "xmark"
        }
    }

    private var headline: String {
        switch outcome {
        case .demo: return "Demo — nothing was sent"
        case .delivered: return "Confirmed"
        case .declined: return "Nothing was submitted"
        case let .failed(outcome):
            switch outcome {
            case .reverted: return "Failed, no funds moved"
            case .timeout: return "Still awaiting a receipt"
            case .unreachable: return "Could not reach the chain"
            case .delivered: return "Confirmed"
            }
        }
    }

    private var message: String {
        switch outcome {
        case .demo:
            return "This build runs on demo data, so nothing was submitted to any chain. No gas was spent and no funds moved — this is the flow, not a real transaction."
        case .delivered:
            return "An on-chain receipt reported success. This is the only thing this app calls done."
        case let .declined(reason):
            return reason
        case let .failed(outcome):
            switch outcome {
            case .reverted:
                return "The chain accepted the transaction and then reverted it, so your funds did not move."
            case .timeout:
                return "No receipt arrived inside the wait. This is not a failure — it may still land. Check the explorer before retrying."
            case let .unreachable(_, error):
                return "The chain could not be reached to confirm this, so whether it landed is unknown. \(error)"
            case .delivered:
                return "Confirmed."
            }
        }
    }
}
