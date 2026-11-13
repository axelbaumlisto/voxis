//! Theme engine — manifest v2 + theme sources. Knows NOTHING about
//! colors/shapes/animation: themes are opaque JS the webview executes.
pub mod loader;
pub mod manifest;
pub mod source;

pub use loader::{ThemeEngineLoader, ThemeValidation};
pub use manifest::ThemeManifest;
pub use source::{DirSource, ThemeSource};
