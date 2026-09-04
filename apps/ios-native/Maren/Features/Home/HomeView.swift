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
    @State private var fullFlow: PayDestination?
    @State private var overlayFlow: PayDestination?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Send and the pay flows open full screen; Receive opens as a bottom-sheet overlay.
    private func present(_ d: PayDestination) {
        if d.isFullScreen { fullFlow = d } else { overlayFlow = d }
    }

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
        .task { await model.load(using: client, address: session.address) }
        .refreshOnSettle { await model.load(using: client, address: session.address) }
        .fullScreenCover(item: $fullFlow) { $0.view }
        .sheet(item: $overlayFlow) { $0.view }
    }

    // MARK: header — avatar, greeting, name, scan

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Space.sm) {
            GeneratedAvatar(seed: session.address ?? session.greetingName, size: 38)
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
            if model.refreshing {
                RefreshingChip().transition(.opacity)
            }
            Button { present(.scan) } label: {
                HugeIcon(name: "scan", size: 22)
                    .foregroundStyle(Theme.Palette.ink)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Scan a payment or claim code")
        }
        .padding(.top, Theme.Space.xs)
        .animation(.easeInOut(duration: 0.2), value: model.refreshing)
    }

    // MARK: balance hero — one big number, in dollars, centered

    private var balanceHero: some View {
        VStack(spacing: Theme.Space.xs) {
            Text("Balance").labelStyle()
            if let musd = model.displayBalances?.musd {
                MoneyText(text: MoneyFormat.usd(musd), size: 38, weight: .bold, tracking: -2)
            } else {
                Unavailable(label: "Balance unavailable")
            }
            Text("In MUSD · Mezo")
                .font(.text(13))
                .foregroundStyle(Theme.Palette.tertiary)
        }
        .frame(maxWidth: .infinity)
        .skeleton(model.isFirstLoad)
    }

    private var actionPills: some View {
        HStack(spacing: Theme.Space.sm) {
            PillButton(title: "Send", hugeIcon: "send", variant: .primary) { present(.send) }
            PillButton(title: "Receive", hugeIcon: "receive", variant: .quiet) { present(.receive) }
        }
    }

    // MARK: vault summary — one honest sentence, details live in Finance

    private var vaultCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack {
                    Text("Your Bitcoin vault").labelStyle()
                    Spacer(minLength: Theme.Space.md)
                    if let position = model.displayPosition { HealthChip(status: position.health) }
                }
                vaultLine
                PillButton(title: "Manage vault", variant: .quiet) { router.goToVault() }
            }
        }
        .skeleton(model.isFirstLoad)
    }

    @ViewBuilder private var vaultLine: some View {
        if model.isFirstLoad {
            // A sentence-shaped skeleton so the card is the right height before the real line.
            Text("Your Bitcoin can fall 00% before it could be liquidated.")
                .font(.text(16, weight: .medium))
                .foregroundStyle(Theme.Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        } else if let line = model.safetyLine {
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
                Button {
                    guard !model.refreshing else { return }
                    Task { await model.load(using: client, address: session.address) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .rotationEffect(.degrees(model.refreshing ? 360 : 0))
                        .animation(model.refreshing && !reduceMotion
                                   ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .snappy,
                                   value: model.refreshing)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh")
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
                if model.displayActivity.isEmpty {
                    Text("No transactions yet.")
                        .font(.text(15))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: 0) {
                        let rows = Array(model.displayActivity.prefix(3))
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                            txRow(item, showsDivider: index < rows.count - 1)
                        }
                    }
                }
            }
            .skeleton(model.isFirstLoad)
        }
    }

    private func txRow(_ item: ActivityItem, showsDivider: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Space.sm) {
                TokenCoin(isBtc: item.isBtc, size: 34)
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
                    .font(.text(15, weight: .medium))
                    .foregroundStyle(item.amountColor)
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
