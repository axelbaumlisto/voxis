//! Theme engine — manifest v2 + filesystem loader. Knows NOTHING about
//! colors/shapes/animation: themes are opaque JS the webview executes.
pub mod loader;
pub mod manifest;

pub use loader::{ThemeEngineLoader, ThemeValidation};
pub use manifest::ThemeManifest;