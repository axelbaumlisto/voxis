//! QR payload + SVG rendering for "Share profile to device".
//!
//! The payload shape is pinned by the tauri-plugin-voxis contract fixture
//! `crates/tauri-plugin-voxis/contract/fixtures/profile-qr.json`:
//! `{v, host, port, token, k}` — deliberately **not** a `voxis://…` URL
//! (`[R1-Safety T1]`: a third-party app on the scanning device could
//! register that scheme and steal the token/key before the intended
//! client sees it). `k` is `base64url(k_qr)`; the 6-digit code is shown by
//! the UI next to the QR, never encoded into it.

use qrcode::{render::svg, QrCode};
use serde::Serialize;

/// The exact JSON shape encoded into the QR. Field order/names match the
/// contract fixture; `#[serde(rename_all)]` is not needed since the fixture
/// itself uses these exact short lowercase names.
#[derive(Debug, Clone, Serialize)]
pub struct QrPayload {
    pub v: u32,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub k: String,
}

/// Render `payload` as a self-contained SVG string (no network calls, no
/// external QR-image service — plan requirement). Errors only if the
/// serialized payload is too large for even the largest QR version, which
/// none of this module's fixed-shape payloads ever are.
pub fn render_svg(payload: &QrPayload) -> Result<String, qrcode::types::QrError> {
    let json = serde_json::to_vec(payload).expect("QrPayload always serializes");
    let code = QrCode::new(json)?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> QrPayload {
        QrPayload {
            v: 1,
            host: "192.168.1.42".to_string(),
            port: 4217,
            token: "b2b48c1e-token".to_string(),
            k: "3q2-7w1s5F0P9xJf6uY8bN2mZaC4vD1eR7tG5hK9lQ0".to_string(),
        }
    }

    #[test]
    fn renders_svg_markup() {
        let svg = render_svg(&sample_payload()).unwrap();
        assert!(svg.starts_with("<?xml"));
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn payload_json_matches_contract_shape() {
        let value = serde_json::to_value(sample_payload()).unwrap();
        let obj = value.as_object().unwrap();
        assert_eq!(obj.len(), 5, "payload must have exactly v/host/port/token/k");
        for key in ["v", "host", "port", "token", "k"] {
            assert!(obj.contains_key(key), "missing key {key}");
        }
        // No URL scheme anywhere in the encoded payload (`[R1-Safety T1]`).
        assert!(!value.to_string().contains("://"));
    }

    #[test]
    fn payload_matches_fixture_field_shape() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../crates/tauri-plugin-voxis/contract/fixtures/profile-qr.json"
        ))
        .unwrap();
        let fixture_obj = fixture.as_object().unwrap();
        let ours = serde_json::to_value(sample_payload()).unwrap();
        let ours_obj = ours.as_object().unwrap();
        let mut fixture_keys: Vec<&str> = fixture_obj.keys().map(String::as_str).collect();
        let mut our_keys: Vec<&str> = ours_obj.keys().map(String::as_str).collect();
        fixture_keys.sort();
        our_keys.sort();
        assert_eq!(fixture_keys, our_keys, "QrPayload field set must match the contract fixture");
    }
}
