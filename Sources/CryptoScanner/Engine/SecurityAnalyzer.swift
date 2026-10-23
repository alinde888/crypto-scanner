import Foundation

enum Severity: Int, Comparable {
    case ok = 0, info = 1, warning = 2, critical = 3

    static func < (l: Severity, r: Severity) -> Bool { l.rawValue < r.rawValue }
}

struct SecurityFlag: Identifiable, Hashable {
    let id = UUID()
    let severity: Severity
    let title: String
    let detail: String
}

enum SecurityVerdict {
    case clean, caution, danger

    var title: String {
        switch self {
        case .clean: return "Явных угроз не найдено"
        case .caution: return "Есть риски"
        case .danger: return "Опасный контракт"
        }
    }
}

struct SecurityReport {
    var flags: [SecurityFlag] = []
    var buyTax: Double?
    var sellTax: Double?
    var holderCount: Int?
    /// Share of supply held by the 10 largest wallets (pools and burn addresses excluded), 0...1
    var top10Share: Double?
    /// Share of LP tokens locked or burned, 0...1
    var lpLockedShare: Double?
    var checkedAt = Date()

    var verdict: SecurityVerdict {
        if flags.contains(where: { $0.severity == .critical }) { return .danger }
        if flags.contains(where: { $0.severity == .warning }) { return .caution }
        return .clean
    }

    var warningCount: Int { flags.filter { $0.severity == .warning }.count }

    var sortedFlags: [SecurityFlag] { flags.sorted { $0.severity > $1.severity } }
}

/// Turns raw GoPlus data into flags a person can read.
enum SecurityAnalyzer {

    private static func isBurnAddress(_ address: String) -> Bool {
        let a = address.lowercased()
        return a.hasPrefix("0x000000000000000000000000000000000000")
            || a == "1nc1nerator11111111111111111111111111111111"
            || a == "11111111111111111111111111111111"
    }

    private static func pct(_ v: Double) -> String {
        String(format: "%.1f%%", v * 100)
    }

    // MARK: EVM

    static func evm(_ j: JSONValue) -> SecurityReport {
        var r = SecurityReport()
        func on(_ key: String) -> Bool { j[key]?.flag == true }
        func add(_ s: Severity, _ title: String, _ detail: String) {
            r.flags.append(SecurityFlag(severity: s, title: title, detail: detail))
        }

        if on("is_honeypot") { add(.critical, "Honeypot", "Симуляция показала, что купленный токен продать нельзя.") }
        if on("cannot_sell_all") { add(.critical, "Нельзя продать весь баланс", "Контракт не даёт продать все токены разом.") }
        if on("owner_change_balance") { add(.critical, "Владелец меняет балансы", "Владелец может изменить баланс любого кошелька, включая твой.") }
        if on("hidden_owner") { add(.critical, "Скрытый владелец", "У контракта есть скрытый управляющий адрес.") }
        if on("can_take_back_ownership") { add(.critical, "Права владельца можно вернуть", "Отказ от прав владельца можно отменить.") }
        if on("selfdestruct") { add(.critical, "Самоуничтожение", "Контракт можно уничтожить вместе с балансами.") }
        if on("is_airdrop_scam") { add(.critical, "Скам-аирдроп", "Токен помечен как мошеннический аирдроп.") }

        if j["is_open_source"]?.flag == false {
            add(.warning, "Код не верифицирован", "Исходный код закрыт, проверить логику контракта нельзя.")
        }
        if on("is_proxy") { add(.warning, "Прокси-контракт", "Логику контракта можно заменить уже после твоей покупки.") }
        if on("is_mintable") { add(.warning, "Допечатка токенов", "Владелец может выпустить новые токены и обесценить твои.") }
        if on("transfer_pausable") { add(.warning, "Переводы можно остановить", "Владелец может заблокировать все переводы и продажи.") }
        if on("is_blacklisted") { add(.warning, "Чёрный список", "Владелец может запретить продажу отдельным кошелькам.") }
        if on("slippage_modifiable") { add(.warning, "Налог можно изменить", "Владелец может поднять налог на покупку или продажу.") }
        if on("personal_slippage_modifiable") { add(.warning, "Персональный налог", "Владелец может назначить отдельный налог конкретному кошельку.") }
        if on("trading_cooldown") { add(.info, "Пауза между сделками", "Контракт ограничивает частоту сделок с одного кошелька.") }
        if on("anti_whale_modifiable") { add(.info, "Лимиты на сделку меняются", "Владелец может изменить максимальный размер сделки.") }
        if on("external_call") { add(.info, "Внешние вызовы", "Контракт вызывает другие контракты при переводе.") }
        if on("trust_list") { add(.ok, "В доверенном списке GoPlus", "Известный и проверенный токен.") }

        r.buyTax = j["buy_tax"]?.double
        r.sellTax = j["sell_tax"]?.double
        taxFlag(r.sellTax, kind: "продажу", into: &r)
        taxFlag(r.buyTax, kind: "покупку", into: &r)

        let owner = j["owner_address"]?.string ?? ""
        if owner.isEmpty || isBurnAddress(owner) {
            add(.ok, "Нет активного владельца", "Права владельца сожжены или отсутствуют.")
        }

        // Holders: exclude DEX pools and burn addresses from concentration.
        let pools = Set((j["dex"]?.array ?? []).compactMap { $0["pair"]?.string?.lowercased() })
        let holders = j["holders"]?.array ?? []
        let realHolders = holders.filter { h in
            let addr = (h["address"]?.string ?? "").lowercased()
            return !pools.contains(addr) && !isBurnAddress(addr) && h["is_locked"]?.flag != true
        }
        if !holders.isEmpty {
            let top10 = realHolders.prefix(10).compactMap { $0["percent"]?.double }.reduce(0, +)
            r.top10Share = top10
            if top10 > 0.5 {
                add(.warning, "Высокая концентрация", "У 10 крупнейших кошельков \(pct(top10)) токенов. Их продажа обвалит цену.")
            }
        }
        if let count = j["holder_count"]?.double { r.holderCount = Int(count) }

        if let creator = j["creator_percent"]?.double, creator > 0.05 {
            add(.warning, "Много токенов у создателя", "Создатель держит \(pct(creator)) токенов.")
        }

        let lp = j["lp_holders"]?.array ?? []
        if !lp.isEmpty {
            let locked = lp.filter { h in
                h["is_locked"]?.flag == true || isBurnAddress(h["address"]?.string ?? "")
            }.compactMap { $0["percent"]?.double }.reduce(0, +)
            r.lpLockedShare = locked
            if locked < 0.5 {
                add(.warning, "Ликвидность не заблокирована", "Заблокировано или сожжено \(pct(locked)) LP. Создатель может забрать ликвидность.")
            } else {
                add(.ok, "Ликвидность заблокирована", "Заблокировано или сожжено \(pct(locked)) LP.")
            }
        }
        return r
    }

