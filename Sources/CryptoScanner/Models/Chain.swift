import Foundation

struct Chain: Identifiable, Hashable {
    /// DexScreener chain id
    let id: String
    let name: String
    let short: String
    /// GoPlus chain id ("solana" uses a separate endpoint), nil if unsupported
    let goplusId: String?
    let explorerTokenPrefix: String
    /// Symbol used to discover established pools via DexScreener search
    let searchSeed: String

    var isSolana: Bool { id == "solana" }

    func explorerURL(_ address: String) -> URL? {
        URL(string: explorerTokenPrefix + address)
    }

    static let all: [Chain] = [
        Chain(id: "solana", name: "Solana", short: "SOL", goplusId: "solana",
              explorerTokenPrefix: "https://solscan.io/token/", searchSeed: "SOL"),
        Chain(id: "ethereum", name: "Ethereum", short: "ETH", goplusId: "1",
              explorerTokenPrefix: "https://etherscan.io/token/", searchSeed: "WETH"),
        Chain(id: "bsc", name: "BNB Chain", short: "BNB", goplusId: "56",
              explorerTokenPrefix: "https://bscscan.com/token/", searchSeed: "WBNB"),
        Chain(id: "base", name: "Base", short: "BASE", goplusId: "8453",
              explorerTokenPrefix: "https://basescan.org/token/", searchSeed: "base WETH"),
        Chain(id: "arbitrum", name: "Arbitrum", short: "ARB", goplusId: "42161",
              explorerTokenPrefix: "https://arbiscan.io/token/", searchSeed: "ARB"),
        Chain(id: "polygon", name: "Polygon", short: "POL", goplusId: "137",
              explorerTokenPrefix: "https://polygonscan.com/token/", searchSeed: "WPOL"),
        Chain(id: "avalanche", name: "Avalanche", short: "AVAX", goplusId: "43114",
              explorerTokenPrefix: "https://snowscan.xyz/token/", searchSeed: "WAVAX"),
        Chain(id: "optimism", name: "Optimism", short: "OP", goplusId: "10",
              explorerTokenPrefix: "https://optimistic.etherscan.io/token/", searchSeed: "OP"),
        Chain(id: "sonic", name: "Sonic", short: "S", goplusId: "146",
              explorerTokenPrefix: "https://sonicscan.org/token/", searchSeed: "wS"),
        Chain(id: "hyperevm", name: "HyperEVM", short: "HYPE", goplusId: "999",
              explorerTokenPrefix: "https://hyperevmscan.io/token/", searchSeed: "WHYPE"),
    ]

    static func byId(_ id: String) -> Chain? {
        all.first { $0.id == id }
    }
}
