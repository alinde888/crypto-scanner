import SwiftUI

struct TokenCheckView: View {
    @Environment(ScannerStore.self) private var store

    @State private var chainId = "solana"
    @State private var address = ""
    @State private var result: DexPair?
    @State private var isLoading = false
    @State private var errorText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Picker("Сеть", selection: $chainId) {
                    ForEach(Chain.all) { chain in
                        Text(chain.name).tag(chain.id)
                    }
                }
                .labelsHidden()
                .frame(width: 140)

                TextField("Адрес контракта токена", text: $address)
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())
                    .onSubmit { Task { await check() } }

                Button {
                    Task { await check() }
                } label: {
                    Label("Проверить", systemImage: "checkmark.shield")
                }
                .buttonStyle(.borderedProminent)
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            }
            .padding(16)

            Divider()

            Group {
                if isLoading {
                    ProgressView("Ищу токен на DEX…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let result {
                    TokenDetailView(pair: result)
                        .frame(maxWidth: 720)
                        .frame(maxWidth: .infinity)
                } else if let errorText {
                    ContentUnavailableView {
                        Label("Токен не найден", systemImage: "questionmark.circle")
                    } description: {
                        Text(errorText)
                    }
                } else {
                    ContentUnavailableView {
                        Label("Проверка любого токена", systemImage: "checkmark.shield")
                    } description: {
                        Text("Вставь адрес контракта и выбери сеть. Приложение найдёт самую ликвидную пару, проверит контракт на скам и покажет уровень риска.")
                    }
                }
            }
        }
        .navigationTitle("Проверка токена")
    }

    private func check() async {
        let token = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        isLoading = true
        errorText = nil
        result = nil
        defer { isLoading = false }
        do {
            let pairs = try await DexScreenerClient.shared.tokenPairs(chain: chainId, token: token)
            let own = pairs.filter { $0.baseToken.address.lowercased() == token.lowercased() }
            let candidates = own.isEmpty ? pairs : own
            if let best = candidates.max(by: { $0.liquidityUsd < $1.liquidityUsd }) {
                result = best
                await store.checkSecurity(best, force: true)
            } else {
                errorText = "На DexScreener нет торговых пар для этого адреса в сети \(Chain.byId(chainId)?.name ?? chainId). Проверь адрес и выбранную сеть."
            }
        } catch {
            errorText = error.localizedDescription
        }
    }
}
