// swift-tools-version:5.9
import PackageDescription

// Task 8 [R1-iOS S5]: iOS 17 is the floor -- `AVAudioApplication`
// (permission API + `inputMuteStateChangeNotification`, both used by
// `Sources/AudioCapture.swift`) is iOS 17+. Anything gated to iOS 18+
// (none of this task's own surface, but noted for future Task 9a/b
// Live Activity work) must use `#available(iOS 18, *)` at the call site
// instead of raising this floor.
let package = Package(
    name: "tauri-plugin-voxis",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "tauri-plugin-voxis",
            type: .static,
            targets: ["tauri-plugin-voxis"])
    ],
    dependencies: [
        // Vendored at build time by `tauri-plugin`'s build-script
        // support (`build.rs`'s `.ios_path("ios")`, see that crate's
        // `src/build/mobile.rs::setup`): copies Tauri's own
        // `mobile/ios-api` Swift package to `../.tauri/tauri-api`
        // (relative to this file's parent, i.e. the plugin crate root)
        // -- mirrors `naked-plugin-capture/ios/Package.swift` verbatim.
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-voxis",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
