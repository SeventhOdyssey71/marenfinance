import SwiftUI

// MARK: - Send (full screen)
//
// Recipient → amount (custom keypad, big animated figure) → submit (glossy coin loader) →
// honest outcome. Relayed, so gasless. The recipient is validated to the same allowlist the
// scanner uses; the amount is typed on the app's own keypad, never the system one.

struct SendFlow: View {
    var prefill: PaymentLinks.PaymentPayload? = nil
    @Environment(\.marenActions) private var actions
    @Environment(\.marenClient) private var client
    @Environment(\.dismiss) private var dismiss

    private enum Stage { case amount, recipient, submitting, done }
    @State private var stage: Stage = .amount
    @State private var recipient = ""
    @State private var raw = ""            // the amount as typed
    @State private var balance: Decimal?
    @State private var outcome: SubmitOutcome?
    @State private var loaded = false
    @State private var balanceLoaded = false
    @State private var resolvedAddress: String?   // a handle's resolved 0x address, as you type
    @State private var resolving = false

    private var trimmedRecipient: String { recipient.trimmingCharacters(in: .whitespaces) }
    private var recipientValid: Bool { PaymentLinks.isRecipient(trimmedRecipient) }
    private var isHandle: Bool { PaymentLinks.isHandle(trimmedRecipient) }

    /// Ready to send: a literal address always is; a handle only once it has resolved.
    private var canSend: Bool {
        if PaymentLinks.isAddress(trimmedRecipient) { return true }
        if isHandle { return resolvedAddress != nil }
        return false
    }
    private var amount: Decimal? { Decimal(string: raw.isEmpty ? "0" : raw) }
    private var amountValid: Bool { (amount ?? 0) > 0 }
    private var overBalance: Bool { if let a = amount, let b = balance { return a > b }; return false }

