// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CryptoScanner",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "CryptoScanner",
            path: "Sources/CryptoScanner"
        )
    ]
)
