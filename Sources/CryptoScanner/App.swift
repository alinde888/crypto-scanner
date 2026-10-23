import SwiftUI
import AppKit

@main
struct CryptoScannerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = ScannerStore()

    var body: some Scene {
        WindowGroup("Crypto Scanner") {
            ContentView()
                .environment(store)
                .frame(minWidth: 1060, minHeight: 640)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Обновить данные") {
                    Task { await store.refresh() }
                }
                .keyboardShortcut("r")
            }
        }

        Settings {
            SettingsView()
                .environment(store)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
