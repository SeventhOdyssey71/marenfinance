import SwiftUI
import BigInt
import web3

// MARK: - MarenActions — the write seam for the UI
//
// Every value-moving screen submits through this protocol. It sits ABOVE the chain layer:
// the live runner drives `Maren/Chain` (Face ID → sign → relay → Receipt.confirm), and the
// demo runner walks the same flow without ever touching a chain. Neither ever fabricates a
// success: a demo submit resolves to `.demo` (nothing was submitted anywhere), and a live
// submit resolves only to what `Receipt.confirm` actually returned.
//
// HONEST GAS lives on `Intent`: deposit and every Earn action send/hold value the relayer
// cannot carry, so the user pays BTC gas; borrow, repay, withdraw and all of Pay are relayed
// and cost nothing. Mirrors `apps/ios/src/lib/copy.ts` and the relayer's allowlist.

/// What a submit resolved to. A hash is never a success on its own — only `.delivered`
/// (constructed solely by `Receipt.confirm`) or an honest `.demo` counts as done.
enum SubmitOutcome: Sendable {
    /// Demo mode: the flow was walked but NOTHING was submitted to any chain.
    case demo
    /// A real on-chain receipt reported `success`.
    case delivered(Delivered)
    /// Nothing was submitted and no gas was spent — a stated, human reason why.
    case declined(reason: String)
    /// The chain accepted it and then reverted, timed out, or was unreachable.
    case failed(TxOutcome)
}

/// How an action is paid for, so the review step can tell the truth before the user commits.
enum GasMode: Sendable {
    /// Relayed under ERC-2771: the user signs, Maren's relayer pays the BTC gas.
    case sponsored
    /// The user pays BTC gas themselves — the action sends or holds value a relayer cannot.
    case youPayBtc

    var title: String {
        switch self {
        case .sponsored: return "Gasless"
        case .youPayBtc: return "Costs BTC gas"
        }
    }

    /// Default body. Deposit uses this; Earn passes its own via `GasNote(body:)` because it is
    /// unsponsored for a different reason (MarenEarn is off the relay allowlist).
    var body: String {
        switch self {
        case .sponsored:
            return "You sign, Maren’s relayer pays the BTC gas."
        case .youPayBtc:
            return "You pay this one; every action after is gasless."
        }
    }
}

/// A described write, ready to review and submit. `title`/`detail` are what the review step
/// states back to the user; `gas` is the honest cost line.
struct Intent: Sendable {
    enum Kind: Sendable {
        case send(to: String, memo: String)
        case deposit
        case borrow
        case repay
        case withdraw
        case earnSupply
        case earnWithdraw
        case split(recipients: [String], amounts: [Decimal])
        /// Ask to be paid. `payer` is nil when anyone may fulfil it, which the encoder passes
        /// to the contract as the zero address.
        case request(payer: String?, memo: String)
        /// Settle a request somebody else created. Nothing but the id is carried: the amount
        /// and the recipient are the ones MarenPay already stored.
        case fulfillRequest(requestId: UInt64)
        /// Escrow MUSD to a one-time link. `linkKey` is the ADDRESS of the bearer keypair —
        /// the private key stays in the flow that generated it and never enters an Intent.
        case createLink(linkKey: String, expiry: UInt64, memo: String)
        case claim(PaymentLinks.ClaimLink)
        /// Step one of `@handle` registration: publish the opaque commitment.
        case commitHandle(handle: String, secret: String)
        /// Step two: reveal the secret and take the handle.
        case registerHandle(handle: String, secret: String)
    }

    let kind: Kind
    /// The primary figure the user entered (MUSD for money flows, BTC for deposit/withdraw).
    let amount: Decimal
    let unit: Unit

    enum Unit: Sendable { case musd, btc }

    /// Deposit sends BTC as msg.value, which no relayer can carry. Earn is off the hub's
    /// allowlist. `createLink` is off it too — `script/Deploy.s.sol` allowlists `claimLink`
    /// and NOT its pair `createLink` — so escrowing a link costs the creator BTC gas while
    /// claiming it is free for the claimer. Everything else is relayed.
    var gas: GasMode {
        switch kind {
        case .deposit, .earnSupply, .earnWithdraw, .createLink: return .youPayBtc
        default: return .sponsored
        }
    }
}

protocol MarenActions: Sendable {
    /// Whether this runner can actually settle on a chain. False for the demo runner and for a
    /// live build with no relayer configured — the review step says so up front.
    var canSettle: Bool { get }
    func submit(_ intent: Intent) async -> SubmitOutcome
    /// Resolve a typed recipient — a `0x` address or an `@handle` — to its `0x` address for a
    /// live as-you-type preview, or `nil` if a handle isn't registered (or can't be reached).
    /// A read only; it moves no funds. The submit path resolves again authoritatively.
    func resolve(_ recipient: String) async -> String?
}

