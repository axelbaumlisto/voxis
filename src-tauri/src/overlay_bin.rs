#![allow(deprecated, unexpected_cfgs)]

#[path = "overlay_bin/mod.rs"]
mod overlay_bin;

fn main() {
    overlay_bin::main();
}
