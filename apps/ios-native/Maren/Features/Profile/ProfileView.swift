import SwiftUI
import web3

// MARK: - Profile
//
// Who you are and how your key is held. @handle, address (copy), network, a security entry
// into wallet setup, and sign-out. The security copy is honest about how the key is actually
// protected — a session-only key is never described as Face-ID-protected.

struct ProfileView: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.isDemoData) private var isDemoData
    @Environment(MarenSession.self) private var session
    @State private var account: Account?
    @State private var showSetup = false
    @State private var protection: KeyProtection?
    @State private var loadingAccount = true
    private let capability = Keystore.shared.capability()

    /// While the account read is in flight and nothing has arrived, a neutral placeholder that
    /// the skeleton redacts to bars — never a fabricated handle or address shown to the user.
    private var displayAccount: Account? {
        if loadingAccount && account == nil {
            return Account(handle: "@handle", address: "0x0000000000000000000000000000000000000000")
        }
        return account
    }
    private var accountLoading: Bool { loadingAccount && account == nil }

    var body: some View {
        Screen(title: "Profile", badge: isDemoData) {
            accountCard
                .skeleton(accountLoading)
            HandleCard(owner: session.address)
            securityCard
            howItWorksCard
            if !actions.canSettle {
                Text("Reads run live against Mezo testnet. Deposit, Earn and creating a claimable link are self-paid: you sign, pay a little BTC gas, and they settle on-chain now. Sending, borrowing, repaying, splitting, claiming a link, payment requests and claiming a name go through a relayer, which isn’t configured in this build, so those decline honestly rather than pretend to settle.")
                    .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if session.address != nil {
                PillButton(title: "Sign out", variant: .quiet) { session.signOut() }
            }
        }
        .task {
            loadingAccount = true
            account = try? await client.account()
            loadingAccount = false
        }
        .sheet(isPresented: $showSetup) {
            WalletSetupView { newProtection in
                protection = newProtection
                if newProtection == nil { session.signOut() }
            }
        }
        .onAppear(perform: refreshProtection)
    }

    private func refreshProtection() {
        // A session-only key never survives a cold launch, so a key found at startup is a
        // Keychain item — honestly reported as biometric-protected. In-session, the setup
        // callback supplies the real protection, so this only fills the cold-start gap.
        Task {
            if protection == nil, await Keystore.shared.hasKey() {
                protection = .keychainBiometric(label: capability.displayName)
            }
        }
    }

    private var accountCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Account").labelStyle()
                Text(displayAccount?.handle ?? "—")
                    .font(.display(26, weight: .bold))
                    .foregroundStyle(Theme.Palette.ink)
                HStack(spacing: Theme.Space.sm) {
                    Text(displayAccount?.address ?? "—")
                        .font(.figure(14, weight: .regular))
                        .foregroundStyle(Theme.Palette.muted)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: Theme.Space.sm)
                    if let addr = displayAccount?.address {
                        CopyButton(value: addr, describes: "your address")
                    }
                }
                Divider().overlay(Theme.Palette.ink.opacity(0.07))
                StatRow(label: "Network", showsDivider: false) {
                    Text("Mezo testnet").font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                }
            }
        }
    }

    private var securityCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Security").labelStyle()
                HStack(spacing: Theme.Space.sm) {
                    Image(systemName: keyIcon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(keyTone)
                        .frame(width: 32)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(keyTitle).font(.text(16, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                        Text(keySubtitle).font(.text(14)).foregroundStyle(Theme.Palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                PillButton(title: protection == nil ? "Set up wallet" : "Manage wallet", variant: .quiet) {
                    showSetup = true
                }
            }
        }
    }

    private var howItWorksCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("How Maren works").labelStyle()
                Text("Deposit BTC, borrow MUSD, and pay by @handle, all on Mezo. Your first deposit pays BTC gas; borrowing and every payment after are relayed and gasless. Minimum deposit \(MoneyFormat.btc(MarenPolicy.minCollateralBtc)).")
                    .font(.text(15)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var keyIcon: String {
        switch protection {
        case .keychainBiometric: return capability.kind == .faceID ? "faceid" : "touchid"
        case .sessionOnly: return "exclamationmark.lock"
        case .none: return "lock.open"
        }
    }
    private var keyTone: Color {
        switch protection {
        case .keychainBiometric: return Theme.Palette.success
        case .sessionOnly: return Theme.Palette.warning
        case .none: return Theme.Palette.tertiary
        }
    }
    private var keyTitle: String {
        switch protection {
        case let .keychainBiometric(label): return "Protected by \(label)"
        case .sessionOnly: return "Held for this session only"
        case .none: return "No wallet yet"
        }
    }
    private var keySubtitle: String {
        switch protection {
        case .keychainBiometric:
            return "Your signing key is in the Keychain and needs a biometric check before every transaction."
        case let .sessionOnly(reason):
            return "\(reason) The key stays in memory for this session only, not protected by biometrics."
        case .none:
            return capability.available && capability.enrolled
                ? "Create or import a key to sign transactions. It will be protected by \(capability.displayName)."
                : "Create or import a key to sign transactions."
        }
    }
}

// MARK: - HandleCard — claim an @handle, commit then reveal
//
// MarenRegistry is commit-reveal, and this card shows both legs as the two separate things
// they are rather than hiding one behind a spinner.
//
// STEP ONE publishes `keccak256(abi.encode(handle, owner, secret))`, which is opaque on-chain,
// so watching the transaction tells a squatter nothing about the name being claimed. STEP TWO
// reveals the secret at least 60 seconds later and takes the name. The commitment binds the
// handle to THIS address, so a copied commitment is worthless to whoever copied it.
//
// THE SECRET IS WRITTEN TO DISK BEFORE THE COMMIT IS EVEN OFFERED FOR SIGNATURE (see
// `HandleCommitmentStore`). Losing it between the two steps means the name is unrecoverable
// for seven days, and a backgrounded app inside a 60-second wait is not a rare event.
//
// Every state here is read from the chain and stated as it is: "not submitted yet", "ready in
// 41s", "expired", or an honest "couldn't check". A countdown is never run off a local
// stopwatch, and an availability tick is never shown for a read that failed.

private struct HandleCard: View {
    let owner: String?

    @Environment(\.marenActions) private var actions
    @Environment(\.isDemoData) private var isDemoData

    private enum Availability: Equatable {
        case idle, checking, free, taken
        case invalid(String)
        case unknown(String)
    }

    @State private var handleText = ""
    @State private var availability: Availability = .idle
    @State private var pending: PendingCommitment?
    @State private var phase: HandleCommitmentStore.Phase?
    @State private var registered: String?
    @State private var busy = false
    @State private var note: String?

    private let network: MezoNetwork = .testnet
    private var rpc: MezoRPC { MezoRPC(.of(network)) }

    private var typed: String { MezoActions.bareHandle(handleText) }

    var body: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Your name").labelStyle()
                if let registered, !registered.isEmpty {
                    registeredView(registered)
                } else if let pending {
                    pendingView(pending)
                } else {
                    claimView
                }
                if let note {
                    Text(note)
                        .font(.text(13))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .task(id: owner) { await refresh() }
    }

    // MARK: registered

    @ViewBuilder private func registeredView(_ handle: String) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.Palette.success)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("@\(handle)").font(.text(16, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                Text("Registered on MarenRegistry. Anyone can pay you at this name.")
                    .font(.text(14)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: claim (step one)

    @ViewBuilder private var claimView: some View {
        Text("Claim a name so people can pay you at @you instead of a 0x address. It takes two steps about a minute apart, which is what stops somebody copying your claim out of the mempool and taking the name first.")
            .font(.text(14)).foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        TextEntryCard(
            label: "Name",
            placeholder: "sele",
            text: $handleText,
            footnote: availabilityFootnote
        )
        .onChange(of: handleText) { _, _ in
            availability = .idle
        }
        HStack(spacing: Theme.Space.sm) {
            PillButton(title: availability == .checking ? "Checking…" : "Check", variant: .quiet) {
                Task { await check() }
            }
            Spacer(minLength: 0)
        }
        SubmitBar(title: "Claim @\(typed.isEmpty ? "name" : typed)",
                  enabled: MezoActions.handleProblem(typed) == nil && owner != nil,
                  submitting: busy) {
            Task { await claim() }
        }
        GasNote(mode: .sponsored)
    }

    private var availabilityFootnote: String? {
        switch availability {
        case .idle:
            return "3 to 32 characters, lowercase letters, digits and underscores."
        case .checking:
            return "Asking MarenRegistry…"
        case .free:
            return "@\(typed) is available."
        case .taken:
            return "@\(typed) is already registered."
        case let .invalid(reason):
            return reason
        case let .unknown(reason):
            return reason
        }
    }

    // MARK: pending (between the two steps)

    @ViewBuilder private func pendingView(_ pending: PendingCommitment) -> some View {
        HStack(spacing: Theme.Space.sm) {
            Image(systemName: phaseIcon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(phaseTone)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("@\(pending.handle)").font(.text(16, weight: .medium)).foregroundStyle(Theme.Palette.ink)
                Text(phaseTitle).font(.text(14)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        Text(phaseDetail)
            .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
            .fixedSize(horizontal: false, vertical: true)

        switch phase {
        case .revealable:
            SubmitBar(title: "Complete registration", submitting: busy) {
                Task { await complete() }
            }
        case .waiting, .notCommitted, .unknown, .none:
            PillButton(title: busy ? "Checking…" : "Check again", variant: .quiet) {
                Task { await refresh() }
            }
        case .expired:
            PillButton(title: "Start over", variant: .quiet) { discard() }
        }

        // Abandoning the claim destroys the only copy of the secret, so it says so.
        if phase != .expired {
            PillButton(title: "Discard this claim", variant: .quiet) { discard() }
        }
    }

    private var phaseIcon: String {
        switch phase {
        case .revealable: return "checkmark.circle"
        case .waiting: return "clock"
        case .expired: return "xmark.circle"
        case .notCommitted, .unknown, .none: return "questionmark.circle"
        }
    }

    private var phaseTone: Color {
        switch phase {
        case .revealable: return Theme.Palette.success
        case .waiting: return Theme.Palette.warning
        case .expired: return Theme.Palette.danger
        case .notCommitted, .unknown, .none: return Theme.Palette.tertiary
        }
    }

    private var phaseTitle: String {
        switch phase {
        case .revealable: return "Ready to complete"
        case let .waiting(seconds): return "Committed, ready in \(seconds)s"
        case .expired: return "Commitment expired"
        case .notCommitted: return "Not on-chain yet"
        case .unknown: return "Couldn’t check the chain"
        case .none: return "Reading MarenRegistry…"
        }
    }

    private var phaseDetail: String {
        switch phase {
        case .revealable:
            return "MarenRegistry is holding your commitment and it is old enough to reveal. Completing takes the name for this address."
        case .waiting:
            return "MarenRegistry requires a commitment to be at least 60 seconds old before it can be revealed. That wait is what makes the claim impossible to front-run."
        case .expired:
            return "A commitment dies after 7 days. This one is past that, so the name has to be claimed again from the start."
        case .notCommitted:
            return "This device is holding the secret for this name, but MarenRegistry has no commitment recorded for it. Nothing has been reserved."
        case let .unknown(reason):
            return reason
        case .none:
            return "Reading the commitment’s age from MarenRegistry."
        }
    }

    // MARK: reads

    private func refresh() async {
        guard let owner else {
            registered = nil
            pending = nil
            return
        }
        // Demo data has no chain behind it, so nothing here can be shown as a fact.
        if isDemoData {
            note = "Demo data has no Mezo connection, so no name can be looked up or claimed."
            return
        }

        if let onChain = try? await rpc.primaryHandle(of: owner), !onChain.isEmpty {
            registered = onChain
            // Registration makes the secret worthless, so it stops being kept.
            HandleCommitmentStore.clear(network: network, handle: onChain)
            pending = nil
            return
        }
        registered = nil

        let stored = HandleCommitmentStore.all(network: network)
            .filter { $0.owner.lowercased() == owner.lowercased() }
            .sorted { ($0.committedAt ?? .distantPast) > ($1.committedAt ?? .distantPast) }
            .first
        pending = stored
        guard let stored else { return }

        busy = true
        defer { busy = false }
        do {
            let commitment = try MarenEncoding.handleCommitment(handle: stored.handle, owner: owner,
                                                                secret: secretData(stored) ?? Data())
            let committedAt = try await rpc.handleCommittedAt(commitment)
            phase = HandleCommitmentStore.phase(committedAt: UInt64(committedAt),
                                                now: UInt64(Date().timeIntervalSince1970))
        } catch {
            phase = .unknown(reason: "MarenRegistry could not be reached to read how old this commitment is, so whether it can be revealed yet is unknown.")
        }
    }

    private func check() async {
        if let problem = MezoActions.handleProblem(typed) {
            availability = .invalid(problem)
            return
        }
        if isDemoData {
            availability = .unknown("Demo data has no Mezo connection, so availability can’t be checked.")
            return
        }
        availability = .checking
        do {
            availability = try await rpc.handleAvailable(typed) ? .free : .taken
        } catch {
            availability = .unknown("MarenRegistry couldn’t be reached, so whether @\(typed) is free is unknown.")
        }
    }

    // MARK: writes

    private func claim() async {
        guard let owner, MezoActions.handleProblem(typed) == nil else { return }
        guard let secret = HandleCommitmentStore.newSecret() else {
            note = "A commitment secret could not be generated on this device, so nothing was submitted."
            return
        }
        busy = true
        defer { busy = false }
        note = nil

        // Written to disk BEFORE anything is signed. If the app dies between here and the
        // receipt, the secret survives and the claim can still be completed.
        var record = PendingCommitment(handle: typed, secret: secret, owner: owner,
                                       network: network, txHash: nil, committedAt: nil)
        HandleCommitmentStore.save(record)
        pending = record
        phase = .notCommitted

        let outcome = await actions.submit(
            Intent(kind: .commitHandle(handle: typed, secret: secret), amount: 0, unit: .musd)
        )
        switch outcome {
        case let .delivered(delivered):
            record.txHash = delivered.hash
            record.committedAt = Date()
            HandleCommitmentStore.save(record)
            pending = record
            handleText = ""
            availability = .idle
            await refresh()
        case let .declined(reason):
            // A decline is the one outcome that PROVES nothing was submitted, so the secret is
            // thrown away rather than left implying a reservation that does not exist.
            HandleCommitmentStore.clear(network: network, handle: record.handle)
            pending = nil
            note = reason
        case .demo:
            HandleCommitmentStore.clear(network: network, handle: record.handle)
            pending = nil
            note = "Nothing was submitted to any chain, so no name was reserved."
        case .failed:
            // It may still land, so the secret is KEPT. Discarding it here would be the one
            // action that could make a landed commitment unrevealable.
            note = "The commit did not confirm. The secret is still on this device, so if it lands you can still complete the claim."
            await refresh()
        }
    }

    private func complete() async {
        guard let pending, let owner, owner.lowercased() == pending.owner.lowercased() else { return }
        busy = true
        defer { busy = false }
        note = nil

        let outcome = await actions.submit(
            Intent(kind: .registerHandle(handle: pending.handle, secret: pending.secret), amount: 0, unit: .musd)
        )
        switch outcome {
        case .delivered:
            HandleCommitmentStore.clear(network: network, handle: pending.handle)
            self.pending = nil
            await refresh()
        case let .declined(reason):
            note = reason
            await refresh()
        case .demo:
            note = "Nothing was submitted to any chain, so the name was not registered."
        case .failed:
            note = "The reveal did not confirm, so the name is not registered. The secret is still on this device and the claim can be retried."
            await refresh()
        }
    }

    private func discard() {
        guard let pending else { return }
        HandleCommitmentStore.clear(network: network, handle: pending.handle)
        self.pending = nil
        phase = nil
        note = "That claim was discarded and its secret deleted from this device. Any commitment already on-chain simply expires."
    }

    private func secretData(_ pending: PendingCommitment) -> Data? {
        Data(hex: pending.secret)
    }
}
