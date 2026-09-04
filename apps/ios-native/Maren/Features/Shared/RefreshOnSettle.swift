import SwiftUI
import Combine

// MARK: - Refresh after settle
//
// The single place an on-chain settlement tells the rest of the app to reload. `SettleBroadcaster`
// wraps whatever `MarenActions` the session injects and, the moment a submit resolves to a
// CONFIRMED receipt (`.delivered` — the only outcome `Receipt.confirm` ever produces), posts one
// `.marenDidSettle`. Nothing fires on submit, on a decline, on a demo walk, or on a failure: a
// balance is only refreshed once the chain has actually moved. Home, Finance and Activity observe
// the note through `refreshOnSettle` and reload their live reads in place, so the new state appears
// without a manual pull-to-refresh — and because the reads still degrade to `.unavailable` on
// failure, a refresh can only ever replace a value with a truer one, never stale-as-fresh.

extension Notification.Name {
    /// Posted exactly once per confirmed on-chain settlement, at the action→confirm boundary.
    static let marenDidSettle = Notification.Name("maren.didSettle")
}

/// Decorates any `MarenActions`, broadcasting `.marenDidSettle` on a confirmed settlement and
/// nothing else. `canSettle` and `resolve` pass straight through, so it is transparent to callers.
struct SettleBroadcaster: MarenActions {
    let base: any MarenActions

    var canSettle: Bool { base.canSettle }

    func submit(_ intent: Intent) async -> SubmitOutcome {
        let outcome = await base.submit(intent)
        // Only a real, confirmed receipt refreshes anything. A demo walk, a decline and a
        // failure all changed no on-chain state, so none of them fire.
        if case .delivered = outcome {
            await MainActor.run {
                NotificationCenter.default.post(name: .marenDidSettle, object: nil)
            }
        }
        return outcome
    }

    func resolve(_ recipient: String) async -> String? {
        await base.resolve(recipient)
    }
}

extension View {
    /// Reload live reads whenever an action settles on-chain. The trigger is central — a single
    /// note posted at the action→confirm boundary — so a screen only states what it reloads.
    func refreshOnSettle(_ reload: @escaping () async -> Void) -> some View {
        onReceive(NotificationCenter.default.publisher(for: .marenDidSettle)) { _ in
            Task { await reload() }
        }
    }
}
