use serde::{Deserialize, Serialize};

const BASE_WIDTH: u32 = 200;
const BASE_HEIGHT: u32 = 50;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "snake_case")]
pub enum OverlayState {
    #[default]
    Hidden,
    Idle,
    Recording,
    Transcribing,
    Queued(usize),
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositionConfig {
    #[default]
    BottomLeft,
    BottomRight,
    TopLeft,
    TopRight,
    Center,
    TopCenter,
    BottomCenter,
    LeftCenter,
    RightCenter,
}

impl PositionConfig {
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "bottom_left" => Self::BottomLeft,
            "bottom_right" => Self::BottomRight,
            "top_left" => Self::TopLeft,
            "top_right" => Self::TopRight,
            "center" => Self::Center,
            "top_center" => Self::TopCenter,
            "bottom_center" => Self::BottomCenter,
            "left_center" => Self::LeftCenter,
            "right_center" => Self::RightCenter,
            _ => Self::default(),
        }
    }

    pub fn calculate(
        self,
        monitor_width: i32,
        monitor_height: i32,
        window_width: i32,
        window_height: i32,
        margin: i32,
    ) -> (i32, i32) {
        match self {
            Self::BottomLeft => (margin, monitor_height - window_height - margin),
            Self::BottomRight => (
                monitor_width - window_width - margin,
                monitor_height - window_height - margin,
            ),
            Self::TopLeft => (margin, margin),
            Self::TopRight => (monitor_width - window_width - margin, margin),
            Self::Center => (
                (monitor_width - window_width) / 2,
                (monitor_height - window_height) / 2,
            ),
            Self::TopCenter => ((monitor_width - window_width) / 2, margin),
            Self::BottomCenter => (
                (monitor_width - window_width) / 2,
                monitor_height - window_height - margin,
            ),
            Self::LeftCenter => (margin, (monitor_height - window_height) / 2),
            Self::RightCenter => (
                monitor_width - window_width - margin,
                (monitor_height - window_height) / 2,
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeConfig {
    Small,
    #[default]
    Medium,
    Large,
}

impl SizeConfig {
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "small" => Self::Small,
            "medium" => Self::Medium,
            "large" => Self::Large,
            _ => Self::default(),
        }
    }

    pub fn multiplier(self) -> u32 {
        match self {
            Self::Small => 1,
            Self::Medium => 2,
            Self::Large => 4,
        }
    }

    pub fn width(self) -> u32 {
        BASE_WIDTH * self.multiplier()
    }

    pub fn height(self) -> u32 {
        BASE_HEIGHT * self.multiplier()
    }
}
