//! Theme DTOs shared with the frontend via Tauri commands.
//!
//! These are the type-level contract the webview depends on for overlay
//! theme selection and validation. All rendering/schema logic moved to
//! `theme_engine` (Rust) and `theme-engine/` (TypeScript).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ThemeInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct ThemeTestResult {
    pub valid: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}
