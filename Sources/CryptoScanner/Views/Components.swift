import SwiftUI
import AppKit

extension RiskTier {
    var color: Color {
        switch self {
        case .high: return .red
        case .medium: return .orange
        case .low: return .green
        }
    }
}

extension Severity {
    var color: Color {
        switch self {
        case .critical: return .red
        case .warning: return .orange
        case .info: return .secondary
        case .ok: return .green
        }
    }

    var icon: String {
        switch self {
        case .critical: return "xmark.octagon.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .info: return "info.circle"
        case .ok: return "checkmark.circle.fill"
        }
    }
}

extension SecurityVerdict {
    var color: Color {
        switch self {
        case .clean: return .green
        case .caution: return .orange
        case .danger: return .red
        }
    }

    var icon: String {
        switch self {
        case .clean: return "checkmark.shield.fill"
        case .caution: return "exclamationmark.shield.fill"
        case .danger: return "xmark.shield.fill"
        }
    }
}

struct ChainBadge: View {
    let chainId: String

    var body: some View {
        Text(Chain.byId(chainId)?.short ?? chainId.uppercased())
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.quaternary, in: Capsule())
            .help(Chain.byId(chainId)?.name ?? chainId)
    }
}

struct ChangeText: View {
    let value: Double?

    var body: some View {
        Text(Fmt.pct(value))
            .monospacedDigit()
            .foregroundStyle(color)
    }

    private var color: Color {
        guard let value else { return .secondary }
        if value > 0 { return .green }
        if value < 0 { return .red }
        return .secondary
    }
}

struct RiskBadge: View {
    let assessment: RiskAssessment
    var checking = false

    var body: some View {
        HStack(spacing: 4) {
            if let tier = assessment.tier {
                Circle().fill(tier.color).frame(width: 7, height: 7)
                Text(tier.shortTitle)
            } else {
                Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
                Text("Опасно").foregroundStyle(.red)
            }
            if checking {
                ProgressView().controlSize(.mini)
            } else if !assessment.securityChecked {
                Image(systemName: "shield.slash")
                    .foregroundStyle(.tertiary)
                    .help("Контракт ещё не проверен")
            }
        }
        .font(.callout)
    }
}

struct TokenIcon: View {
    let url: String?
    let symbol: String
    var size: CGFloat = 20

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(symbol.prefix(1)))
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.quaternary)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

enum Clipboard {
    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
