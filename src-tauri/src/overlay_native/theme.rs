use super::color::Color32;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ThemeColors {
    pub use_gradient: bool,
    pub gradient_bottom: String,
    pub gradient_middle: String,
    pub gradient_top: String,
    pub recording: String,
    pub transcribing: String,
    pub idle: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GradientColors {
    pub bottom: Color32,
    pub middle: Color32,
    pub top: Color32,
}

impl Default for GradientColors {
    fn default() -> Self {
        Self {
            bottom: Color32::from_rgb(41, 148, 0),
            middle: Color32::from_rgb(214, 181, 33),
            top: Color32::from_rgb(239, 49, 16),
        }
    }
}

impl GradientColors {
    pub fn color_at(&self, t: f32) -> Color32 {
        let t = t.clamp(0.0, 1.0);
        if t < 0.5 {
            lerp_color(self.bottom, self.middle, t * 2.0)
        } else {
            lerp_color(self.middle, self.top, (t - 0.5) * 2.0)
        }
    }
}

fn lerp_color(c1: Color32, c2: Color32, t: f32) -> Color32 {
    let t = t.clamp(0.0, 1.0);
    let r = (c1.r() as f32 * (1.0 - t) + c2.r() as f32 * t) as u8;
    let g = (c1.g() as f32 * (1.0 - t) + c2.g() as f32 * t) as u8;
    let b = (c1.b() as f32 * (1.0 - t) + c2.b() as f32 * t) as u8;
    let a = (c1.a() as f32 * (1.0 - t) + c2.a() as f32 * t) as u8;
    Color32::from_rgba_premultiplied(r, g, b, a)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VisualizationFamily {
    Bars,
    OrganicRing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OrganicRingShape {
    pub gap_degrees: f32,
    pub base_thickness: f32,
    pub taper: f32,
    pub roundness: f32,
    pub active_zones: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OrganicRingMotion {
    pub idle_breathing: f32,
    pub speech_responsiveness: f32,
    pub drift: f32,
    pub settle_speed: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OrganicRingTheme {
    pub shape: OrganicRingShape,
    pub motion: OrganicRingMotion,
}

/// Full theme payload for the webview overlay. Combines colors + family hint
/// + organic_ring shape/motion so the React side has one DTO to consume.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct OverlayThemeData {
    pub id: String,
    pub name: String,
    /// `"bars"` | `"organic_ring"`.
    pub family: String,
    pub colors: ThemeColors,
    pub organic_ring: Option<OrganicRingTheme>,
}

impl OverlayThemeData {
    pub fn from_theme(theme: &VisualizationTheme) -> Self {
        let family = match theme.family {
            VisualizationFamily::Bars => "bars".to_string(),
            VisualizationFamily::OrganicRing => "organic_ring".to_string(),
        };
        Self {
            id: theme.id.clone(),
            name: theme.name.clone(),
            family,
            colors: theme.to_colors(),
            organic_ring: theme.organic_ring.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VisualizationTheme {
    pub id: String,
    pub name: String,
    pub family: VisualizationFamily,
    pub organic_ring: Option<OrganicRingTheme>,
    pub background: Color32,
    pub idle: Color32,
    pub recording: Color32,
    pub recording_peak: Color32,
    pub transcribing: Color32,
    pub queued: Color32,
    pub text: Color32,
    pub use_gradient: bool,
    pub gradient: GradientColors,
}

impl Default for VisualizationTheme {
    fn default() -> Self {
        Self::builtin_winamp_classic()
    }
}

impl VisualizationTheme {
    pub fn by_name(name: &str, theme_loader: &super::ThemeLoaderHandle) -> Self {
        theme_loader
            .read()
            .map(|loader| loader.get_theme(name))
            .unwrap_or_else(|_| Self::builtin_winamp_classic())
    }

    pub fn by_name_builtin(name: &str) -> Self {
        Self::builtin_by_id(name).unwrap_or_else(Self::builtin_winamp_classic)
    }

    pub fn builtin_default() -> Self {
        Self {
            id: "default".into(),
            name: "Default".into(),
            family: VisualizationFamily::Bars,
            organic_ring: None,
            background: Color32::TRANSPARENT,
            idle: Color32::from_rgb(0x1e, 0x88, 0xe5),
            recording: Color32::from_rgb(0x1e, 0x88, 0xe5),
            recording_peak: Color32::from_rgb(0x64, 0xb5, 0xf6),
            transcribing: Color32::from_rgb(0x4c, 0xaf, 0x50),
            queued: Color32::from_rgb(0xff, 0xa7, 0x26),
            text: Color32::WHITE,
            use_gradient: true,
            gradient: GradientColors {
                bottom: Color32::from_rgb(0x1e, 0x88, 0xe5),
                middle: Color32::from_rgb(0x42, 0xa5, 0xf5),
                top: Color32::from_rgb(0x64, 0xb5, 0xf6),
            },
        }
    }

    pub fn builtin_winamp_classic() -> Self {
        Self {
            id: "winamp_classic".into(),
            name: "Winamp Classic".into(),
            family: VisualizationFamily::Bars,
            organic_ring: None,
            background: Color32::BLACK,
            idle: Color32::from_rgb(41, 148, 0),
            recording: Color32::from_rgb(239, 49, 16),
            recording_peak: Color32::from_rgb(255, 255, 255),
            transcribing: Color32::from_rgb(41, 206, 16),
            queued: Color32::from_rgb(214, 181, 33),
            text: Color32::WHITE,
            use_gradient: true,
            gradient: GradientColors::default(),
        }
    }

    pub fn builtin_dark() -> Self {
        let mut t = Self::builtin_default();
        t.id = "dark".into();
        t.name = "Dark Purple".into();
        t.idle = Color32::from_rgb(0x7c, 0x4d, 0xff);
        t.recording = Color32::from_rgb(0x7c, 0x4d, 0xff);
        t.recording_peak = Color32::from_rgb(0xb3, 0x88, 0xff);
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x7c, 0x4d, 0xff),
            middle: Color32::from_rgb(0x9c, 0x6d, 0xff),
            top: Color32::from_rgb(0xb3, 0x88, 0xff),
        };
        t
    }

    pub fn builtin_neon() -> Self {
        let mut t = Self::builtin_default();
        t.id = "neon".into();
        t.name = "Neon".into();
        t.idle = Color32::from_rgb(0x00, 0xff, 0xff);
        t.recording = Color32::from_rgb(0xff, 0x00, 0xff);
        t.recording_peak = Color32::WHITE;
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x00, 0xff, 0xff),
            middle: Color32::from_rgb(0xff, 0x00, 0xff),
            top: Color32::from_rgb(0xff, 0xff, 0x00),
        };
        t
    }

    pub fn builtin_monochrome() -> Self {
        let mut t = Self::builtin_default();
        t.id = "monochrome".into();
        t.name = "Monochrome".into();
        t.idle = Color32::from_rgb(0x60, 0x60, 0x60);
        t.recording = Color32::from_rgb(0xa0, 0xa0, 0xa0);
        t.recording_peak = Color32::WHITE;
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x60, 0x60, 0x60),
            middle: Color32::from_rgb(0xa0, 0xa0, 0xa0),
            top: Color32::WHITE,
        };
        t
    }

    /// Common scaffolding for organic-ring themes. Sets family + organic_ring
    /// to provided shape/motion; callers override colors and gradient for
    /// personality. Keeps DRY without forcing identical visuals.
    fn organic_template(
        id: &str,
        name: &str,
        shape: OrganicRingShape,
        motion: OrganicRingMotion,
    ) -> Self {
        let mut t = Self::builtin_monochrome();
        t.id = id.into();
        t.name = name.into();
        t.family = VisualizationFamily::OrganicRing;
        t.organic_ring = Some(OrganicRingTheme { shape, motion });
        t
    }

    /// Quiet Reed — minimal motion, cool blue palette. Suitable for ambient
    /// always-on indicator. Wide gap, thin stroke, low speech responsiveness.
    pub fn builtin_quiet_reed() -> Self {
        let mut t = Self::organic_template(
            "quiet_reed",
            "Quiet Reed",
            OrganicRingShape {
                gap_degrees: 60.0,
                base_thickness: 5.0,
                taper: 0.4,
                roundness: 0.95,
                active_zones: 2,
            },
            OrganicRingMotion {
                idle_breathing: 0.05,
                speech_responsiveness: 0.6,
                drift: 0.15,
                settle_speed: 0.8,
            },
        );
        // Cool blue palette.
        t.idle = Color32::from_rgb(0x3d, 0x51, 0x68);
        t.recording = Color32::from_rgb(0x7a, 0x9f, 0xbd);
        t.recording_peak = Color32::from_rgb(0xb8, 0xd0, 0xe6);
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x3d, 0x51, 0x68),
            middle: Color32::from_rgb(0x7a, 0x9f, 0xbd),
            top: Color32::from_rgb(0xb8, 0xd0, 0xe6),
        };
        t
    }

    /// Living Reed — balanced motion, warm green palette. The original
    /// reference organic profile.
    pub fn builtin_living_reed() -> Self {
        let mut t = Self::organic_template(
            "living_reed",
            "Living Reed",
            OrganicRingShape {
                gap_degrees: 42.0,
                base_thickness: 7.2,
                taper: 0.7,
                roundness: 0.9,
                active_zones: 3,
            },
            OrganicRingMotion {
                idle_breathing: 0.1,
                speech_responsiveness: 0.92,
                drift: 0.38,
                settle_speed: 0.6,
            },
        );
        // Living green palette.
        t.idle = Color32::from_rgb(0x3a, 0x68, 0x41);
        t.recording = Color32::from_rgb(0x7c, 0xc2, 0x87);
        t.recording_peak = Color32::from_rgb(0xc4, 0xea, 0xc8);
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x3a, 0x68, 0x41),
            middle: Color32::from_rgb(0x7c, 0xc2, 0x87),
            top: Color32::from_rgb(0xc4, 0xea, 0xc8),
        };
        t
    }

    /// Drifting Contour — expressive motion, warm amber palette. Narrow gap,
    /// thick stroke, many active zones, high drift — most visually active.
    pub fn builtin_drifting_contour() -> Self {
        let mut t = Self::organic_template(
            "drifting_contour",
            "Drifting Contour",
            OrganicRingShape {
                gap_degrees: 28.0,
                base_thickness: 9.0,
                taper: 0.9,
                roundness: 0.7,
                active_zones: 5,
            },
            OrganicRingMotion {
                idle_breathing: 0.18,
                speech_responsiveness: 1.1,
                drift: 0.55,
                settle_speed: 0.4,
            },
        );
        // Warm amber palette.
        t.idle = Color32::from_rgb(0x7a, 0x5a, 0x30);
        t.recording = Color32::from_rgb(0xd9, 0xa8, 0x65);
        t.recording_peak = Color32::from_rgb(0xf4, 0xd9, 0xa8);
        t.gradient = GradientColors {
            bottom: Color32::from_rgb(0x7a, 0x5a, 0x30),
            middle: Color32::from_rgb(0xd9, 0xa8, 0x65),
            top: Color32::from_rgb(0xf4, 0xd9, 0xa8),
        };
        t
    }

    pub fn builtin_theme_ids() -> &'static [&'static str] {
        &["winamp_classic"]
    }

    pub fn builtin_by_id(id: &str) -> Option<Self> {
        match id {
            "winamp_classic" => Some(Self::builtin_winamp_classic()),
            "default" => Some(Self::builtin_default()),
            "dark" => Some(Self::builtin_dark()),
            "neon" => Some(Self::builtin_neon()),
            "monochrome" => Some(Self::builtin_monochrome()),
            "quiet_reed" => Some(Self::builtin_quiet_reed()),
            "living_reed" => Some(Self::builtin_living_reed()),
            "drifting_contour" => Some(Self::builtin_drifting_contour()),
            _ => None,
        }
    }

    pub fn is_builtin_theme_id(id: &str) -> bool {
        Self::builtin_by_id(id).is_some()
    }

    pub fn external_seed_templates() -> Vec<Self> {
        vec![
            Self::builtin_default(),
            Self::builtin_dark(),
            Self::builtin_neon(),
            Self::builtin_monochrome(),
            Self::builtin_quiet_reed(),
            Self::builtin_living_reed(),
            Self::builtin_drifting_contour(),
        ]
    }

    pub fn available_themes(theme_loader: &super::ThemeLoaderHandle) -> Vec<ThemeInfo> {
        theme_loader
            .read()
            .map(|loader| loader.available_themes())
            .unwrap_or_else(|_| Self::builtin_theme_infos())
    }

    pub fn builtin_theme_infos() -> Vec<ThemeInfo> {
        vec![
            ThemeInfo {
                id: "winamp_classic".into(),
                name: "Winamp Classic".into(),
                description: "Classic Winamp fire spectrum (red → yellow → green)".into(),
            },
            ThemeInfo {
                id: "default".into(),
                name: "Default".into(),
                description: "Default blue gradient theme".into(),
            },
            ThemeInfo {
                id: "dark".into(),
                name: "Dark Purple".into(),
                description: "Dark purple gradient theme".into(),
            },
            ThemeInfo {
                id: "neon".into(),
                name: "Neon".into(),
                description: "Bright neon cyan/magenta/yellow theme".into(),
            },
            ThemeInfo {
                id: "monochrome".into(),
                name: "Monochrome".into(),
                description: "Clean black and white theme".into(),
            },
            ThemeInfo {
                id: "quiet_reed".into(),
                name: "Quiet Reed".into(),
                description: "Subtle amber tones, gentle motion".into(),
            },
            ThemeInfo {
                id: "living_reed".into(),
                name: "Living Reed".into(),
                description: "Warm amber with organic movement".into(),
            },
            ThemeInfo {
                id: "drifting_contour".into(),
                name: "Drifting Contour".into(),
                description: "Cyan contour with drift effect".into(),
            },
        ]
    }

    pub fn reload_themes(theme_loader: &super::ThemeLoaderHandle) -> Result<(), String> {
        theme_loader
            .write()
            .map_err(|e| e.to_string())?
            .reload()
            .map_err(|e| e.to_string())
    }

    /// Resolve the on-disk `theme.json` path for the named theme id, if
    /// the loader is aware of it. Returns `None` when the theme is
    /// builtin-only (no file on disk) or the id is unknown.
    ///
    /// Used by command handlers (e.g. `get_handy_theme`) that need to
    /// re-parse the raw JSON for fields not yet exposed via
    /// `VisualizationTheme`.
    pub fn path_for_id(
        theme_id: &str,
        theme_loader: &super::ThemeLoaderHandle,
    ) -> Option<std::path::PathBuf> {
        let dir = Self::themes_dir(theme_loader).join(theme_id);
        let candidate = dir.join("theme.json");
        if candidate.exists() {
            Some(candidate)
        } else {
            None
        }
    }

    pub fn themes_dir(theme_loader: &super::ThemeLoaderHandle) -> std::path::PathBuf {
        theme_loader
            .read()
            .map(|loader| loader.themes_dir().clone())
            .unwrap_or_else(|_| {
                dirs::config_dir()
                    .unwrap_or_default()
                    .join("soupawhisper")
                    .join("themes")
            })
    }

    pub fn to_file_format(&self) -> ThemeFile {
        ThemeFile {
            name: self.name.clone(),
            description: None,
            family: Some(match self.family {
                VisualizationFamily::Bars => "bars".to_string(),
                VisualizationFamily::OrganicRing => "organic_ring".to_string(),
            }),
            colors: ThemeFileColors {
                background: ColorValue::Hex(color_to_hex_rgba(self.background)),
                idle: ColorValue::Hex(color_to_hex_rgb(self.idle)),
                recording: ColorValue::Hex(color_to_hex_rgb(self.recording)),
                recording_peak: ColorValue::Hex(color_to_hex_rgb(self.recording_peak)),
                transcribing: ColorValue::Hex(color_to_hex_rgb(self.transcribing)),
                queued: ColorValue::Hex(color_to_hex_rgb(self.queued)),
                text: ColorValue::Hex(color_to_hex_rgb(self.text)),
            },
            use_gradient: self.use_gradient,
            gradient: self.use_gradient.then_some(GradientColorsFile {
                bottom: ColorValue::Hex(color_to_hex_rgb(self.gradient.bottom)),
                middle: ColorValue::Hex(color_to_hex_rgb(self.gradient.middle)),
                top: ColorValue::Hex(color_to_hex_rgb(self.gradient.top)),
            }),
            organic_ring: self
                .organic_ring
                .as_ref()
                .map(|organic| OrganicRingConfigFile {
                    shape: OrganicRingShapeFile {
                        gap_degrees: organic.shape.gap_degrees,
                        base_thickness: organic.shape.base_thickness,
                        taper: organic.shape.taper,
                        roundness: organic.shape.roundness,
                        active_zones: organic.shape.active_zones,
                    },
                    motion: OrganicRingMotionFile {
                        idle_breathing: organic.motion.idle_breathing,
                        speech_responsiveness: organic.motion.speech_responsiveness,
                        drift: organic.motion.drift,
                        settle_speed: organic.motion.settle_speed,
                    },
                }),
        }
    }

    pub fn to_colors(&self) -> ThemeColors {
        ThemeColors {
            use_gradient: self.use_gradient,
            gradient_bottom: color_to_hex_rgb(self.gradient.bottom),
            gradient_middle: color_to_hex_rgb(self.gradient.middle),
            gradient_top: color_to_hex_rgb(self.gradient.top),
            recording: color_to_hex_rgb(self.recording),
            transcribing: color_to_hex_rgb(self.transcribing),
            idle: color_to_hex_rgb(self.idle),
        }
    }

    pub fn validate(&self) -> ThemeTestResult {
        let mut result = ThemeTestResult {
            valid: true,
            warnings: vec![],
            errors: vec![],
        };

        if self.recording.a() == 0 {
            result.errors.push("Recording color is transparent".into());
        }
        if self.transcribing.a() == 0 {
            result
                .errors
                .push("Transcribing color is transparent".into());
        }
        if self.idle.a() == 0 {
            result.errors.push("Idle color is transparent".into());
        }

        result.valid = result.errors.is_empty();
        result
    }
}

