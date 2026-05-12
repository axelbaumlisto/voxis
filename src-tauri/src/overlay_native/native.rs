use super::theme::VisualizationTheme;
use super::{OverlayPositionConfig, OverlaySizeConfig, OverlayState, ThemeLoaderHandle};
use crate::audio::SPECTRUM_BARS;
use crossbeam_channel::{Receiver, Sender, TryRecvError};
use egui::{Color32, Rect, Ui, Vec2};
use egui_overlay::egui_window_glfw_passthrough::GlfwBackend;
use egui_overlay::EguiOverlay;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

const BAR_WIDTH: f32 = 4.0;
const BAR_GAP: f32 = 2.0;
const MIN_BAR_HEIGHT: f32 = 2.0;

#[derive(Debug, Clone, Copy, Default)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone)]
pub struct WaveformLevels {
    levels: Vec<f32>,
}

impl WaveformLevels {
    pub fn new(capacity: usize) -> Self {
        Self {
            levels: vec![0.0; capacity],
        }
    }

    pub fn push(&mut self, level: f32) {
        if self.levels.is_empty() {
            return;
        }
        self.levels.rotate_left(1);
        let last = self.levels.len() - 1;
        self.levels[last] = level;
    }

    pub fn get(&self, index: usize) -> f32 {
        self.levels.get(index).copied().unwrap_or(0.0)
    }

    pub fn clear(&mut self) {
        self.levels.fill(0.0);
    }

    pub fn set_from_array(&mut self, bins: &[f32]) {
        let copy_len = bins.len().min(self.levels.len());
        self.levels[..copy_len].copy_from_slice(&bins[..copy_len]);
    }

    pub fn len(&self) -> usize {
        self.levels.len()
    }

    /// Returns `true` if the level buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.levels.is_empty()
    }
}

pub fn amplify_level(level: f32, audio_boost: f32) -> f32 {
    let boost_factor = audio_boost / 100.0;
    (level.max(0.0) * boost_factor).sqrt().min(1.0)
}

#[derive(Debug, Clone)]
enum OverlayCommand {
    Show(OverlayState),
    Hide,
    AudioLevel(f32),
    SpectrumBins([f32; SPECTRUM_BARS]),
    UpdatePosition(Position, i32),
    SetTheme(String),
    SetAudioBoost(f32),
    Shutdown,
    #[cfg(debug_assertions)]
    Demo,
}

struct OverlayStateManager {
    state: OverlayState,
    levels: WaveformLevels,
    animation_time: f32,
    position_config: OverlayPositionConfig,
    size_config: OverlaySizeConfig,
    margin: i32,
    target_position: Option<(i32, i32)>,
    theme: VisualizationTheme,
    audio_boost: f32,
    theme_loader: ThemeLoaderHandle,
}

impl OverlayStateManager {
    fn new_with_config(
        position_config: OverlayPositionConfig,
        size_config: OverlaySizeConfig,
        margin: i32,
        theme_name: &str,
        audio_boost: f32,
        theme_loader: ThemeLoaderHandle,
    ) -> Self {
        Self {
            state: OverlayState::Hidden,
            levels: WaveformLevels::new(super::BAR_COUNT),
            animation_time: 0.0,
            position_config,
            size_config,
            margin,
            target_position: None,
            theme: VisualizationTheme::by_name(theme_name, &theme_loader),
            audio_boost,
            theme_loader,
        }
    }

    fn show(&mut self, state: OverlayState) {
        self.state = state;
        if state == OverlayState::Recording {
            self.levels.clear();
        }
    }

    fn hide(&mut self) {
        self.state = OverlayState::Hidden;
    }

    fn push_audio_level(&mut self, level: f32) {
        self.levels.push(level);
    }

    fn set_spectrum_bins(&mut self, bins: [f32; super::BAR_COUNT]) {
        self.levels.set_from_array(&bins);
    }

    fn set_theme(&mut self, name: &str) {
        self.theme = VisualizationTheme::by_name(name, &self.theme_loader);
    }

    fn set_audio_boost(&mut self, boost: f32) {
        self.audio_boost = boost;
    }

    fn update_position(&mut self, x: i32, y: i32, margin: i32) {
        self.target_position = Some((x, y));
        self.margin = margin;
    }

