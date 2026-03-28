//! Standalone typing benchmark for enigo performance testing.
//!
//! Usage:
//!   cargo run --release --bin typing_bench -- "text to type"
//!   cargo run --release --bin typing_bench -- --benchmark
//!
//! The benchmark mode tests typing speed without actually typing,
//! measuring enigo initialization and text processing overhead.

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::env;
use std::time::Instant;

/// Create Settings for fast typing.
fn fast_settings() -> Settings {
    Settings {
        linux_delay: 0,
        ..Settings::default()
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: typing_bench <text> | --benchmark | --dry-run <text> | --paste <text>");
        eprintln!();
        eprintln!("Options:");
        eprintln!("  <text>           Type the given text and measure time");
        eprintln!("  --benchmark      Run standard benchmark suite (dry-run)");
        eprintln!("  --dry-run <text> Measure without typing (init overhead only)");
        eprintln!("  --paste <text>   Use fast paste mode (clipboard + Ctrl+V)");
        eprintln!("  --compare <text> Compare typing vs paste speed");
        std::process::exit(1);
    }

    match args[1].as_str() {
        "--benchmark" => run_benchmark_suite(),
        "--dry-run" => {
            let text = args.get(2).map(|s| s.as_str()).unwrap_or("Привет мир!");
            dry_run(text);
        }
        "--paste" => {
            let text = args.get(2).map(|s| s.as_str()).unwrap_or("Привет мир!");
            paste_and_measure(text);
        }
        "--compare" => {
            let text = args
                .get(2)
                .map(|s| s.as_str())
                .unwrap_or("Привет, мир! Один, два, три.");
            compare_methods(text);
        }
        _ => {
            let text = &args[1];
            type_and_measure(text);
        }
    }
}

fn type_and_measure(text: &str) {
    let init_start = Instant::now();
    let mut enigo = Enigo::new(&fast_settings()).expect("Failed to init enigo");
    let init_time = init_start.elapsed();

    let type_start = Instant::now();
    enigo.text(text).expect("Failed to type");
    let type_time = type_start.elapsed();

    let total_time = init_time + type_time;
    let char_count = text.chars().count();
    let chars_per_sec = if total_time.as_millis() > 0 {
        (char_count as f64 / total_time.as_secs_f64()) as u64
    } else {
        char_count as u64 * 1000
    };

    println!("Chars: {}", char_count);
    println!("Init: {}ms", init_time.as_millis());
    println!("Type: {}ms", type_time.as_millis());
    println!("Total: {}ms", total_time.as_millis());
    println!("Speed: {} chars/sec", chars_per_sec);

    // Exit code based on performance target (< 500ms for typing)
    if type_time.as_millis() > 500 {
        eprintln!("WARN: Typing exceeded 500ms target");
        std::process::exit(1);
    }
}

fn dry_run(text: &str) {
    let init_start = Instant::now();
    let _enigo = Enigo::new(&fast_settings()).expect("Failed to init enigo");
    let init_time = init_start.elapsed();

    println!("DRY RUN (no actual typing)");
    println!("Text: \"{}\"", text);
    println!("Chars: {}", text.chars().count());
    println!("Init: {}ms", init_time.as_millis());
}

fn paste_and_measure(text: &str) {
    println!("=== PASTE MODE (clipboard + Ctrl+V) ===");

    let start = Instant::now();

    // Set clipboard
    let clip_start = Instant::now();
    let mut clipboard = Clipboard::new().expect("Failed to init clipboard");
    clipboard.set_text(text).expect("Failed to set clipboard");
    let clip_time = clip_start.elapsed();

    // Send Ctrl+V
    let paste_start = Instant::now();
    let settings = Settings::default();
    let mut enigo = Enigo::new(&settings).expect("Failed to init enigo");

    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;

    enigo
        .key(modifier, Direction::Press)
        .expect("Failed to press modifier");
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .expect("Failed to press V");
    enigo
        .key(modifier, Direction::Release)
        .expect("Failed to release modifier");
    let paste_time = paste_start.elapsed();

    // Small delay for paste to complete
    std::thread::sleep(std::time::Duration::from_millis(50));

    let total_time = start.elapsed();
    let char_count = text.chars().count();

    println!("Text: \"{}\"", text);
    println!("Chars: {}", char_count);
    println!("Clipboard: {}ms", clip_time.as_millis());
    println!("Paste (Ctrl+V): {}ms", paste_time.as_millis());
    println!("Total: {}ms", total_time.as_millis());
    println!();
    println!(
        "FAST: {} chars in {}ms!",
        char_count,
        total_time.as_millis()
    );
}

