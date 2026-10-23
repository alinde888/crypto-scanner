import Foundation

enum GoPlusError: LocalizedError {
    case api(String)
    case unsupportedChain

    var errorDescription: String? {
        switch self {
        case .api(let message): return "GoPlus: \(message)"
        case .unsupportedChain: return "GoPlus не проверяет токены в этой сети."
        }
    }
}

/// GoPlus Security public API (no key, roughly 30 requests per minute).
struct GoPlusClient {
    static let shared = GoPlusClient()

    private let pacer = RequestPacer(interval: 2.2)

    private struct Envelope: Decodable {
        let code: JSONValue?
        let message: String?
        let result: JSONValue?
    }

    func tokenSecurity(chain: Chain, address: String) async throws -> JSONValue {
        guard let goplusId = chain.goplusId else { throw GoPlusError.unsupportedChain }
        let url: String
        if chain.isSolana {
            url = "https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=\(address)"
        } else {
            url = "https://api.gopluslabs.io/api/v1/token_security/\(goplusId)?contract_addresses=\(address)"
        }
        await pacer.wait()
        let envelope = try await HTTP.get(url, as: Envelope.self)
        if let code = envelope.code?.double, code != 1 {
            throw GoPlusError.api(envelope.message ?? "код \(Int(code))")
        }
        guard let result = envelope.result?.object, !result.isEmpty else {
            throw GoPlusError.api("нет данных по этому токену, возможно он слишком новый.")
        }
        if let exact = result[address] ?? result[address.lowercased()] {
            return exact
        }
        if let match = result.first(where: { $0.key.lowercased() == address.lowercased() }) {
            return match.value
        }
        return result.values.first ?? .null
    }
}
