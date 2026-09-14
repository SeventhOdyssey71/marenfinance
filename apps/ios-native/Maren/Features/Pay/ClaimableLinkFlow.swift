import SwiftUI
import web3
import BigInt

// MARK: - Claimable link creation and recovery
// A biometric Keychain draft is written before submission. One unsaved link per wallet can
// be resumed after restart, even if the app died before recording the transaction hash.
// Only a confirmed receipt supplies the link id; no counter or block-number guesses.

struct ClaimableLinkFlow: View {
    @Environment(\.marenActions) private var actions
    @Environment(\.dismiss) private var dismiss
    @Environment(MarenSession.self) private var session
    @Environment(\.isDemoData) private var isDemoData

    private enum Stage: Equatable { case entry, review, submitting, created, idUnknown, walked, failed }
    @State private var stage: Stage = .entry
    @State private var amountText = ""
    /// The share URL is derived from the persisted draft after a receipt supplies its id.
    @State private var link: String?
    /// The bearer key on its own, for the branch where the escrow landed but the id did not.
    @State private var secret: String?
    @State private var outcome: SubmitOutcome?
    @State private var savedDraft: PendingClaimLink?
    @State private var recovering = true
    @State private var recoveryNote: String?

    private var amount: Decimal? { Amount.parse(amountText) }

    /// The expiry this link is created with, fixed at the moment the screen opens so the review
    /// step and the submitted calldata can never quote different dates.
    @State private var expiry = UInt64(Date().timeIntervalSince1970) + CLAIM_LINK_EXPIRY_SECONDS
    private var expiryDate: Date { Date(timeIntervalSince1970: TimeInterval(expiry)) }

