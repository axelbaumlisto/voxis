//! Test rdev keyboard listener
use rdev::{listen, Event, EventType};

fn main() {
    println!("Testing rdev listener. Press any key...");
    println!("Press Ctrl+C to exit.");

    let callback = |event: Event| match event.event_type {
        EventType::KeyPress(key) => {
            println!("KeyPress: {:?}", key);
        }
        EventType::KeyRelease(key) => {
            println!("KeyRelease: {:?}", key);
        }
        _ => {}
    };

    if let Err(e) = listen(callback) {
        eprintln!("Error: {:?}", e);
    }
}
