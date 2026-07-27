//! Pure crash diagnostics report core.
//!
//! Origin: adapted from Clipshot's Task-5 doctor verdict matrix
//! (`/home/sham/work/clipshot/src/doctor/crash_diagnostics.rs`). Voxis has no
//! doctor CLI, so this module returns serializable evidence for Export
//! Diagnostics and Settings instead. Keep this note so future fixes can be
//! mirrored deliberately.
//!
//! This module is intentionally the pure core: callers inject parsed crash-log,
//! heartbeat, install-error, and clock inputs. Disk/process I/O lives in the
//! Tauri command layer.

use serde::{Deserialize, Serialize};

pub const CRASH_LOOP_THRESHOLD: usize = 3;
pub const CRASH_LOOP_WINDOW_SECS: u64 = 10 * 60;
const HEARTBEAT_FRESH_SECS: u64 = 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrashDiagnosticsInput {
    pub crash_log: CrashLogEvidence,
    pub heartbeat: HeartbeatEvidence,
    pub fatal_install_error: Option<FatalInstallErrorInput>,
    pub now_wall_ts: u64,
    pub now_monotonic_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrashLogEvidence {
    Missing,
    Unreadable { error: String },
    Present(ParsedCrashLog),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCrashLog {
    pub events: Vec<CrashEvent>,
    pub malformed_entries: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrashEvent {
    pub kind: CrashEventKind,
    pub summary: String,
    pub when_label: String,
    pub wall_ts: Option<u64>,
    pub monotonic_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CrashEventKind {
    Panic,
    FatalSignal,
    WindowsException,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeartbeatEvidence {
    MissingAll,
    Observed(Box<HeartbeatObservedInput>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatObservedInput {
    pub heartbeat: Option<HeartbeatSnapshotInput>,
    pub heartbeat_parse_error: bool,
    pub reported_unclean: Option<ReportedUncleanInput>,
    pub reported_unclean_parse_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportedUncleanInput {
    pub reported_at_wall_ts: u64,
    pub snapshot: HeartbeatSnapshotInput,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeartbeatSnapshotInput {
    pub pid: u32,
    pub wall_ts: u64,
    pub uptime_s: u64,
    pub process_start_unix_s: Option<u64>,
    pub last_breadcrumb: Option<String>,
    pub rss_kb: Option<u64>,
    pub recording_state: Option<String>,
    pub queue_depth: Option<usize>,
    pub last_transcription_outcome: Option<String>,
    pub overlay_backend: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FatalInstallErrorInput {
    pub step: String,
    pub os_error: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CrashDiagnosticsSeverity {
    Ok,
    Warn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CrashReportSummary {
    pub kind: CrashEventKind,
    pub summary: String,
    pub when_label: String,
    pub wall_ts: Option<u64>,
    pub monotonic_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CrashDiagnosticsReport {
    pub severity: CrashDiagnosticsSeverity,
    pub headline: String,
    pub details: Vec<String>,
    pub hints: Vec<String>,
    pub settings_notice: Option<String>,
    pub last_crash_report: Option<CrashReportSummary>,
    pub previous_run_ended_uncleanly: bool,
    pub previous_run_last_state: Option<String>,
    pub heartbeat_freshness: Option<String>,
    pub fatal_handler_install_error: Option<String>,
}

/// Pure verdict matrix for crash diagnostics.
///
/// Rows implemented:
/// - clean history + no unclean previous exit + handlers installed => OK with
///   non-overclaiming wording.
/// - previous run ended uncleanly => Warn naming captured heartbeat state.
/// - 3 or more crashes within 600s => Warn naming the count. Three in ten
///   minutes is high enough to avoid alarming on one-off restarts but early
///   enough to catch launcher-style crash loops before common five-burst caps
///   hide the pattern.
/// - fatal-handler installation failure => Warn because fatal-signal coverage is blind.
/// - old crash report => informational detail, not a warning.
/// - missing files => informational detail, never an error.
pub fn crash_diagnostics_report(input: &CrashDiagnosticsInput) -> CrashDiagnosticsReport {
    let mut severity = CrashDiagnosticsSeverity::Ok;
    let mut details = Vec::new();
    let mut hints = Vec::new();
    let mut settings_notices = Vec::new();

    let fatal_handler_install_error = input.fatal_install_error.as_ref().map(|error| {
        redact_sensitive_text(&format!(
            "crash diagnostics unavailable: fatal handler install failed at {} (os error {})",
            error.step, error.os_error
        ))
    });
    if let Some(error) = &fatal_handler_install_error {
        severity = CrashDiagnosticsSeverity::Warn;
        details.push(error.clone());
        settings_notices.push(error.clone());
        hints.push(
            "fatal signal reports may be missing; heartbeat snapshots are still partial evidence"
                .to_string(),
        );
    }

    let unclean = reported_unclean(input);
    let previous_run_last_state = unclean.map(|unclean| heartbeat_summary(&unclean.snapshot));
    if let Some(state) = &previous_run_last_state {
        severity = CrashDiagnosticsSeverity::Warn;
        let detail = format!("previous run ended uncleanly; captured last state: {state}");
        details.push(detail.clone());
        settings_notices.push(detail);
        hints.push("inspect the exported crash diagnostics summary for the pre-death state".into());
    }

    let mut last_crash_report = None;
    match &input.crash_log {
        CrashLogEvidence::Missing => {}
        CrashLogEvidence::Unreadable { error } => {
            details.push(redact_sensitive_text(&format!(
                "crash.log unreadable; ignored ({error})"
            )));
        }
        CrashLogEvidence::Present(parsed) => {
            let loop_notice = append_crash_log_details(
                parsed,
                input.now_wall_ts,
                input.now_monotonic_ms,
                &mut severity,
                &mut details,
                &mut hints,
            );
            if let Some(notice) = loop_notice {
                settings_notices.push(notice);
            }
            last_crash_report = parsed.events.last().map(|event| CrashReportSummary {
                kind: event.kind,
                summary: redact_sensitive_text(&event.summary),
                when_label: redact_sensitive_text(&event.when_label),
                wall_ts: event.wall_ts,
                monotonic_ms: event.monotonic_ms,
            });
        }
    }

    let heartbeat_freshness = append_heartbeat_details(&input.heartbeat, input.now_wall_ts, &mut details);

    if crash_history_absent(&input.crash_log)
        && unclean.is_none()
        && input.fatal_install_error.is_none()
    {
        details.insert(
            0,
            "no crashes recorded (local evidence only; SIGKILL and some third-party-thread stack overflows can be missed)"
                .to_string(),
        );
    }

    if details.is_empty() {
        details.push(
            "no crashes recorded (local evidence only; SIGKILL and some third-party-thread stack overflows can be missed)"
                .to_string(),
        );
    }

    let headline = match severity {
        CrashDiagnosticsSeverity::Ok => "Crash diagnostics: no urgent evidence".to_string(),
        CrashDiagnosticsSeverity::Warn => "Crash diagnostics need attention".to_string(),
    };

    CrashDiagnosticsReport {
        severity,
        headline,
        details: sanitize_vec(details),
        hints: sanitize_vec(dedup(hints)),
        settings_notice: settings_notices.into_iter().next().map(|s| redact_sensitive_text(&s)),
        last_crash_report,
        previous_run_ended_uncleanly: unclean.is_some(),
        previous_run_last_state: previous_run_last_state.map(|s| redact_sensitive_text(&s)),
        heartbeat_freshness,
        fatal_handler_install_error,
    }
}

fn append_crash_log_details(
    parsed: &ParsedCrashLog,
    now_wall_ts: u64,
    _now_monotonic_ms: Option<u64>,
    severity: &mut CrashDiagnosticsSeverity,
    details: &mut Vec<String>,
    hints: &mut Vec<String>,
) -> Option<String> {
    if parsed.events.is_empty() {
        if parsed.malformed_entries > 0 {
            details.push(format!(
                "crash.log present but no parseable reports ({} malformed/corrupt entr{} ignored)",
                parsed.malformed_entries,
                plural_y(parsed.malformed_entries)
            ));
        }
        return None;
    }

    let recent_count = parsed
        .events
        .iter()
        .filter(|event| event_is_recent(event, now_wall_ts))
        .count();

    let mut loop_notice = None;
    if recent_count >= CRASH_LOOP_THRESHOLD {
        *severity = CrashDiagnosticsSeverity::Warn;
        let detail = format!(
            "recent repeated crashes: {} within {}s (threshold {}/{}s: filters one-off restarts, catches loops before common 5-burst launcher caps)",
            recent_count, CRASH_LOOP_WINDOW_SECS, CRASH_LOOP_THRESHOLD, CRASH_LOOP_WINDOW_SECS
        );
        details.push(detail.clone());
        loop_notice = Some(detail);
        hints.push("repeated recent crashes indicate a crash loop; inspect crash.log signals/panic summaries".into());
    }

    if let Some(last) = parsed.events.last() {
        details.push(format!(
            "last crash report: {}, {}{}",
            redact_sensitive_text(&last.when_label),
            redact_sensitive_text(&last.summary),
            crash_age_suffix(last, now_wall_ts, recent_count)
        ));
    }

    if parsed.malformed_entries > 0 {
        details.push(format!(
            "{} malformed/corrupt crash.log entr{} ignored",
            parsed.malformed_entries,
            plural_y(parsed.malformed_entries)
        ));
    }

    loop_notice
}

fn event_is_recent(event: &CrashEvent, now_wall_ts: u64) -> bool {
    event
        .wall_ts
        .is_some_and(|ts| now_wall_ts.saturating_sub(ts) <= CRASH_LOOP_WINDOW_SECS)
}

fn crash_age_suffix(last: &CrashEvent, now_wall_ts: u64, recent_count: usize) -> String {
    if event_is_recent(last, now_wall_ts) {
        if recent_count < CRASH_LOOP_THRESHOLD {
            return format!(
                " ({}/{} within {}s; informational)",
                recent_count, CRASH_LOOP_THRESHOLD, CRASH_LOOP_WINDOW_SECS
            );
        }
        return String::new();
    }

    if last.wall_ts.is_some() {
        format!(" (outside {}s crash-loop window; informational)", CRASH_LOOP_WINDOW_SECS)
    } else {
        " (wall time unavailable; not counted for recent-loop threshold)".into()
    }
}

fn append_heartbeat_details(
    heartbeat: &HeartbeatEvidence,
    now_wall_ts: u64,
    details: &mut Vec<String>,
) -> Option<String> {
    match heartbeat {
        HeartbeatEvidence::MissingAll => {
            details.push("heartbeat files missing (fresh install or pre-diagnostics build)".into());
            None
        }
        HeartbeatEvidence::Observed(observed) => {
            let freshness = if let Some(snapshot) = &observed.heartbeat {
                let freshness = heartbeat_freshness(snapshot, now_wall_ts);
                details.push(format!(
                    "last heartbeat: {}, {}",
                    freshness,
                    heartbeat_summary(snapshot)
                ));
                Some(freshness)
            } else {
                if observed.heartbeat_parse_error {
                    details.push("heartbeat.json corrupt/unreadable; ignored".into());
                }
                None
            };

            if observed.reported_unclean_parse_error {
                details.push("heartbeat.crashed.json corrupt/unreadable; ignored".into());
            }
            freshness
        }
    }
}

fn heartbeat_freshness(snapshot: &HeartbeatSnapshotInput, now_wall_ts: u64) -> String {
    if snapshot.wall_ts > now_wall_ts.saturating_add(300) {
        return format!(
            "timestamp is in the future (wall_ts={}, now={})",
            snapshot.wall_ts, now_wall_ts
        );
    }
    let age = now_wall_ts.saturating_sub(snapshot.wall_ts);
    if age <= HEARTBEAT_FRESH_SECS {
        format!("fresh age={}s (fresh<=30s)", age)
    } else {
        format!("stale age={}s (fresh<=30s)", age)
    }
}

pub fn heartbeat_summary(snapshot: &HeartbeatSnapshotInput) -> String {
    redact_sensitive_text(&format!(
        "pid={}, uptime={}s, rss_kb={}, recording_state={}, queue_depth={}, last_transcription_outcome={}, overlay_backend={}, last_breadcrumb={}",
        snapshot.pid,
        snapshot.uptime_s,
        option_u64(snapshot.rss_kb),
        option_str(snapshot.recording_state.as_deref()),
        option_usize(snapshot.queue_depth),
        option_str(snapshot.last_transcription_outcome.as_deref()),
        option_str(snapshot.overlay_backend.as_deref()),
        option_str(snapshot.last_breadcrumb.as_deref())
    ))
}

fn option_str(value: Option<&str>) -> &str {
    value.filter(|v| !v.is_empty()).unwrap_or("<none>")
}

fn option_u64(value: Option<u64>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "<none>".into())
}

fn option_usize(value: Option<usize>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "<none>".into())
}

fn reported_unclean(input: &CrashDiagnosticsInput) -> Option<&ReportedUncleanInput> {
    match &input.heartbeat {
        HeartbeatEvidence::Observed(observed) => observed.reported_unclean.as_ref(),
        HeartbeatEvidence::MissingAll => None,
    }
}

fn crash_history_absent(crash_log: &CrashLogEvidence) -> bool {
    match crash_log {
        CrashLogEvidence::Missing => true,
        CrashLogEvidence::Present(parsed) => parsed.events.is_empty() && parsed.malformed_entries == 0,
        CrashLogEvidence::Unreadable { .. } => false,
    }
}

fn dedup(items: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in items {
        if !out.contains(&item) {
            out.push(item);
        }
    }
    out
}

fn sanitize_vec(items: Vec<String>) -> Vec<String> {
    items.into_iter().map(|item| redact_sensitive_text(&item)).collect()
}

fn plural_y(count: usize) -> &'static str {
    if count == 1 { "y" } else { "ies" }
}

/// Pure crash.log parser. Handles current Task-2 fatal text blocks and a
/// defensive JSON panic-line shape if a future panic reporter writes one.
/// Malformed/corrupt entries are counted, never panicked on.
pub fn parse_crash_log(text: &str) -> ParsedCrashLog {
    let mut events = Vec::new();
    let mut malformed_entries = 0usize;
    let mut fatal_block: Vec<&str> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "=== voxis fatal crash ===" {
            flush_fatal_block(&mut fatal_block, &mut events, &mut malformed_entries);
            fatal_block.push(trimmed);
            continue;
        }

        if !fatal_block.is_empty() {
            if trimmed.starts_with('{') {
                flush_fatal_block(&mut fatal_block, &mut events, &mut malformed_entries);
                parse_json_crash_line(trimmed, &mut events, &mut malformed_entries);
            } else {
                fatal_block.push(trimmed);
            }
            continue;
        }

        if trimmed.starts_with('{') {
            parse_json_crash_line(trimmed, &mut events, &mut malformed_entries);
        } else {
            malformed_entries += 1;
        }
    }

    flush_fatal_block(&mut fatal_block, &mut events, &mut malformed_entries);

    ParsedCrashLog { events, malformed_entries }
}

fn parse_json_crash_line(
    line: &str,
    events: &mut Vec<CrashEvent>,
    malformed_entries: &mut usize,
) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(value) => {
            let timestamp = value
                .get("timestamp")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let wall_ts = parse_rfc3339_unix(timestamp);
            events.push(CrashEvent {
                kind: CrashEventKind::Panic,
                summary: "panic recorded (message withheld from export; see local crash.log)".into(),
                when_label: if timestamp.is_empty() {
                    "timestamp unavailable".into()
                } else {
                    redact_sensitive_text(timestamp)
                },
                wall_ts,
                monotonic_ms: None,
            });
        }
        Err(_) => *malformed_entries += 1,
    }
}

fn flush_fatal_block(
    fatal_block: &mut Vec<&str>,
    events: &mut Vec<CrashEvent>,
    malformed_entries: &mut usize,
) {
    if fatal_block.is_empty() {
        return;
    }
    match parse_fatal_block(fatal_block) {
        Some(event) => events.push(event),
        None => *malformed_entries += 1,
    }
    fatal_block.clear();
}

fn parse_fatal_block(lines: &[&str]) -> Option<CrashEvent> {
    let mut signal = None;
    let mut signal_label = None;
    let mut exception_code = None;
    let mut timestamp_ms = None;
    let mut last_breadcrumb = None;

    for line in lines {
        if let Some(rest) = line.strip_prefix("signal: ") {
            signal = parse_i32_prefix(rest);
            signal_label = parse_paren_label(rest).map(str::to_string);
        } else if let Some(rest) = line.strip_prefix("exception_code: ") {
            exception_code = parse_u32_prefix(rest);
        } else if let Some(rest) = line.strip_prefix("timestamp_ms: ") {
            timestamp_ms = parse_u64_prefix(rest);
        } else if let Some(rest) = line.strip_prefix("breadcrumb: ") {
            last_breadcrumb = Some(rest.trim().to_string());
        }
    }

    let when_label = match timestamp_ms {
        Some(ms) => format!("wall time unavailable (fatal monotonic_ms={ms})"),
        None => "wall time unavailable".into(),
    };
    let breadcrumb_suffix = last_breadcrumb
        .as_ref()
        .map(|b| format!(", last breadcrumb: {}", truncate(&redact_sensitive_text(b), 120)))
        .unwrap_or_default();

    if let Some(signal) = signal {
        let label = signal_label.unwrap_or_else(|| signal_name(signal).to_string());
        return Some(CrashEvent {
            kind: CrashEventKind::FatalSignal,
            summary: redact_sensitive_text(&format!(
                "fatal signal {} ({}){}",
                label, signal, breadcrumb_suffix
            )),
            when_label,
            wall_ts: None,
            monotonic_ms: timestamp_ms,
        });
    }

    exception_code.map(|code| CrashEvent {
        kind: CrashEventKind::WindowsException,
        summary: redact_sensitive_text(&format!(
            "fatal Windows exception code {}{}",
            code, breadcrumb_suffix
        )),
        when_label,
        wall_ts: None,
        monotonic_ms: timestamp_ms,
    })
}

fn parse_i32_prefix(value: &str) -> Option<i32> {
    value.split_whitespace().next()?.parse().ok()
}

fn parse_u32_prefix(value: &str) -> Option<u32> {
    value.split_whitespace().next()?.parse().ok()
}

fn parse_u64_prefix(value: &str) -> Option<u64> {
    value.split_whitespace().next()?.parse().ok()
}

fn parse_paren_label(value: &str) -> Option<&str> {
    let start = value.find('(')? + 1;
    let end = value[start..].find(')')? + start;
    value.get(start..end).filter(|s| !s.is_empty())
}

fn signal_name(signal: i32) -> &'static str {
    match signal {
        4 => "SIGILL",
        6 => "SIGABRT",
        7 => "SIGBUS",
        11 => "SIGSEGV",
        _ => "signal",
    }
}

fn parse_rfc3339_unix(timestamp: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .and_then(|dt| dt.timestamp().try_into().ok())
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

/// Redact diagnostic free text before it is returned to the UI or exported.
///
/// Crash breadcrumbs are `&'static str` literals recorded by Voxis code, so they
/// cannot carry transcription text, API keys, or user-provided paths by
/// construction. This sanitizer is defense-in-depth for panic summaries,
/// unreadable-path errors, and any future report fields: it removes obvious
/// API-key/token/password assignments and home-directory usernames.
pub fn redact_sensitive_text(input: &str) -> String {
    let home_redacted = redact_home_like_paths(input);
    let assignment_redacted = redact_secret_assignments(&home_redacted);
    redact_secret_tokens(&assignment_redacted)
}

pub fn is_secret_key_name(key: &str) -> bool {
    let leaf = key.rsplit('.').next().unwrap_or(key).to_lowercase();
    leaf.contains("api_key")
        || leaf.contains("apikey")
        || leaf.contains("secret")
        || leaf.contains("token")
        || leaf.contains("password")
        || leaf == "key"
}

fn redact_home_like_paths(input: &str) -> String {
    let unix_redacted = redact_embedded_path_prefix(input, "/home/");
    let mac_redacted = redact_embedded_path_prefix(&unix_redacted, "/Users/");
    redact_embedded_windows_prefix(&mac_redacted, "C:\\Users\\")
}

fn redact_embedded_path_prefix(input: &str, prefix: &str) -> String {
    redact_embedded_user_segment(input, prefix, '/')
}

fn redact_embedded_windows_prefix(input: &str, prefix: &str) -> String {
    redact_embedded_user_segment(input, prefix, '\\')
}

fn redact_embedded_user_segment(input: &str, prefix: &str, separator: char) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(idx) = rest.find(prefix) {
        out.push_str(&rest[..idx]);
        out.push_str(prefix);
        out.push_str("[REDACTED]");
        let after_prefix = &rest[idx + prefix.len()..];
        rest = match after_prefix.find(separator) {
            Some(name_end) => &after_prefix[name_end..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

fn redact_secret_assignments(input: &str) -> String {
    let tokens: Vec<&str> = input.split_whitespace().collect();
    let mut redacted = Vec::with_capacity(tokens.len());
    let mut index = 0;

    while index < tokens.len() {
        let token = tokens[index];

        if let Some(key) = inline_assignment_key(token) {
            if is_secret_key_name(key) {
                redacted.push(redact_assignment_token(token));
                index += 1;
                continue;
            }
        }

        if let Some(key) = token.strip_suffix('=').or_else(|| token.strip_suffix(':')) {
            if is_secret_key_name(key) && index + 1 < tokens.len() {
                redacted.push(token.to_string());
                redacted.push(redact_value_token(tokens[index + 1]));
                index += 2;
                continue;
            }
        }

        if is_secret_key_name(token) && index + 1 < tokens.len() {
            let next = tokens[index + 1];
            if is_separator_token(next) && index + 2 < tokens.len() {
                redacted.push(token.to_string());
                redacted.push(next.to_string());
                redacted.push(redact_value_token(tokens[index + 2]));
                index += 3;
                continue;
            }
            if starts_with_separator_and_value(next) {
                redacted.push(token.to_string());
                redacted.push(redact_separator_prefixed_value(next));
                index += 2;
                continue;
            }
        }

        redacted.push(token.to_string());
        index += 1;
    }

    redacted.join(" ")
}

fn inline_assignment_key(token: &str) -> Option<&str> {
    let idx = token.find('=').or_else(|| token.find(':'))?;
    if idx == 0 || idx + 1 >= token.len() {
        return None;
    }
    token.get(..idx)
}

fn is_separator_token(token: &str) -> bool {
    token == "=" || token == ":"
}

fn starts_with_separator_and_value(token: &str) -> bool {
    token.len() > 1 && (token.starts_with('=') || token.starts_with(':'))
}

fn redact_separator_prefixed_value(token: &str) -> String {
    match token.chars().next() {
        Some(separator) => format!("{separator}[REDACTED]"),
        None => "[REDACTED]".into(),
    }
}

fn redact_value_token(_token: &str) -> String {
    "[REDACTED]".into()
}

fn redact_assignment_token(token: &str) -> String {
    let sep = token.find('=').or_else(|| token.find(':'));
    match sep {
        Some(idx) => format!("{}[REDACTED]", &token[..=idx]),
        None => "[REDACTED]".into(),
    }
}

fn redact_secret_tokens(input: &str) -> String {
    input
        .split_whitespace()
        .map(|token| {
            let trimmed = token.trim_matches(|c: char| c == ',' || c == ';' || c == ')' || c == '(');
            let lower = trimmed.to_lowercase();
            if trimmed.len() >= 12
                && (lower.starts_with("sk-")
                    || lower.starts_with("gsk_")
                    || lower.starts_with("xoxb-")
                    || lower.starts_with("ghp_"))
            {
                token.replace(trimmed, "[REDACTED]")
            } else {
                token.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn render_report_text(report: &CrashDiagnosticsReport) -> String {
    let mut lines = vec![
        "# Voxis crash diagnostics".to_string(),
        format!("severity: {:?}", report.severity),
        format!("headline: {}", redact_sensitive_text(&report.headline)),
        String::new(),
        "## Details".to_string(),
    ];
    lines.extend(report.details.iter().map(|detail| format!("- {}", redact_sensitive_text(detail))));
    if !report.hints.is_empty() {
        lines.push(String::new());
        lines.push("## Hints".to_string());
        lines.extend(report.hints.iter().map(|hint| format!("- {}", redact_sensitive_text(hint))));
    }
    if let Some(last) = &report.last_crash_report {
        lines.push(String::new());
        lines.push("## Last crash report".to_string());
        lines.push(format!("kind: {:?}", last.kind));
        lines.push(format!("when: {}", redact_sensitive_text(&last.when_label)));
        lines.push(format!("summary: {}", redact_sensitive_text(&last.summary)));
    }
    lines.push(String::new());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;
    const NOW_MS: u64 = 9_000_000;

    fn base_input() -> CrashDiagnosticsInput {
        CrashDiagnosticsInput {
            crash_log: CrashLogEvidence::Missing,
            heartbeat: HeartbeatEvidence::MissingAll,
            fatal_install_error: None,
            now_wall_ts: NOW,
            now_monotonic_ms: Some(NOW_MS),
        }
    }

    fn panic_event(wall_ts: u64, message: &str) -> CrashEvent {
        CrashEvent {
            kind: CrashEventKind::Panic,
            summary: format!("panic: {message}"),
            when_label: format!("ts={wall_ts}"),
            wall_ts: Some(wall_ts),
            monotonic_ms: None,
        }
    }

    fn fatal_event(monotonic_ms: u64, message: &str) -> CrashEvent {
        CrashEvent {
            kind: CrashEventKind::FatalSignal,
            summary: message.to_string(),
            when_label: format!("wall time unavailable (fatal monotonic_ms={monotonic_ms})"),
            wall_ts: None,
            monotonic_ms: Some(monotonic_ms),
        }
    }

    fn heartbeat_snapshot() -> HeartbeatSnapshotInput {
        HeartbeatSnapshotInput {
            pid: 123,
            wall_ts: NOW - 5,
            uptime_s: 42,
            process_start_unix_s: Some(NOW - 100),
            last_breadcrumb: Some("transcription:completed".into()),
            rss_kb: Some(12_345),
            recording_state: Some("idle".into()),
            queue_depth: Some(0),
            last_transcription_outcome: Some("ok".into()),
            overlay_backend: Some("webview".into()),
        }
    }

    #[test]
    fn diagnostics_no_crash_history_ok_without_overclaiming() {
        let r = crash_diagnostics_report(&base_input());
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        assert!(r.details.join("; ").contains("no crashes recorded"));
        assert!(r.details.join("; ").contains("local evidence only"));
        assert!(r.details.join("; ").contains("SIGKILL"));
        assert!(r.details.join("; ").contains("fresh install"));
        assert!(r.settings_notice.is_none());
    }

    #[test]
    fn diagnostics_previous_unclean_exit_warns_with_captured_state() {
        let mut input = base_input();
        input.heartbeat = HeartbeatEvidence::Observed(Box::new(HeartbeatObservedInput {
            heartbeat: Some(heartbeat_snapshot()),
            heartbeat_parse_error: false,
            reported_unclean: Some(ReportedUncleanInput {
                reported_at_wall_ts: NOW,
                snapshot: heartbeat_snapshot(),
            }),
            reported_unclean_parse_error: false,
        }));

        let r = crash_diagnostics_report(&input);
        let detail = r.details.join("; ");
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Warn);
        assert!(detail.contains("previous run ended uncleanly"), "{detail}");
        assert!(detail.contains("uptime=42s"), "{detail}");
        assert!(detail.contains("recording_state=idle"), "{detail}");
        assert!(detail.contains("last_breadcrumb=transcription:completed"), "{detail}");
        assert!(r.settings_notice.as_deref().unwrap_or("").contains("previous run ended uncleanly"));
    }

    #[test]
    fn diagnostics_crash_loop_boundary_two_is_informational_three_warns() {
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: vec![panic_event(NOW - 100, "one"), panic_event(NOW - 50, "two")],
            malformed_entries: 0,
        });
        let r = crash_diagnostics_report(&input);
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        assert!(r.details.join("; ").contains("2/3 within 600s"));
        assert!(r.settings_notice.is_none());

        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: vec![
                panic_event(NOW - 120, "one"),
                panic_event(NOW - 60, "two"),
                panic_event(NOW - 1, "three"),
            ],
            malformed_entries: 0,
        });
        let r = crash_diagnostics_report(&input);
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Warn);
        assert!(r.details.join("; ").contains("recent repeated crashes: 3"));
        assert!(r.details.join("; ").contains("threshold 3/600s"));
        assert!(r.settings_notice.as_deref().unwrap_or("").contains("recent repeated crashes: 3"));
    }

    #[test]
    fn diagnostics_crash_loop_ignores_monotonic_only_fatal_timestamps() {
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: vec![
                fatal_event(NOW_MS - 120_000, "fatal signal SIGABRT (6)"),
                fatal_event(NOW_MS - 60_000, "fatal signal SIGABRT (6)"),
                fatal_event(NOW_MS - 1_000, "fatal signal SIGABRT (6)"),
            ],
            malformed_entries: 0,
        });

        let r = crash_diagnostics_report(&input);
        let details = r.details.join("; ");
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        assert!(!details.contains("recent repeated crashes"), "{details}");
        assert!(
            details.contains("wall time unavailable; not counted for recent-loop threshold"),
            "{details}"
        );
    }

    #[test]
    fn diagnostics_fatal_handler_install_failure_warns() {
        let mut input = base_input();
        input.fatal_install_error = Some(FatalInstallErrorInput {
            step: "Sigaction".into(),
            os_error: 22,
        });

        let r = crash_diagnostics_report(&input);
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Warn);
        assert!(r.details.join("; ").contains("crash diagnostics unavailable"));
        assert!(r.details.join("; ").contains("Sigaction"));
    }

    #[test]
    fn diagnostics_old_crash_report_is_informational() {
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: vec![panic_event(NOW - CRASH_LOOP_WINDOW_SECS - 1, "old")],
            malformed_entries: 0,
        });

        let r = crash_diagnostics_report(&input);
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        assert!(r.details.join("; ").contains("last crash report"));
        assert!(r.details.join("; ").contains("outside 600s crash-loop window"));
    }

    #[test]
    fn diagnostics_missing_files_are_informational_never_error() {
        let r = crash_diagnostics_report(&base_input());
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        assert!(r.details.join("; ").contains("heartbeat files missing"));
        assert!(r.settings_notice.is_none());
    }

    #[test]
    fn diagnostics_corrupt_crash_log_and_heartbeat_degrade_without_warning() {
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: Vec::new(),
            malformed_entries: 2,
        });
        input.heartbeat = HeartbeatEvidence::Observed(Box::new(HeartbeatObservedInput {
            heartbeat: None,
            heartbeat_parse_error: true,
            reported_unclean: None,
            reported_unclean_parse_error: true,
        }));

        let r = crash_diagnostics_report(&input);
        assert_eq!(r.severity, CrashDiagnosticsSeverity::Ok);
        let detail = r.details.join("; ");
        assert!(detail.contains("malformed/corrupt"), "{detail}");
        assert!(detail.contains("heartbeat.json corrupt"), "{detail}");
        assert!(detail.contains("heartbeat.crashed.json corrupt"), "{detail}");
    }

    #[test]
    fn diagnostics_heartbeat_fresh_and_stale_are_reported() {
        let mut input = base_input();
        input.heartbeat = HeartbeatEvidence::Observed(Box::new(HeartbeatObservedInput {
            heartbeat: Some(heartbeat_snapshot()),
            heartbeat_parse_error: false,
            reported_unclean: None,
            reported_unclean_parse_error: false,
        }));
        let r = crash_diagnostics_report(&input);
        assert_eq!(r.heartbeat_freshness.as_deref(), Some("fresh age=5s (fresh<=30s)"));

        if let HeartbeatEvidence::Observed(observed) = &mut input.heartbeat {
            observed.heartbeat.as_mut().unwrap().wall_ts = NOW - HEARTBEAT_FRESH_SECS - 1;
        }
        let r = crash_diagnostics_report(&input);
        assert!(r.heartbeat_freshness.as_deref().unwrap_or("").starts_with("stale age=31s"));
    }

    #[test]
    fn diagnostics_parse_crash_log_reads_json_panic_and_fatal_signal_blocks() {
        let text = concat!(
            "{\"panic_message\":\"boom\",\"timestamp\":\"2026-07-27T00:00:00Z\"}\n",
            "\n=== voxis fatal crash ===\n",
            "version: 0.1.1\n",
            "signal: 11 (SIGSEGV)\n",
            "timestamp_ms: 9876\n",
            "breadcrumbs_count: 1\n",
            "breadcrumb: monotonic_ms=12 name=tauri:build_pre\n"
        );

        let parsed = parse_crash_log(text);
        assert_eq!(parsed.malformed_entries, 0);
        assert_eq!(parsed.events.len(), 2);
        assert_eq!(parsed.events[0].kind, CrashEventKind::Panic);
        assert_eq!(parsed.events[0].wall_ts, Some(1_785_110_400));
        assert!(parsed.events[0].summary.contains("message withheld"));
        assert!(!parsed.events[0].summary.contains("boom"));
        assert_eq!(parsed.events[1].kind, CrashEventKind::FatalSignal);
        assert_eq!(parsed.events[1].monotonic_ms, Some(9876));
        assert!(parsed.events[1].summary.contains("SIGSEGV"));
        assert!(parsed.events[1].summary.contains("tauri:build_pre"));
    }

    #[test]
    fn diagnostics_parse_crash_log_counts_malformed_entries_without_panic() {
        let parsed = parse_crash_log("not-json\n{bad json}\n=== voxis fatal crash ===\nversion: x\n");
        assert_eq!(parsed.events.len(), 0);
        assert_eq!(parsed.malformed_entries, 3);
    }

    #[test]
    fn diagnostics_json_panic_payload_is_withheld_from_export_summary() {
        let payload = "fake secret gsk_ADVERSARIAL_SECRET_12345 transcript: private dictated phrase zebra";
        let parsed = parse_crash_log(&format!(
            "{{\"panic_message\":\"{payload}\",\"timestamp\":\"2026-07-27T00:00:00Z\"}}\n"
        ));
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(parsed);

        let report = crash_diagnostics_report(&input);
        let exported = format!(
            "{}\n{}\n{}",
            serde_json::to_string(&report).unwrap(),
            render_report_text(&report),
            report.details.join("\n")
        );

        assert!(!exported.contains("gsk_ADVERSARIAL_SECRET_12345"), "{exported}");
        assert!(!exported.contains("private dictated phrase zebra"), "{exported}");
        assert!(!exported.contains("fake secret"), "{exported}");
        assert!(exported.contains("message withheld"), "{exported}");
    }

    #[test]
    fn diagnostics_redacts_secret_like_strings_and_home_paths() {
        let dirty = "panic: api_key=gsk_SUPER_SECRET_12345 token:sk-SECRETSECRETSECRET path=/home/alice/.config/voxis/crash.log C:\\Users\\Alice\\voxis";
        let clean = redact_sensitive_text(dirty);
        assert!(!clean.contains("gsk_SUPER_SECRET_12345"), "{clean}");
        assert!(!clean.contains("sk-SECRETSECRETSECRET"), "{clean}");
        assert!(!clean.contains("/home/alice"), "{clean}");
        assert!(!clean.contains("C:\\Users\\Alice"), "{clean}");
        assert!(clean.contains("api_key=[REDACTED]"), "{clean}");
        assert!(clean.contains("/home/[REDACTED]/.config/voxis/crash.log"), "{clean}");
    }

    #[test]
    fn diagnostics_redacts_spaced_secret_assignment_values() {
        let dirty = concat!(
            "api_key = someProviderKey ",
            "api_key= anotherProviderKey ",
            "api_key =thirdProviderKey ",
            "password: hunter2 ",
            "token : bearerToken ",
            "model = whisper-large-v3"
        );
        let clean = redact_sensitive_text(dirty);

        for leaked in [
            "someProviderKey",
            "anotherProviderKey",
            "thirdProviderKey",
            "hunter2",
            "bearerToken",
        ] {
            assert!(!clean.contains(leaked), "{clean}");
        }
        assert!(clean.contains("api_key = [REDACTED]"), "{clean}");
        assert!(clean.contains("api_key= [REDACTED]"), "{clean}");
        assert!(clean.contains("api_key =[REDACTED]"), "{clean}");
        assert!(clean.contains("password: [REDACTED]"), "{clean}");
        assert!(clean.contains("token : [REDACTED]"), "{clean}");
        assert!(clean.contains("model = whisper-large-v3"), "{clean}");
    }

    #[test]
    fn diagnostics_rendered_export_does_not_leak_injected_secret_summary() {
        let mut input = base_input();
        input.crash_log = CrashLogEvidence::Present(ParsedCrashLog {
            events: vec![panic_event(NOW - 1, "api_key=gsk_LEAK_LEAK_LEAK token=sk-LEAKLEAKLEAK")],
            malformed_entries: 0,
        });
        let report = crash_diagnostics_report(&input);
        let text = render_report_text(&report);
        assert!(!text.contains("gsk_LEAK_LEAK_LEAK"), "{text}");
        assert!(!text.contains("sk-LEAKLEAKLEAK"), "{text}");
        assert!(text.contains("[REDACTED]"), "{text}");
    }
}
