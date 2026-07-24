//! Update-check — opt-in, manual-trigger only.
//!
//! Fetches the latest published release from the public GitHub API and compares
//! its version against the running app's own version. There is deliberately NO
//! automatic background polling, no call on launch, and no scheduler: this only
//! runs when the user clicks "Check for updates" in Settings. Keeping it
//! manual-trigger avoids any always-on network behaviour that would contradict
//! the project's "no telemetry" positioning.
//!
//! ## Why a dependency-free version comparison?
//! Voxis versions are plain, numeric `major.minor.patch` semver (e.g. `0.1.1`).
//! A numeric per-segment comparison (`split('.')`, parse each as an integer) is
//! trivially correct for this shape and adds no crate. The `semver` crate would
//! only earn its keep if we needed pre-release/build-metadata ordering, which
//! this simple "is a newer release available?" check does not.

use serde::{Deserialize, Serialize};

/// Public GitHub API endpoint for the latest release of the Voxis repo.
/// Unauthenticated — public repo releases need no token.
const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/axelbaumlisto/voxis/releases/latest";

/// GitHub requires a User-Agent header on all API requests, or it returns 403.
const USER_AGENT: &str = "voxis-update-check";

/// Result of a manual update check, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct UpdateCheckResult {
    /// The running app's own version (e.g. "0.1.1").
    pub current_version: String,
    /// The latest published release version, tag normalised (leading 'v' stripped).
    pub latest_version: String,
    /// True when `latest_version` is strictly newer than `current_version`.
    pub update_available: bool,
    /// URL of the latest release page (GitHub `html_url`).
    pub release_url: String,
}

/// Subset of the GitHub "latest release" JSON we care about.
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    html_url: String,
}

/// Manual-trigger command: check whether a newer Voxis release is available.
///
/// Reads the running app's own version via `app.package_info().version` (Tauri
/// v2), then does a single GET to the public GitHub releases API.
#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    check_update_against(&current_version, GITHUB_LATEST_RELEASE_API).await
}

/// Core implementation, decoupled from the Tauri `AppHandle` so it is
/// unit-testable with mockito: the current version and the API URL are both
/// injected.
async fn check_update_against(
    current_version: &str,
    api_url: &str,
) -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .get(api_url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("failed to reach GitHub: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("GitHub returned HTTP {status}"));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read GitHub response: {e}"))?;

    let release: GithubRelease = serde_json::from_str(&body)
        .map_err(|e| format!("failed to parse GitHub response: {e}"))?;

    let latest_version = normalize_version(&release.tag_name);
    let update_available = is_newer(&latest_version, current_version);
    let release_url = if release.html_url.is_empty() {
        format!(
            "https://github.com/axelbaumlisto/voxis/releases/tag/{}",
            release.tag_name
        )
    } else {
        release.html_url
    };

    Ok(UpdateCheckResult {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        release_url,
    })
}

/// Strip a leading 'v'/'V' from a release tag (e.g. "v0.1.1" -> "0.1.1").
fn normalize_version(tag: &str) -> String {
    tag.trim().trim_start_matches(['v', 'V']).to_string()
}

/// Return true when `latest` is strictly newer than `current`, comparing plain
/// numeric `major.minor.patch` segments. Non-numeric or missing segments are
/// treated as 0, so this never panics on unexpected input.
fn is_newer(latest: &str, current: &str) -> bool {
    let latest_parts = numeric_segments(latest);
    let current_parts = numeric_segments(current);
    let len = latest_parts.len().max(current_parts.len());
    for i in 0..len {
        let l = latest_parts.get(i).copied().unwrap_or(0);
        let c = current_parts.get(i).copied().unwrap_or(0);
        if l != c {
            return l > c;
        }
    }
    false
}

/// Parse a version string into numeric segments, ignoring any non-numeric
/// suffix on a segment (e.g. "1.2.0-rc1" -> [1, 2, 0]).
fn numeric_segments(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse::<u64>().unwrap_or(0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_leading_v() {
        assert_eq!(normalize_version("v0.1.1"), "0.1.1");
        assert_eq!(normalize_version("V2.0.0"), "2.0.0");
        assert_eq!(normalize_version("0.1.1"), "0.1.1");
        assert_eq!(normalize_version("  v1.2.3  "), "1.2.3");
    }

    #[test]
    fn is_newer_compares_numeric_segments() {
        assert!(is_newer("0.1.2", "0.1.1"));
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(!is_newer("0.1.1", "0.1.1"));
        assert!(!is_newer("0.1.0", "0.1.1"));
        // Missing segments treated as 0.
        assert!(is_newer("0.2", "0.1.9"));
        assert!(!is_newer("0.1", "0.1.0"));
        // Non-numeric suffixes are ignored gracefully (no panic).
        assert!(is_newer("0.1.2-rc1", "0.1.1"));
    }

    /// Case 1: the fetched latest version is NEWER than current.
    #[tokio::test]
    async fn reports_update_available_when_newer() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/releases/latest")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"tag_name": "v9.9.9", "html_url": "https://github.com/axelbaumlisto/voxis/releases/tag/v9.9.9"}"#,
            )
            .create_async()
            .await;

        let result = check_update_against("0.1.1", &format!("{}/releases/latest", server.url()))
            .await
            .expect("check should succeed");

        assert_eq!(result.current_version, "0.1.1");
        assert_eq!(result.latest_version, "9.9.9");
        assert!(result.update_available);
        assert_eq!(
            result.release_url,
            "https://github.com/axelbaumlisto/voxis/releases/tag/v9.9.9"
        );

        mock.assert_async().await;
    }

    /// Case 2: latest == current -> no update available.
    #[tokio::test]
    async fn reports_up_to_date_when_equal() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/releases/latest")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"tag_name": "v0.1.1", "html_url": ""}"#)
            .create_async()
            .await;

        let result = check_update_against("0.1.1", &format!("{}/releases/latest", server.url()))
            .await
            .expect("check should succeed");

        assert_eq!(result.latest_version, "0.1.1");
        assert!(!result.update_available);
        // Empty html_url falls back to a constructed release URL.
        assert_eq!(
            result.release_url,
            "https://github.com/axelbaumlisto/voxis/releases/tag/v0.1.1"
        );

        mock.assert_async().await;
    }

    /// Case 3: a network/server failure returns a graceful Err, never a panic.
    #[tokio::test]
    async fn returns_error_on_server_failure() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/releases/latest")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let result =
            check_update_against("0.1.1", &format!("{}/releases/latest", server.url())).await;

        assert!(result.is_err(), "expected Err on HTTP 500, got {result:?}");
        assert!(result.unwrap_err().contains("500"));

        mock.assert_async().await;
    }
}
