import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case screener, check, wallets, copyTrading, plan

    var id: Self { self }

    var title: String {
        switch self {
        case .screener: return "Скринер"
        case .check: return "Проверка токена"
        case .wallets: return "Сильные кошельки"
        case .copyTrading: return "Копи-трейдинг"
        case .plan: return "Мои правила"
        }
    }

    var icon: String {
        switch self {
        case .screener: return "line.3.horizontal.decrease.circle"
        case .check: return "checkmark.shield"
        case .wallets: return "person.crop.circle.badge.checkmark"
        case .copyTrading: return "arrow.triangle.branch"
        case .plan: return "slider.horizontal.3"
        }
    }
}

struct ContentView: View {
    @State private var selection: SidebarItem? = .screener

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Рынок") {
                    row(.screener)
                    row(.check)
                }
                Section("Кошельки") {
                    row(.wallets)
                    row(.copyTrading)
                }
                Section("Торговля") {
                    row(.plan)
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 210)
        } detail: {
            switch selection ?? .screener {
            case .screener:
                ScreenerView()
            case .check:
                TokenCheckView()
            case .wallets:
                ComingSoonView(
                    title: "Сильные кошельки",
                    icon: "person.crop.circle.badge.checkmark",
                    text: "Следующий этап. Здесь будет поиск кошельков с реальным винрейтом: прибыль считается по каждой сделке из истории блокчейна, боты и кошельки разработчиков отсеиваются."
                )
            case .copyTrading:
                ComingSoonView(
                    title: "Копи-трейдинг",
                    icon: "arrow.triangle.branch",
                    text: "Следующий этап. Ты добавляешь кошельки в отслеживание, а приложение показывает их покупки и продажи с мгновенной скам-проверкой токена и уведомлением macOS."
                )
            case .plan:
                TradePlanView()
            }
        }
    }

    private func row(_ item: SidebarItem) -> some View {
        Label(item.title, systemImage: item.icon).tag(item)
    }
}

struct ComingSoonView: View {
    let title: String
    let icon: String
    let text: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(text)
        }
        .navigationTitle(title)
    }
}
