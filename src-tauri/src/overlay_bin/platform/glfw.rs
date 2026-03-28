use std::sync::mpsc;

use egui_overlay::EguiOverlay;
use egui_window_glfw_passthrough::GlfwBackend;
use voice_lib::overlay::themes::{VisualizationFamily, VisualizationTheme};

use crate::overlay_bin::render::{amplify_level, pulse_factor, PULSE_HEIGHTS};
use crate::overlay_bin::theme::create_theme_loader;
use crate::overlay_bin::types::{
    Command, OverlayState, WaveformLevels, BAR_COUNT, DEFAULT_HEIGHT, DEFAULT_WIDTH,
};

pub struct OverlayApp {
    state: OverlayState,
    visible: bool,
    levels: WaveformLevels,
    cmd_rx: mpsc::Receiver<Command>,
    pulse_phase: f32,
    target_pos: (i32, i32, u32, u32),
    positioned: bool,
    theme_loader: voice_lib::overlay::themes::ThemeLoader,
    theme: VisualizationTheme,
}

impl OverlayApp {
    pub fn new(cmd_rx: mpsc::Receiver<Command>) -> Self {
        let theme_loader = create_theme_loader();
        let theme = theme_loader.get_theme("default");

        Self {
            state: OverlayState::Idle,
            visible: true,
            levels: WaveformLevels::new(BAR_COUNT),
            cmd_rx,
            pulse_phase: 0.0,
            target_pos: (100, 100, DEFAULT_WIDTH, DEFAULT_HEIGHT),
            positioned: false,
            theme_loader,
            theme,
        }
    }

    fn color_for_state(&self) -> egui::Color32 {
        match self.state {
            OverlayState::Idle | OverlayState::Hidden => self.theme.idle,
            OverlayState::Recording => self.theme.recording,
            OverlayState::Transcribing => self.theme.transcribing,
            OverlayState::Queued(_) => self.theme.queued,
        }
    }

    fn draw_waveform(&self, ui: &mut egui::Ui) {
        let rect = ui.available_rect_before_wrap();
        let painter = ui.painter();
        let color = self.color_for_state();
        let max_h = rect.height() * 0.8;

        match self.theme.family {
            VisualizationFamily::OrganicRing => {
                let radius = rect.height().min(rect.width()) * 0.25;
                painter.circle_stroke(rect.center(), radius, egui::Stroke::new(3.0, color));
            }
            VisualizationFamily::Bars => match self.state {
                OverlayState::Hidden => {}
                OverlayState::Idle => {
                    painter.line_segment(
                        [
                            egui::pos2(rect.left() + 10.0, rect.center().y),
                            egui::pos2(rect.right() - 10.0, rect.center().y),
                        ],
                        egui::Stroke::new(2.0, color),
                    );
                }
                OverlayState::Recording => {
                    let bar_w = rect.width() / BAR_COUNT as f32 * 0.8;
                    let spacing = rect.width() / BAR_COUNT as f32;

                    for i in 0..BAR_COUNT {
                        let amp = amplify_level(self.levels.get(i));
                        let h = (amp * max_h).max(2.0);
                        let x = rect.left() + (i as f32 + 0.5) * spacing;

                        painter.rect_filled(
                            egui::Rect::from_center_size(
                                egui::pos2(x, rect.center().y),
                                egui::vec2(bar_w, h),
                            ),
                            1.0,
                            color,
                        );
                    }
                }
                OverlayState::Transcribing | OverlayState::Queued(_) => {
                    let bar_w = rect.width() / BAR_COUNT as f32 * 1.6;
                    let spacing = rect.width() / BAR_COUNT as f32 * 2.0;
                    let total_w = PULSE_HEIGHTS.len() as f32 * spacing;
                    let start_x = rect.center().x - total_w / 2.0;

                    for (i, &base_h) in PULSE_HEIGHTS.iter().enumerate() {
                        let h = base_h * pulse_factor(self.pulse_phase, i) * max_h;
                        let x = start_x + (i as f32 + 0.5) * spacing;

                        painter.rect_filled(
                            egui::Rect::from_center_size(
                                egui::pos2(x, rect.center().y),
                                egui::vec2(bar_w, h),
                            ),
                            2.0,
                            color,
                        );
                    }
                }
            },
        }
    }
}

impl EguiOverlay for OverlayApp {
    fn gui_run(
        &mut self,
        ctx: &egui::Context,
        _gfx: &mut egui_render_three_d::ThreeDBackend,
        glfw: &mut GlfwBackend,
    ) {
        while let Ok(cmd) = self.cmd_rx.try_recv() {
            match cmd {
                Command::Show(s) => {
                    self.state = s;
                    self.visible = true;
                }
                Command::Hide => self.visible = false,
                Command::AudioLevel(l) => self.levels.push(l),
                Command::Spectrum(bins) => self.levels.set_from_bins(&bins),
                Command::Position(x, y, w, h) => {
                    self.target_pos = (x, y, w, h);
                    self.positioned = false;
                }
                Command::Theme(name) => {
                    self.theme = self.theme_loader.get_theme(&name);
                }
                Command::Quit => {
                    glfw.window.set_should_close(true);
                    return;
                }
            }
        }

        if !self.positioned {
            let (x, y, w, h) = self.target_pos;
            glfw.window.set_size(w as i32, h as i32);
            glfw.window.set_pos(x, y);
            self.positioned = true;
        }

        self.pulse_phase += 0.15;

        if self.visible {
            egui::CentralPanel::default()
                .frame(egui::Frame::none().fill(egui::Color32::TRANSPARENT))
                .show(ctx, |ui| self.draw_waveform(ui));
        } else {
            egui::CentralPanel::default()
                .frame(egui::Frame::none().fill(egui::Color32::TRANSPARENT))
                .show(ctx, |_| {});
        }

        ctx.request_repaint();
    }
}

pub fn run(cmd_rx: mpsc::Receiver<Command>) {
    egui_overlay::start(OverlayApp::new(cmd_rx));
}
