import Foundation

enum RiskTier: String, CaseIterable, Identifiable, Codable {
    case high, medium, low

    var id: String { rawValue }

    var title: String {
        switch self {
        case .high: return "Высокий риск"
        case .medium: return "Средний риск"
        case .low: return "Низкий риск"
        }
    }

    var shortTitle: String {
        switch self {
        case .high: return "Высокий"
        case .medium: return "Средний"
        case .low: return "Низкий"
        }
    }
}

struct RiskAssessment {
    /// nil when the contract is dangerous
    let tier: RiskTier?
    let score: Int
    let factors: [String]
    let securityChecked: Bool

    var isBlocked: Bool { tier == nil }
}

/// Measurable risk profile of a token. It describes how risky the asset is,
/// not where its price will go.
enum RiskEngine {
    static func assess(_ p: DexPair, security: SecurityReport?) -> RiskAssessment {
        if let security, security.verdict == .danger {
            let reasons = security.flags.filter { $0.severity == .critical }.map(\.title)
            return RiskAssessment(tier: nil, score: 99, factors: reasons, securityChecked: true)
        }

        var score = 0
        var factors: [String] = []

        let liq = p.liquidityUsd
        if liq < 50_000 { score += 3; factors.append("Очень тонкая ликвидность (\(Fmt.usd(liq)))") }
        else if liq < 250_000 { score += 2; factors.append("Небольшая ликвидность (\(Fmt.usd(liq)))") }
        else if liq < 1_000_000 { score += 1; factors.append("Средняя ликвидность (\(Fmt.usd(liq)))") }

        if let age = p.ageHours {
            if age < 24 { score += 3; factors.append("Пара моложе суток") }
            else if age < 24 * 7 { score += 2; factors.append("Пара моложе недели") }
            else if age < 24 * 30 { score += 1; factors.append("Пара моложе месяца") }
        } else {
            score += 2; factors.append("Возраст пары неизвестен")
        }

        let cap = p.marketCap ?? p.fdv ?? 0
        if cap > 0 && cap < 1_000_000 { score += 2; factors.append("Капитализация ниже $1M") }
        else if cap > 0 && cap < 10_000_000 { score += 1; factors.append("Капитализация ниже $10M") }

        if let ch = p.change("h24") {
            if abs(ch) > 50 { score += 2; factors.append("Движение цены за сутки \(Fmt.pct(ch))") }
            else if abs(ch) > 20 { score += 1; factors.append("Заметная волатильность за сутки (\(Fmt.pct(ch)))") }
        }

        if let security {
            if let top = security.top10Share {
                if top > 0.5 { score += 2; factors.append("Топ-10 кошельков держат \(Fmt.share(top))") }
                else if top > 0.3 { score += 1; factors.append("Топ-10 кошельков держат \(Fmt.share(top))") }
            }
            let warnings = min(security.warningCount, 3)
            if warnings > 0 { score += warnings; factors.append("Предупреждений по контракту: \(security.warningCount)") }
        }

        let tier: RiskTier
        if score >= 7 { tier = .high }
        else if score >= 3 { tier = .medium }
        else { tier = .low }

        if factors.isEmpty { factors.append("Крупная ликвидность, давняя пара, умеренная волатильность") }
        return RiskAssessment(tier: tier, score: score, factors: factors, securityChecked: security != nil)
    }
}
