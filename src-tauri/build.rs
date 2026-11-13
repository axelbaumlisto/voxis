fn main() {
    // `include_dir!` embeds `themes/` into the binary, but include_dir_macros
    // on stable has no `proc_macro::tracked_path`, so it does not track the
    // embedded files at all — without this line editing a theme would not
    // rebuild the binary.
    println!("cargo:rerun-if-changed=themes");
    tauri_build::build()
}
