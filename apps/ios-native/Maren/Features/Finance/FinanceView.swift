import SwiftUI

// MARK: - Finance
//
// Vault and Earn under one segmented roof. Vault borrows MUSD against Bitcoin; Earn puts idle
// MUSD to work in the Stability Pool. Honest-data throughout: anything that needs a USD price
// shows an explicit unavailable state when the oracle is not live, never a fabricated figure.

struct FinanceView: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.isDemoData) private var isDemoData
    @Environment(AppRouter.self) private var router
    @State private var model = FinanceModel()

    var body: some View {
        @Bindable var router = router
        return Screen(title: "Finance", badge: isDemoData) {
            Segmented(options: [(FinanceTab.vault, "Vault"), (FinanceTab.earn, "Earn")],
                      selection: $router.financeTab)
            switch router.financeTab {
            case .vault: VaultSection(model: model)
            case .earn: EarnSection(model: model)
            }
        }
        .task { await model.load(using: client) }
    }
}

// MARK: - Vault

private struct VaultSection: View {
    @Bindable var model: FinanceModel

    private enum Flow: String, Identifiable { case deposit, borrow, repay, withdraw; var id: String { rawValue } }
    @State private var flow: Flow?

    var body: some View {
        positionCard
        if !model.priceLive {
            PriceNote(feed: model.priceFeed)
        }
        actionGrid
            // Screenshot/testing hook: open a flow directly. Inert in normal use.
            .onAppear {
                switch ProcessInfo.processInfo.environment["MAREN_SCREEN"] {
                case "borrow": flow = .borrow
                case "deposit": flow = .deposit
                default: break
                }
            }
    }

