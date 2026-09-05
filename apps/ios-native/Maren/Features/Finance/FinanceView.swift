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
        return Screen(title: "Finance", badge: isDemoData, refreshing: model.refreshing) {
            Segmented(options: [(FinanceTab.vault, "Vault"), (FinanceTab.earn, "Earn")],
                      selection: $router.financeTab)
            switch router.financeTab {
            case .vault: VaultSection(model: model)
            case .earn: EarnSection(model: model)
            }
        }
        .task { await model.load(using: client) }
        .refreshOnSettle { await model.load(using: client) }
    }
}

// MARK: - Vault

private struct VaultSection: View {
    @Bindable var model: FinanceModel

    private enum Flow: String, Identifiable { case deposit, borrow, repay, withdraw; var id: String { rawValue } }
    @State private var flow: Flow?

    var body: some View {
        positionCard
            .skeleton(model.isFirstLoad)
        if !model.isFirstLoad && !model.priceLive {
            PriceNote(feed: model.priceFeed)
        }
        actionGrid
            .skeleton(model.isFirstLoad)
            // Screenshot/testing hook: open a flow directly. Inert in normal use.
            .onAppear {
                switch ScreenshotHooks.screen {
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
                    if let position = model.displayPosition {
                        HealthChip(status: position.health)
                    }
                }
                Divider().overlay(Theme.Palette.ink.opacity(0.07))
                VStack(spacing: 0) {
                    StatRow(label: "Bitcoin locked") { rowValue(model.displayPosition.map { MoneyFormat.btc($0.bitcoinLocked) }) }
                    StatRow(label: "Borrowed", hint: "1.00% APR") { rowValue(model.displayPosition.map { MoneyFormat.musd($0.borrowed) }) }
                    StatRow(label: "Collateral ratio") { ratioValue }
                    StatRow(label: "Left to borrow") { rowValue(model.displayPosition.map { MoneyFormat.musd($0.leftToBorrow) }) }
                    StatRow(label: "Drop to liquidation", hint: "at 110%", showsDivider: false) { dropValue }
                }
            }
        }
    }

    private var headline: String {
        // While first-loading, a sentence-shaped line the redaction turns into a neutral bar.
        if model.isFirstLoad { return "Your Bitcoin can fall 00% before it could be liquidated." }
        guard let position = model.position else { return "Loading your vault…" }
        if position.borrowed <= 0 { return "No debt yet. Borrow MUSD against your Bitcoin whenever you’re ready." }
        if let drop = position.dropToLiquidationPercent {
            return "Your Bitcoin can fall \(MoneyFormat.percent(drop)) before it could be liquidated."
        }
        return "You’re borrowing against your Bitcoin."
    }

    @ViewBuilder private var ratioValue: some View {
        if let ratio = model.displayPosition?.collateralRatioPercent {
            MoneyText(text: MoneyFormat.ratio(ratio), size: 17, weight: .semibold)
        } else if model.displayPosition?.borrowed == 0 {
            Text("No debt").font(.figure(15, weight: .medium)).foregroundStyle(Theme.Palette.tertiary)
        } else {
            Unavailable()
        }
    }

    @ViewBuilder private var dropValue: some View {
        if let drop = model.displayPosition?.dropToLiquidationPercent, (model.displayPosition?.borrowed ?? 0) > 0 {
            MoneyText(text: MoneyFormat.percent(drop), size: 17, weight: .semibold)
        } else if model.displayPosition?.borrowed == 0 {
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

    // The collateral ratio at (collateralBtc, debtMusd): from the live oracle price when we
    // have it, otherwise PROJECTED from the current on-chain ratio. Collateral value per BTC is
    // fixed, so scaling the known ratio by the change in collateral and debt needs no price at
    // all. Nil only when there is neither a price nor a rated current position to scale from.
    private func projectedRatio(collateral: Decimal, debt: Decimal) -> Decimal? {
        guard debt > 0, collateral > 0 else { return nil }
        if case let .available(usdPerBtc, _) = model.priceFeed {
            return collateral * usdPerBtc / debt * 100
        }
        guard let ratio = model.position?.collateralRatioPercent,
              let coll0 = model.position?.bitcoinLocked, coll0 > 0,
              let debt0 = model.position?.borrowed, debt0 > 0 else { return nil }
        return ratio * debt0 * collateral / (coll0 * debt)
    }

    // The BTC price at which (collateralBtc, debtMusd) hits the 110% Mezo liquidation cliff —
    // price-independent: liqPrice = debt × 1.10 / collateral, in USD per BTC. Matches the same
    // threshold buildPosition uses for drop-to-liquidation.
    private func liquidationPrice(collateral: Decimal, debt: Decimal) -> Decimal? {
        guard collateral > 0, debt > 0 else { return nil }
        return debt * MarenPolicy.mezoLiquidationPercent / 100 / collateral
    }

    private func ratioRow(collateral: Decimal, debt: Decimal) -> ReviewRow {
        if let ratio = projectedRatio(collateral: collateral, debt: debt) {
            return ReviewRow(label: "Resulting ratio", value: MoneyFormat.percent(ratio))
        }
        return ReviewRow(label: "Resulting ratio", value: "", unavailable: true)
    }

    private func liquidationRow(collateral: Decimal, debt: Decimal) -> ReviewRow {
        if let liq = liquidationPrice(collateral: collateral, debt: debt) {
            return ReviewRow(label: "Liquidation price", value: MoneyFormat.usd(liq) + " / BTC")
        }
        return ReviewRow(label: "Liquidation price", value: "", unavailable: true)
    }

    private func config(for flow: Flow) -> AmountFlowConfig {
        let p = model.position
        switch flow {
        case .deposit:
            return AmountFlowConfig(
                navTitle: "Deposit Bitcoin",
                unit: .btc,
                explainer: "Adds collateral to your vault and raises your collateral ratio immediately. Adding collateral does not raise your Mezo borrow limit — only a refinance does.",
                presets: [0.01, 0.05, 0.1],
                available: model.balances?.btc,
                availableLabel: "Your Bitcoin",
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
                    let newDebt = (p?.borrowed ?? 0) + amt
                    let coll = p?.bitcoinLocked ?? 0
                    if p?.borrowed != nil {
                        rows.append(ReviewRow(label: "New borrowed total", value: MoneyFormat.musd(newDebt)))
                    }
                    rows.append(self.ratioRow(collateral: coll, debt: newDebt))
                    rows.append(self.liquidationRow(collateral: coll, debt: newDebt))
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
                    let newColl = max(0, (p?.bitcoinLocked ?? 0) - amt)
                    let debt = p?.borrowed ?? 0
                    if p?.bitcoinLocked != nil {
                        rows.append(ReviewRow(label: "Collateral after", value: MoneyFormat.btc(newColl)))
                    }
                    rows.append(self.ratioRow(collateral: newColl, debt: debt))
                    rows.append(self.liquidationRow(collateral: newColl, debt: debt))
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
            .skeleton(model.isFirstLoad)
        yieldCard
        exposureCard
            .skeleton(model.isFirstLoad)
        riskCard
        actionRow
            .skeleton(model.isFirstLoad)
    }

    private var balanceCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack(spacing: Theme.Space.sm) {
                    MusdCoin(size: 34)
                    Text("In Earn").labelStyle()
                    Spacer()
                }
                if let balance = model.displayEarnBalance {
                    MoneyText(text: MoneyFormat.musd(balance), size: 34, weight: .bold)
                    Text("Supplied to the Stability Pool")
                        .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                } else {
                    Unavailable(label: "Couldn’t read your pool balance")
                }
            }
        }
    }

    // Trailing REALISED yield, computed from the vault's on-chain Harvested events — never a
    // forward APY. Three honest states: a read that failed is explicitly unavailable; a window
    // with no seized BTC says "no return to report yet" (never 0%); a window with gains shows
    // the realised amount, the real observed window, and an annualised percent ONLY when it can
    // be defended (live price, long-enough window), always framed realised / trailing / not a
    // forecast. The lumpy-BTC explainer stays as a footer under every state.
    private var yieldCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack {
                    Text("Realised yield").labelStyle()
                    Spacer()
                    HStack(spacing: 5) {
                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 10, weight: .bold))
                        Text("Backward-looking").font(.text(12, weight: .medium))
                    }
                    .foregroundStyle(Theme.Palette.muted)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Theme.Palette.inset, in: Capsule())
                }

                if model.isFirstLoad {
                    yieldExplainer
                } else if let y = model.earnYield {
                    if y.hasReturn {
                        realisedYieldBody(y)
                    } else {
                        noReturnBody(y)
                    }
                    yieldExplainer
                } else {
                    Unavailable(label: "Couldn’t read realised yield")
                    yieldExplainer
                }
            }
        }
    }

    private var yieldExplainer: some View {
        Text("Yield is Bitcoin seized at liquidation — lumpy and backward-looking, so Maren shows what was realised, never a forecast APY.")
            .font(.text(13))
            .foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    // A window that observed at least one seized-BTC gain. Headline is the realised MUSD value
    // when the oracle price is live, otherwise the exact realised BTC (the MUSD figure is
    // withheld, never guessed). The annualised percent rides beneath, or an honest reason it is
    // held back.
    @ViewBuilder private func realisedYieldBody(_ y: RealisedYield) -> some View {
        if let musd = y.musdRealised {
            MoneyText(text: MoneyFormat.musd(musd), size: 28, weight: .bold)
        } else {
            MoneyText(text: MoneyFormat.btc(y.btcRealised), size: 28, weight: .bold)
        }
        Text("Realised over the last \(y.windowDays) \(y.windowDays == 1 ? "day" : "days")")
            .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)

        Text(seizedSummary(y))
            .font(.text(13)).foregroundStyle(Theme.Palette.muted)
            .fixedSize(horizontal: false, vertical: true)

        Divider().overlay(Theme.Palette.ink.opacity(0.07))

        if let pct = y.annualisedPercent {
            HStack(spacing: 6) {
                Text("≈ \(MoneyFormat.percent(pct)) annualised")
                    .font(.figure(15, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                Text("realised · trailing · not a forecast")
                    .font(.text(12, weight: .medium))
                    .foregroundStyle(Theme.Palette.tertiary)
            }
        } else {
            Text(withheldPercentReason(y))
                .font(.text(13)).foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func seizedSummary(_ y: RealisedYield) -> String {
        let btc = MoneyFormat.btc(y.btcRealised)
        let events = "\(y.liquidationEvents) \(y.liquidationEvents == 1 ? "liquidation" : "liquidations")"
        if y.musdRealised != nil {
            return "\(btc) seized across \(events), valued at the current oracle price."
        }
        // No MUSD value: the oracle price is stale, so it is withheld rather than guessed.
        return "\(btc) seized across \(events). The oracle price is stale, so its MUSD value is withheld."
    }

    private func withheldPercentReason(_ y: RealisedYield) -> String {
        if y.musdRealised == nil {
            return "No annualised figure while the oracle price is stale — realised, not a forecast."
        }
        if y.windowDays < EARN_YIELD_MIN_ANNUALISE_DAYS {
            return "Too recent to annualise honestly — realised, not a forecast."
        }
        if y.liquidationEvents < EARN_YIELD_MIN_ANNUALISE_EVENTS {
            return "Too few realised gains to annualise honestly. Realised, not a forecast."
        }
        return "Realised, not a forecast."
    }

    // A window that ran and found no seized BTC — the honest empty state. This is TRUE today:
    // the vault holds zero BTC, so there is genuinely no realised gain to report, and the app
    // says so plainly rather than printing 0%.
    @ViewBuilder private func noReturnBody(_ y: RealisedYield) -> some View {
        Text("No return to report yet")
            .font(.text(17, weight: .semibold))
            .foregroundStyle(Theme.Palette.ink)
        if y.windowDays > 0 {
            Text("No liquidation gains in the last \(y.windowDays) \(y.windowDays == 1 ? "day" : "days").")
                .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // What actually backs the pool right now: its MUSD, plus any Bitcoin it seized absorbing
    // liquidations. One focal figure (the MUSD backing); the seized-BTC exposure and any stale
    // price are stated honestly beneath it. Degrades to an explicit unavailable, never a zero.
    private var exposureCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("Pool backing").labelStyle()
                if let exposure = model.displayEarnExposure {
                    MoneyText(text: MoneyFormat.musd(exposure.musdBacking), size: 28, weight: .bold)
                    Text("MUSD backing the Stability Pool")
                        .font(.text(13)).foregroundStyle(Theme.Palette.tertiary)
                    if exposure.btcSeized > 0 {
                        Divider().overlay(Theme.Palette.ink.opacity(0.07))
                        seizedLine(exposure)
                    }
                    if exposure.stalePrice {
                        stalePriceNote
                    }
                } else {
                    Unavailable(label: "Couldn’t read the pool backing")
                }
            }
        }
    }

    // "Includes {btc} BTC seized at liquidation (≈ {musd} MUSD)". When the oracle price is stale
    // the ≈ MUSD figure is withheld — the stale note below carries the reason — so a value the
    // protocol would refuse is never presented as authoritative.
    @ViewBuilder private func seizedLine(_ exposure: EarnExposure) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "bitcoinsign.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Palette.muted)
                .accessibilityHidden(true)
            Text(seizedText(exposure))
                .font(.text(13))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func seizedText(_ exposure: EarnExposure) -> String {
        let btc = MoneyFormat.btc(exposure.btcSeized)
        if exposure.stalePrice {
            return "Includes \(btc) seized at liquidation."
        }
        return "Includes \(btc) seized at liquidation (≈ \(MoneyFormat.musd(exposure.btcValuedMusd)))."
    }

    private var stalePriceNote: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "clock.badge.exclamationmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.Palette.warning)
                .accessibilityHidden(true)
            Text("The oracle price is stale, so the BTC value may be understated.")
                .font(.text(13))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var riskCard: some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.Palette.warning)
                .accessibilityHidden(true)
            Text("Deposits absorb liquidated debt: you earn BTC gains, but your MUSD can be spent closing others’ positions. Not principal-protected.")
                .font(.text(13))
                .foregroundStyle(Theme.Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }

    private var actionRow: some View {
        HStack(spacing: Theme.Space.sm) {
            ActionTile(title: "Move in", icon: "deposit", emphasized: true) { flow = .supply }
            ActionTile(title: "Move out", icon: "withdraw") { flow = .withdraw }
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
                available: model.earnBalance,
                availableLabel: "Your Earn balance",
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

// `#Preview` expands unconditionally, so this must be gated by hand or the demo stub it
// injects would be linked into Release. See the matching note in HomeView.
#if DEBUG
#Preview("Finance — demo") {
    FinanceView()
        .environment(\.marenClient, StubMarenClient())
        .environment(AppRouter())
}
#endif