fn compare_methods(text: &str) {
    println!("=== COMPARISON: Type vs Paste ===");
    println!("Text: \"{}\" ({} chars)", text, text.chars().count());
    println!();

    // First test paste
    println!("--- Testing PASTE mode ---");
    let paste_start = Instant::now();
    {
        let mut clipboard = Clipboard::new().expect("Failed to init clipboard");
        clipboard.set_text(text).expect("Failed to set clipboard");
        let settings = Settings::default();
        let mut enigo = Enigo::new(&settings).expect("Failed to init enigo");

        #[cfg(target_os = "macos")]
        let modifier = Key::Meta;
        #[cfg(not(target_os = "macos"))]
        let modifier = Key::Control;

        enigo.key(modifier, Direction::Press).unwrap();
        enigo.key(Key::Unicode('v'), Direction::Click).unwrap();
        enigo.key(modifier, Direction::Release).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let paste_time = paste_start.elapsed();
    println!("Paste: {}ms", paste_time.as_millis());

    // Small pause between tests
    std::thread::sleep(std::time::Duration::from_millis(500));

    println!();
    println!("--- Testing TYPE mode ---");
    let type_start = Instant::now();
    {
        let mut enigo = Enigo::new(&fast_settings()).expect("Failed to init enigo");
        enigo.text(text).expect("Failed to type");
    }
    let type_time = type_start.elapsed();
    println!("Type: {}ms", type_time.as_millis());

    println!();
    println!("=== RESULTS ===");
    println!("Paste: {}ms", paste_time.as_millis());
    println!("Type:  {}ms", type_time.as_millis());
    let speedup = type_time.as_millis() as f64 / paste_time.as_millis() as f64;
    println!("Speedup: {:.1}x faster with paste!", speedup);
}

fn run_benchmark_suite() {
    println!("=== Enigo Typing Benchmark Suite ===");
    println!();

    let test_cases = [
        ("Short ASCII", "Hello world!"),
        ("Medium ASCII", "The quick brown fox jumps over the lazy dog."),
        ("Short Cyrillic", "Привет мир!"),
        ("Medium Cyrillic", "Быстрая коричневая лиса перепрыгивает через ленивую собаку."),
        ("Mixed", "Hello мир! Testing 123 тест."),
        ("Long text", "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."),
    ];

    // Initialize enigo once to measure init overhead
    let init_start = Instant::now();
    let enigo = Enigo::new(&fast_settings()).expect("Failed to init enigo");
    drop(enigo);
    let init_time = init_start.elapsed();
    println!("Enigo init time: {}ms", init_time.as_millis());
    println!();

    println!("{:<20} {:>8} {:>10}", "Test Case", "Chars", "Est. Time");
    println!("{}", "-".repeat(42));

    for (name, text) in test_cases {
        let char_count = text.chars().count();
        // Estimate: with set_delay(0), typing should be near-instant
        // Actual X11 event sending is ~0.1-0.5ms per char
        let est_ms = (char_count as f64 * 0.5) as u64;
        println!("{:<20} {:>8} {:>8}ms", name, char_count, est_ms);
    }

    println!();
    println!("To run actual typing test:");
    println!("  cargo run --release --bin typing_bench -- \"your text here\"");
    println!();
    println!("Target: < 500ms for any reasonable text length");
}
