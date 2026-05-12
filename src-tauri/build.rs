fn main() {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    build_apple_intelligence_bridge();

    tauri_build::build()
}

/// Compile the Swift Apple Intelligence bridge into a static library.
///
/// Selects the real implementation when the SDK has FoundationModels,
/// otherwise falls back to the stub that returns "not available".
/// The resulting `libapple_intelligence.a` is linked into the Rust binary.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn build_apple_intelligence_bridge() {
    use std::env;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const REAL_SWIFT: &str = "swift/apple_intelligence.swift";
    const STUB_SWIFT: &str = "swift/apple_intelligence_stub.swift";
    const BRIDGE_H: &str = "swift/apple_intelligence_bridge.h";

    println!("cargo:rerun-if-changed={REAL_SWIFT}");
    println!("cargo:rerun-if-changed={STUB_SWIFT}");
    println!("cargo:rerun-if-changed={BRIDGE_H}");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let obj = out_dir.join("apple_intelligence.o");
    let lib = out_dir.join("libapple_intelligence.a");

    // Locate SDK (respect SDKROOT override for non-Xcode toolchains).
    let sdk_path = env::var("SDKROOT").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--sdk", "macosx", "--show-sdk-path"])
                .output()
                .expect("Failed to locate macOS SDK via xcrun")
                .stdout,
        )
        .expect("SDK path is not valid UTF-8")
        .trim()
        .to_string()
    });

    // Pick real or stub based on FoundationModels availability in the SDK.
    let has_fm = Path::new(&sdk_path)
        .join("System/Library/Frameworks/FoundationModels.framework")
        .exists();

    let source = if has_fm {
        println!("cargo:warning=Building Apple Intelligence with real FoundationModels.");
        REAL_SWIFT
    } else {
        println!("cargo:warning=FoundationModels not in SDK — building with stubs.");
        STUB_SWIFT
    };

    assert!(
        Path::new(source).exists(),
        "Swift source file missing: {source}"
    );

    // Locate swiftc (respect SWIFTC override).
    let swiftc = env::var("SWIFTC").unwrap_or_else(|_| {
        String::from_utf8(
            Command::new("xcrun")
                .args(["--find", "swiftc"])
                .output()
                .expect("Failed to locate swiftc")
                .stdout,
        )
        .expect("swiftc path not valid UTF-8")
        .trim()
        .to_string()
    });

    // Swift toolchain lib paths for linking.
    let toolchain_lib = Path::new(&swiftc)
        .parent()
        .and_then(|p| p.parent())
        .map(|root| root.join("lib/swift/macosx"))
        .expect("Cannot determine Swift toolchain lib dir");
    let sdk_swift_lib = Path::new(&sdk_path).join("usr/lib/swift");

    // Compile .swift → .o (fall back to stub if real source fails)
    let compile = |src: &str| -> bool {
        Command::new(&swiftc)
            .args([
                "-parse-as-library",
                "-target",
                "arm64-apple-macosx11.0",
                "-sdk",
                &sdk_path,
                "-O",
                "-import-objc-header",
                BRIDGE_H,
                "-c",
                src,
                "-o",
            ])
            .arg(obj.to_str().unwrap())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };

    if !compile(source) {
        if source == REAL_SWIFT {
            println!("cargo:warning=Real Swift source failed to compile — falling back to stub.");
            assert!(
                compile(STUB_SWIFT),
                "swiftc failed to compile even the stub {STUB_SWIFT}"
            );
        } else {
            panic!("swiftc failed to compile {source}");
        }
    }

    // .o → .a
    let status = Command::new("libtool")
        .args(["-static", "-o"])
        .arg(lib.to_str().unwrap())
        .arg(obj.to_str().unwrap())
        .status()
        .expect("Failed to invoke libtool");
    assert!(status.success(), "libtool failed");

    // Link directives
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=apple_intelligence");
    println!(
        "cargo:rustc-link-search=native={}",
        toolchain_lib.display()
    );
    println!("cargo:rustc-link-search=native={}", sdk_swift_lib.display());
    println!("cargo:rustc-link-lib=framework=Foundation");

    if has_fm {
        // Weak-link so the binary still launches on systems without the framework.
        println!("cargo:rustc-link-arg=-weak_framework");
        println!("cargo:rustc-link-arg=FoundationModels");
    }

    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