// MARK: - UnconfiguredMarenActions
//
// The PRODUCTION no-wallet runner, and the Environment default for `\.marenActions`. Pairs
// with `UnconfiguredMarenClient`. There is no loaded account to sign with and no chain to
// submit to, so every submit DECLINES with a plain sentence and nothing is ever presented as
// having happened. `canSettle` is false, so the review step says so before the user commits.
//
// It never returns `.demo`: a demo walk is a claim that a flow was exercised against
// something, and this runner is not attached to anything at all.

struct UnconfiguredMarenActions: MarenActions {
    var canSettle: Bool { false }

    func submit(_ intent: Intent) async -> SubmitOutcome {
        .declined(reason: "No wallet is loaded, so nothing was signed or submitted and no funds moved. Set up or restore a wallet first.")
    }

    /// No registry to ask and no account to ask on behalf of, so nothing resolves. Returning
    /// nil is the honest "could not resolve", which the flows already render as such.
    func resolve(_ recipient: String) async -> String? { nil }
}

#if DEBUG

// MARK: - DemoMarenActions (DEBUG ONLY)
//
// Pairs with `StubMarenClient`. Walks any flow and resolves to `.demo`, which the UI renders
// as an explicit "nothing was submitted to any chain, no gas was spent, no funds moved".
//
// COMPILED OUT OF RELEASE, alongside the stub client it pairs with. A shipping binary has no
// runner that can resolve a submit to `.demo`, so a success-shaped outcome for a transaction
// that never happened cannot be produced.

struct DemoMarenActions: MarenActions {
    var canSettle: Bool { false }

    func submit(_ intent: Intent) async -> SubmitOutcome {
        // A brief, honest pause so the flow reads like a submit without pretending to broadcast.
        try? await Task.sleep(nanoseconds: 700_000_000)
        return .demo
    }

    // No chain to ask, so only a literal address "resolves"; handles cannot in demo mode.
    func resolve(_ recipient: String) async -> String? {
        let trimmed = recipient.trimmingCharacters(in: .whitespaces)
        return PaymentLinks.isAddress(trimmed) ? trimmed : nil
    }
}

#endif

// MARK: - LiveMarenActions
//
// Pairs with `MezoMarenClient`. Drives the real chain layer. Every write has a golden-tested
// encoder and is wired end-to-end — there is no longer a `default:` arm here, so a new Intent
// kind cannot be added without deciding what it does on-chain.
//
// THE SELF-PAID SET, and why each one is in it. Deposit sends BTC as msg.value and a relayer
// refuses value (R3). Earn supply/withdraw are not on MarenRelayHub's allowlist. Creating a
// claimable link is not either — `script/Deploy.s.sol` allowlists `claimLink` and not its pair
// `createLink` — so the creator pays BTC gas and the claimer pays nothing. All three sign a
// direct tx and SETTLE on-chain now, relayer or no relayer.
//
// Everything else — send, borrow, repay, withdraw, split, claim a link, create and fulfil a
// payment request, and both legs of @handle registration — is on the hub's allowlist and is
// relayed. No relayer is configured in this build, so those decline honestly with the same
// sentence the RN app uses, never a fabricated hash or receipt, and they light up the instant
// MAREN_RELAYER_URL is set.

struct LiveMarenActions: MarenActions {
    let network: MezoNetwork
    let loadedAddress: String

    var canSettle: Bool { RelayerConfig.isConfigured }

