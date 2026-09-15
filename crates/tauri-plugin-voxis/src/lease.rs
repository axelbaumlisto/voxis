//! Hold-mode heartbeat lease (`[R1-Safety S4 / R2-Coherence F-lease]`):
//! guest-js sends `hold_lease(id)` at 1 Hz while the hold-to-talk trigger
//! is held; 3 missed heartbeats \u2014 no `hold_lease` call for
//! `LEASE_TIMEOUT` \u2014 means the webview (or the hotkey listener inside
//! it) is gone (WebKit process died, tab navigated away, `on_page_load`)
//! with nothing left to ever call `stop()`, so `pipeline.rs`'s
//! Recording-phase loop must notice on its own and finalize as
//! `LeaseLost`.
//!
//! **Per-session, not global** (`[R2-Coherence F-lease]`, "no ABA across
//! rapid hold-release-hold"): a `LeaseTracker` is created fresh by
//! `pipeline::spawn` for each session and lives only inside that
//! session's own Recording-phase task \u2014 there is no shared/global timer
//! that could carry stale state from a session that already ended into
//! a new one. Toggle-mode sessions never get one (`pipeline::spawn` only
//! constructs a tracker for `Mode::Hold`) \u2014 "Toggle mode has no lease".

use tokio::time::{Duration, Instant};

/// `hold_lease` is expected once per this interval while a Hold session
/// is active.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);

/// How many consecutive missed heartbeats before the lease is
/// considered lost.
pub const MISSED_HEARTBEATS_LIMIT: u32 = 3;

/// `HEARTBEAT_INTERVAL * MISSED_HEARTBEATS_LIMIT` \u2014 the absolute
/// silence-from-`hold_lease` duration that means the lease is lost.
pub const LEASE_TIMEOUT: Duration = Duration::from_secs(MISSED_HEARTBEATS_LIMIT as u64);

/// Tracks the most recent heartbeat for one Hold-mode session.
/// `pipeline.rs`'s guard-poll loop calls `is_lost` once per 250 ms tick;
/// `commands::do_hold_lease` calls `heartbeat` from a separate command
/// invocation \u2014 both go through the same `Arc<std::sync::Mutex<..>>`
/// (see `session::SessionHandles::lease`), so this type itself carries
/// no synchronization of its own.
pub struct LeaseTracker {
    last_heartbeat: Instant,
}

impl LeaseTracker {
    /// A fresh tracker whose clock starts now \u2014 `start()` counts as the
    /// first heartbeat so a Hold session isn't already 3 s from losing
    /// its lease before the first real `hold_lease` call ever arrives.
    pub fn new(now: Instant) -> Self {
        Self { last_heartbeat: now }
    }

    pub fn heartbeat(&mut self, now: Instant) {
        self.last_heartbeat = now;
    }

    /// `true` once `LEASE_TIMEOUT` has elapsed since the last heartbeat.
    /// `saturating_duration_since` so a heartbeat that (in a real clock,
    /// never under `tokio::time::pause`) lands a hair after `now` can't
    /// underflow into a bogus "lost" reading.
    pub fn is_lost(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.last_heartbeat) >= LEASE_TIMEOUT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn fresh_tracker_is_not_lost_immediately() {
        let tracker = LeaseTracker::new(Instant::now());
        assert!(!tracker.is_lost(Instant::now()));
    }

    #[tokio::test(start_paused = true)]
    async fn tracker_is_lost_after_the_full_timeout_with_no_heartbeat() {
        let tracker = LeaseTracker::new(Instant::now());
        tokio::time::advance(LEASE_TIMEOUT - Duration::from_millis(1)).await;
        assert!(!tracker.is_lost(Instant::now()), "must not fire a hair before the timeout");
        tokio::time::advance(Duration::from_millis(1)).await;
        assert!(tracker.is_lost(Instant::now()));
    }

    #[tokio::test(start_paused = true)]
    async fn heartbeat_resets_the_deadline() {
        let mut tracker = LeaseTracker::new(Instant::now());
        tokio::time::advance(Duration::from_millis(2_900)).await;
        tracker.heartbeat(Instant::now());
        tokio::time::advance(Duration::from_millis(2_900)).await;
        assert!(!tracker.is_lost(Instant::now()), "the heartbeat at 2.9s must have reset the 3s window");
    }
}
