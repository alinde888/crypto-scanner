import Foundation

enum Fmt {
    static func usd(_ value: Double?) -> String {
        guard let v = value, v.isFinite else { return "—" }
        let a = abs(v)
        if a >= 1_000_000_000 { return String(format: "$%.2fB", v / 1_000_000_000) }
        if a >= 1_000_000 { return String(format: "$%.2fM", v / 1_000_000) }
        if a >= 1_000 { return String(format: "$%.1fK", v / 1_000) }
        return String(format: "$%.0f", v)
    }

    static func price(_ value: Double?) -> String {
        guard let v = value, v.isFinite, v > 0 else { return "—" }
        if v >= 1000 { return String(format: "$%.0f", v) }
        if v >= 1 { return String(format: "$%.3f", v) }
        if v >= 0.01 { return String(format: "$%.4f", v) }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.usesSignificantDigits = true
        f.maximumSignificantDigits = 4
        f.minimumSignificantDigits = 2
        f.decimalSeparator = "."
        f.usesGroupingSeparator = false
        return "$" + (f.string(from: NSNumber(value: v)) ?? String(v))
    }

    static func pct(_ value: Double?) -> String {
        guard let v = value, v.isFinite else { return "—" }
        return String(format: "%@%.1f%%", v > 0 ? "+" : "", v)
    }

    static func share(_ fraction: Double) -> String {
        String(format: "%.1f%%", fraction * 100)
    }

    static func age(_ hours: Double?) -> String {
        guard let h = hours, h.isFinite else { return "—" }
        if h < 1 { return "\(max(1, Int(h * 60))) мин" }
        if h < 48 { return "\(Int(h)) ч" }
        let days = Int(h / 24)
        if days < 365 { return "\(days) дн" }
        return String(format: "%.1f г", Double(days) / 365)
    }

    static func number(_ value: Int?) -> String {
        guard let v = value else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = " "
        return f.string(from: NSNumber(value: v)) ?? String(v)
    }
}
