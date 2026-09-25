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
                balanceHero
                actionPills
                if showsFundingPrompt {
                    FundingNeeded(
                        address: session.address,
                        because: "Everything starts with a Bitcoin deposit, and a deposit is a "
                            + "transaction you send and pay for yourself. Once you hold BTC, "
                            + "payments are sponsored."
                    )
                }
                DottedDivider()
                vaultCard
                historySection
                Spacer(minLength: Theme.Space.md)
            }
            .padding(.horizontal, Theme.Space.md)
            .padding(.top, Theme.Space.sm)
            .padding(.bottom, 120)   // clear the floating glass tab bar
        }
        .background {
            Theme.Palette.canvas
                .overlay(alignment: .top) {
                    BalanceGlow()
                        .frame(height: 330)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .ignoresSafeArea(edges: .top)
        }
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
                Text(greeting)
                    .font(.text(12))
                    .foregroundStyle(Theme.Palette.muted)
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

    // MARK: balance hero — dollar notation, with the stablecoin identified underneath

    private var balanceHero: some View {
        VStack(spacing: Theme.Space.sm) {
            Text("Available balance")
                .font(.text(13, weight: .medium))
                .foregroundStyle(Theme.Palette.muted)
            if let musd = model.displayBalances?.musd {
                MoneyText(text: MoneyFormat.musd(musd), size: 46, weight: .bold, tracking: -1.8)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
                    .accessibilityLabel("Available balance, \(MoneyFormat.musd(musd)), MUSD stablecoin")
            } else {
                Unavailable(label: "Balance unavailable")
            }
            HStack(spacing: Theme.Space.xs) {
                MusdCoin(size: 16)
                Text("MUSD · Mezo")
                    .font(.text(12, weight: .medium))
                    .foregroundStyle(Theme.Palette.muted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Theme.Space.lg)
        .padding(.bottom, Theme.Space.md)
        .skeleton(model.isFirstLoad)
    }

    /// Said to the person's actual clock, not ours. "Good morning" was hardcoded, so anyone
    /// testing in the evening — which is most of them — was greeted with the wrong time of day
    /// by an app whose whole pitch is that it does not tell you things that are not true.
    private var greeting: String {
        switch Calendar.current.component(.hour, from: Date()) {
        case 5..<12:  return "Good morning"
        case 12..<18: return "Good afternoon"
        default:      return "Good evening"
        }
    }

    /// A wallet with nothing in it and nothing deposited: the state every external tester
    /// starts in. Gated on a completed read (`phase == .loaded`) so it never flashes over a
    /// skeleton or replaces a failed read, where the honest message is different.
    private var showsFundingPrompt: Bool {
        guard model.phase == .loaded, let balances = model.balances else { return false }
        let hasPosition = (model.position?.bitcoinLocked ?? 0) > 0
        return balances.btc <= 0 && balances.musd <= 0 && !hasPosition
    }

    private var actionPills: some View {
        // Two tiers, because these are not peers. Send and Receive are what someone opens the
        // app to do; the three below are real features that shipped with no launch site at
        // all — RequestFlow, SplitFlow and ClaimableLinkFlow were defined, routed and tested,
        // but the only presenter was a DEBUG-only screenshot hook, so on a TestFlight build
        // they were unreachable dead code. Claim stays off this row on purpose: you claim a
        // link someone sent you, which arrives by scan or deep link, not by browsing here.
        VStack(spacing: Theme.Space.md) {
            HStack(spacing: Theme.Space.sm) {
                PillButton(title: "Send", hugeIcon: "send", variant: .primary) { present(.send) }
                PillButton(title: "Receive", hugeIcon: "receive", variant: .quiet) { present(.receive) }
            }
            HStack(spacing: Theme.Space.sm) {
                ForEach([PayDestination.request, .split, .link], id: \.id) { destination in
                    secondaryAction(destination)
                }
            }
        }
    }

    private func secondaryAction(_ destination: PayDestination) -> some View {
        Button { present(destination) } label: {
            VStack(spacing: Theme.Space.xs) {
                Image(systemName: destination.icon)
                    .font(.system(size: 15, weight: .medium))
                Text(destination.title)
                    .font(.text(12, weight: .medium))
            }
            .foregroundStyle(Theme.Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 56)   // comfortably past the 44pt touch floor
            .background(Theme.Palette.inset, in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(secondaryActionLabel(destination))
    }

    /// The visible label is one word so three fit across a phone; VoiceOver gets the sentence.
    private func secondaryActionLabel(_ destination: PayDestination) -> String {
        switch destination {
        case .request: return "Request money from someone"
        case .split:   return "Split a payment between people"
        case .link:    return "Create a claimable payment link"
        default:       return destination.title
        }
    }

    // MARK: vault summary — one honest sentence, details live in Finance

    private var vaultCard: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                HStack {
                    Text("Your Bitcoin vault").labelStyle()
                    Spacer(minLength: Theme.Space.md)
                    // Health comes from the collateral ratio, so it is absent when the ratio is
                    // (no oracle price the protocol would accept). No chip rather than a guess.
                    if let health = model.displayPosition?.health { HealthChip(status: health) }
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
        } else if case .failed(let why) = model.phase {
            // A read that failed says so and offers the way out, rather than sitting on
            // "Loading…" indefinitely. The reassurance is the load-bearing part: a first-run
            // RPC hiccup should not read as "my deposit vanished".
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text(why)
                    .font(.text(16, weight: .medium))
                    .foregroundStyle(Theme.Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                PillButton(title: "Try again", variant: .quiet) {
                    Task { await model.load(using: client, address: session.address) }
                }
            }
        } else {
            Text("Loading your position…")
                .font(.text(16, weight: .medium))
                .foregroundStyle(Theme.Palette.muted)
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
                        .foregroundStyle(Theme.Palette.muted)
                        .rotationEffect(.degrees(model.refreshing ? 360 : 0))
                        .animation(model.refreshing && !reduceMotion
                                   ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .snappy,
                                   value: model.refreshing)
                        // 44 to match the scan button above it; the glyph stays 11pt.
                        .frame(width: 44, height: 44)
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
                        .foregroundStyle(Theme.Palette.muted)
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
                        .foregroundStyle(Theme.Palette.muted)
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

/// A quiet wash behind the balance, fading into the white content surface.
private struct BalanceGlow: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Theme.Palette.balanceLavender, location: 0),
                .init(color: Theme.Palette.balanceLavender.opacity(0.72), location: 0.46),
                .init(color: Theme.Palette.canvas.opacity(0), location: 1)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// The `#Preview` macro expands unconditionally — it is NOT wrapped in `#if DEBUG` for you —
// so a preview that injects the demo stub would drag the stub into a Release binary. Gating it
// here is what keeps the stub genuinely absent from a shipping build.
#if DEBUG
#Preview("Home") {
    HomeView()
        .environment(\.marenClient, StubMarenClient())
        .environment(MarenSession())
        .environment(AppRouter())
}
#endif
