//! Theme engine — manifest v2 + theme sources. Knows NOTHING about
//! colors/shapes/animation: themes are opaque JS the webview executes.
pub mod digest;
pub mod loader;
pub mod manifest;
pub mod migrate;
pub mod source;

pub use loader::{ThemeEngineLoader, ThemeValidation};
pub use manifest::ThemeManifest;
pub use migrate::{known_builtin_digests, retire_pristine_copies, RetireReport};
pub use source::{DirSource, ThemeSource};
