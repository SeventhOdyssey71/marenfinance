import SwiftUI

// MARK: - Screen scaffold
//
// A shared page frame — canvas background, a loud condensed title, and a body. Keeps
// the three simpler tabs consistent with Home while Wave 1 fills them in.

struct Screen<Content: View>: View {
    let title: String
    var badge: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.lg) {
                HStack(alignment: .center) {
                    Text(title)
                        .font(.display(40))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.Palette.ink)
                    Spacer()
                    if badge { DemoBadge() }
                }
                .padding(.top, Theme.Space.xs)
                content
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, Theme.Space.xl)
        }
        .background(Theme.Palette.canvas)
    }
}

/// A quiet "coming in a later wave" note inside a card — honest about what is not built.
struct ComingSoon: View {
    let text: String
    var body: some View {
        MCard {
            HStack(spacing: Theme.Space.sm) {
                Image(systemName: "hammer")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.tertiary)
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Finance

struct FinanceView: View {
    var body: some View {
        Screen(title: "FINANCE", badge: true) {
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.md) {
                    Text("Vault & Earn")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Theme.Palette.ink)
                    Text("Borrow MUSD against your Bitcoin, and put idle MUSD to work — both live here.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: 0) {
                        StatRow(label: "Maren healthy floor") {
                            MoneyText(text: MoneyFormat.percent(MarenPolicy.marenHealthyFloorPercent, fractionDigits: 0), size: 17, weight: .semibold)
                        }
                        StatRow(label: "Mezo liquidation") {
                            MoneyText(text: MoneyFormat.percent(MarenPolicy.mezoLiquidationPercent, fractionDigits: 0), size: 17, weight: .semibold)
                        }
                        StatRow(label: "Borrow rate", hint: "fixed, simple", showsDivider: false) {
                            MoneyText(text: MoneyFormat.percent(MarenPolicy.fixedAprPercent), size: 17, weight: .semibold)
                        }
                    }
                }
            }
            ComingSoon(text: "The borrow slider, preflight and yield screens arrive in a later wave.")
        }
    }
}

// MARK: - Activity

struct ActivityView: View {
    @Environment(\.marenClient) private var client
    @State private var items: [ActivityItem] = []
    @State private var loaded = false

    var body: some View {
        Screen(title: "ACTIVITY", badge: true) {
            if items.isEmpty && loaded {
                ComingSoon(text: "No activity yet. Your sends, receives and borrows will show up here.")
            } else {
                MCard(padding: Theme.Space.md) {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            ActivityRow(item: item, showsDivider: index < items.count - 1)
                        }
                    }
                }
            }
        }
        .task {
            items = (try? await client.recentActivity()) ?? []
            loaded = true
        }
    }
}

private struct ActivityRow: View {
    let item: ActivityItem
    let showsDivider: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Space.sm) {
                ZStack {
                    Circle().fill(Theme.Palette.inset).frame(width: 40, height: 40)
                    Image(systemName: item.icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.Palette.ink)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.Palette.ink)
                    Text(item.subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.Palette.tertiary)
                }
                Spacer(minLength: Theme.Space.sm)
                Text(item.amount)
                    .font(.figure(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
            }
            .padding(.vertical, 12)
            if showsDivider {
                Rectangle().fill(Theme.Palette.ink.opacity(0.07)).frame(height: 1)
            }
        }
    }
}

// MARK: - Profile

struct ProfileView: View {
    @Environment(\.marenClient) private var client
    @State private var account: Account?

    var body: some View {
        Screen(title: "PROFILE", badge: true) {
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("Account")
                        .labelStyle()
                    Text(account?.handle ?? "—")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Theme.Palette.ink)
                    Text(account?.address ?? "—")
                        .font(.figure(14, weight: .regular))
                        .foregroundStyle(Theme.Palette.muted)
                }
            }
            MCard {
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text("How Maren works")
                        .labelStyle()
                    Text("Deposit BTC, borrow MUSD, pay by @handle — on Mezo. Minimum deposit \(MoneyFormat.btc(MarenPolicy.minCollateralBtc)). Pre-audit.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            ComingSoon(text: "Handle registration, security and settings arrive in a later wave.")
        }
        .task { account = try? await client.account() }
    }
}
