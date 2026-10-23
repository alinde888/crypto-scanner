import SwiftUI

struct TokenDetailView: View {
    @Environment(ScannerStore.self) private var store
    let pair: DexPair

    private var risk: RiskAssessment { store.risk(for: pair) }
    private var report: SecurityReport? { store.security[pair.tokenKey] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                market
                riskSection
                securitySection
                planSection
                actions
                Text("Оценки описывают риск актива по данным рынка и контракта и не предсказывают цену. Решение о сделке и её размере принимаешь ты.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
        }
        .task(id: pair.tokenKey) {
            await store.checkSecurity(pair)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                TokenIcon(url: pair.info?.imageUrl, symbol: pair.symbol, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pair.symbol).font(.title2.weight(.semibold))
                    Text(pair.name).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                ChainBadge(chainId: pair.chainId)
            }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(Fmt.price(pair.price))
                    .font(.system(size: 26, weight: .semibold))
                    .monospacedDigit()
                    .textSelection(.enabled)
            }
            HStack(spacing: 16) {
                change("5 мин", "m5")
                change("1 ч", "h1")
                change("6 ч", "h6")
                change("24 ч", "h24")
            }
        }
    }

    private func change(_ label: String, _ key: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            ChangeText(value: pair.change(key)).font(.callout.weight(.medium))
        }
    }

    // MARK: Market

    private var market: some View {
        GroupBox("Рынок") {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    metric("Ликвидность", Fmt.usd(pair.liquidityUsd))
                    metric("Капитализация", Fmt.usd(pair.marketCap ?? pair.fdv))
                }
                GridRow {
                    metric("Объём 1 ч", Fmt.usd(pair.volume1h))
                    metric("Объём 24 ч", Fmt.usd(pair.volume24h))
                }
                GridRow {
                    metric("Покупки / продажи 1 ч", "\(pair.buys("h1")) / \(pair.sells("h1"))")
                    metric("Возраст пары", Fmt.age(pair.ageHours))
                }
                GridRow {
                    metric("Биржа", (pair.dexId ?? "—").capitalized)
                    metric("Котируется к", pair.quoteToken?.symbol ?? "—")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Risk

    private var riskSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                if let tier = risk.tier {
                    Label(tier.title, systemImage: "gauge.with.dots.needle.67percent")
                        .font(.headline)
                        .foregroundStyle(tier.color)
                } else {
                    Label("Опасно: не торговать", systemImage: "xmark.octagon.fill")
                        .font(.headline)
                        .foregroundStyle(.red)
                }
                ForEach(risk.factors, id: \.self) { factor in
                    Label(factor, systemImage: "smallcircle.filled.circle")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .labelStyle(.titleAndIcon)
                }
                if !risk.securityChecked {
                    Text("Категория уточнится после проверки контракта.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: {
            Text("Уровень риска")
        }
    }

    // MARK: Security

    private var securitySection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                if store.checking.contains(pair.tokenKey) && report == nil {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Проверяю контракт…").foregroundStyle(.secondary)
                    }
                } else if let report {
                    HStack {
                        Label(report.verdict.title, systemImage: report.verdict.icon)
                            .font(.headline)
                            .foregroundStyle(report.verdict.color)
                        Spacer()
                        Button {
                            Task { await store.checkSecurity(pair, force: true) }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.borderless)
                        .help("Проверить заново")
                    }
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow {
                            metric("Налог покупка", report.buyTax.map { Fmt.share($0) } ?? "—")
                            metric("Налог продажа", report.sellTax.map { Fmt.share($0) } ?? "—")
                        }
                        GridRow {
                            metric("Держателей", Fmt.number(report.holderCount))
                            metric("Топ-10 держат", report.top10Share.map { Fmt.share($0) } ?? "—")
                        }
                    }
                    ForEach(report.sortedFlags) { flag in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: flag.severity.icon)
                                .foregroundStyle(flag.severity.color)
                                .frame(width: 16)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(flag.title).font(.callout.weight(.medium))
                                if !flag.detail.isEmpty {
                                    Text(flag.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                    Text("Источник: GoPlus Security, \(report.checkedAt.formatted(date: .omitted, time: .shortened))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else if let error = store.securityErrors[pair.tokenKey] {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Повторить проверку") {
                        Task { await store.checkSecurity(pair, force: true) }
                    }
                } else {
                    Button("Проверить контракт") {
                        Task { await store.checkSecurity(pair, force: true) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: {
            Text("Скам-проверка")
        }
    }

    // MARK: Plan

    private var planSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                if let tier = risk.tier, let price = pair.price {
                    let plan = store.plan(for: tier)
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        levelRow("Стоп-лосс", -plan.stopLoss, price, .red)
                        levelRow("Тейк-профит 1", plan.takeProfit1, price, .green)
                        levelRow("Тейк-профит 2", plan.takeProfit2, price, .green)
                    }
                    Text("Размер позиции: до \(Fmt.share(plan.positionPercent / 100)) депозита")
                        .font(.callout)
                    Text("Уровни посчитаны от текущей цены по твоим правилам для категории «\(tier.title.lowercased())». Изменить их можно в разделе «Мои правила».")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if risk.isBlocked {
                    Text("Контракт опасный, уровни не рассчитываются.")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Нет цены для расчёта уровней.")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(4)
        } label: {
            Text("Мои уровни")
        }
    }

    private func levelRow(_ title: String, _ percent: Double, _ price: Double, _ color: Color) -> some View {
        GridRow {
            Text(title)
            Text(Fmt.pct(percent)).foregroundStyle(color).monospacedDigit()
            Text(Fmt.price(price * (1 + percent / 100)))
                .monospacedDigit()
                .textSelection(.enabled)
        }
    }

    // MARK: Actions

    private var actions: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let url = pair.dexScreenerURL {
                    Link(destination: url) {
                        Label("Открыть на DexScreener", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.borderedProminent)
                }
                if let url = pair.chain?.explorerURL(pair.baseToken.address) {
                    Link(destination: url) {
                        Label("Эксплорер", systemImage: "magnifyingglass")
                    }
                    .buttonStyle(.bordered)
                }
            }
            Button {
                Clipboard.copy(pair.baseToken.address)
            } label: {
                Label("Скопировать адрес контракта", systemImage: "doc.on.doc")
            }
            .buttonStyle(.bordered)
            Text(pair.baseToken.address)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}
