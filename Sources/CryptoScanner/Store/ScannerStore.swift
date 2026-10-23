import Foundation
import Observation

@MainActor
@Observable
final class ScannerStore {

    // MARK: Settings (persisted)

    var enabledChainIDs: Set<String> {
        didSet { defaults.set(Array(enabledChainIDs), forKey: Keys.chains) }
    }
    var minLiquidity: Double {
        didSet { defaults.set(minLiquidity, forKey: Keys.minLiquidity) }
    }
    var hideDangerous: Bool {
        didSet { defaults.set(hideDangerous, forKey: Keys.hideDangerous) }
    }
    var autoRefreshMinutes: Int {
        didSet {
            defaults.set(autoRefreshMinutes, forKey: Keys.autoRefresh)
            scheduleAutoRefresh()
        }
    }
    var plans: [String: TradePlan] {
        didSet {
            if let data = try? JSONEncoder().encode(plans) { defaults.set(data, forKey: Keys.plans) }
        }
    }

    // MARK: Live data

    var pairs: [DexPair] = []
    var isLoading = false
    var lastUpdated: Date?
    var errorMessage: String?

    var security: [String: SecurityReport] = [:]
    var securityErrors: [String: String] = [:]
    var checking: Set<String> = []

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var autoTask: Task<Void, Never>?

    private enum Keys {
        static let chains = "enabledChains"
        static let minLiquidity = "minLiquidity"
        static let hideDangerous = "hideDangerous"
        static let autoRefresh = "autoRefreshMinutes"
        static let plans = "tradePlans"
    }

    init() {
        let d = UserDefaults.standard
        if let saved = d.array(forKey: Keys.chains) as? [String] {
            enabledChainIDs = Set(saved)
        } else {
            enabledChainIDs = Set(Chain.all.map(\.id))
        }
        minLiquidity = d.object(forKey: Keys.minLiquidity) as? Double ?? 10_000
        hideDangerous = d.object(forKey: Keys.hideDangerous) as? Bool ?? true
        autoRefreshMinutes = d.object(forKey: Keys.autoRefresh) as? Int ?? 5
        if let data = d.data(forKey: Keys.plans),
           let saved = try? JSONDecoder().decode([String: TradePlan].self, from: data) {
            plans = saved
        } else {
            plans = [:]
        }
        scheduleAutoRefresh()
    }

    // MARK: Queries

    func plan(for tier: RiskTier) -> TradePlan {
        plans[tier.rawValue] ?? TradePlan.defaults(for: tier)
    }

    func setPlan(_ plan: TradePlan, for tier: RiskTier) {
        plans[tier.rawValue] = plan
    }

    func risk(for pair: DexPair) -> RiskAssessment {
        RiskEngine.assess(pair, security: security[pair.tokenKey])
    }

    func matches(_ strategy: Strategy) -> [DexPair] {
        pairs.filter { p in
            guard enabledChainIDs.contains(p.chainId) else { return false }
            guard p.liquidityUsd >= minLiquidity else { return false }
            if hideDangerous, security[p.tokenKey]?.verdict == .danger { return false }
            return strategy.matches(p)
        }
    }

    // MARK: Loading

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let client = DexScreenerClient.shared
        let chains = Chain.all.filter { enabledChainIDs.contains($0.id) }
        guard !chains.isEmpty else {
            errorMessage = "Не выбрано ни одной сети. Включи сети в настройках."
            return
        }

        var failures: [String] = []

        // 1. Fresh and promoted tokens.
        var refs: [TokenProfile] = []
        do { refs += try await client.latestProfiles() } catch { failures.append(error.localizedDescription) }
        do { refs += try await client.latestBoosts() } catch { failures.append(error.localizedDescription) }
        do { refs += try await client.topBoosts() } catch { failures.append(error.localizedDescription) }

        var byChain: [String: [String]] = [:]
        var seen = Set<String>()
        for ref in refs where enabledChainIDs.contains(ref.chainId) {
            let key = "\(ref.chainId):\(ref.tokenAddress)"
            if seen.insert(key).inserted {
                byChain[ref.chainId, default: []].append(ref.tokenAddress)
            }
        }

        var collected: [DexPair] = []
        for (chain, tokens) in byChain {
            var start = 0
            while start < tokens.count {
                let batch = Array(tokens[start..<min(start + 30, tokens.count)])
                do { collected += try await client.pairs(chain: chain, tokens: batch) }
                catch { failures.append(error.localizedDescription) }
                start += 30
            }
        }

        // 2. Established pools per chain.
        for chain in chains {
            do {
                let found = try await client.search(chain.searchSeed)
                collected += found.filter { $0.chainId == chain.id }
            } catch {
                failures.append(error.localizedDescription)
            }
        }

        // Keep the deepest pool per token.
        var best: [String: DexPair] = [:]
        for p in collected {
            if let current = best[p.tokenKey], current.liquidityUsd >= p.liquidityUsd { continue }
            best[p.tokenKey] = p
        }

        if best.isEmpty {
            errorMessage = failures.first ?? "DexScreener не вернул данных."
            return
        }
        pairs = Array(best.values)
        lastUpdated = Date()
    }

    func checkSecurity(_ pair: DexPair, force: Bool = false) async {
        let key = pair.tokenKey
        if !force && security[key] != nil { return }
        if checking.contains(key) { return }
        guard let chain = pair.chain else { return }
        checking.insert(key)
        defer { checking.remove(key) }
        do {
            let raw = try await GoPlusClient.shared.tokenSecurity(chain: chain, address: pair.baseToken.address)
            security[key] = chain.isSolana ? SecurityAnalyzer.solana(raw) : SecurityAnalyzer.evm(raw)
            securityErrors[key] = nil
        } catch {
            securityErrors[key] = error.localizedDescription
        }
    }

    /// Checks the first tokens of a list one by one, respecting GoPlus limits.
    func checkMany(_ list: [DexPair], limit: Int = 25) async {
        for p in list.prefix(limit) {
            if Task.isCancelled { return }
            if security[p.tokenKey] != nil || securityErrors[p.tokenKey] != nil { continue }
            await checkSecurity(p)
        }
    }

    private func scheduleAutoRefresh() {
        autoTask?.cancel()
        let minutes = autoRefreshMinutes
        guard minutes > 0 else { return }
        autoTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(minutes) * 60 * 1_000_000_000)
                if Task.isCancelled { return }
                await self?.refresh()
            }
        }
    }
}