fn color_to_hex_rgb(c: Color32) -> String {
    format!("#{:02x}{:02x}{:02x}", c.r(), c.g(), c.b())
}

fn color_to_hex_rgba(c: Color32) -> String {
    format!("#{:02x}{:02x}{:02x}{:02x}", c.r(), c.g(), c.b(), c.a())
}

#[derive(Debug, Error)]
pub enum ThemeLoadError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON parse error in {file}: {source}")]
    Json {
        file: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("Invalid color value: {0}")]
    InvalidColor(String),
}

use thiserror::Error;

pub struct ThemeLoader {
    external_themes: HashMap<String, VisualizationTheme>,
    themes_dir: PathBuf,
}

impl ThemeLoader {
    pub fn new(themes_dir: PathBuf) -> Self {
        Self {
            external_themes: HashMap::new(),
            themes_dir,
        }
    }

    pub fn themes_dir(&self) -> &PathBuf {
        &self.themes_dir
    }

    pub fn scan(&mut self) -> Result<(), ThemeLoadError> {
        self.external_themes.clear();

        if !self.themes_dir.exists() {
            std::fs::create_dir_all(&self.themes_dir)?;
        }

        self.ensure_seeded_external_themes()?;

        for entry in std::fs::read_dir(&self.themes_dir)?.flatten() {
            let path = entry.path();
            let loaded = if path.is_dir() {
                self.load_theme_dir(&path)
            } else if path.extension().is_some_and(|ext| ext == "json") {
                self.load_legacy_theme_file(&path)
            } else {
                continue;
            };

            if let Ok(theme) = loaded {
                self.external_themes.insert(theme.id.clone(), theme);
            }
        }

        Ok(())
    }

