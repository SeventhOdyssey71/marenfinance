import SwiftUI

// MARK: - Home

struct HomeView: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(AppRouter.self) private var router
    @State private var model = HomeModel()
    @State private var destination: PayDestination?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                header
                positionCard
                priceNote
                actionRow
                payRow
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, Theme.Space.xl)
        }
        .background(Theme.Palette.canvas)
        .task { await model.load(using: client) }
        .sheet(item: $destination) { $0.view }
    }

    // MARK: wordmark + account line

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .center) {
                Text("MAREN")
                    .font(.display(46))
                    .tracking(-0.5)
                    .foregroundStyle(Theme.Palette.ink)
                Spacer()
                Button { destination = .scan } label: {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Scan a payment or claim code")
                if !actions.canSettle { DemoBadge() }
            }
            Text(accountLine)
                .font(.figure(15, weight: .medium))
                .foregroundStyle(Theme.Palette.muted)
        }
        .padding(.top, Theme.Space.xs)
    }

    private var accountLine: String {
        guard let account = model.account else { return "Loading account…" }
        return "\(account.handle) · \(account.address)"
    }

    // MARK: position summary

    private var positionCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your position")
                            .labelStyle()
                        safetyText
                    }
                    Spacer(minLength: Theme.Space.md)
                    if let position = model.position {
                        HealthChip(status: position.health)
                    }
                }

                collateralValueLine

                Divider().overlay(Theme.Palette.ink.opacity(0.07))

                VStack(spacing: 0) {
                    StatRow(label: "Bitcoin locked") {
                        rowValue(model.position.map { MoneyFormat.btc($0.bitcoinLocked) })
                    }
                    StatRow(label: "Borrowed", hint: "1.00% APR") {
                        rowValue(model.position.map { MoneyFormat.musd($0.borrowed) })
                    }
                    StatRow(label: "Left to borrow", showsDivider: false) {
                        rowValue(model.position.map { MoneyFormat.musd($0.leftToBorrow) })
                    }
                }
            }
        }
    }

    @ViewBuilder private var safetyText: some View {
        if let line = model.safetyLine {
            Text(line)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        } else if model.position != nil {
            Text("No debt yet. Borrow MUSD against your Bitcoin whenever you’re ready.")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text("Loading your position…")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.Palette.tertiary)
        }
    }

    /// When the oracle isn't live, the same visible banner Finance uses — so the *why*
    /// behind the unavailable collateral value is reachable on touch, not lost to a
    /// desktop-only tooltip.
    @ViewBuilder private var priceNote: some View {
        if case .unavailable = model.priceFeed {
            PriceNote(feed: model.priceFeed)
        }
    }

    /// The USD value of locked BTC. When the price feed is unavailable this is an
    /// explicit unavailable state — the honest gap, never a fabricated dollar figure.
    @ViewBuilder private var collateralValueLine: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Collateral value")
                .font(.system(size: 15))
                .foregroundStyle(Theme.Palette.muted)
            Spacer()
            if let usd = model.collateralUsd {
                MoneyText(text: MoneyFormat.usd(usd), size: 17, weight: .semibold)
            } else if case .unavailable = model.priceFeed {
                Unavailable(label: "Price unavailable")
            } else {
                Unavailable()
            }
        }
    }

    @ViewBuilder private func rowValue(_ text: String?) -> some View {
        if let text {
            MoneyText(text: text, size: 17, weight: .semibold)
        } else {
            Unavailable()
        }
    }

    // MARK: action row

    private var actionRow: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionHeader(title: "Actions")
            HStack(spacing: Theme.Space.sm) {
                ActionTile(title: "Send", icon: "arrow.up.right") { destination = .send }
                ActionTile(title: "Receive", icon: "arrow.down.left") { destination = .receive }
                ActionTile(title: "Borrow", icon: "banknote", emphasized: true) { router.goToVault() }
                ActionTile(title: "Earn", icon: "leaf.fill") { router.goToEarn() }
            }
        }
    }

    private var payRow: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            SectionHeader(title: "Pay")
            HStack(spacing: Theme.Space.sm) {
                ActionTile(title: "Request", icon: "arrow.down.circle") { destination = .request }
                ActionTile(title: "Split", icon: "person.2") { destination = .split }
                ActionTile(title: "Link", icon: "link") { destination = .link }
                ActionTile(title: "Claim", icon: "gift") { destination = .claim }
            }
        }
    }
}

#Preview("Home — price unavailable") {
    HomeView()
        .environment(\.marenClient, StubMarenClient())
        .environment(AppRouter())
}

#Preview("Home — price wired") {
    HomeView()
        .environment(\.marenClient, StubMarenClient(priceWired: true))
        .environment(AppRouter())
}
