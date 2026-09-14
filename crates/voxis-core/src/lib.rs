//! voxis-core: pure-Rust core shared by Voxis desktop (`voice_lib`) and,
//! eventually, `tauri-plugin-voxis` (desktop + iOS).
//!
//! No dependency on tauri at all (Task 1b's deferred Task-1a minor M1
//! replaced the one Tauri-coupled constructor, `storage::paths::
//! AppPaths::new(&AppHandle)`, with the tauri-free `AppPaths::
//! for_desktop()` and removed the `tauri-support` feature + optional
//! `tauri` dependency entirely), cpal, enigo, arboard, objc2*, or
//! core-foundation — and no `rdev` with zero feature flags. This crate
//! must stay buildable for `aarch64-apple-ios` with zero feature flags
//! (`scripts/check-ios-build.sh`); `rdev`/`hotkey` are opt-in via the
//! `rdev` feature for desktop consumers only.
//!
//! Task 1a moved `config` + `storage` here (mechanical extraction), plus a
//! few pure leaf types that `AppConfig` embeds but that structurally belong
//! to backend-coupled voice_lib modules: `output_types::AutoSubmitKey`,
//! `audio_feedback_types::AudioFeedbackSettings`, `shortcut::binding`,
//! `llm::prompts`. voice_lib re-exports every one of these under their
//! original paths so existing call sites are unchanged.
//!
//! Task 1b added `transcription`, the rest of `llm`, `learning`,
//! `audio_wav` (WAV encoding), `guard` (pure recording-guard decision
//! logic), and `hotkey` (parser + rdev listener, behind the `rdev`
//! feature — off by default, so this crate has zero `rdev` in its default
//! dependency tree).

pub mod audio_feedback_types;
pub mod audio_wav;
pub mod config;
pub mod guard;
#[cfg(feature = "rdev")]
pub mod hotkey;
pub mod learning;
pub mod llm;
pub mod output_types;
pub mod profile;
pub mod shortcut;
pub mod storage;
pub mod transcription;
