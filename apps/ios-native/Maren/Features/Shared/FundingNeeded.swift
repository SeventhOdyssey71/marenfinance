import SwiftUI

// MARK: - FundingNeeded
//
// The state a brand-new tester is actually in, and the one the app used to have no answer
// for. A fresh wallet holds no BTC; deposits, the one-time MUSD approval, Earn and
// claimable links are all self-paid by construction, so BTC is the precondition for
// everything. Before this the Deposit screen simply disabled Review and said "More than
// you can use", the Home hero showed $0.00, and nothing anywhere named a way forward —
// `grep -ri faucet` over the whole native tree returned nothing.
//
// So this orients and offers the next action, rather than reporting the obstacle. The two
// buttons are one sequence, not a choice: copy the address, then paste it into the faucet.
struct FundingNeeded: View {
    /// The address to fund. Nil only before the wallet exists, where this view is not shown.
    let address: String?
    /// Why BTC is needed here, in this flow's own terms.
    var because: String

    /// Verified reachable on 2026-09-23: HTTP 200, `<title>Mezo Faucet</title>`, with a
    /// BTC/MUSD toggle. Hard-coded rather than configurable because a stale faucet URL is
    /// worse than none — if this ever breaks, the copy below still names the network.
    private static let faucet = URL(string: "https://faucet.test.mezo.org")!

    var body: some View {
        MCard {
            VStack(alignment: .leading, spacing: Theme.Space.md) {
                Text("You need testnet BTC first")
                    .font(.text(17, weight: .semibold))
                    .foregroundStyle(Theme.Palette.ink)

                Text(because)
                    .font(.text(14))
                    .foregroundStyle(Theme.Palette.muted)
                    .fixedSize(horizontal: false, vertical: true)

                if let address {
                    // The address is the thing the faucet asks for, so it is shown and
                    // copyable here rather than sending anyone hunting through Receive —
                    // which, before this, offered to receive MUSD, the one asset that
                    // cannot solve this.
                    HStack(spacing: Theme.Space.sm) {
                        Text(address)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.Palette.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .accessibilityLabel("Your wallet address")
                        Spacer(minLength: Theme.Space.sm)
                        CopyButton(value: address, describes: "your address")
                    }
                    .padding(.horizontal, Theme.Space.md)
                    .padding(.vertical, Theme.Space.sm)
                    // Concentric: the card is 22 at 22 padding, so the well inside it is 16.
                    .background(Theme.Palette.inset, in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
                }

                Link(destination: Self.faucet) {
                    HStack(spacing: Theme.Space.xs) {
                        Text("Open the Mezo faucet")
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .font(.text(15, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Theme.Palette.accent, in: RoundedRectangle(cornerRadius: Theme.Radius.pill, style: .continuous))
                }
                .accessibilityLabel("Open the Mezo faucet in your browser")

                Text("Paste your address into the faucet and choose BTC. It arrives in a moment.")
                    .font(.text(12))
                    .foregroundStyle(Theme.Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
