//! Standalone native overlay binary.
//!
//! Runs as separate process to avoid GTK/GLFW conflict.
//! Communicates with main process via stdin.

use std::io::{self, BufRead};
use std::sync::mpsc;
use std::thread;

mod platform;
mod render;
mod theme;
mod types;

use types::parse_command;

#[allow(unused_imports)]
pub use types::{Command, OverlayState};

pub fn main() {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines().map_while(Result::ok) {
            if let Some(cmd) = parse_command(&line) {
                if tx.send(cmd).is_err() {
                    break;
                }
            }
        }
        let _ = tx.send(types::Command::Quit);
    });

    platform::run(rx);
}

#[cfg(test)]
mod tests;
