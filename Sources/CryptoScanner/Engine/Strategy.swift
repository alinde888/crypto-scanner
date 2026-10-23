import Foundation

/// Screening presets based on common market approaches. Each preset is a
/// transparent set of conditions; a match means "fits the conditions",
/// not "will go up".
enum Strategy: String, CaseIterable, Identifiable {
    case earlyPairs
    case volumeSpike
    case dipRebound
    case steadyGrowth
    case blueChips

    var id: String { rawValue }

    var title: String {
        switch self {
        case .earlyPairs: return "Ранний вход"
        case .volumeSpike: return "Всплеск объёма"
        case .dipRebound: return "Отскок после падения"
        case .steadyGrowth: return "Устойчивый рост"
        case .blueChips: return "Крупные активы"
        }
    }

    var risk: RiskTier {
        switch self {
        case .earlyPairs, .volumeSpike: return .high
        case .dipRebound: return .medium
        case .steadyGrowth, .blueChips: return .low
        }
    }

    var icon: String {
        switch self {
        case .earlyPairs: return "sparkles"
        case .volumeSpike: return "waveform.path.ecg"
        case .dipRebound: return "arrow.uturn.up"
        case .steadyGrowth: return "chart.line.uptrend.xyaxis"
        case .blueChips: return "building.columns"
        }
    }

    var summary: String {
        switch self {
        case .earlyPairs:
            return "Новые пары в первые сутки, где покупателей больше, чем продавцов. Самая высокая доля скамов, поэтому скам-проверка здесь обязательна."
        case .volumeSpike:
            return "Токены, у которых объём за последний час в разы выше среднего и цена растёт. Ловит начало движения, но легко попасть на вершину."
        case .dipRebound:
            return "Токены, которые сильно упали за сутки и начали разворачиваться в последний час на достаточной ликвидности."
        case .steadyGrowth:
            return "Пары старше двух недель с хорошей ликвидностью и умеренным ростом без резких скачков."
        case .blueChips:
            return "Крупные и давно торгующиеся активы с глубокой ликвидностью."
        }
    }

    var rules: [String] {
        switch self {
        case .earlyPairs:
            return ["Возраст ≤ 24 ч", "Ликвидность ≥ $10K", "Покупок за 1 ч больше, чем продаж", "Объём за 1 ч ≥ $5K"]
        case .volumeSpike:
            return ["Объём 1 ч ≥ 2× среднего часа за сутки", "Цена 1 ч ≥ +3%", "Ликвидность ≥ $50K", "Возраст ≥ 6 ч"]
        case .dipRebound:
            return ["Цена 24 ч ≤ −25%", "Цена 1 ч > 0%", "Покупок за 1 ч не меньше продаж", "Ликвидность ≥ $100K", "Возраст ≥ 3 дн"]
        case .steadyGrowth:
            return ["Возраст ≥ 14 дн", "Ликвидность ≥ $500K", "Цена 24 ч от +2% до +25%", "Цена 6 ч > 0%", "Объём 24 ч ≥ $250K"]
        case .blueChips:
            return ["Возраст ≥ 90 дн", "Ликвидность ≥ $5M", "Капитализация ≥ $100M"]
        }
    }

    func matches(_ p: DexPair) -> Bool {
        let age = p.ageHours
        let liq = p.liquidityUsd
        switch self {
        case .earlyPairs:
            guard let age, age <= 24 else { return false }
            return liq >= 10_000 && p.buys("h1") > p.sells("h1") && p.volume1h >= 5_000
        case .volumeSpike:
            guard let age, age >= 6 else { return false }
            let avgHour = p.volume24h / 24
            return liq >= 50_000 && avgHour > 0 && p.volume1h >= avgHour * 2 && (p.change("h1") ?? 0) >= 3
        case .dipRebound:
            guard let age, age >= 72 else { return false }
            return liq >= 100_000 && (p.change("h24") ?? 0) <= -25 && (p.change("h1") ?? 0) > 0
                && p.buys("h1") >= p.sells("h1")
        case .steadyGrowth:
            guard let age, age >= 24 * 14 else { return false }
            let ch24 = p.change("h24") ?? 0
            return liq >= 500_000 && ch24 >= 2 && ch24 <= 25 && (p.change("h6") ?? 0) > 0 && p.volume24h >= 250_000
        case .blueChips:
            guard let age, age >= 24 * 90 else { return false }
            return liq >= 5_000_000 && (p.marketCap ?? p.fdv ?? 0) >= 100_000_000
        }
    }
}

/// The user's own exit rules per risk tier. Percentages relative to entry.
struct TradePlan: Codable, Hashable {
    var stopLoss: Double
    var takeProfit1: Double
    var takeProfit2: Double
    var positionPercent: Double

    static func defaults(for tier: RiskTier) -> TradePlan {
        switch tier {
        case .high: return TradePlan(stopLoss: 30, takeProfit1: 50, takeProfit2: 150, positionPercent: 1)
        case .medium: return TradePlan(stopLoss: 15, takeProfit1: 25, takeProfit2: 60, positionPercent: 3)
        case .low: return TradePlan(stopLoss: 8, takeProfit1: 12, takeProfit2: 30, positionPercent: 5)
        }
    }
}
