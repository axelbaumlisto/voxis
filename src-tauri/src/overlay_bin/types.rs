/// Number of waveform bars.
pub const BAR_COUNT: usize = 32;

/// Default overlay dimensions.
pub const DEFAULT_WIDTH: u32 = 250;
pub const DEFAULT_HEIGHT: u32 = 60;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const DEFAULT_MARGIN: u32 = 30;

/// Overlay colors (RGB). Legacy fallback palette used by `render::state_color`
/// when no `VisualizationTheme` is available. Production code paths in
/// `platform/macos/draw.rs` resolve colors via the active theme; these
/// constants remain as the documented contract for the fallback and are
/// covered by unit tests in `tests.rs::test_state_color`.
#[allow(dead_code)]
pub mod colors {
    pub const BLUE: (u8, u8, u8) = (30, 136, 229);
    pub const GREEN: (u8, u8, u8) = (76, 175, 80);
}

pub use voice_lib::overlay::types::OverlayState;

/// Commands from main process.
#[derive(Debug, PartialEq)]
pub enum Command {
    Show(OverlayState),
    Hide,
    AudioLevel(f32),
    Spectrum([f32; BAR_COUNT]),
    Position(i32, i32, u32, u32),
    Theme(String),
    Quit,
}

/// Parse spectrum bins from "[0.1,0.2,...]" format.
fn parse_spectrum_bins(json_str: &str) -> Option<[f32; BAR_COUNT]> {
    let trimmed = json_str
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']');
    let mut bins = [0.0f32; BAR_COUNT];
    for (i, val_str) in trimmed.split(',').enumerate() {
        if i >= BAR_COUNT {
            break;
        }
        bins[i] = val_str.trim().parse().ok()?;
    }
    Some(bins)
}

/// Parse command from stdin line.
pub fn parse_command(line: &str) -> Option<Command> {
    let trimmed = line.trim();
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    let cmd = parts.first()?;

    match *cmd {
        "show" => {
            let state = match parts.get(1).copied() {
                Some("recording") => OverlayState::Recording,
                Some("transcribing") => OverlayState::Transcribing,
                _ => OverlayState::Idle,
            };
            Some(Command::Show(state))
        }
        "hide" => Some(Command::Hide),
        "level" => parts.get(1)?.parse().ok().map(Command::AudioLevel),
        "spectrum" => {
            // Format: "spectrum [0.1,0.2,...]"
            let bracket_start = trimmed.find('[')?;
            let json_str = &trimmed[bracket_start..];
            let bins = parse_spectrum_bins(json_str)?;
            Some(Command::Spectrum(bins))
        }
        "pos" if parts.len() >= 5 => Some(Command::Position(
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
            parts[3].parse().ok()?,
            parts[4].parse().ok()?,
        )),
        "theme" => {
            let name = parts.get(1)?.to_string();
            Some(Command::Theme(name))
        }
        "quit" => Some(Command::Quit),
        _ => None,
    }
}

/// Waveform levels buffer - sliding window of audio levels.
pub struct WaveformLevels {
    levels: Vec<f32>,
}

impl WaveformLevels {
    pub fn new(bar_count: usize) -> Self {
        Self {
            levels: vec![0.0; bar_count],
        }
    }

    pub fn push(&mut self, level: f32) {
        self.levels.rotate_left(1);
        if let Some(last) = self.levels.last_mut() {
            *last = level;
        }
    }

    pub fn get(&self, index: usize) -> f32 {
        self.levels.get(index).copied().unwrap_or(0.0)
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn len(&self) -> usize {
        self.levels.len()
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn is_empty(&self) -> bool {
        self.levels.is_empty()
    }

    /// Set all levels from a fixed-size array (for FFT spectrum bins).
    pub fn set_from_bins(&mut self, bins: &[f32; BAR_COUNT]) {
        for (i, &val) in bins.iter().enumerate() {
            if i < self.levels.len() {
                self.levels[i] = val;
            }
        }
    }
}