    private var positionCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your vault")
                            .labelStyle()
                        Text(headline)
                            .font(.text(17, weight: .medium))
                            .foregroundStyle(Theme.Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: Theme.Space.md)
                    if let position = model.position {
                        HealthChip(status: position.health)
                    }
                }
                Divider().overlay(Theme.Palette.ink.opacity(0.07))
                VStack(spacing: 0) {
                    StatRow(label: "Bitcoin locked") { rowValue(model.position.map { MoneyFormat.btc($0.bitcoinLocked) }) }
                    StatRow(label: "Borrowed", hint: "1.00% APR") { rowValue(model.position.map { MoneyFormat.musd($0.borrowed) }) }
                    StatRow(label: "Collateral ratio") { ratioValue }
                    StatRow(label: "Left to borrow") { rowValue(model.position.map { MoneyFormat.musd($0.leftToBorrow) }) }
                    StatRow(label: "Drop to liquidation", hint: "at 110%", showsDivider: false) { dropValue }
                }
            }
        }
    }

    private var headline: String {
        guard let position = model.position else { return "Loading your vault…" }
        if position.borrowed <= 0 { return "No debt yet. Borrow MUSD against your Bitcoin whenever you’re ready." }
        if let drop = position.dropToLiquidationPercent {
            return "Your Bitcoin can fall \(MoneyFormat.percent(drop)) before it could be liquidated."
        }
        return "You’re borrowing against your Bitcoin."
    }

    @ViewBuilder private var ratioValue: some View {
        if let ratio = model.position?.collateralRatioPercent {
            MoneyText(text: MoneyFormat.ratio(ratio), size: 17, weight: .semibold)
        } else if model.position?.borrowed == 0 {
            Text("No debt").font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.tertiary)
        } else {
            Unavailable()
        }
    }

    @ViewBuilder private var dropValue: some View {
        if let drop = model.position?.dropToLiquidationPercent, (model.position?.borrowed ?? 0) > 0 {
            MoneyText(text: MoneyFormat.percent(drop), size: 17, weight: .semibold)
        } else if model.position?.borrowed == 0 {
            Text("—").font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.tertiary)
        } else {
            Unavailable()
        }
    }

    @ViewBuilder private func rowValue(_ text: String?) -> some View {
        if let text { MoneyText(text: text, size: 17, weight: .semibold) } else { Unavailable() }
    }

    private var actionGrid: some View {
        VStack(spacing: Theme.Space.sm) {
            HStack(spacing: Theme.Space.sm) {
                ActionTile(title: "Deposit", icon: "deposit") { flow = .deposit }
                ActionTile(title: "Borrow", icon: "borrow", emphasized: true) { flow = .borrow }
            }
            HStack(spacing: Theme.Space.sm) {
                ActionTile(title: "Repay", icon: "repay") { flow = .repay }
                ActionTile(title: "Withdraw", icon: "withdraw") { flow = .withdraw }
            }
        }
        .fullScreenCover(item: $flow) { flow in
            SingleAmountFlow(config: config(for: flow))
                .onDisappear { Task { await model.load(using: clientForReload) } }
        }
    }

    // Re-reads after a flow closes go through the environment client; captured indirectly.
    @Environment(\.marenClient) private var clientForReload

    private func config(for flow: Flow) -> AmountFlowConfig {
        let p = model.position
        switch flow {
        case .deposit:
            return AmountFlowConfig(
                navTitle: "Deposit Bitcoin",
                unit: .btc,
                explainer: "Adds collateral to your vault and raises your collateral ratio immediately. Adding collateral does not raise your Mezo borrow limit — only a refinance does.",
                presets: [0.01, 0.05, 0.1],
                gas: .youPayBtc,
                submitTitle: "Deposit Bitcoin",
                makeIntent: { Intent(kind: .deposit, amount: $0, unit: .btc) },
                reviewRows: { amt in
                    var rows = [ReviewRow(label: "Bitcoin deposited", value: MoneyFormat.btc(amt))]
                    if let locked = p?.bitcoinLocked {
                        rows.append(ReviewRow(label: "New collateral", value: MoneyFormat.btc(locked + amt)))
                    }
                    rows.append(ReviewRow(label: "Minimum deposit", value: MoneyFormat.btc(MarenPolicy.minCollateralBtc)))
                    return rows
                }
            )
        case .borrow:
            return AmountFlowConfig(
                navTitle: "Borrow MUSD",
                unit: .musd,
                explainer: "1.00% APR, simple interest, fixed for the life of this loan. You can borrow up to Maren’s 180% floor — the amount available here already stops short of it.",
                presets: [],
                available: p?.leftToBorrow,
                availableLabel: "Left to borrow",
                gas: .sponsored,
                submitTitle: "Borrow MUSD",
                makeIntent: { Intent(kind: .borrow, amount: $0, unit: .musd) },
                reviewRows: { amt in
                    var rows = [ReviewRow(label: "Borrowing", value: MoneyFormat.musd(amt))]
                    if let borrowed = p?.borrowed {
                        rows.append(ReviewRow(label: "New borrowed total", value: MoneyFormat.musd(borrowed + amt)))
                    }
                    rows.append(ReviewRow(label: "Resulting ratio", value: "", unavailable: true))
                    rows.append(ReviewRow(label: "Liquidation price", value: "", unavailable: true))
                    return rows
                }
            )
        case .repay:
            return AmountFlowConfig(
                navTitle: "Repay MUSD",
                unit: .musd,
                explainer: "Reduces your principal and raises your collateral ratio. Interest is simple and non-compounding, fixed at the rate this vault opened at.",
                presets: [500, 1_000],
                available: model.balances?.musd,
                availableLabel: "Your MUSD balance",
                gas: .sponsored,
                submitTitle: "Repay MUSD",
                makeIntent: { Intent(kind: .repay, amount: $0, unit: .musd) },
                reviewRows: { amt in
                    var rows = [ReviewRow(label: "Repaying", value: MoneyFormat.musd(amt))]
                    if let borrowed = p?.borrowed {
                        let remaining = borrowed > amt ? borrowed - amt : 0
                        rows.append(ReviewRow(label: "Borrowed after", value: MoneyFormat.musd(remaining)))
                    }
                    return rows
                }
            )
        case .withdraw:
            return AmountFlowConfig(
                navTitle: "Withdraw Bitcoin",
                unit: .btc,
                explainer: "Removes collateral. Maren refuses any withdrawal that would take the vault below 180%, so the amount available is already limited by your outstanding debt.",
                presets: [0.01, 0.05],
                available: p?.bitcoinLocked,
                availableLabel: "Bitcoin locked",
                gas: .sponsored,
                submitTitle: "Withdraw Bitcoin",
                makeIntent: { Intent(kind: .withdraw, amount: $0, unit: .btc) },
                reviewRows: { amt in
                    var rows = [ReviewRow(label: "Withdrawing", value: MoneyFormat.btc(amt))]
                    if let locked = p?.bitcoinLocked {
                        let remaining = locked > amt ? locked - amt : 0
                        rows.append(ReviewRow(label: "Collateral after", value: MoneyFormat.btc(remaining)))
                    }
                    rows.append(ReviewRow(label: "Resulting ratio", value: "", unavailable: true))
                    return rows
                }
            )
        }
    }
}

