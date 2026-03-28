mod backend;
mod native;
mod subprocess;
pub mod theme;

use std::sync::{Arc, RwLock};

pub use backend::{NoopOverlay, OverlayBackend};
pub use native::{amplify_level, NativeOverlay, Position, WaveformLevels};
pub use subprocess::SubprocessOverlay;
pub use theme::{ThemeColors, ThemeInfo, ThemeLoader, ThemeTestResult, VisualizationTheme};

pub type OverlayState = crate::overlay::types::OverlayState;
pub type OverlayPositionConfig = crate::overlay::types::PositionConfig;
pub type OverlaySizeConfig = crate::overlay::types::SizeConfig;

pub type ThemeLoaderHandle = Arc<RwLock<ThemeLoader>>;

pub struct ThemeLoaderState {
    pub handle: ThemeLoaderHandle,
}

impl ThemeLoaderState {
    pub fn new(themes_dir: std::path::PathBuf) -> Self {
        let mut loader = ThemeLoader::new(themes_dir);
        if let Err(e) = loader.scan() {
            tracing::warn!("Failed to scan themes directory: {}", e);
        }
        Self {
            handle: Arc::new(RwLock::new(loader)),
        }
    }
}

pub const BAR_COUNT: usize = 32;

pub fn create_overlay(
    enabled: bool,
    position: OverlayPositionConfig,
    size: OverlaySizeConfig,
    margin: i32,
    theme: &str,
    audio_boost: f32,
    theme_loader: ThemeLoaderHandle,
) -> Box<dyn OverlayBackend> {
    if !enabled {
        return Box::new(NoopOverlay::new());
    }

    #[cfg(target_os = "linux")]
    if NativeOverlay::is_available() {
        return Box::new(NativeOverlay::new_with_config(
            position,
            size,
            margin,
            theme,
            audio_boost,
            theme_loader,
        ));
    }

    if let Some(subprocess) = SubprocessOverlay::new() {
        return Box::new(subprocess);
    }

    if NativeOverlay::is_available() {
        return Box::new(NativeOverlay::new_with_config(
            position,
            size,
            margin,
            theme,
            audio_boost,
            theme_loader,
        ));
    }

    Box::new(NoopOverlay::new())
}
