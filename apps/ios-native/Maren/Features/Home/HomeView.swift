import SwiftUI

// MARK: - Home

struct HomeView: View {
    @Environment(\.marenClient) private var client
    @State private var model = HomeModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                header
                positionCard
                actionRow
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, Theme.Space.xl)
        }
        .background(Theme.Palette.canvas)
        .task { await model.load(using: client) }
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
                DemoBadge()
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
            } else if case let .unavailable(reason) = model.priceFeed {
                Unavailable(label: "Price unavailable")
                    .help(reason)
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
                ActionTile(title: "Send", icon: "arrow.up.right") {}
                ActionTile(title: "Receive", icon: "arrow.down.left") {}
                ActionTile(title: "Borrow", icon: "banknote", emphasized: true) {}
                ActionTile(title: "Earn", icon: "leaf.fill") {}
            }
        }
    }
}

#Preview("Home — price unavailable") {
    HomeView().environment(\.marenClient, StubMarenClient())
}

#Preview("Home — price wired") {
    HomeView().environment(\.marenClient, StubMarenClient(priceWired: true))
}
