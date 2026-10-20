import SwiftUI

/// What a proposed borrow does to your liquidation risk.
///
/// ONE SOURCE FOR BOTH SCREENS. The amount screen and the review screen previously computed
/// nothing and one number respectively, so a borrow could be typed with no indication of risk
/// at all and then reviewed against a figure in the same plain black as every other row. Both
/// now read this, so they cannot disagree about whether an amount is safe.
struct LiquidationRisk {
    /// How far BTC can fall before this position reaches Mezo's 110% cliff, as a percentage.
    let dropPercent: Decimal
    /// The BTC price at which that happens, in USD.
    let price: Decimal
    /// The resulting collateral ratio, as a percentage.
    let ratioPercent: Decimal

    /// Severity, keyed to Maren's own published thresholds rather than invented bands.
    enum Level {
        /// At or above the 250% Maren recommends.
        case healthy
        /// Between Maren's 180% borrowing floor and the 250% target.
        case caution
        /// Below the 180% floor. Maren refuses to open here, so this is a state the user is
        /// being steered away from, not merely warned about.
        case atRisk

        /// The fill: icons and the panel wash, where mass carries the meaning.
        var tint: Color {
            switch self {
            case .healthy: return Theme.Palette.success
            case .caution: return Theme.Palette.warning
            case .atRisk:  return Theme.Palette.danger
            }
        }

        /// The same meaning at text weight. Separate because the fills do not hold AA at
        /// 13pt on a tint of themselves — success measured 3.24:1, which is a fail.
        var textTint: Color {
            switch self {
            case .healthy: return Theme.Palette.successText
            case .caution: return Theme.Palette.warningText
            case .atRisk:  return Theme.Palette.dangerText
            }
        }

        /// A NAMED state, not only a colour. Status must never be carried by colour alone —
        /// roughly one in twelve men cannot reliably separate the amber from the green.
        var label: String {
            switch self {
            case .healthy: return "Healthy"
            case .caution: return "Caution"
            case .atRisk:  return "At risk"
            }
        }

        var symbol: String {
            switch self {
            case .healthy: return "checkmark.circle.fill"
            case .caution: return "exclamationmark.triangle.fill"
            case .atRisk:  return "exclamationmark.octagon.fill"
            }
        }
    }

    var level: Level {
        if ratioPercent >= MarenPolicy.marenTargetPercent { return .healthy }
        if ratioPercent >= MarenPolicy.marenHealthyFloorPercent { return .caution }
        return .atRisk
    }

    /// The one sentence the user actually needs, phrased exactly as Home and Finance already
    /// phrase it so the wording does not change between screens.
    var sentence: String {
        "Your Bitcoin can fall \(MoneyFormat.percent(dropPercent)) before it could be liquidated."
    }

    /// Build from a proposed position. Returns nil when there is nothing to say — no
    /// collateral, no debt, or no usable price — rather than inventing a reassuring number.
    ///
    /// Route-specific liquidation threshold: 140% for vault users, 110% for direct Mezo loans.
    /// A stale or unavailable price withholds the projected distance.
    static func of(collateralBtc: Decimal, debtMusd: Decimal, priceUsd: Decimal?,
                   liquidationPercent: Decimal = MarenPolicy.mezoLiquidationPercent) -> LiquidationRisk? {
        guard collateralBtc > 0, debtMusd > 0 else { return nil }
        let liq = debtMusd * liquidationPercent / 100 / collateralBtc
        guard let price = priceUsd, price > 0, liq > 0 else { return nil }
        let ratio = collateralBtc * price / debtMusd * 100
        // Already below the cliff: a negative "can fall" is meaningless, so clamp at zero and
        // let the level carry the severity.
        let drop = price > liq ? (price - liq) / price * 100 : 0
        return LiquidationRisk(dropPercent: drop, price: liq, ratioPercent: ratio)
    }
}

/// The live risk line under the amount, shown WHILE typing.
///
/// This is the gap it fills: the amount screen showed only "Left to borrow", so the entire
/// consequence of the number being typed — how close it puts you to losing your Bitcoin —
/// appeared for the first time on the review screen, after the decision was made.
struct LiquidationRiskNote: View {
    let risk: LiquidationRisk

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: risk.level.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(risk.level.tint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(risk.sentence)
                    .font(.text(14))
                    .foregroundStyle(Theme.Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text("\(risk.level.label) · liquidates at \(MoneyFormat.usd(risk.price)) / BTC")
                    .font(.text(13))
                    .monospacedDigit()
                    .foregroundStyle(risk.level.textTint)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Space.md)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(risk.level.tint.opacity(0.06))
        )
        // One announcement, not four fragments read in sequence.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(risk.level.label). \(risk.sentence) Liquidates at \(MoneyFormat.usd(risk.price)) per Bitcoin.")
    }
}