    var body: some View {
        VStack(spacing: 0) {
            switch stage {
            case .recipient:  recipientStage
            case .amount:     amountStage
            case .submitting: submittingStage
            case .done:       doneStage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.Palette.canvas)
        .task {
            guard !loaded else { return }
            loaded = true
            balance = try? await client.balances().musd
            balanceLoaded = true
            // Screenshot/testing hook: jump straight to a stage with a sample recipient and
            // amount typed into the form. The whole block is DEBUG-only, so neither the sample
            // address nor the sample amount is even present in a Release binary.
            #if DEBUG
            let hookScreen = ScreenshotHooks.screen
            switch hookScreen {
            case "sendamount", "sendloading":
                recipient = "0x7094000000000000000000000000000000002242"
                raw = "3"
                stage = hookScreen == "sendloading" ? .submitting : .amount
                return
            default: break
            }
            #endif
            if let prefill {
                recipient = prefill.to
                if let a = prefill.amount { raw = a }
            }
        }
    }

    // MARK: header

    private func header(title: String, pill: String? = nil, onPill: (() -> Void)? = nil) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Text(title)
                .font(.display(24, weight: .medium))
                .foregroundStyle(Theme.Palette.ink)
            if let pill {
                Button { onPill?() } label: {
                    Text(pill)
                        .font(.figure(14, weight: .medium))
                        .foregroundStyle(Theme.Palette.ink)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(Theme.Palette.inset, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Recipient \(pill), tap to change")
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.Palette.muted)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, Theme.Space.md)
        .padding(.top, Theme.Space.sm)
    }

    // MARK: recipient

    private var recipientStage: some View {
        VStack(alignment: .leading, spacing: Theme.Space.lg) {
            header(title: "Send")
            Text("Who are you paying?").font(.display(28, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                .padding(.horizontal, Theme.Space.md)
            TextEntryCard(
                label: "Send to",
                placeholder: "@handle or 0x address",
                text: $recipient,
                footnote: recipient.isEmpty || recipientValid ? nil : "Not a valid @handle or 0x address.",
                showsPaste: true
            )
            .padding(.horizontal, Theme.Space.md)
            if isHandle { handlePreview.padding(.horizontal, Theme.Space.md) }
            Spacer()
            PillButton(title: "Send \(MoneyFormat.musd(amount ?? 0, unit: false)) MUSD", variant: .primary) {
                Task { await submit() }
            }
            .disabled(!canSend)
            .padding(.horizontal, Theme.Space.md)
            .padding(.bottom, Theme.Space.md)
        }
        // As-you-type handle resolution, debounced. `.task(id:)` cancels the prior lookup on
        // every keystroke, so only the settled handle hits the registry.
        .task(id: trimmedRecipient) {
            resolvedAddress = nil
            guard isHandle else { resolving = false; return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            if Task.isCancelled { return }
            resolving = true
            let address = await actions.resolve(trimmedRecipient)
            if Task.isCancelled { return }
            resolvedAddress = address
            resolving = false
        }
    }

    // The line under a @handle: resolving → resolved address → or not registered.
    @ViewBuilder private var handlePreview: some View {
        HStack(spacing: 6) {
            if resolving {
                ProgressView().controlSize(.small)
                Text("Resolving \(trimmedRecipient)…")
                    .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
            } else if let resolvedAddress {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12)).foregroundStyle(Theme.Palette.success)
                Text(resolvedAddress)
                    .font(.text(12))
                    .foregroundStyle(Theme.Palette.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .truncationMode(.middle)
            } else {
                Text("\(trimmedRecipient) isn’t registered yet.")
                    .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: amount

    private var amountStage: some View {
        VStack(spacing: Theme.Space.md) {
            header(title: "Send")
            Spacer(minLength: 0)
            AmountReadout(raw: raw, unitLabel: "MUSD", onToggle: {})
            if overBalance {
                Text("More than your balance").font(.text(13, weight: .medium)).foregroundStyle(Theme.Palette.warning)
            }
            Spacer(minLength: 0)
            assetCard
            AmountKeypad(onDigit: digit, onDot: dot, onDelete: del)
                .padding(.horizontal, Theme.Space.sm)
            PillButton(title: "Continue", variant: .primary) { stage = .recipient }
                .disabled(!amountValid || overBalance)
                .padding(.horizontal, Theme.Space.md)
                .padding(.bottom, Theme.Space.md)
        }
    }

    private var assetCard: some View {
        HStack(spacing: Theme.Space.sm) {
            MusdCoin(size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text("MUSD").font(.text(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                Text(balance.map { "\(MoneyFormat.musd($0, unit: false)) available" }
                     ?? (balanceLoaded ? "Balance unavailable" : "0,000.00 available"))
                    .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                    .skeleton(!balanceLoaded && balance == nil)
            }
            Spacer()
            Button { useMax() } label: {
                Text("Use Max").font(.text(14, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(Theme.Palette.card, in: Capsule())
            }
            .buttonStyle(PressableStyle())
            .disabled(balance == nil)
        }
        .padding(Theme.Space.sm)
        .background(Theme.Palette.inset, in: RoundedRectangle(cornerRadius: Theme.Radius.pill, style: .continuous))
        .padding(.horizontal, Theme.Space.md)
    }

    // MARK: submitting + done

    private var submittingStage: some View {
        VStack(spacing: Theme.Space.lg) {
            Spacer()
            LogoLoader()
            VStack(spacing: 4) {
                Text("Sending \(MoneyFormat.musd(amount ?? 0, unit: false)) MUSD")
                    .font(.display(20, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                Text("to \(shortRecipient)")
                    .font(.text(14)).foregroundStyle(Theme.Palette.tertiary)
            }
            Spacer()
        }
    }

    private var doneStage: some View {
        Group {
            if let outcome {
                OutcomeView(outcome: outcome, network: .testnet, detail: outcomeDetail(for: outcome)) { dismiss() }
            }
        }
    }

    private func outcomeDetail(for outcome: SubmitOutcome) -> OutcomeDetail? {
        guard case .delivered = outcome, let amount else { return nil }
        return OutcomeDetail(
            caption: "You sent",
            hero: "\(MoneyFormat.musd(amount, unit: false)) MUSD",
            rows: [OutcomeRow(icon: trimmedRecipient.hasPrefix("@") ? "at" : "person.fill",
                              label: "To", value: shortRecipient)]
        )
    }

    // MARK: keypad logic

    private func digit(_ d: String) {
        if raw == "0" { raw = d; return }
        if let dot = raw.firstIndex(of: "."), raw.distance(from: dot, to: raw.endIndex) > 2 { return }  // max 2 dp
        if raw.count >= 12 { return }
        raw += d
    }
    private func dot() { if !raw.contains(".") { raw = raw.isEmpty ? "0." : raw + "." } }
    private func del() { if !raw.isEmpty { raw.removeLast() } }
    private func useMax() {
        guard let balance else { return }
        raw = MoneyFormat.musd(balance, unit: false).replacingOccurrences(of: ",", with: "")
    }

    private var shortRecipient: String {
        trimmedRecipient.hasPrefix("@") ? trimmedRecipient : MarenSession.shortAddress(trimmedRecipient)
    }

    private func submit() async {
        guard let amount else { return }
        stage = .submitting
        let intent = Intent(kind: .send(to: trimmedRecipient, memo: ""), amount: amount, unit: .musd)
        outcome = await actions.submit(intent)
        stage = .done
    }
}
