import SwiftUI

// MARK: - Home
//
// A glanceable summary, kept deliberately simple: what you can spend (your MUSD balance,
// shown in dollars), the health of your Bitcoin vault in one plain sentence, and the pay
// shortcuts. The dense position table lives in the Finance tab — Home never repeats it.

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
                balanceCard
                vaultCard
                payRow
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

    // MARK: header — the logo mark, scan, demo badge

    private var header: some View {
        HStack(alignment: .center) {
            Image("MarenMark")
                .resizable()
                .scaledToFit()
                .frame(height: 30)
                .accessibilityLabel("Maren")
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
        .padding(.top, Theme.Space.xs)
    }

    // MARK: balance hero — the one big number, in dollars

    private var balanceCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("Balance").labelStyle()
                if let musd = model.balances?.musd {
                    MoneyText(text: MoneyFormat.usd(musd), size: 46, weight: .bold)
                } else {
                    Unavailable(label: "Balance unavailable")
                }
                Text("In MUSD · Mezo")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.Palette.tertiary)
                HStack(spacing: Theme.Space.sm) {
                    PillButton(title: "Send", icon: "arrow.up.right", variant: .primary) { destination = .send }
                    PillButton(title: "Receive", icon: "arrow.down.left", variant: .quiet) { destination = .receive }
                }
                .padding(.top, 2)
            }
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

    // MARK: pay shortcuts

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

#Preview("Home") {
    HomeView()
        .environment(\.marenClient, StubMarenClient())
        .environment(AppRouter())
}
