import SwiftUI
import BigInt

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
        case split(recipients: [String])
        case request(to: String)
        case createLink
        case claim(PaymentLinks.ClaimLink)
    }

    let kind: Kind
    /// The primary figure the user entered (MUSD for money flows, BTC for deposit/withdraw).
    let amount: Decimal
    let unit: Unit

    enum Unit: Sendable { case musd, btc }

    var gas: GasMode {
        switch kind {
        case .deposit, .earnSupply, .earnWithdraw: return .youPayBtc
        default: return .sponsored
        }
    }
}

protocol MarenActions: Sendable {
    /// Whether this runner can actually settle on a chain. False for the demo runner and for a
    /// live build with no relayer configured — the review step says so up front.
    var canSettle: Bool { get }
    func submit(_ intent: Intent) async -> SubmitOutcome
}

// MARK: - DemoMarenActions
//
// Pairs with `StubMarenClient`. Walks any flow and resolves to `.demo`, which the UI renders
// as an explicit "nothing was submitted to any chain, no gas was spent, no funds moved".

struct DemoMarenActions: MarenActions {
    var canSettle: Bool { false }

    func submit(_ intent: Intent) async -> SubmitOutcome {
        // A brief, honest pause so the flow reads like a submit without pretending to broadcast.
        try? await Task.sleep(nanoseconds: 700_000_000)
        return .demo
    }
}

// MARK: - LiveMarenActions
//
// Pairs with `MezoMarenClient`. Drives the real chain layer. Send is wired end-to-end through
// `MezoActions.send`; the remaining writes have no encoder in this build's chain layer and no
// relayer is configured, so they decline honestly with the same sentence the RN app uses —
// never a fabricated hash or receipt.

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
            // A @handle needs a registry lookup before it can be paid; not wired in this build,
            // so an address is required for a live send.
            guard PaymentLinks.isAddress(to) else {
                return .declined(reason: "Live send needs a 0x address in this build. Handle resolution is not wired yet, so nothing was submitted.")
            }
            return Self.outcome(await mezo.send(loadedAddress: loadedAddress, to: to, amountWei: wei, memo: memo))

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

        default:
            return .declined(reason: MarenClientError.liveWritesUnavailable.errorDescription
                             ?? "This build has no relayer configured, so nothing was submitted.")
        }
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

private struct MarenActionsKey: EnvironmentKey {
    static let defaultValue: any MarenActions = DemoMarenActions()
}

extension EnvironmentValues {
    var marenActions: any MarenActions {
        get { self[MarenActionsKey.self] }
        set { self[MarenActionsKey.self] = newValue }
    }
}
