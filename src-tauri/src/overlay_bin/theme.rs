use std::path::PathBuf;

use voice_lib::overlay::themes::ThemeLoader;

pub fn default_themes_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_default()
        .join("soupawhisper")
        .join("themes")
}

pub fn create_theme_loader() -> ThemeLoader {
    let mut loader = ThemeLoader::new(default_themes_dir());
    if let Err(err) = loader.scan() {
        eprintln!("Failed to scan themes directory: {err}");
    }
    loader
}
