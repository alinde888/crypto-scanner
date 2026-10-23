import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            NetworksSettings()
                .tabItem { Label("Сети", systemImage: "network") }
            ScreenerSettings()
                .tabItem { Label("Скринер", systemImage: "line.3.horizontal.decrease.circle") }
            KeysSettings()
                .tabItem { Label("API-ключи", systemImage: "key") }
        }
        .frame(width: 520, height: 440)
    }
}

private struct NetworksSettings: View {
    @Environment(ScannerStore.self) private var store

    var body: some View {
        Form {
            Section {
                ForEach(Chain.all) { chain in
                    Toggle(isOn: binding(for: chain.id)) {
                        HStack {
                            Text(chain.name)
                            Spacer()
                            ChainBadge(chainId: chain.id)
                        }
                    }
                }
            } footer: {
                Text("Скринер ищет токены только в включённых сетях.")
            }
        }
        .formStyle(.grouped)
    }

    private func binding(for id: String) -> Binding<Bool> {
        Binding(
            get: { store.enabledChainIDs.contains(id) },
            set: { on in
                if on { store.enabledChainIDs.insert(id) } else { store.enabledChainIDs.remove(id) }
            }
        )
    }
}

private struct ScreenerSettings: View {
    @Environment(ScannerStore.self) private var store

    private let liquidityOptions: [Double] = [0, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000]
    private let refreshOptions: [Int] = [0, 1, 2, 5, 10, 15, 30]

    var body: some View {
        @Bindable var store = store
        Form {
            Section {
                Picker("Минимальная ликвидность", selection: $store.minLiquidity) {
                    ForEach(liquidityOptions, id: \.self) { v in
                        Text(v == 0 ? "Без ограничения" : Fmt.usd(v)).tag(v)
                    }
                }
                Picker("Автообновление", selection: $store.autoRefreshMinutes) {
                    ForEach(refreshOptions, id: \.self) { m in
                        Text(m == 0 ? "Выключено" : "Каждые \(m) мин").tag(m)
                    }
                }
                Toggle("Скрывать токены с опасным контрактом", isOn: $store.hideDangerous)
            } footer: {
                Text("Пары с ликвидностью ниже порога не попадают в скринер. Чем ниже порог, тем больше щитков и тем выше риск, что ликвидность заберут.")
            }
        }
        .formStyle(.grouped)
    }
}

private struct KeysSettings: View {
    @State private var etherscan = Keychain.get("etherscan") ?? ""
    @State private var helius = Keychain.get("helius") ?? ""
    @State private var saved = false

    var body: some View {
        Form {
            Section {
                SecureField("Etherscan API key", text: $etherscan)
                SecureField("Helius API key (Solana)", text: $helius)
                HStack {
                    Button("Сохранить") {
                        Keychain.set(etherscan, for: "etherscan")
                        Keychain.set(helius, for: "helius")
                        saved = true
                    }
                    .buttonStyle(.borderedProminent)
                    if saved {
                        Label("Сохранено в Связке ключей", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }
            } header: {
                Text("Ключи для анализа кошельков")
            } footer: {
                Text("Скринер и скам-проверка работают без ключей. Ключи понадобятся для разделов «Сильные кошельки» и «Копи-трейдинг». Они хранятся в Связке ключей macOS и никуда не отправляются, кроме самих сервисов.")
            }
            Section {
                Link("Получить ключ Etherscan", destination: URL(string: "https://etherscan.io/apidashboard")!)
                Link("Получить ключ Helius", destination: URL(string: "https://dashboard.helius.dev")!)
            }
        }
        .formStyle(.grouped)
        .onChange(of: etherscan) { saved = false }
        .onChange(of: helius) { saved = false }
    }
}
