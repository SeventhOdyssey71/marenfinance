import SwiftUI

// MARK: - Claim
//
// Open a claimable link and collect it into your own wallet. The link may be pasted or arrive
// from the scanner via the one-slot in-memory handoff. The bearer secret is parsed only from
// the URL fragment, held only for the duration of the claim, and NEVER logged or displayed.

struct ClaimFlow: View {
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss

    private enum Stage: Equatable { case open, ready, submitting, done }
    @State private var stage: Stage = .open
    @State private var pasted = ""
    @State private var parsed: PaymentLinks.ClaimLink?
    @State private var parseError = false
    @State private var outcome: SubmitOutcome?

    var body: some View {
        FlowScreen(title: "Claim", canDismiss: stage != .submitting) {
            switch stage {
            case .open: openStep
            case .ready, .submitting: readyStep
            case .done: outcomeView
            }
        }
        .onAppear {
            // A link handed over by the scanner takes precedence and is consumed once.
            if let handed = ClaimHandoff.shared.take() {
                parsed = handed
                stage = .ready
            }
        }
    }

    @ViewBuilder private var openStep: some View {
        Text("Paste a Maren claim link, or scan its QR. Anyone with the complete link can claim its funds. Only share it with the intended recipient.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        TextEntryCard(
            label: "Claim link",
            placeholder: "https://\(PaymentLinks.host)/claim?id=…",
            text: $pasted,
            footnote: parseError ? "That is not a valid Maren claim link." : nil
        )
        SubmitBar(title: "Open link", enabled: !pasted.trimmingCharacters(in: .whitespaces).isEmpty) {
            if let link = PaymentLinks.parseClaim(pasted) {
                parsed = link
                parseError = false
                stage = .ready
            } else {
                parseError = true
            }
        }
    }

    @ViewBuilder private var readyStep: some View {
        if let parsed {
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("Claimable link").labelStyle()
                    StatRow(label: "Link", showsDivider: true) {
                        Text("#\(String(parsed.linkId))")
                            .font(.figure(17, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                    }
                    StatRow(label: "Amount", showsDivider: false) {
                        // No on-chain link-state read is wired through MarenClient in this build,
                        // so the escrowed amount is honestly unavailable rather than guessed.
                        Unavailable(label: "Read on claim")
                    }
                    Text("The secret is held only to sign this claim and is never shown or logged.")
                        .font(.system(size: 13)).foregroundStyle(Theme.Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            GasNote(mode: .sponsored)
            SubmitBar(title: "Claim into my wallet", submitting: stage == .submitting) {
                Task { await submit(parsed) }
            }
        }
    }

    private func submit(_ link: PaymentLinks.ClaimLink) async {
        stage = .submitting
        // The amount is unknown until the chain reports it; the outcome carries the truth.
        outcome = await actions.submit(Intent(kind: .claim(link), amount: 0, unit: .musd))
        stage = .done
    }

    @ViewBuilder private var outcomeView: some View {
        if let outcome { OutcomeView(outcome: outcome, network: .testnet) { dismiss() } }
    }
}
