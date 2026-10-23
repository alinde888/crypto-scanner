import SwiftUI

struct TradePlanView: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        Form {
            Section {
                Text("Правила выхода и размер позиции для каждой категории риска. По ним приложение считает уровни стоп-лосса и тейк-профита для любого токена.")
                    .foregroundStyle(.secondary)
            }
            ForEach(RiskTier.allCases) { tier in
                Section {
                    field("Стоп-лосс, % ниже входа", tier, \.stopLoss, range: 1...95)
                    field("Тейк-профит 1, % выше входа", tier, \.takeProfit1, range: 1...10_000)
                    field("Тейк-профит 2, % выше входа", tier, \.takeProfit2, range: 1...10_000)
                    field("Размер позиции, % депозита", tier, \.positionPercent, range: 0.1...100)
                    Button("Вернуть значения по умолчанию") {
                        store.setPlan(TradePlan.defaults(for: tier), for: tier)
                    }
                    .buttonStyle(.link)
                } header: {
                    HStack(spacing: 6) {
                        Circle().fill(tier.color).frame(width: 8, height: 8)
                        Text(tier.title)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Мои правила")
    }

    private func field(_ title: String, _ tier: RiskTier, _ key: WritableKeyPath<TradePlan, Double>, range: ClosedRange<Double>) -> some View {
        let binding = Binding<Double>(
            get: { store.plan(for: tier)[keyPath: key] },
            set: { newValue in
                var plan = store.plan(for: tier)
                plan[keyPath: key] = min(max(newValue, range.lowerBound), range.upperBound)
                store.setPlan(plan, for: tier)
            }
        )
        return LabeledContent(title) {
            HStack(spacing: 6) {
                TextField(title, value: binding, format: .number.precision(.fractionLength(0...1)))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                Stepper(title, value: binding, in: range, step: 1)
                    .labelsHidden()
            }
        }
    }
}
