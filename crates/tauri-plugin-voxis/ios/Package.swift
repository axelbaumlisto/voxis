// swift-tools-version:5.9
import PackageDescription

// iOS 16 is the floor (owner decision 2026-09-16: keep iOS 16 working).
// Everything 17+ is gated at its call site with `#available(iOS 17.0, *)`:
// `AVAudioApplication` (permission API -> AVAudioSession fallback on 16;
// `inputMuteStateChangeNotification` / `isInputMuted` -> no system-mute
// signal on 16) in `Sources/tauri-plugin-voxis/AudioCapture.swift`, and the
// Live Activity + `LiveActivityIntent` Stop button
// (`Sources/tauri-plugin-voxis/LiveActivity.swift`, `LiveActivityWidget/`)
// which simply does not show on 16. Never raise this floor for a single
// API -- gate the call site.
let package = Package(
    name: "tauri-plugin-voxis",
    platforms: [
        .iOS(.v16)
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
        // S2 (BLIND_SDK_swift.md finding #2): pure numeric level/cap/WAV
        // rules, split into their own Tauri-free library target so
        // `swift test` can build and run them on a plain macOS host --
        // the main `tauri-plugin-voxis` target below depends on `Tauri`
        // unconditionally, and `swift test` cannot link that dependency
        // outside a real Tauri host app.
        .target(
            name: "VoxisAudioMath",
            path: "Sources/VoxisAudioMath"),
        .target(
            name: "tauri-plugin-voxis",
            dependencies: [
                .byName(name: "Tauri"),
                "VoxisAudioMath"
            ],
            path: "Sources/tauri-plugin-voxis"),
        .testTarget(
            name: "tauri-plugin-voxisTests",
            dependencies: ["VoxisAudioMath"],
            path: "Tests/tauri-plugin-voxisTests")
    ]
)