    fn is_visible(&self) -> bool {
        self.state != OverlayState::Hidden
    }

    fn tick(&mut self, delta: f32) {
        self.animation_time += delta;
    }

    fn take_target_position(&mut self) -> Option<(i32, i32)> {
        self.target_position.take()
    }
}

fn draw_overlay(
    ui: &mut Ui,
    state: OverlayState,
    levels: &WaveformLevels,
    animation_time: f32,
    theme: &VisualizationTheme,
    audio_boost: f32,
) {
    let rect = ui.available_rect_before_wrap();
    match state {
        OverlayState::Hidden => {}
        OverlayState::Idle => draw_idle(ui, rect, theme.idle, animation_time),
        OverlayState::Recording => draw_recording(ui, rect, levels, theme.recording, audio_boost),
        OverlayState::Transcribing => {
            draw_transcribing(ui, rect, animation_time, theme.transcribing)
        }
        OverlayState::Queued(count) => {
            draw_queued(ui, rect, animation_time, count, theme.queued, theme.text)
        }
    }
}

fn draw_idle(ui: &mut Ui, rect: Rect, color: Color32, animation_time: f32) {
    let painter = ui.painter();
    let center = rect.center();
    let breath = (animation_time * 1.5).sin();
    let opacity = 0.5 + breath * 0.2;
    let dot_color =
        Color32::from_rgba_unmultiplied(color.r(), color.g(), color.b(), (opacity * 255.0) as u8);
    painter.circle_filled(center, 7.0, dot_color);
}

fn draw_recording(
    ui: &mut Ui,
    rect: Rect,
    levels: &WaveformLevels,
    color: Color32,
    audio_boost: f32,
) {
    let painter = ui.painter();
    let max_height = rect.height() - 10.0;
    let total_bar_width = BAR_WIDTH + BAR_GAP;
    let total_width = super::BAR_COUNT as f32 * total_bar_width - BAR_GAP;
    let start_x = rect.center().x - total_width / 2.0;
    let center_y = rect.center().y;

    for i in 0..super::BAR_COUNT {
        let level = levels.get(i);
        let amplified = amplify_level(level, audio_boost);
        let bar_height = (amplified * max_height).max(MIN_BAR_HEIGHT);

        let x = start_x + i as f32 * total_bar_width;
        let y = center_y - bar_height / 2.0;
        let bar_rect = Rect::from_min_size(egui::pos2(x, y), Vec2::new(BAR_WIDTH, bar_height));
        painter.rect_filled(bar_rect, 2.0, color);
    }
}

fn draw_transcribing(ui: &mut Ui, rect: Rect, animation_time: f32, color: Color32) {
    let painter = ui.painter();
    let max_height = rect.height() - 10.0;
    let total_bar_width = BAR_WIDTH + BAR_GAP;
    let total_width = super::BAR_COUNT as f32 * total_bar_width - BAR_GAP;
    let start_x = rect.center().x - total_width / 2.0;
    let center_y = rect.center().y;
    let phase = animation_time * 4.0;

    for i in 0..super::BAR_COUNT {
        let wave = (phase + i as f32 * 0.3).sin() * 0.3 + 0.5;
        let bar_height = (wave * max_height).max(MIN_BAR_HEIGHT);

        let x = start_x + i as f32 * total_bar_width;
        let y = center_y - bar_height / 2.0;
        let bar_rect = Rect::from_min_size(egui::pos2(x, y), Vec2::new(BAR_WIDTH, bar_height));
        painter.rect_filled(bar_rect, 2.0, color);
    }
}

fn draw_queued(
    ui: &mut Ui,
    rect: Rect,
    animation_time: f32,
    count: usize,
    color: Color32,
    text: Color32,
) {
    draw_transcribing(ui, rect, animation_time * 1.2, color);
    if count > 1 {
        let painter = ui.painter();
        let badge_radius = 10.0;
        let badge_center = egui::pos2(
            rect.right() - badge_radius - 5.0,
            rect.top() + badge_radius + 5.0,
        );
        painter.circle_filled(badge_center, badge_radius, color);
        painter.text(
            badge_center,
            egui::Align2::CENTER_CENTER,
            count.to_string(),
            egui::FontId::proportional(12.0),
            text,
        );
    }
}

