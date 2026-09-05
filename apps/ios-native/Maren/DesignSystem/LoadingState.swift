import SwiftUI

// MARK: - One loading language
//
// Every screen loads the same way. First paint, with nothing to show yet, is a SKELETON: the
// real layout rendered from neutral placeholder values and `.redacted(.placeholder)`, so the
// card shapes are already in place and nothing jumps when the true figures land. A background
// reload — a first load that had cached data, or a refresh after an action settles — keeps the
// existing values on screen and shows a small `RefreshingChip` instead, so the numbers update in
// place. Honest-data discipline is untouched: a skeleton shows the SHAPE of a value, never a
// fabricated one (the redaction replaces the sample figure with a neutral bar before it is ever
// visible), and a field whose read genuinely fails still resolves to `Unavailable`.

extension View {
    /// Render as a skeleton: the real layout, redacted so its values read as neutral bars and
    /// nothing shifts when the true data arrives. Inert while active.
    @ViewBuilder func skeleton(_ active: Bool) -> some View {
        redacted(reason: active ? .placeholder : [])
            .disabled(active)
    }
}

// MARK: - RefreshingChip
//
// The one inline "reloading live data" indicator, shown while a background refresh runs and the
// existing values stay put. A subtle violet chip on brand — never a full-screen spinner that
// would blank the values the user is already looking at.

struct RefreshingChip: View {
    var body: some View {
        HStack(spacing: 6) {
            ProgressView()
                .controlSize(.mini)
                .tint(Theme.Palette.accent)
            Text("Refreshing")
                .font(.text(12, weight: .medium))
                .foregroundStyle(Theme.Palette.accentText)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Theme.Palette.accentWash, in: Capsule())
        .accessibilityLabel("Refreshing live on-chain data")
    }
}

// MARK: - Neutral placeholders for skeletons
//
// Sample-shaped values fed into the real cards ONLY when a screen has nothing yet and is still
// loading. They exist purely to size the redaction bars; a skeleton is always redacted, so these
// figures are never shown to a user and never flow into an action's inputs.

extension Balances {
    static let placeholder = Balances(musd: 1234.56, btc: 0.05)
}

extension Position {
    static let placeholder = Position(
        bitcoinLocked: 0.05,
        borrowed: 1200,
        leftToBorrow: 800,
        collateralRatioPercent: 250,
        dropToLiquidationPercent: 42,
        health: .healthy
    )
}

extension EarnExposure {
    static let placeholder = EarnExposure(
        musdBacking: 5000,
        btcSeized: 0,
        btcValuedMusd: 0,
        stalePrice: false
    )
}

extension ActivityItem {
    /// Three rows shaped like a real history, for the Activity/Home skeletons. Redacted before
    /// paint, so the sample titles and amounts are never visible.
    static let placeholders: [ActivityItem] = [
        ActivityItem(id: "skeleton-1", kind: .receive, title: "Received", subtitle: "From @someone", amount: "+120.00 MUSD", date: Date()),
        ActivityItem(id: "skeleton-2", kind: .send, title: "Sent", subtitle: "To @someone", amount: "-45.00 MUSD", date: Date()),
        ActivityItem(id: "skeleton-3", kind: .deposit, title: "Deposited", subtitle: "Bitcoin vault", amount: "0.0100 BTC", date: Date()),
    ]
}
