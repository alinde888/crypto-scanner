import SwiftUI

struct ScreenerView: View {
    @Environment(ScannerStore.self) private var store

    @State private var riskFilter: RiskTier? = nil
    @State private var strategy: Strategy = .earlyPairs
    @State private var selection: DexPair.ID?
    @State private var sortOrder = [KeyPathComparator(\DexPair.volume1h, order: .reverse)]

    private var visibleStrategies: [Strategy] {
        guard let riskFilter else { return Strategy.allCases }
        return Strategy.allCases.filter { $0.risk == riskFilter }
    }

    private var rows: [DexPair] {
        store.matches(strategy).sorted(using: sortOrder)
    }

    private var selectedPair: DexPair? {
        guard let selection else { return nil }
        return store.pairs.first { $0.id == selection }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            controls
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            Divider()
            content
        }
        .navigationTitle("Скринер")
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItem {
                if store.isLoading {
                    ProgressView().controlSize(.small)
                }
            }
            ToolbarItem {
                Button {
                    Task { await store.refresh() }
                } label: {
                    Label("Обновить", systemImage: "arrow.clockwise")
                }
                .disabled(store.isLoading)
                .help("Обновить данные (⌘R)")
            }
        }
        .inspector(isPresented: inspectorShown) {
            Group {
                if let pair = selectedPair {
                    TokenDetailView(pair: pair)
                } else {
                    ContentUnavailableView("Выбери токен", systemImage: "hand.point.left")
                }
            }
            .inspectorColumnWidth(min: 340, ideal: 400, max: 560)
        }
        .task {
            if store.pairs.isEmpty { await store.refresh() }
        }
        .task(id: rows.map(\.tokenKey)) {
            await store.checkMany(rows)
        }
        .onChange(of: riskFilter) {
            if let first = visibleStrategies.first, !visibleStrategies.contains(strategy) {
                strategy = first
            }
        }
    }

    private var inspectorShown: Binding<Bool> {
        Binding(
            get: { selection != nil },
            set: { if !$0 { selection = nil } }
        )
    }

    private var subtitle: String {
        if let date = store.lastUpdated {
            return "Обновлено в \(date.formatted(date: .omitted, time: .shortened)) · токенов в базе: \(store.pairs.count)"
        }
        return store.isLoading ? "Загружаю рынок…" : "Нет данных"
    }

    // MARK: Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Picker("Уровень риска", selection: $riskFilter) {
                    Text("Все").tag(RiskTier?.none)
                    ForEach(RiskTier.allCases) { tier in
                        Text(tier.shortTitle).tag(Optional(tier))
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 360)
                Spacer()
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(visibleStrategies) { s in
                        StrategyChip(strategy: s, selected: s == strategy, count: store.matches(s).count) {
                            strategy = s
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(strategy.summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    ForEach(strategy.rules, id: \.self) { rule in
                        Text(rule)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.quaternary.opacity(0.6), in: Capsule())
                    }
                }
            }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if let error = store.errorMessage, store.pairs.isEmpty {
            ContentUnavailableView {
                Label("Не удалось загрузить рынок", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error)
            } actions: {
                Button("Повторить") { Task { await store.refresh() } }
            }
        } else if store.pairs.isEmpty {
            ProgressView("Загружаю рынок…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label("Нет совпадений", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("Сейчас ни один токен не проходит условия стратегии «\(strategy.title)». Данные обновляются автоматически, можно выбрать другую стратегию или снизить минимальную ликвидность в настройках.")
            }
        } else {
            table
        }
    }

    private var table: some View {
        Table(rows, selection: $selection, sortOrder: $sortOrder) {
            TableColumn("Токен", value: \.symbol) { p in
                HStack(spacing: 8) {
                    TokenIcon(url: p.info?.imageUrl, symbol: p.symbol)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(p.symbol).fontWeight(.medium)
                        Text(p.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .width(min: 150, ideal: 190)

            TableColumn("Сеть", value: \.chainId) { p in
                ChainBadge(chainId: p.chainId)
            }
            .width(min: 50, ideal: 60)

            TableColumn("Цена", value: \.priceValue) { p in
                Text(Fmt.price(p.price)).monospacedDigit()
            }
            .width(min: 80, ideal: 100)

            TableColumn("1 ч", value: \.change1hValue) { p in
                ChangeText(value: p.change("h1"))
            }
            .width(min: 60, ideal: 70)

            TableColumn("24 ч", value: \.change24hValue) { p in
                ChangeText(value: p.change("h24"))
            }
            .width(min: 60, ideal: 75)

            TableColumn("Ликвидность", value: \.liquidityUsd) { p in
                Text(Fmt.usd(p.liquidityUsd)).monospacedDigit()
            }
            .width(min: 80, ideal: 95)

            TableColumn("Объём 1 ч", value: \.volume1h) { p in
                Text(Fmt.usd(p.volume1h)).monospacedDigit()
            }
            .width(min: 80, ideal: 90)

            TableColumn("Возраст", value: \.ageHoursValue) { p in
                Text(Fmt.age(p.ageHours)).monospacedDigit()
            }
            .width(min: 60, ideal: 70)

            TableColumn("Риск") { p in
                RiskBadge(assessment: store.risk(for: p), checking: store.checking.contains(p.tokenKey))
            }
            .width(min: 100, ideal: 115)
        }
    }
}

struct StrategyChip: View {
    let strategy: Strategy
    let selected: Bool
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: strategy.icon)
                Text(strategy.title)
                Text("\(count)")
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(selected ? Color.white.opacity(0.25) : Color.secondary.opacity(0.15), in: Capsule())
                Circle()
                    .fill(strategy.risk.color)
                    .frame(width: 7, height: 7)
                    .help(strategy.risk.title)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(selected ? Color.white : Color.primary)
            .background(selected ? Color.accentColor : Color.secondary.opacity(0.1), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