    fn load_theme_dir(&self, path: &Path) -> Result<VisualizationTheme, ThemeLoadError> {
        let file = self.load_theme_json(&path.join("theme.json"))?;
        let id = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
        self.convert_theme_file(id, file)
    }

    fn load_legacy_theme_file(&self, path: &Path) -> Result<VisualizationTheme, ThemeLoadError> {
        let file = self.load_theme_json(path)?;
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
        self.convert_theme_file(id, file)
    }

    fn load_theme_json(&self, path: &Path) -> Result<ThemeFile, ThemeLoadError> {
        let content = std::fs::read_to_string(path)?;
        serde_json::from_str(&content).map_err(|e| ThemeLoadError::Json {
            file: path.display().to_string(),
            source: e,
        })
    }

    fn convert_theme_file(
        &self,
        id: String,
        file: ThemeFile,
    ) -> Result<VisualizationTheme, ThemeLoadError> {
        let recording = parse_color(&file.colors.recording)?;
        let recording_peak = parse_color(&file.colors.recording_peak)?;

        let gradient = if file.use_gradient {
            if let Some(grad) = file.gradient.as_ref() {
                GradientColors {
                    bottom: parse_color(&grad.bottom)?,
                    middle: parse_color(&grad.middle)?,
                    top: parse_color(&grad.top)?,
                }
            } else {
                GradientColors::default()
            }
        } else {
            GradientColors {
                bottom: recording,
                middle: lerp_color(recording, recording_peak, 0.5),
                top: recording_peak,
            }
        };

        let family = match file.family.as_deref() {
            Some("organic_ring") => VisualizationFamily::OrganicRing,
            _ => VisualizationFamily::Bars,
        };

        // BUG FIX (Phase 3): previously this always set organic_ring: None,
        // dropping the shape/motion from the JSON. Result: any external theme
        // declared as family=organic_ring rendered blank because
        // build_ring_points short-circuits when theme.organic_ring is None.
        let organic_ring = match (&family, file.organic_ring.as_ref()) {
            (VisualizationFamily::OrganicRing, Some(cfg)) => Some(OrganicRingTheme {
                shape: OrganicRingShape {
                    gap_degrees: cfg.shape.gap_degrees,
                    base_thickness: cfg.shape.base_thickness,
                    taper: cfg.shape.taper,
                    roundness: cfg.shape.roundness,
                    active_zones: cfg.shape.active_zones,
                },
                motion: OrganicRingMotion {
                    idle_breathing: cfg.motion.idle_breathing,
                    speech_responsiveness: cfg.motion.speech_responsiveness,
                    drift: cfg.motion.drift,
                    settle_speed: cfg.motion.settle_speed,
                },
            }),
            _ => None,
        };

        Ok(VisualizationTheme {
            id,
            name: file.name,
            family,
            organic_ring,
            background: parse_color(&file.colors.background).unwrap_or(Color32::TRANSPARENT),
            idle: parse_color(&file.colors.idle)?,
            recording,
            recording_peak,
            transcribing: parse_color(&file.colors.transcribing)?,
            queued: parse_color(&file.colors.queued)?,
            text: parse_color(&file.colors.text).unwrap_or(Color32::WHITE),
            use_gradient: file.use_gradient,
            gradient,
        })
    }