struct OverlayApp {
    state_mgr: OverlayStateManager,
    cmd_rx: Receiver<OverlayCommand>,
    running: Arc<AtomicBool>,
    config_stage: u8,
}

impl OverlayApp {
    #[allow(clippy::too_many_arguments)]
    fn new(
        cmd_rx: Receiver<OverlayCommand>,
        running: Arc<AtomicBool>,
        position_config: OverlayPositionConfig,
        size_config: OverlaySizeConfig,
        margin: i32,
        theme: &str,
        audio_boost: f32,
        theme_loader: ThemeLoaderHandle,
    ) -> Self {
        Self {
            state_mgr: OverlayStateManager::new_with_config(
                position_config,
                size_config,
                margin,
                theme,
                audio_boost,
                theme_loader,
            ),
            cmd_rx,
            running,
            config_stage: 0,
        }
    }

    fn process_commands(&mut self) {
        loop {
            match self.cmd_rx.try_recv() {
                Ok(cmd) => self.handle_command(cmd),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.running.store(false, Ordering::SeqCst);
                    break;
                }
            }
        }
    }

    fn handle_command(&mut self, cmd: OverlayCommand) {
        match cmd {
            OverlayCommand::Show(state) => self.state_mgr.show(state),
            OverlayCommand::Hide => self.state_mgr.hide(),
            OverlayCommand::AudioLevel(level) => self.state_mgr.push_audio_level(level),
            OverlayCommand::SpectrumBins(bins) => self.state_mgr.set_spectrum_bins(bins),
            OverlayCommand::UpdatePosition(position, margin) => self
                .state_mgr
                .update_position(position.x, position.y, margin),
            OverlayCommand::SetTheme(theme_name) => self.state_mgr.set_theme(&theme_name),
            OverlayCommand::SetAudioBoost(boost) => self.state_mgr.set_audio_boost(boost),
            OverlayCommand::Shutdown => {
                self.running.store(false, Ordering::SeqCst);
            }
            #[cfg(debug_assertions)]
            OverlayCommand::Demo => {
                self.state_mgr.show(OverlayState::Recording);
                for level in [0.1, 0.3, 0.5, 0.7, 0.95, 0.8, 0.6, 0.3, 0.1] {
                    self.state_mgr.push_audio_level(level);
                }
            }
        }
    }

    fn configure_window(&mut self, glfw_backend: &mut GlfwBackend) {
        match self.config_stage {
            0 => {
                glfw_backend.window.set_opacity(0.0);
                let w = self.state_mgr.size_config.width() as i32;
                let h = self.state_mgr.size_config.height() as i32;
                glfw_backend.window.set_size(w, h);
                self.config_stage = 1;
            }
            1 => self.config_stage = 2,
            2 => {
                let w = self.state_mgr.size_config.width() as i32;
                let h = self.state_mgr.size_config.height() as i32;
                let mut result = (0, 0);
                let margin = self.state_mgr.margin;
                let position_config = self.state_mgr.position_config;

                glfw_backend.glfw.with_primary_monitor(|_, monitor| {
                    if let Some(monitor) = monitor {
                        let (_, _, mw, mh) = monitor.get_workarea();
                        result = position_config.calculate(mw, mh, w, h, margin);
                    }
                });

                glfw_backend.window.set_pos(result.0, result.1);
                self.config_stage = 3;
            }
            _ => {}
        }
    }
}

impl EguiOverlay for OverlayApp {
    fn gui_run(
        &mut self,
        egui_context: &egui::Context,
        #[cfg(target_os = "macos")] _default_gfx_backend: &mut egui_render_wgpu::WgpuBackend,
        #[cfg(not(target_os = "macos"))]
        _default_gfx_backend: &mut egui_render_three_d::ThreeDBackend,
        glfw_backend: &mut GlfwBackend,
    ) {
        self.configure_window(glfw_backend);
        if self.config_stage < 3 {
            glfw_backend.window.set_opacity(0.0);
            return;
        }

        if let Some((x, y)) = self.state_mgr.take_target_position() {
            glfw_backend.window.set_pos(x, y);
        }

        self.process_commands();

        if !self.running.load(Ordering::SeqCst) {
            glfw_backend.window.set_should_close(true);
            return;
        }

        self.state_mgr.tick(1.0 / 60.0);

        if !self.state_mgr.is_visible() {
            glfw_backend.window.set_opacity(0.0);
            return;
        }

        glfw_backend.window.set_opacity(1.0);

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(egui::Color32::TRANSPARENT))
            .show(egui_context, |ui| {
                draw_overlay(
                    ui,
                    self.state_mgr.state,
                    &self.state_mgr.levels,
                    self.state_mgr.animation_time,
                    &self.state_mgr.theme,
                    self.state_mgr.audio_boost,
                );
            });