    func submit(_ intent: Intent) async -> SubmitOutcome {
        let mezo = MezoActions(.of(network))
        switch intent.kind {
        case let .send(to, memo):
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            // A @handle is resolved to its address via MarenRegistry before paying; a 0x
            // address passes straight through. An unregistered handle declines cleanly.
            switch await mezo.resolveRecipient(to) {
            case let .ok(address):
                return Self.outcome(await mezo.send(loadedAddress: loadedAddress, to: address, amountWei: wei, memo: memo))
            case let .fail(reason):
                return .declined(reason: reason)
            }

        // Relayed (gasless) vault writes.
        case .borrow:   return await vaultWrite("borrow", intent, mezo)
        case .repay:    return await vaultWrite("repay", intent, mezo)
        case .withdraw: return await vaultWrite("withdraw", intent, mezo)

        // Self-paid deposit (sends BTC as msg.value, so it is not relayed).
        case .deposit:
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            return Self.outcome(await mezo.deposit(loadedAddress: loadedAddress, valueWei: wei))

        // Self-paid Earn (MarenEarn is off the relay allowlist).
        case .earnSupply:
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            return Self.outcome(await mezo.earnSupply(loadedAddress: loadedAddress, assetsWei: wei))
        case .earnWithdraw:
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            return Self.outcome(await mezo.earnWithdraw(loadedAddress: loadedAddress, assetsWei: wei))

        // Relayed claim of a payment link (the link's own secret authorises the payout).
        case let .claim(link):
            return Self.outcome(await mezo.claimLink(loadedAddress: loadedAddress, linkId: link.linkId, secretHex: link.secret))

        // Relayed split — one MUSD transfer per recipient.
        case let .split(recipients, amounts):
            guard recipients.count == amounts.count, !recipients.isEmpty else {
                return .declined(reason: "That split could not be read, so nothing was submitted.")
            }
            var resolvedRecipients: [String] = []
            for r in recipients {
                switch await mezo.resolveRecipient(r) {
                case let .ok(address): resolvedRecipients.append(address)
                case let .fail(reason): return .declined(reason: reason)
                }
            }
            var amountsWei: [BigUInt] = []
            for a in amounts {
                guard let wei = Amount.toWei(a) else {
                    return .declined(reason: "That amount could not be read, so nothing was submitted.")
                }
                amountsWei.append(wei)
            }
            let total = amountsWei.reduce(BigUInt(0), +)
            return Self.outcome(await mezo.split(loadedAddress: loadedAddress, recipients: resolvedRecipients,
                                                 amountsWei: amountsWei, totalWei: total, memo: ""))

        // Relayed claimable-link creation. The escrowed MUSD is pulled by MarenPay, so this
        // needs the same one-time approval a send does; the real linkId comes back on the
        // receipt as `Delivered.mintedId`.
        case let .createLink(linkKey, expiry, memo):
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            return Self.outcome(await mezo.createLink(loadedAddress: loadedAddress, linkKey: linkKey,
                                                      amountWei: wei, expiry: expiry, memo: memo))

        // Relayed payment request. Moves no funds; the real requestId arrives on the receipt.
        case let .request(payer, memo):
            guard let wei = Amount.toWei(intent.amount) else {
                return .declined(reason: "That amount could not be read, so nothing was submitted.")
            }
            var payerAddress = MarenAddresses.zero
            if let payer, !payer.trimmingCharacters(in: .whitespaces).isEmpty {
                switch await mezo.resolveRecipient(payer) {
                case let .ok(address): payerAddress = address
                case let .fail(reason): return .declined(reason: reason)
                }
            }
            return Self.outcome(await mezo.createRequest(loadedAddress: loadedAddress, payer: payerAddress,
                                                         amountWei: wei, memo: memo))

        // Relayed fulfilment of somebody else's request.
        case let .fulfillRequest(requestId):
            return Self.outcome(await mezo.fulfillRequest(loadedAddress: loadedAddress,
                                                          requestId: BigUInt(requestId)))

        // Relayed @handle registration, both legs against MarenRegistry.
        case let .commitHandle(handle, secret):
            guard let secretData = Data(hex: secret), secretData.count == 32 else {
                return .declined(reason: "That commitment secret is malformed, so nothing was submitted.")
            }
            return Self.outcome(await mezo.commitHandle(loadedAddress: loadedAddress, handle: handle, secret: secretData))
        case let .registerHandle(handle, secret):
            guard let secretData = Data(hex: secret), secretData.count == 32 else {
                return .declined(reason: "That commitment secret is malformed, so nothing was submitted.")
            }
            return Self.outcome(await mezo.registerHandle(loadedAddress: loadedAddress, handle: handle, secret: secretData))
        }
    }

    func resolve(_ recipient: String) async -> String? {
        if case let .ok(address) = await MezoActions(.of(network)).resolveRecipient(recipient) { return address }
        return nil
    }

    private func vaultWrite(_ function: String, _ intent: Intent, _ mezo: MezoActions) async -> SubmitOutcome {
        guard let wei = Amount.toWei(intent.amount) else {
            return .declined(reason: "That amount could not be read, so nothing was submitted.")
        }
        return Self.outcome(await mezo.vaultWrite(function, loadedAddress: loadedAddress, amountWei: wei))
    }

    private static func outcome(_ result: ActionResult) -> SubmitOutcome {
        switch result {
        case let .ok(delivered): return .delivered(delivered)
        case let .declined(reason): return .declined(reason: reason)
        case let .failed(outcome): return .failed(outcome)
        }
    }
}

// MARK: - Environment injection

// The default is the NON-FABRICATING runner in every configuration, Debug and Release alike.
// A view rendered outside a configured session declines honestly rather than walking a flow
// to a demo "success". Previews that want the demo walk inject it explicitly.
private struct MarenActionsKey: EnvironmentKey {
    static let defaultValue: any MarenActions = UnconfiguredMarenActions()
}

extension EnvironmentValues {
    var marenActions: any MarenActions {
        get { self[MarenActionsKey.self] }
        set { self[MarenActionsKey.self] = newValue }
    }
}
