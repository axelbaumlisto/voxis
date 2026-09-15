//! `voxis-fake-stt` binary: `--port <PORT>` (default `8790`) and
//! `--map <PATH>` (default `fixtures/audio/fake-stt-map.json`, resolved
//! relative to the current working directory). Prints the bound address
//! to stdout on startup (`scripts/host-min-smoke.sh` and CI parse this
//! to know the server is ready) and serves until killed.

use std::net::SocketAddr;
use std::path::PathBuf;

fn parse_args() -> (u16, PathBuf) {
    let mut port: u16 = 8790;
    let mut map_path = PathBuf::from("fixtures/audio/fake-stt-map.json");
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--port" => {
                if let Some(value) = args.get(i + 1) {
                    port = value.parse().unwrap_or_else(|_| panic!("--port must be a u16, got {value:?}"));
                    i += 1;
                }
            }
            "--map" => {
                if let Some(value) = args.get(i + 1) {
                    map_path = PathBuf::from(value);
                    i += 1;
                }
            }
            other => eprintln!("voxis-fake-stt: ignoring unknown argument {other:?}"),
        }
        i += 1;
    }
    (port, map_path)
}

#[tokio::main]
async fn main() {
    // Minor (REJECT-FIX): `tracing_subscriber::fmt::init()`'s own
    // default (no `RUST_LOG` set) only shows `error`-level events, which
    // would silently swallow this binary's own `tracing::info!("loaded
    // fixture map")` startup line below -- default to `info`, still
    // overridable via `RUST_LOG`.
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
    let (port, map_path) = parse_args();

    let map = voxis_fake_stt::load_map(&map_path).unwrap_or_else(|e| {
        panic!("voxis-fake-stt: failed to load fixture map {}: {e}", map_path.display())
    });
    tracing::info!(entries = map.len(), path = %map_path.display(), "loaded fixture map");

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let (bound, serve_fut) = voxis_fake_stt::serve(addr, map)
        .await
        .unwrap_or_else(|e| panic!("voxis-fake-stt: failed to bind {addr}: {e}"));

    // Parsed by scripts/host-min-smoke.sh and the CI job to know the
    // server is up and which port it actually bound (relevant when
    // `--port 0` is used).
    println!("voxis-fake-stt listening on {bound}");

    serve_fut.await;
}