    private static func taxFlag(_ tax: Double?, kind: String, into r: inout SecurityReport) {
        guard let tax, tax > 0 else { return }
        let text = "Налог на \(kind) \(pct(tax))"
        if tax >= 0.3 {
            r.flags.append(SecurityFlag(severity: .critical, title: text, detail: "Такой налог съедает почти всю сделку."))
        } else if tax >= 0.1 {
            r.flags.append(SecurityFlag(severity: .warning, title: text, detail: "Высокий налог, учитывай его при расчёте прибыли."))
        } else {
            r.flags.append(SecurityFlag(severity: .info, title: text, detail: "Небольшой налог контракта."))
        }
    }

    // MARK: Solana

    static func solana(_ j: JSONValue) -> SecurityReport {
        var r = SecurityReport()
        func status(_ key: String) -> Bool? {
            if let s = j[key]?["status"]?.flag { return s }
            return j[key]?.flag
        }
        func add(_ s: Severity, _ title: String, _ detail: String) {
            r.flags.append(SecurityFlag(severity: s, title: title, detail: detail))
        }

        let mintable = status("mintable")
        let freezable = status("freezable")

        if freezable == true {
            add(.critical, "Freeze authority активна", "Создатель может заморозить токены на твоём кошельке, и продать их будет нельзя.")
        }
        if status("balance_mutable_authority") == true {
            add(.critical, "Балансы можно изменить", "Есть права, позволяющие менять балансы держателей.")
        }
        if status("non_transferable") == true {
            add(.critical, "Токен нельзя переводить", "Токен заблокирован для переводов.")
        }
        if mintable == true {
            add(.warning, "Mint authority активна", "Создатель может выпустить новые токены и обесценить твои.")
        }
        if status("closable") == true {
            add(.warning, "Токен можно закрыть", "Есть права на закрытие аккаунтов токена.")
        }
        if let hooks = j["transfer_hook"]?.array, !hooks.isEmpty {
            add(.warning, "Transfer hook", "При каждом переводе вызывается сторонняя программа.")
        }
        if status("metadata_mutable") == true {
            add(.info, "Метаданные можно менять", "Название и картинку токена можно изменить.")
        }
        if j["trusted_token"]?.flag == true {
            add(.ok, "В доверенном списке GoPlus", "Известный и проверенный токен.")
        }
        if mintable == false && freezable == false {
            add(.ok, "Mint и freeze отключены", "Новые токены выпустить нельзя, заморозить твои тоже.")
        }

        let holders = j["holders"]?.array ?? []
        if !holders.isEmpty {
            let real = holders.filter { h in
                let tag = h["tag"]?.string ?? ""
                return tag.isEmpty && h["is_locked"]?.flag != true
                    && !isBurnAddress(h["account"]?.string ?? "")
            }
            let top10 = real.prefix(10).compactMap { $0["percent"]?.double }.reduce(0, +)
            r.top10Share = top10
            if top10 > 0.5 {
                add(.warning, "Высокая концентрация", "У 10 крупнейших кошельков \(pct(top10)) токенов. Их продажа обвалит цену.")
            }
        }
        if let count = j["holder_count"]?.double { r.holderCount = Int(count) }
        return r
    }
}
