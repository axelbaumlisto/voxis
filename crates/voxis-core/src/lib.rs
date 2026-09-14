//! voxis-core: pure-Rust core shared by Voxis desktop (`voice_lib`) and,
//! eventually, `tauri-plugin-voxis` (desktop + iOS).
//!
//! No dependency on tauri (except the optional, off-by-default
//! `tauri-support` feature used only by `storage::paths::AppPaths::new`),
//! cpal, rdev, enigo, arboard, objc2*, or core-foundation — this crate must
//! stay buildable for `aarch64-apple-ios` with zero feature flags
//! (`scripts/check-ios-build.sh`).
//!
//! Task 1a moved `config` + `storage` here (mechanical extraction), plus a
//! few pure leaf types that `AppConfig` embeds but that structurally belong
//! to backend-coupled voice_lib modules: `output_types::AutoSubmitKey`,
//! `audio_feedback_types::AudioFeedbackSettings`, `shortcut::binding`,
//! `llm::prompts`. voice_lib re-exports every one of these under their
//! original paths so existing call sites are unchanged.

pub mod audio_feedback_types;
pub mod config;
pub mod llm;
pub mod output_types;
pub mod shortcut;
pub mod storage;
