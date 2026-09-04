import SwiftUI

// MARK: - Activity
//
// A history list read through the client (real logs live, demo items in the stub) plus a
// per-transaction receipt. Honest reads: an empty list after a SUCCESSFUL read is "nothing
// yet"; a read that THROWS is a failed-read state with retry, never an empty list dressed up
// as "no activity". The two sentences are different and only one is ever true.

struct ActivityView: View {
    @Environment(\.marenClient) private var client
    @Environment(\.marenActions) private var actions
    @Environment(\.isDemoData) private var isDemoData

    private enum Phase: Equatable { case loading, loaded, failed(String) }
    @State private var phase: Phase = .loading
    @State private var items: [ActivityItem] = []
    @State private var selected: ActivityItem?

    var body: some View {
        Screen(title: "Activity", badge: isDemoData) {
            switch phase {
            case .loading:
                MCard { HStack { ProgressView().tint(Theme.Palette.tertiary); Text("Reading recent activity…").foregroundStyle(Theme.Palette.tertiary).font(.system(size: 15)) } }
            case .failed(let reason):
                failedState(reason)
            case .loaded:
                if items.isEmpty { emptyState } else { list }
            }
        }
        .task { await load() }
        .sheet(item: $selected) { ReceiptDetail(item: $0) }
    }

    private func load() async {
        phase = .loading
        do {
            items = try await client.recentActivity()
            phase = .loaded
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // Grouped by day, most recent first — a clean, scannable structure with a quiet date
    // header over each card, rather than one long undifferentiated list.
    private struct DayGroup: Identifiable {
        let id: Date
        let label: String
        let items: [ActivityItem]
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM d"
        return formatter
    }()

    private var groups: [DayGroup] {
        let calendar = Calendar.current
        let byDay = Dictionary(grouping: items) { calendar.startOfDay(for: $0.date) }
        return byDay.keys.sorted(by: >).map { day in
            let label: String
            if calendar.isDateInToday(day) { label = "Today" }
            else if calendar.isDateInYesterday(day) { label = "Yesterday" }
            else { label = Self.dayFormatter.string(from: day) }
            return DayGroup(id: day, label: label, items: byDay[day]!.sorted { $0.date > $1.date })
        }
    }

    private var list: some View {
        VStack(spacing: Theme.Space.lg) {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: Theme.Space.sm) {
                    Text(group.label)
                        .font(.text(13, weight: .medium))
                        .foregroundStyle(Theme.Palette.tertiary)
                        .padding(.horizontal, Theme.Space.xs)
                    MCard(padding: Theme.Space.md) {
                        VStack(spacing: 0) {
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                Button { selected = item } label: {
                                    ActivityRow(item: item, showsDivider: index < group.items.count - 1)
                                }
                                .buttonStyle(PressableStyle())
                                .accessibilityHint("Opens the receipt")
                            }
                        }
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                Text("No activity yet")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)
                Text("Your sends, receives, borrows and deposits will show up here once you make them.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func failedState(_ reason: String) -> some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.sm) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.Palette.warning)
                        .accessibilityHidden(true)
                    Text("Could not read your activity").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                }
                Text("This is a read that failed, not an empty history, so nothing is shown rather than a misleading “no activity”.")
                    .font(.system(size: 15)).foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                PillButton(title: "Try again", variant: .quiet) { Task { await load() } }
            }
        }
    }
}

// MARK: - Row

private struct ActivityRow: View {
    let item: ActivityItem
    let showsDivider: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Theme.Space.sm) {
                TokenCoin(isBtc: item.isBtc, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.Palette.ink)
                    HStack(spacing: 5) {
                        if item.status != .confirmed {
                            Image(systemName: item.status.icon).font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(item.status.tone)
                            Text(item.status.label).font(.system(size: 13)).foregroundStyle(item.status.tone)
                        } else {
                            Text(item.subtitle).font(.system(size: 13)).foregroundStyle(Theme.Palette.tertiary)
                        }
                    }
                }
                Spacer(minLength: Theme.Space.sm)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(item.amount)
                        .font(.text(15, weight: .medium))
                        .foregroundStyle(item.status == .failed ? Theme.Palette.tertiary : item.amountColor)
                        .strikethrough(item.status == .failed)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                    Text(item.date, style: .time)
                        .font(.text(11))
                        .foregroundStyle(Theme.Palette.tertiary)
                }
            }
            .padding(.vertical, 12)
            if showsDivider {
                Rectangle().fill(Theme.Palette.ink.opacity(0.07)).frame(height: 1)
            }
        }
    }
}

// MARK: - Receipt detail

struct ReceiptDetail: View {
    let item: ActivityItem
    @Environment(\.marenClient) private var client
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        FlowScreen(title: "Receipt") {
            MCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).labelStyle()
                    MoneyText(text: item.amount, size: 34, weight: .bold)
                }
            }
            MCard(padding: Theme.Space.md) {
                VStack(spacing: 0) {
                    if let counterparty = item.counterparty {
                        detailRow("Counterparty") { Text(counterparty).plainValue() }
                    }
                    if let memo = item.memo, !memo.isEmpty {
                        detailRow("Memo") { Text("“\(memo)”").plainValue() }
                    }
                    detailRow("Status") {
                        HStack(spacing: 6) {
                            Image(systemName: item.status.icon).font(.system(size: 12, weight: .semibold))
                            Text(item.status.label).font(.system(size: 15, weight: .semibold))
                        }.foregroundStyle(item.status.tone)
                    }
                    detailRow("Time") { Text(item.date.formatted(date: .abbreviated, time: .shortened)).plainValue() }
                    detailRow("Gas") { gasValue }
                    detailRow("Network", showsDivider: false) {
                        Text("Mezo testnet").plainValue()
                    }
                }
            }
            if let hash = item.hash {
                explorerBlock(hash)
            }
            PillButton(title: "Done", variant: .quiet) { dismiss() }
        }
    }

    @ViewBuilder private var gasValue: some View {
        switch item.sponsored {
        case .some(true):
            Text("Paid by Maren").font(.figure(15, weight: .semibold)).foregroundStyle(Theme.Palette.success)
        case .some(false):
            Text("You paid BTC").font(.figure(15, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
        case .none:
            Unavailable(label: "Unknown")
        }
    }

    @ViewBuilder private func explorerBlock(_ hash: String) -> some View {
        let url = MezoChain.testnet.explorerURL.appendingPathComponent("tx").appendingPathComponent(hash)
        VStack(spacing: Theme.Space.sm) {
            Link(destination: url) {
                HStack(spacing: 6) {
                    Text("View on explorer"); Image(systemName: "arrow.up.right.square")
                }
                .pillLabel()
            }
            .accessibilityLabel("View this transaction on the Mezo explorer")
            CopyButton(value: hash, describes: "the transaction hash",
                       title: "Copy transaction hash", style: .inline)
        }
    }

    @ViewBuilder private func detailRow<V: View>(_ label: String, showsDivider: Bool = true, @ViewBuilder value: () -> V) -> some View {
        StatRow(label: label, showsDivider: showsDivider) { value() }
    }
}

private extension Text {
    func plainValue() -> some View {
        self.font(.figure(15, weight: .medium))
            .foregroundStyle(Theme.Palette.ink)
            .lineLimit(1)
            .truncationMode(.middle)
    }
}
