import SwiftUI

// MARK: - Home
//
// Clean and light: a greeting header with your name, one big balance in dollars, the vault
// health in a sentence, and recent transactions. Type is SF Pro Rounded at moderate weights;
// numbers grey their decimals; separators are the slight dotted hairline. The dense vault
// table lives on the Finance tab.

struct HomeView: View {
    @Environment(\.marenClient) private var client
    @Environment(MarenSession.self) private var session
    @Environment(AppRouter.self) private var router
    @State private var model = HomeModel()
    @State private var destination: PayDestination?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                header
                DottedDivider()
                balanceHero
                actionPills
                DottedDivider()
                vaultCard
                historySection
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, 120)   // clear the floating glass tab bar
        }
        .background(Theme.Palette.canvas)
        .task { await model.load(using: client) }
        .sheet(item: $destination) { $0.view }
    }

    // MARK: header — avatar, greeting, name, scan

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Space.sm) {
            AvatarPlaceholder(size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text("Good morning")
                    .font(.text(12))
                    .foregroundStyle(Theme.Palette.tertiary)
                Text(session.greetingName)
                    .font(.display(18, weight: .medium))
                    .foregroundStyle(Theme.Palette.ink)
                    .overlay(alignment: .bottom) { DottedDivider().offset(y: 3) }
            }
            Spacer()
            Button { destination = .scan } label: {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(Theme.Palette.ink)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Scan a payment or claim code")
        }
        .padding(.top, Theme.Space.xs)
    }

    // MARK: balance hero — one big number, in dollars, centered

    private var balanceHero: some View {
        VStack(spacing: Theme.Space.xs) {
            Text("Balance").labelStyle()
            if let musd = model.balances?.musd {
                MoneyText(text: MoneyFormat.usd(musd), size: 38, weight: .bold, tracking: -2)
            } else {
                Unavailable(label: "Balance unavailable")
            }
            Text("In MUSD · Mezo")
                .font(.text(13))
                .foregroundStyle(Theme.Palette.tertiary)
        }
        .frame(maxWidth: .infinity)
    }

    private var actionPills: some View {
        HStack(spacing: Theme.Space.sm) {
            PillButton(title: "Send", icon: "arrow.up.right", variant: .primary) { destination = .send }
            PillButton(title: "Receive", icon: "arrow.down.left", variant: .quiet) { destination = .receive }
        }
    }

    // MARK: vault summary — one honest sentence, details live in Finance

    private var vaultCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack {
                    Text("Your Bitcoin vault").labelStyle()
                    Spacer(minLength: Theme.Space.md)
                    if let position = model.position { HealthChip(status: position.health) }
                }
                vaultLine
                PillButton(title: "Manage vault", variant: .quiet) { router.goToVault() }
            }
        }
    }

    @ViewBuilder private var vaultLine: some View {
        if let line = model.safetyLine {
            Text(line)
                .font(.text(16, weight: .medium))
                .foregroundStyle(Theme.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        } else if model.position != nil {
            Text("No debt yet. Borrow MUSD against your Bitcoin whenever you’re ready.")
                .font(.text(16, weight: .medium))
                .foregroundStyle(Theme.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text("Loading your position…")
                .font(.text(16, weight: .medium))
                .foregroundStyle(Theme.Palette.tertiary)
        }
    }

    // MARK: transaction history — a few recent, tap through for all

    private var historySection: some View {
        VStack(alignment: .leading, spacing: Theme.Space.md) {
            HStack {
                Text("Transaction history")
                    .font(.sectionDisplay())
                    .foregroundStyle(Theme.Palette.ink)
                Spacer()
                Button { router.tab = .activity } label: {
                    Text("View all")
                        .font(.text(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.muted)
                        .overlay(alignment: .bottom) { DottedDivider().offset(y: 2) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("View all transactions")
            }
            MCard(padding: Theme.Space.md) {
                if model.activity.isEmpty {
                    Text("No transactions yet.")
                        .font(.text(15))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: 0) {
                        let rows = Array(model.activity.prefix(3))
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                            txRow(item, showsDivider: index < rows.count - 1)
                        }
                    }
                }
            }
        }
    }

    private func txRow(_ item: ActivityItem, showsDivider: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: item.icon)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(Theme.Palette.ink)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title)
                        .font(.text(15, weight: .medium))
                        .foregroundStyle(Theme.Palette.ink)
                    Text(item.subtitle)
                        .font(.text(13))
                        .foregroundStyle(Theme.Palette.tertiary)
                }
                Spacer(minLength: Theme.Space.sm)
                Text(item.amount)
                    .font(.figure(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.vertical, 11)
            if showsDivider {
                Rectangle().fill(Theme.Palette.ink.opacity(0.07)).frame(height: 1)
            }
        }
    }
}

#Preview("Home") {
    HomeView()
        .environment(\.marenClient, StubMarenClient())
        .environment(MarenSession())
        .environment(AppRouter())
}
