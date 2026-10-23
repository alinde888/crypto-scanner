import Foundation

struct TokenRef: Decodable, Hashable {
    let address: String
    let name: String?
    let symbol: String?
}

struct TxnCount: Decodable, Hashable {
    let buys: Int?
    let sells: Int?
}

struct Liquidity: Decodable, Hashable {
    let usd: Double?
    let base: Double?
    let quote: Double?
}

struct PairLink: Decodable, Hashable {
    let label: String?
    let type: String?
    let url: String?
}

struct PairInfo: Decodable, Hashable {
    let imageUrl: String?
    let websites: [PairLink]?
    let socials: [PairLink]?
}

/// One trading pair as returned by DexScreener.
struct DexPair: Decodable, Identifiable, Hashable {
    let chainId: String
    let dexId: String?
    let url: String?
    let pairAddress: String
    let baseToken: TokenRef
    let quoteToken: TokenRef?
    let priceUsd: String?
    let txns: [String: TxnCount]?
    let volume: [String: Double]?
    let priceChange: [String: Double]?
    let liquidity: Liquidity?
    let fdv: Double?
    let marketCap: Double?
    let pairCreatedAt: Double?
    let info: PairInfo?

    var id: String { "\(chainId):\(pairAddress)" }
    var tokenKey: String { "\(chainId):\(baseToken.address)" }
    var chain: Chain? { Chain.byId(chainId) }

    var symbol: String { baseToken.symbol ?? "?" }
    var name: String { baseToken.name ?? baseToken.symbol ?? "Без названия" }

    var price: Double? { priceUsd.flatMap { Double($0) } }
    var priceValue: Double { price ?? 0 }
    var liquidityUsd: Double { liquidity?.usd ?? 0 }
    var volume24h: Double { volume?["h24"] ?? 0 }
    var volume6h: Double { volume?["h6"] ?? 0 }
    var volume1h: Double { volume?["h1"] ?? 0 }

    func change(_ window: String) -> Double? { priceChange?[window] }
    var change1hValue: Double { change("h1") ?? 0 }
    var change24hValue: Double { change("h24") ?? 0 }

    func buys(_ window: String) -> Int { txns?[window]?.buys ?? 0 }
    func sells(_ window: String) -> Int { txns?[window]?.sells ?? 0 }

    var ageHours: Double? {
        guard let created = pairCreatedAt, created > 0 else { return nil }
        return (Date().timeIntervalSince1970 * 1000 - created) / 3_600_000
    }
    var ageHoursValue: Double { ageHours ?? .greatestFiniteMagnitude }

    var dexScreenerURL: URL? {
        if let url, let u = URL(string: url) { return u }
        return URL(string: "https://dexscreener.com/\(chainId)/\(pairAddress)")
    }

    static func == (l: DexPair, r: DexPair) -> Bool {
        l.id == r.id && l.priceUsd == r.priceUsd && l.liquidity?.usd == r.liquidity?.usd
    }

    func hash(into h: inout Hasher) { h.combine(id) }
}

struct TokenProfile: Decodable, Hashable {
    let chainId: String
    let tokenAddress: String
}
