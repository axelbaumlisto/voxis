use std::sync::mpsc;

use crate::overlay_bin::types::Command;

#[cfg(not(target_os = "macos"))]
mod glfw;
#[cfg(target_os = "macos")]
mod macos;

pub fn run(cmd_rx: mpsc::Receiver<Command>) {
    #[cfg(target_os = "macos")]
    macos::run(cmd_rx);

    #[cfg(not(target_os = "macos"))]
    glfw::run(cmd_rx);
}
