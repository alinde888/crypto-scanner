import Foundation

/// Public DexScreener API (no key). Limits: 60 req/min for profiles and
/// boosts, 300 req/min for pair endpoints.
struct DexScreenerClient {
    static let shared = DexScreenerClient()

    private let base = "https://api.dexscreener.com"
    private let listPacer = RequestPacer(interval: 1.1)
    private let pairPacer = RequestPacer(interval: 0.25)

    private struct SearchResponse: Decodable {
        let pairs: [Failable<DexPair>]?
    }

    func latestProfiles() async throws -> [TokenProfile] {
        try await list("/token-profiles/latest/v1")
    }

    func latestBoosts() async throws -> [TokenProfile] {
        try await list("/token-boosts/latest/v1")
    }

    func topBoosts() async throws -> [TokenProfile] {
        try await list("/token-boosts/top/v1")
    }

    private func list(_ path: String) async throws -> [TokenProfile] {
        await listPacer.wait()
        let items = try await HTTP.get(base + path, as: [Failable<TokenProfile>].self)
        return items.compactMap(\.value)
    }

    /// Pairs for up to 30 token addresses on one chain.
    func pairs(chain: String, tokens: [String]) async throws -> [DexPair] {
        let batch = tokens.prefix(30)
        guard !batch.isEmpty else { return [] }
        await pairPacer.wait()
        let csv = batch.joined(separator: ",")
        let items = try await HTTP.get("\(base)/tokens/v1/\(chain)/\(csv)", as: [Failable<DexPair>].self)
        return items.compactMap(\.value)
    }

    /// All pools of a single token.
    func tokenPairs(chain: String, token: String) async throws -> [DexPair] {
        await pairPacer.wait()
        let items = try await HTTP.get("\(base)/token-pairs/v1/\(chain)/\(token)", as: [Failable<DexPair>].self)
        return items.compactMap(\.value)
    }

    func search(_ query: String) async throws -> [DexPair] {
        await pairPacer.wait()
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let response = try await HTTP.get("\(base)/latest/dex/search?q=\(q)", as: SearchResponse.self)
        return (response.pairs ?? []).compactMap(\.value)
    }
}
