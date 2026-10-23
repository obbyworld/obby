// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-mobile-notifications",
    platforms: [.iOS(.v13)],
    products: [
        .library(
            name: "tauri-plugin-mobile-notifications",
            type: .static,
            targets: ["tauri-plugin-mobile-notifications"]
        )
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-mobile-notifications",
            dependencies: [
                .product(name: "Tauri", package: "Tauri")
            ],
            path: "Sources"
        )
    ]
)