// MARK: - Earn

private struct EarnSection: View {
    @Bindable var model: FinanceModel

    private enum Flow: String, Identifiable { case supply, withdraw; var id: String { rawValue } }
    @State private var flow: Flow?
    @Environment(\.marenClient) private var clientForReload

    var body: some View {
        balanceCard
        yieldCard
        riskCard
        actionRow
    }

    private var balanceCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Your balance in Earn")
                    .labelStyle()
                // No Earn read is wired through MarenClient, so this is honestly unavailable
                // rather than a fabricated pool balance.
                Unavailable(label: "Not read on this build")
                Text("Earn supplies MUSD to the Stability Pool. This build does not yet read your pool position, so it is shown as unavailable rather than guessed.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var yieldCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Text("Realised yield")
                        .labelStyle()
                    Spacer()
                    HStack(spacing: 5) {
                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 10, weight: .bold))
                        Text("Backward-looking").font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(Theme.Palette.muted)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.Palette.inset, in: Capsule())
                }
                Text("This is MUSD actually realised in the past, not a rate and not a forecast. Maren does not display an APY for Earn because there is no reliable one to display.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Text("The Stability Pool has no token emissions. Its entire yield is the Bitcoin seized in liquidations, sold and compounded back into MUSD — so returns arrive in lumps and can be zero for months.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var riskCard: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.Palette.warning)
                .accessibilityHidden(true)
            Text("Stability Pool deposits absorb liquidated debt. In exchange for the BTC gains you take on the risk that your MUSD is used to close somebody else’s position. Historically profitable, not guaranteed, and not principal-protected.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }

    private var actionRow: some View {
        HStack(spacing: Theme.Space.sm) {
            ActionTile(title: "Move in", icon: "leaf.fill", emphasized: true) { flow = .supply }
            ActionTile(title: "Move out", icon: "arrow.up.left") { flow = .withdraw }
        }
        .fullScreenCover(item: $flow) { flow in
            SingleAmountFlow(config: config(for: flow))
        }
    }

    private var earnGasDetail: String {
        "Earn settles from your wallet, so you pay a little BTC gas."
    }

    private func config(for flow: Flow) -> AmountFlowConfig {
        switch flow {
        case .supply:
            return AmountFlowConfig(
                navTitle: "Move into Earn",
                unit: .musd,
                explainer: "Supplies MUSD to the Stability Pool. Any return is realised Bitcoin from liquidations: lumpy, backward-looking, never a rate.",
                presets: [100, 500],
                available: model.balances?.musd,
                availableLabel: "Spendable MUSD",
                gas: .youPayBtc,
                gasDetail: earnGasDetail,
                submitTitle: "Deposit into Earn",
                makeIntent: { Intent(kind: .earnSupply, amount: $0, unit: .musd) },
                reviewRows: { amt in [ReviewRow(label: "Moving into Earn", value: MoneyFormat.musd(amt))] }
            )
        case .withdraw:
            return AmountFlowConfig(
                navTitle: "Withdraw from Earn",
                unit: .musd,
                explainer: "Moves MUSD back to spendable. Your realised gains, if any, are already part of your Earn balance.",
                presets: [100, 500],
                gas: .youPayBtc,
                gasDetail: earnGasDetail,
                submitTitle: "Withdraw from Earn",
                makeIntent: { Intent(kind: .earnWithdraw, amount: $0, unit: .musd) },
                reviewRows: { amt in [ReviewRow(label: "Moving to spendable", value: MoneyFormat.musd(amt))] }
            )
        }
    }
}

// MARK: - PriceNote

/// A quiet banner stating the oracle is not live, so anything price-derived reads as unavailable.
struct PriceNote: View {
    let feed: PriceFeed
    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.Palette.warning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Price feed unavailable")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                if case let .unavailable(reason) = feed {
                    Text(reason)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.Palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }
}

#Preview("Finance — demo") {
    FinanceView()
        .environment(\.marenClient, StubMarenClient())
        .environment(AppRouter())
}
