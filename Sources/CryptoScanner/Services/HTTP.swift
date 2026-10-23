import Foundation

enum HTTPError: LocalizedError {
    case status(Int, String)
    case decoding(String)
    case badURL

    var errorDescription: String? {
        switch self {
        case .status(429, let host): return "\(host): слишком много запросов, попробуй через минуту."
        case .status(let code, let host): return "\(host) ответил ошибкой \(code)."
        case .decoding(let host): return "\(host) вернул данные в неожиданном формате."
        case .badURL: return "Некорректный адрес запроса."
        }
    }
}

enum HTTP {
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.httpAdditionalHeaders = [
            "Accept": "application/json",
            "User-Agent": "CryptoScanner/0.1 (macOS)"
        ]
        return URLSession(configuration: config)
    }()

    static func get<T: Decodable>(_ urlString: String, as type: T.Type) async throws -> T {
        guard let url = URL(string: urlString) else { throw HTTPError.badURL }
        let (data, response) = try await session.data(from: url)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let host = url.host ?? "сервер"
        guard (200..<300).contains(code) else { throw HTTPError.status(code, host) }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw HTTPError.decoding(host)
        }
    }
}

/// Spaces out requests to stay under an API's rate limit.
actor RequestPacer {
    private let interval: TimeInterval
    private var next = Date.distantPast

    init(interval: TimeInterval) {
        self.interval = interval
    }

    func wait() async {
        let now = Date()
        let slot = max(now, next)
        next = slot.addingTimeInterval(interval)
        let delay = slot.timeIntervalSince(now)
        if delay > 0 {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }
}