        if self.state_mgr.state == OverlayState::Recording
            || self.state_mgr.state == OverlayState::Transcribing
        {
            egui_context.request_repaint();
        }
    }
}

fn set_skip_taskbar(window: &egui_window_glfw_passthrough::glfw::PWindow) {
    #[cfg(target_os = "linux")]
    {
        use egui_window_glfw_passthrough::glfw::Context;
        use std::ffi::CString;

        let x11_window = unsafe {
            egui_window_glfw_passthrough::glfw::ffi::glfwGetX11Window(window.window_ptr())
        };
        if x11_window.is_null() {
            return;
        }
        let x11_display = unsafe { egui_window_glfw_passthrough::glfw::ffi::glfwGetX11Display() };
        if x11_display.is_null() {
            return;
        }

        unsafe {
            let atom_state = x11::xlib::XInternAtom(
                x11_display as *mut _,
                CString::new("_NET_WM_STATE").unwrap().as_ptr(),
                0,
            );
            let atom_skip = x11::xlib::XInternAtom(
                x11_display as *mut _,
                CString::new("_NET_WM_STATE_SKIP_TASKBAR").unwrap().as_ptr(),
                0,
            );
            let atoms = [atom_skip];
            x11::xlib::XChangeProperty(
                x11_display as *mut _,
                x11_window as u64,
                atom_state,
                x11::xlib::XA_ATOM,
                32,
                x11::xlib::PropModeReplace,
                atoms.as_ptr() as *const u8,
                1,
            );

            let root = x11::xlib::XDefaultRootWindow(x11_display as *mut _);
            let mut event: x11::xlib::XClientMessageEvent = std::mem::zeroed();
            event.type_ = x11::xlib::ClientMessage;
            event.display = x11_display as *mut _;
            event.window = x11_window as u64;
            event.message_type = atom_state;
            event.format = 32;
            event.data.as_longs_mut()[0] = 1;
            event.data.as_longs_mut()[1] = atom_skip as i64;
            event.data.as_longs_mut()[3] = 1;
            x11::xlib::XSendEvent(
                x11_display as *mut _,
                root,
                0,
                x11::xlib::SubstructureRedirectMask | x11::xlib::SubstructureNotifyMask,
                &mut event as *mut _ as *mut x11::xlib::XEvent,
            );
            x11::xlib::XFlush(x11_display as *mut _);
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = window;
}

fn start_overlay<T: EguiOverlay + 'static>(user_data: T) {
    use egui_window_glfw_passthrough::{glfw::WindowHint, GlfwConfig};

    #[cfg(target_os = "macos")]
    let opengl_window = Some(false);
    #[cfg(not(target_os = "macos"))]
    let opengl_window = Some(true);

    let mut glfw_backend = GlfwBackend::new(GlfwConfig {
        glfw_callback: Box::new(|gtx| {
            (GlfwConfig::default().glfw_callback)(gtx);
            gtx.window_hint(WindowHint::ScaleToMonitor(true));
        }),
        opengl_window,
        transparent_window: Some(true),
        ..Default::default()
    });

    glfw_backend.window.set_floating(true);
    glfw_backend.window.set_decorated(false);
    set_skip_taskbar(&glfw_backend.window);

    let latest_size = glfw_backend.window.get_framebuffer_size();
    let latest_size = [latest_size.0 as _, latest_size.1 as _];

    #[cfg(target_os = "macos")]
    let default_gfx_backend = egui_render_wgpu::WgpuBackend::new(
        egui_render_wgpu::WgpuConfig::default(),
        Some(Box::new(glfw_backend.window.render_context())),
        latest_size,
    );

    #[cfg(not(target_os = "macos"))]
    let default_gfx_backend = egui_render_three_d::ThreeDBackend::new(
        egui_render_three_d::ThreeDConfig::default(),
        |s| glfw_backend.get_proc_address(s),
        latest_size,
    );

    let overlay_app = egui_overlay::OverlayApp {
        user_data,
        egui_context: Default::default(),
        default_gfx_backend,
        glfw_backend,
    };
    overlay_app.enter_event_loop();
}

pub struct NativeOverlay {
    cmd_tx: Sender<OverlayCommand>,
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl NativeOverlay {
    pub fn new_with_config(
        position: OverlayPositionConfig,
        size: OverlaySizeConfig,
        margin: i32,
        theme: &str,
        audio_boost: f32,
        theme_loader: ThemeLoaderHandle,
    ) -> Self {
        let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded();
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = Arc::clone(&running);
        let theme_owned = theme.to_string();

        let thread = thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let app = OverlayApp::new(
                    cmd_rx,
                    running_clone,
                    position,
                    size,
                    margin,
                    &theme_owned,
                    audio_boost,
                    theme_loader,
                );
                start_overlay(app);
            }));

            if let Err(e) = result {
                tracing::error!("Native overlay panicked: {:?}", e);
            }
        });

        Self {
            cmd_tx,
            running,
            thread: Some(thread),
        }
    }

    pub fn new(theme_loader: ThemeLoaderHandle) -> Self {
        Self::new_with_config(
            OverlayPositionConfig::BottomLeft,
            OverlaySizeConfig::Medium,
            30,
            "default",
            800.0,
            theme_loader,
        )
    }

    pub fn is_available() -> bool {
        #[cfg(target_os = "linux")]
        {
            std::env::var("DISPLAY").is_ok()
        }
        #[cfg(target_os = "macos")]
        {
            false
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            false
        }
    }

    pub fn show(&self, state: OverlayState) {
        let _ = self.cmd_tx.send(OverlayCommand::Show(state));
    }

    pub fn hide(&self) {
        let _ = self.cmd_tx.send(OverlayCommand::Hide);
    }

    pub fn send_audio_level(&self, level: f32) {
        let _ = self.cmd_tx.send(OverlayCommand::AudioLevel(level));
    }

    pub fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
        let _ = self.cmd_tx.send(OverlayCommand::SpectrumBins(bins));
    }

    pub fn update_position(&self, x: i32, y: i32, _width: u32, _height: u32) {
        let _ = self
            .cmd_tx
            .send(OverlayCommand::UpdatePosition(Position { x, y }, 0));
    }

    pub fn set_theme(&self, theme_name: &str) {
        let _ = self
            .cmd_tx
            .send(OverlayCommand::SetTheme(theme_name.to_string()));
    }

    pub fn set_audio_boost(&self, boost: f32) {
        let _ = self.cmd_tx.send(OverlayCommand::SetAudioBoost(boost));
    }

    #[cfg(debug_assertions)]
    pub fn run_demo(&self) {
        let _ = self.cmd_tx.send(OverlayCommand::Demo);
    }

    pub fn shutdown(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        let _ = self.cmd_tx.send(OverlayCommand::Shutdown);

        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for NativeOverlay {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl super::backend::OverlayBackend for NativeOverlay {
    fn show(&self, state: OverlayState) {
        NativeOverlay::show(self, state);
    }

    fn hide(&self) {
        NativeOverlay::hide(self);
    }

    fn send_audio_level(&self, level: f32) {
        NativeOverlay::send_audio_level(self, level);
    }

    fn send_spectrum_bins(&self, bins: [f32; crate::audio::SPECTRUM_BARS]) {
        NativeOverlay::send_spectrum_bins(self, bins);
    }

    fn update_position(&self, x: i32, y: i32, width: u32, height: u32) {
        NativeOverlay::update_position(self, x, y, width, height);
    }

    fn set_theme(&self, theme_name: &str) {
        NativeOverlay::set_theme(self, theme_name);
    }

    fn shutdown(&mut self) {
        NativeOverlay::shutdown(self);
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    #[cfg(debug_assertions)]
    fn run_demo(&self) {
        NativeOverlay::run_demo(self);
    }
}