    pub fn get_theme(&self, id: &str) -> VisualizationTheme {
        self.external_themes.get(id).cloned().unwrap_or_else(|| {
            VisualizationTheme::builtin_by_id(id)
                .unwrap_or_else(VisualizationTheme::builtin_winamp_classic)
        })
    }

    pub fn available_themes(&self) -> Vec<ThemeInfo> {
        let mut themes = VisualizationTheme::builtin_theme_infos();
        for (id, theme) in &self.external_themes {
            if let Some(existing) = themes.iter_mut().find(|t| t.id == *id) {
                existing.name = theme.name.clone();
                existing.description = format!("{} (custom)", theme.name);
            } else {
                themes.push(ThemeInfo {
                    id: id.clone(),
                    name: theme.name.clone(),
                    description: "Custom theme".into(),
                });
            }
        }
        themes
    }

    pub fn reload(&mut self) -> Result<(), ThemeLoadError> {
        self.scan()
    }

    pub fn external_theme_count(&self) -> usize {
        self.external_themes.len()
    }

    fn ensure_seeded_external_themes(&self) -> Result<(), ThemeLoadError> {
        for theme in VisualizationTheme::external_seed_templates() {
            let theme_dir = self.themes_dir.join(&theme.id);
            let path = theme_dir.join("theme.json");
            if path.exists() {
                continue;
            }
            std::fs::create_dir_all(&theme_dir)?;
            let json = serde_json::to_string_pretty(&theme.to_file_format()).map_err(|e| {
                ThemeLoadError::Json {
                    file: path.display().to_string(),
                    source: e,
                }
            })?;
            std::fs::write(path, json)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFile {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    pub colors: ThemeFileColors,
    #[serde(default)]
    pub use_gradient: bool,
    #[serde(default)]
    pub gradient: Option<GradientColorsFile>,
    #[serde(default)]
    pub organic_ring: Option<OrganicRingConfigFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganicRingConfigFile {
    pub shape: OrganicRingShapeFile,
    pub motion: OrganicRingMotionFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganicRingShapeFile {
    pub gap_degrees: f32,
    pub base_thickness: f32,
    pub taper: f32,
    pub roundness: f32,
    pub active_zones: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganicRingMotionFile {
    pub idle_breathing: f32,
    pub speech_responsiveness: f32,
    pub drift: f32,
    pub settle_speed: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFileColors {
    #[serde(default = "default_transparent")]
    pub background: ColorValue,
    pub idle: ColorValue,
    pub recording: ColorValue,
    pub recording_peak: ColorValue,
    pub transcribing: ColorValue,
    pub queued: ColorValue,
    #[serde(default = "default_white")]
    pub text: ColorValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientColorsFile {
    pub bottom: ColorValue,
    pub middle: ColorValue,
    pub top: ColorValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ColorValue {
    Hex(String),
    Array(Vec<u8>),
}

fn default_transparent() -> ColorValue {
    ColorValue::Hex("#00000000".to_string())
}

fn default_white() -> ColorValue {
    ColorValue::Hex("#ffffff".to_string())
}

fn parse_color(value: &ColorValue) -> Result<Color32, ThemeLoadError> {
    match value {
        ColorValue::Hex(hex) => parse_hex_color(hex),
        ColorValue::Array(arr) => parse_array_color(arr),
    }
}

fn parse_hex_color(hex: &str) -> Result<Color32, ThemeLoadError> {
    let hex = hex.trim_start_matches('#');
    match hex.len() {
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            let g = u8::from_str_radix(&hex[2..4], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            let b = u8::from_str_radix(&hex[4..6], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            Ok(Color32::from_rgb(r, g, b))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            let g = u8::from_str_radix(&hex[2..4], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            let b = u8::from_str_radix(&hex[4..6], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            let a = u8::from_str_radix(&hex[6..8], 16)
                .map_err(|_| ThemeLoadError::InvalidColor(hex.to_string()))?;
            Ok(Color32::from_rgba_unmultiplied(r, g, b, a))
        }
        _ => Err(ThemeLoadError::InvalidColor(hex.to_string())),
    }
}

fn parse_array_color(arr: &[u8]) -> Result<Color32, ThemeLoadError> {
    match arr.len() {
        3 => Ok(Color32::from_rgb(arr[0], arr[1], arr[2])),
        4 => Ok(Color32::from_rgba_unmultiplied(
            arr[0], arr[1], arr[2], arr[3],
        )),
        _ => Err(ThemeLoadError::InvalidColor(format!(
            "Invalid color array length: {}",
            arr.len()
        ))),
    }
}

#[cfg(test)]
mod organic_theme_tests {
    //! Contract tests for organic-ring builtin themes.
    //!
    //! These tests guarantee that:
    //! 1. The three organic builtins have distinct visuals (shape + colors).
    //! 2. Each builtin matches its bundled JSON asset under `themes/<id>/theme.json`.
    //!
    //! If a test fails, either the Rust code or the JSON drifted out of sync.

    use super::*;
    use std::path::PathBuf;

    fn organic_themes() -> [(&'static str, VisualizationTheme); 3] {
        [
            ("quiet_reed", VisualizationTheme::builtin_quiet_reed()),
            ("living_reed", VisualizationTheme::builtin_living_reed()),
            (
                "drifting_contour",
                VisualizationTheme::builtin_drifting_contour(),
            ),
        ]
    }

    #[test]
    fn test_organic_themes_have_distinct_shapes() {
        let themes = organic_themes();
        let shapes: Vec<&OrganicRingShape> = themes
            .iter()
            .map(|(_, t)| &t.organic_ring.as_ref().expect("organic_ring").shape)
            .collect();
        // Compare pair-wise via debug representation (struct PartialEq would
        // require deriving it; debug repr captures all fields).
        let signatures: Vec<String> = shapes.iter().map(|s| format!("{s:?}")).collect();
        assert_ne!(signatures[0], signatures[1], "quiet vs living shape");
        assert_ne!(signatures[0], signatures[2], "quiet vs drifting shape");
        assert_ne!(signatures[1], signatures[2], "living vs drifting shape");
    }

    #[test]
    fn test_organic_themes_have_distinct_motions() {
        let themes = organic_themes();
        let motions: Vec<String> = themes
            .iter()
            .map(|(_, t)| {
                format!(
                    "{:?}",
                    t.organic_ring.as_ref().expect("organic_ring").motion
                )
            })
            .collect();
        assert_ne!(motions[0], motions[1], "quiet vs living motion");
        assert_ne!(motions[0], motions[2], "quiet vs drifting motion");
        assert_ne!(motions[1], motions[2], "living vs drifting motion");
    }

    #[test]
    fn test_organic_themes_have_distinct_recording_colors() {
        let themes = organic_themes();
        let colors: Vec<Color32> = themes.iter().map(|(_, t)| t.recording).collect();
        assert_ne!(colors[0], colors[1], "quiet vs living recording color");
        assert_ne!(colors[0], colors[2], "quiet vs drifting recording color");
        assert_ne!(colors[1], colors[2], "living vs drifting recording color");
    }

    #[test]
    fn test_organic_themes_load_from_bundled_json() {
        // Walks each bundled JSON, parses it via ThemeLoader, and asserts the
        // resulting VisualizationTheme matches the builtin (single source of
        // truth — code wins, JSON must match).
        let themes_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("themes");
        let mut loader = ThemeLoader::new(themes_dir);
        loader.scan().expect("scan bundled themes");

        for (id, builtin) in organic_themes() {
            let loaded = loader.get_theme(id);
            let b_shape = &builtin.organic_ring.as_ref().unwrap().shape;
            let l_shape = &loaded.organic_ring.as_ref().unwrap().shape;
            assert_eq!(
                format!("{b_shape:?}"),
                format!("{l_shape:?}"),
                "shape mismatch for {id}"
            );
            let b_motion = &builtin.organic_ring.as_ref().unwrap().motion;
            let l_motion = &loaded.organic_ring.as_ref().unwrap().motion;
            assert_eq!(
                format!("{b_motion:?}"),
                format!("{l_motion:?}"),
                "motion mismatch for {id}"
            );
            assert_eq!(
                builtin.recording, loaded.recording,
                "recording color mismatch for {id}"
            );
            assert_eq!(builtin.idle, loaded.idle, "idle color mismatch for {id}");
            assert_eq!(
                builtin.recording_peak, loaded.recording_peak,
                "recording_peak color mismatch for {id}"
            );
        }
    }
}