    var body: some View {
        FlowScreen(title: "Claimable link", canDismiss: stage != .submitting && !recovering) {
            if recovering {
                ProgressView("Checking saved link…")
            } else {
                switch stage {
                case .entry: entry
                case .review, .submitting: review
                case .created: created
                case .idUnknown: idUnknownView
                case .walked: walkedView
                case .failed: failedView
                }
                if let recoveryNote {
                    Text(recoveryNote).font(.text(14)).foregroundStyle(Theme.Palette.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .task { await loadSavedLink() }
    }

    @ViewBuilder private var entry: some View {
        Text("Escrow MUSD to a one-time link. Whoever opens it can claim the funds into their own wallet, so treat the link like cash.")
            .font(.system(size: 15))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        AmountField(unit: "MUSD", text: $amountText)
        GasNote(mode: .youPayBtc, detail: "You pay BTC gas to create the escrow. Maren sponsors claiming when sponsorship is available.")
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
            GasNote(mode: .youPayBtc, detail: "You pay BTC gas to create the escrow. Maren sponsors claiming when sponsorship is available.")
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
        // in the URL fragment. The recoverable copy stays only in biometric Keychain.
        guard let secretHex = HandleCommitmentStore.newSecret(),
              let secretData = Data(hex: secretHex),
              let linkKey = try? Keystore.address(of: secretData) else {
            outcome = .declined(reason: "A one-time link key could not be generated on this device, so nothing was submitted.")
            stage = .failed
            return
        }

        if !isDemoData {
            guard let owner = session.address else {
                outcome = .declined(reason: "Restore a wallet before creating a claimable link.")
                stage = .failed
                return
            }
            do {
                let chain = MezoChain.of(.testnet)
                let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
                let head = try await client.eth_blockNumber()
                let draft = PendingClaimLink(owner: owner, secret: secretHex, linkKey: linkKey,
                    amount: NSDecimalNumber(decimal: amount).stringValue, expiry: expiry, startBlock: head)
                // Durability precedes signing/broadcast. Failure stops creation entirely.
                try await Keystore.shared.savePendingClaim(draft)
                savedDraft = draft
            } catch {
                outcome = .declined(reason: "A recoverable claim key could not be saved in biometric Keychain. Nothing was escrowed. Enable Face ID or Touch ID, or reopen Claimable link to recover an existing draft.")
                stage = .failed
                return
            }
        }

        let result = await actions.submit(
            Intent(kind: .createLink(linkKey: linkKey, expiry: expiry, memo: ""), amount: amount, unit: .musd)
        )
        outcome = result
        await recordOutcome(result)

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
        case .failed(let tx):
            // The escrow may land after the wait ends. Keep its bearer key available rather
            // than discarding the only way the recipient can claim it.
            if case .reverted = tx { stage = .failed }
            else { secret = secretHex; stage = .idUnknown }
        case .declined:
            stage = .failed
        }
    }

    private func loadSavedLink() async {
        defer { recovering = false }
        guard !isDemoData, let owner = session.address else { return }
        do {
            guard let draft = try await Keystore.shared.loadPendingClaim(owner: owner) else { return }
            savedDraft = draft
            secret = draft.secret
            expiry = draft.expiry
            amountText = draft.amount
            if let id = draft.linkId {
                link = PaymentLinks.buildClaim(linkId: id, secret: draft.secret)
                stage = .created
            } else {
                if let hash = draft.txHash { outcome = .failed(.timeout(hash: hash)) }
                stage = .idUnknown
            }
        } catch {
            outcome = .declined(reason: "The saved claim could not be unlocked. Nothing new was submitted. Close this screen and try again to recover it.")
            stage = .failed
        }
    }

    private func recordOutcome(_ result: SubmitOutcome) async {
        guard var draft = savedDraft else { return }
        let definitelyNoEscrow = !draft.retain(after: result)
        do {
            if definitelyNoEscrow {
                try await Keystore.shared.clearPendingClaim(owner: draft.owner)
                savedDraft = nil
            } else {
                try await Keystore.shared.savePendingClaim(draft, replacing: true)
                savedDraft = draft
            }
        } catch {
            // The original durable draft still contains the secret and indexed bearer address.
            recoveryNote = "The original recovery key remains saved. Reopen Claimable link to recover the transaction if these details could not be updated."
        }
    }

    private func recoverSavedLink() async {
        guard let draft = savedDraft else { return }
        recovering = true
        recoveryNote = nil
        defer { recovering = false }
        do {
            let chain = MezoChain.of(.testnet)
            guard let hash = try await draft.recoverHash(chain: chain) else {
                recoveryNote = "No matching escrow was found in the checked blocks. It may still be pending or may not have been submitted. Your recovery key remains saved; this does not authorize another payment."
                return
            }
            let client = EthereumHttpClient(url: chain.rpcURLs[0], network: .custom(String(chain.chainId)))
            let result = await Receipt.confirm(client: client, hash: hash, sponsored: false,
                mintedIdFrom: MintedIdSource(contract: MarenAddresses.of(.testnet).marenPay,
                                            topic0: MarenEncoding.linkCreatedTopic), timeout: 10)
            let submitted: SubmitOutcome
            if case .delivered(let delivered) = result { submitted = .delivered(delivered) }
            else { submitted = .failed(result) }
            outcome = submitted
            await recordOutcome(submitted)
            if case .delivered(let delivered) = result, let id = delivered.mintedId {
                link = PaymentLinks.buildClaim(linkId: id, secret: draft.secret)
                stage = .created
            } else if case .reverted = result { stage = .failed }
        } catch {
            recoveryNote = "Mezo could not be reached. Your claim recovery key is still saved on this device. Try recovering again when the connection returns."
        }
    }

    private func acknowledgeSaved() async {
        if let draft = savedDraft {
            do { try await Keystore.shared.clearPendingClaim(owner: draft.owner) }
            catch { recoveryNote = "The saved recovery copy could not be removed. You can close this screen and try again later."; return }
        }
        savedDraft = nil
        secret = nil
        link = nil
        dismiss()
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
                        Text("Save your link").labelStyle().foregroundStyle(Theme.Palette.warning)
                    }
                    Text(link)
                        .font(.figure(13, weight: .regular))
                        .foregroundStyle(Theme.Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Anyone with this link can claim the funds. A recovery copy stays in this device’s biometric Keychain until you confirm that you saved it. Reopen Claimable link to find it.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(spacing: Theme.Space.sm) {
                CopyButton(value: link, describes: "the claim link", style: .filled, sensitive: true)
                ShareLink(item: link) {
                    Label("Share", systemImage: "square.and.arrow.up").pillLabel()
                }
                .accessibilityLabel("Share the claim link")
            }
            PillButton(title: "I saved the link", variant: .primary) { Task { await acknowledgeSaved() } }
            PillButton(title: "Keep for later", variant: .quiet) { dismiss() }
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
                Text("Keep your claim key").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.Palette.ink)
            }
            Text("Maren could not read a confirmed link id. A recovery copy is saved in this device’s biometric Keychain. Reopen Claimable link to recover it, or save this key elsewhere before confirming that you saved it. If the escrow confirms, pair the LinkCreated id with this key to recover the link. Unclaimed escrow becomes reclaimable after \(expiryDate.formatted(date: .abbreviated, time: .shortened)).")
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("Claim recovery key").labelStyle().foregroundStyle(Theme.Palette.warning)
                    Text(secret)
                        .font(.figure(13, weight: .regular))
                        .foregroundStyle(Theme.Palette.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            CopyButton(value: secret, describes: "the claim key", style: .filled, sensitive: true)
            if savedDraft != nil {
                PillButton(title: "Recover link", variant: .primary) { Task { await recoverSavedLink() } }
                PillButton(title: "I saved the recovery key", variant: .quiet) { Task { await acknowledgeSaved() } }
            }
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
