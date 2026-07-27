//! Lock-free in-memory breadcrumbs for crash diagnostics.
//!
//! Origin: adapted from Clipshot's proven two-tier crash-diagnostics design
//! (`/home/sham/work/clipshot/src/diagnostics/breadcrumbs.rs`, Task 3 of
//! `2026-07-27-always-on-crash-diagnostics.md`). Keep this note so future fixes
//! in either repository can be mirrored deliberately instead of rediscovered.
//!
//! The fatal-signal handler added by a later task must be able to read these
//! records while the process is dying. For that reason the read API uses only
//! caller-provided storage and atomic loads; it never takes a lock, never
//! formats, and never allocates. Writes store only `&'static str` pointer+length
//! pairs and a timestamp.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

/// One-shot lifecycle milestone slots. Sticky breadcrumbs saturate and never
/// wrap, so startup breadcrumbs cannot be evicted by recurring activity.
pub const STICKY_BREADCRUMB_CAPACITY: usize = 16;

/// Recent recurring activity slots. Rolling breadcrumbs wrap as a ring.
pub const ROLLING_BREADCRUMB_CAPACITY: usize = 64;

/// Minimum interval for recurring production call sites.
pub const ROLLING_RATE_LIMIT_MS: u64 = 60_000;

/// One breadcrumb record copied out of the two-tier store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BreadcrumbRecord {
    pub monotonic_ms: u64,
    pub name: &'static str,
}

impl BreadcrumbRecord {
    pub const EMPTY: Self = Self {
        monotonic_ms: 0,
        name: "",
    };
}

struct BreadcrumbSlot {
    /// Published sequence: `0` means empty; odd means a writer is in progress;
    /// even means a committed record. Rolling slots use `sequence / 2` as the
    /// record sequence. Sticky slots use `index + 1` as the record sequence.
    sequence: AtomicU64,
    monotonic_ms: AtomicU64,
    name_ptr: AtomicUsize,
    name_len: AtomicUsize,
}

impl BreadcrumbSlot {
    const fn new() -> Self {
        Self {
            sequence: AtomicU64::new(0),
            monotonic_ms: AtomicU64::new(0),
            name_ptr: AtomicUsize::new(0),
            name_len: AtomicUsize::new(0),
        }
    }
}

fn publish_slot(
    slot: &BreadcrumbSlot,
    record_sequence: u64,
    monotonic_ms: u64,
    name: &'static str,
) {
    let in_progress = record_sequence.saturating_mul(2).saturating_sub(1);
    let committed = record_sequence.saturating_mul(2);

    slot.sequence.store(in_progress, Ordering::Release);
    slot.monotonic_ms.store(monotonic_ms, Ordering::Relaxed);
    slot.name_ptr
        .store(name.as_ptr() as usize, Ordering::Relaxed);
    slot.name_len.store(name.len(), Ordering::Relaxed);
    slot.sequence.store(committed, Ordering::Release);
}

fn try_read_committed_slot(slot: &BreadcrumbSlot, expected_sequence: u64) -> Option<BreadcrumbRecord> {
    let before = slot.sequence.load(Ordering::Acquire);
    if before != expected_sequence {
        return None;
    }

    let monotonic_ms = slot.monotonic_ms.load(Ordering::Relaxed);
    let name_ptr = slot.name_ptr.load(Ordering::Relaxed);
    let name_len = slot.name_len.load(Ordering::Relaxed);

    let after = slot.sequence.load(Ordering::Acquire);
    if after != before || name_ptr == 0 {
        return None;
    }

    // SAFETY: Writers accept only `&'static str` values and publish pointer and
    // length atomically before the `Release` store to `sequence`. The double
    // sequence check above rejects slots being concurrently written or
    // overwritten, so the pointer/length pair belongs to one committed static
    // string and remains valid for the life of the process.
    let name = unsafe { static_str_from_parts(name_ptr, name_len) };

    Some(BreadcrumbRecord { monotonic_ms, name })
}

/// Fixed-capacity atomic ring for recurring breadcrumbs.
pub struct RollingBreadcrumbRing<const N: usize> {
    next_sequence: AtomicU64,
    slots: [BreadcrumbSlot; N],
}

impl<const N: usize> RollingBreadcrumbRing<N> {
    pub const fn new() -> Self {
        Self {
            next_sequence: AtomicU64::new(0),
            slots: [const { BreadcrumbSlot::new() }; N],
        }
    }

    /// Push one record into the rolling ring. No allocation; call sites must
    /// pass string literals or other `&'static str` values.
    pub fn push(&self, monotonic_ms: u64, name: &'static str) {
        if N == 0 {
            return;
        }

        let record_sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let slot = &self.slots[(record_sequence as usize - 1) % N];
        publish_slot(slot, record_sequence, monotonic_ms, name);
    }

    /// Copy newest rolling records into `out` in chronological order.
    ///
    /// This method is signal-handler readable: it uses only atomic loads and
    /// caller-provided memory. It may return fewer records than requested if a
    /// writer is concurrently publishing or overwriting a slot.
    pub fn read_recent(&self, out: &mut [BreadcrumbRecord]) -> usize {
        if N == 0 || out.is_empty() {
            return 0;
        }

        let written = self.next_sequence.load(Ordering::Acquire);
        let available = (written as usize).min(N);
        let wanted = out.len().min(available);
        if wanted == 0 {
            return 0;
        }

        let start = written.saturating_sub(wanted as u64).saturating_add(1);
        let mut copied = 0usize;
        for sequence in start..=written {
            if copied >= out.len() {
                break;
            }
            if let Some(record) = self.try_read_sequence(sequence) {
                out[copied] = record;
                copied += 1;
            }
        }
        copied
    }

    fn try_read_sequence(&self, record_sequence: u64) -> Option<BreadcrumbRecord> {
        if record_sequence == 0 || N == 0 {
            return None;
        }
        let slot = &self.slots[(record_sequence as usize - 1) % N];
        let expected = record_sequence.saturating_mul(2);
        try_read_committed_slot(slot, expected)
    }
}

impl<const N: usize> Default for RollingBreadcrumbRing<N> {
    fn default() -> Self {
        Self::new()
    }
}

/// Fixed-capacity append-only store for one-shot lifecycle milestones.
///
/// Sticky breadcrumbs never share slots with recurring breadcrumbs, and this
/// store saturates instead of wrapping. Once a startup milestone is committed,
/// no hotkey/transcription/overlay flood can evict it. Duplicate names are
/// ignored so a repeated milestone cannot consume another slot.
pub struct StickyBreadcrumbStore<const N: usize> {
    next_index: AtomicUsize,
    slots: [BreadcrumbSlot; N],
}

impl<const N: usize> StickyBreadcrumbStore<N> {
    pub const fn new() -> Self {
        Self {
            next_index: AtomicUsize::new(0),
            slots: [const { BreadcrumbSlot::new() }; N],
        }
    }

    /// Push a unique sticky milestone. Duplicate names are ignored.
    pub fn push_unique(&self, monotonic_ms: u64, name: &'static str) {
        if N == 0 || self.contains(name) {
            return;
        }

        let Some(index) = self.reserve_index() else {
            return;
        };
        let slot = &self.slots[index];
        publish_slot(slot, index as u64 + 1, monotonic_ms, name);
    }

    /// Copy sticky milestones into `out`.
    ///
    /// This method is signal-handler readable: it uses only atomic loads and
    /// caller-provided memory. It never retries a torn slot.
    pub fn read_all(&self, out: &mut [BreadcrumbRecord]) -> usize {
        if N == 0 || out.is_empty() {
            return 0;
        }

        let used = self.next_index.load(Ordering::Acquire).min(N);
        let mut copied = 0usize;
        for index in 0..used.min(out.len()) {
            if let Some(record) = self.try_read_index(index) {
                out[copied] = record;
                copied += 1;
            }
        }
        copied
    }

    fn reserve_index(&self) -> Option<usize> {
        loop {
            let index = self.next_index.load(Ordering::Relaxed);
            if index >= N {
                return None;
            }
            if self
                .next_index
                .compare_exchange(index, index + 1, Ordering::AcqRel, Ordering::Relaxed)
                .is_ok()
            {
                return Some(index);
            }
        }
    }

    fn contains(&self, name: &'static str) -> bool {
        let used = self.next_index.load(Ordering::Acquire).min(N);
        for index in 0..used {
            if let Some(record) = self.try_read_index(index) {
                if record.name == name {
                    return true;
                }
            }
        }
        false
    }

    fn try_read_index(&self, index: usize) -> Option<BreadcrumbRecord> {
        if index >= N {
            return None;
        }
        let expected = (index as u64 + 1).saturating_mul(2);
        try_read_committed_slot(&self.slots[index], expected)
    }
}

impl<const N: usize> Default for StickyBreadcrumbStore<N> {
    fn default() -> Self {
        Self::new()
    }
}

/// Two-tier breadcrumb storage: sticky milestones plus a rolling activity ring.
pub struct BreadcrumbStore<const STICKY: usize, const ROLLING: usize> {
    sticky: StickyBreadcrumbStore<STICKY>,
    rolling: RollingBreadcrumbRing<ROLLING>,
}

impl<const STICKY: usize, const ROLLING: usize> BreadcrumbStore<STICKY, ROLLING> {
    pub const fn new() -> Self {
        Self {
            sticky: StickyBreadcrumbStore::new(),
            rolling: RollingBreadcrumbRing::new(),
        }
    }

    pub fn sticky(&self, monotonic_ms: u64, name: &'static str) {
        self.sticky.push_unique(monotonic_ms, name);
    }

    pub fn rolling(&self, monotonic_ms: u64, name: &'static str) {
        self.rolling.push(monotonic_ms, name);
    }

    /// Copy sticky milestones plus newest rolling records into `out`.
    ///
    /// Sticky records are prioritized: they are copied first, and the rolling
    /// tier fills only the remaining caller-provided slots. The populated
    /// prefix is then sorted in-place by monotonic timestamp, so a crash report
    /// gets one coherent chronological view without heap allocation.
    pub fn snapshot(&self, out: &mut [BreadcrumbRecord]) -> usize {
        if out.is_empty() {
            return 0;
        }

        let sticky_count = self.sticky.read_all(out);
        if sticky_count >= out.len() {
            sort_records_chronologically(&mut out[..sticky_count]);
            return sticky_count;
        }

        let rolling_count = self.rolling.read_recent(&mut out[sticky_count..]);
        let total = sticky_count + rolling_count;
        sort_records_chronologically(&mut out[..total]);
        total
    }
}

impl<const STICKY: usize, const ROLLING: usize> Default for BreadcrumbStore<STICKY, ROLLING> {
    fn default() -> Self {
        Self::new()
    }
}

fn sort_records_chronologically(records: &mut [BreadcrumbRecord]) {
    for index in 1..records.len() {
        let record = records[index];
        let mut cursor = index;
        while cursor > 0 && records[cursor - 1].monotonic_ms > record.monotonic_ms {
            records[cursor] = records[cursor - 1];
            cursor -= 1;
        }
        records[cursor] = record;
    }
}

unsafe fn static_str_from_parts(ptr: usize, len: usize) -> &'static str {
    // SAFETY: The caller guarantees `ptr` and `len` came from a single
    // committed `&'static str` and the storage remains valid forever.
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
    // SAFETY: All writers source bytes from Rust `str` values, so the committed
    // byte slice is valid UTF-8.
    unsafe { std::str::from_utf8_unchecked(bytes) }
}

static START_INSTANT: OnceLock<Instant> = OnceLock::new();
static GLOBAL_BREADCRUMBS: BreadcrumbStore<STICKY_BREADCRUMB_CAPACITY, ROLLING_BREADCRUMB_CAPACITY> =
    BreadcrumbStore::new();

/// Initialize the breadcrumb clock baseline. The ring storage itself is static
/// and already pre-allocated; this just pins `monotonic_ms` near process start.
pub fn init() {
    let _ = START_INSTANT.set(Instant::now());
}

/// Milliseconds since the diagnostics clock baseline.
pub fn monotonic_ms_now() -> u64 {
    let start = START_INSTANT.get_or_init(Instant::now);
    start.elapsed().as_millis() as u64
}

/// Record a process-global sticky lifecycle breadcrumb.
pub fn sticky(name: &'static str) {
    GLOBAL_BREADCRUMBS.sticky(monotonic_ms_now(), name);
}

/// Record a process-global rolling activity breadcrumb.
pub fn rolling(name: &'static str) {
    GLOBAL_BREADCRUMBS.rolling(monotonic_ms_now(), name);
}

/// Record a process-global rolling breadcrumb with a caller-supplied timestamp.
pub fn rolling_at(monotonic_ms: u64, name: &'static str) {
    GLOBAL_BREADCRUMBS.rolling(monotonic_ms, name);
}

/// Copy sticky milestones plus newest rolling breadcrumbs in chronological order.
///
/// The caller owns `out`; this API is suitable for a fatal signal handler.
pub fn snapshot(out: &mut [BreadcrumbRecord]) -> usize {
    GLOBAL_BREADCRUMBS.snapshot(out)
}

/// Record no more than once per minute for a specific recurring call site.
///
/// The rate limiter is a caller-owned atomic, so it is lock-free and allocation
/// free. It intentionally uses a 60s floor to keep the 64-slot rolling tier from
/// self-evicting useful recent state in under a minute.
pub fn rolling_rate_limited(last_recorded_ms: &AtomicU64, name: &'static str) {
    let now = monotonic_ms_now();
    let stamp = now.max(1);
    let last = last_recorded_ms.load(Ordering::Relaxed);
    if last != 0 && stamp.saturating_sub(last) < ROLLING_RATE_LIMIT_MS {
        return;
    }
    if last_recorded_ms
        .compare_exchange(last, stamp, Ordering::Relaxed, Ordering::Relaxed)
        .is_ok()
    {
        rolling_at(now, name);
    }
}

/// Named production instrumentation sites. Keeping these as one-line helpers
/// makes call sites coarse and data-free by construction.
pub mod sites {
    use super::{rolling_rate_limited, sticky};
    use std::sync::atomic::AtomicU64;

    static HOTKEY_PRESSED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static HOTKEY_RELEASED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static RECORDING_STARTED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static RECORDING_STOPPED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static TRANSCRIPTION_QUEUED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static TRANSCRIPTION_COMPLETED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static TRANSCRIPTION_FAILED_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static OVERLAY_STATE_LAST_MS: AtomicU64 = AtomicU64::new(0);
    static AUDIO_DEVICE_CHANGED_LAST_MS: AtomicU64 = AtomicU64::new(0);

    pub fn tauri_build_pre() {
        sticky("tauri:build:pre");
    }

    pub fn tauri_build_post() {
        sticky("tauri:build:post");
    }

    pub fn setup_configure_entry() {
        sticky("setup:configure_app:entry");
    }

    pub fn setup_configure_exit() {
        sticky("setup:configure_app:exit");
    }

    pub fn x11_threads_done() {
        sticky("setup:init_x11_threads:done");
    }

    pub fn first_transcription_success() {
        sticky("transcription:first_success");
    }

    pub fn overlay_backend_webview() {
        sticky("overlay:backend:webview");
    }

    pub fn overlay_backend_noop() {
        sticky("overlay:backend:noop");
    }

    pub fn hotkey_pressed() {
        rolling_rate_limited(&HOTKEY_PRESSED_LAST_MS, "hotkey:pressed");
    }

    pub fn hotkey_released() {
        rolling_rate_limited(&HOTKEY_RELEASED_LAST_MS, "hotkey:released");
    }

    pub fn recording_started() {
        rolling_rate_limited(&RECORDING_STARTED_LAST_MS, "recording:started");
    }

    pub fn recording_stopped() {
        rolling_rate_limited(&RECORDING_STOPPED_LAST_MS, "recording:stopped");
    }

    pub fn transcription_queued() {
        rolling_rate_limited(&TRANSCRIPTION_QUEUED_LAST_MS, "transcription:queued");
    }

    pub fn transcription_completed() {
        rolling_rate_limited(&TRANSCRIPTION_COMPLETED_LAST_MS, "transcription:completed");
    }

    pub fn transcription_failed() {
        rolling_rate_limited(&TRANSCRIPTION_FAILED_LAST_MS, "transcription:failed");
    }

    pub fn overlay_state_transition() {
        rolling_rate_limited(&OVERLAY_STATE_LAST_MS, "overlay:state_transition");
    }

    pub fn audio_device_changed_if(changed: bool) {
        if changed {
            rolling_rate_limited(&AUDIO_DEVICE_CHANGED_LAST_MS, "audio:device_changed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn breadcrumb_empty_snapshot_is_safe() {
        let store = BreadcrumbStore::<4, 4>::new();
        let mut out = [BreadcrumbRecord::EMPTY; 4];

        let count = store.snapshot(&mut out);

        assert_eq!(count, 0);
        assert_eq!(out, [BreadcrumbRecord::EMPTY; 4]);
    }

    #[test]
    fn breadcrumb_wraparound_drops_oldest_and_keeps_newest_chronological() {
        let ring = RollingBreadcrumbRing::<4>::new();
        for (time, name) in [
            (0, "event-0"),
            (1, "event-1"),
            (2, "event-2"),
            (3, "event-3"),
            (4, "event-4"),
            (5, "event-5"),
        ] {
            ring.push(time, name);
        }
        let mut out = [BreadcrumbRecord::EMPTY; 4];

        let count = ring.read_recent(&mut out);

        assert_eq!(count, 4);
        assert_eq!(out.map(|record| record.name), ["event-2", "event-3", "event-4", "event-5"]);
        assert_eq!(out.map(|record| record.monotonic_ms), [2, 3, 4, 5]);
    }

    #[test]
    fn breadcrumb_newest_n_returned_chronologically() {
        let ring = RollingBreadcrumbRing::<8>::new();
        for (time, name) in [
            (0, "event-0"),
            (1, "event-1"),
            (2, "event-2"),
            (3, "event-3"),
            (4, "event-4"),
            (5, "event-5"),
        ] {
            ring.push(time, name);
        }
        let mut out = [BreadcrumbRecord::EMPTY; 3];

        let count = ring.read_recent(&mut out);

        assert_eq!(count, 3);
        assert_eq!(out.map(|record| record.monotonic_ms), [3, 4, 5]);
        assert_eq!(out.map(|record| record.name), ["event-3", "event-4", "event-5"]);
    }

    #[test]
    fn breadcrumb_capacity_bounds_hold_for_both_tiers() {
        let store = BreadcrumbStore::<2, 3>::new();
        store.sticky(1, "sticky-1");
        store.sticky(2, "sticky-2");
        store.sticky(3, "sticky-dropped-1");
        store.sticky(4, "sticky-dropped-2");
        for (time, name) in [
            (10, "rolling-0"),
            (11, "rolling-1"),
            (12, "rolling-2"),
            (13, "rolling-3"),
            (14, "rolling-4"),
        ] {
            store.rolling(time, name);
        }
        let mut out = [BreadcrumbRecord::EMPTY; 16];

        let count = store.snapshot(&mut out);

        assert_eq!(count, 5);
        assert!(count <= 2 + 3);
        assert_eq!(
            out[..count].iter().map(|record| record.name).collect::<Vec<_>>(),
            ["sticky-1", "sticky-2", "rolling-2", "rolling-3", "rolling-4"]
        );
    }

    #[test]
    fn breadcrumb_sticky_milestone_survives_recurring_flood() {
        let store = BreadcrumbStore::<2, 4>::new();
        store.sticky(1, "tauri:build:pre");
        for offset in 0..100 {
            store.rolling(10 + offset, "hotkey:pressed");
        }
        let mut out = [BreadcrumbRecord::EMPTY; 5];

        let count = store.snapshot(&mut out);

        assert_eq!(count, 5);
        assert_eq!(out[0].name, "tauri:build:pre");
        assert_eq!(
            [
                out[1].monotonic_ms,
                out[2].monotonic_ms,
                out[3].monotonic_ms,
                out[4].monotonic_ms,
            ],
            [106, 107, 108, 109]
        );
    }

    #[test]
    fn breadcrumb_multi_thread_writes_do_not_corrupt_slots() {
        const THREADS: usize = 8;
        const PER_THREAD: usize = 256;
        let ring = Arc::new(RollingBreadcrumbRing::<64>::new());
        let mut handles = Vec::new();

        for thread_id in 0..THREADS {
            let ring = Arc::clone(&ring);
            handles.push(thread::spawn(move || {
                let name = match thread_id {
                    0 => "thread-0",
                    1 => "thread-1",
                    2 => "thread-2",
                    3 => "thread-3",
                    4 => "thread-4",
                    5 => "thread-5",
                    6 => "thread-6",
                    _ => "thread-7",
                };
                for item in 0..PER_THREAD {
                    let monotonic_ms = (thread_id * PER_THREAD + item) as u64;
                    ring.push(monotonic_ms, name);
                }
            }));
        }

        for handle in handles {
            handle.join().expect("writer thread panicked");
        }

        let mut out = [BreadcrumbRecord::EMPTY; 64];
        let count = ring.read_recent(&mut out);

        assert_eq!(count, 64);
        let mut seen_times = HashSet::new();
        for record in &out[..count] {
            assert!(record.name.starts_with("thread-"));
            assert!(seen_times.insert(record.monotonic_ms), "duplicate/torn slot: {record:?}");
        }
    }

    #[test]
    fn breadcrumb_dedup_same_sticky_consumes_one_slot() {
        let store = BreadcrumbStore::<2, 2>::new();
        store.sticky(1, "setup:configure_app:entry");
        store.sticky(2, "setup:configure_app:entry");
        store.sticky(3, "setup:configure_app:exit");
        store.sticky(4, "tauri:build:post");
        let mut out = [BreadcrumbRecord::EMPTY; 4];

        let count = store.snapshot(&mut out);

        assert_eq!(count, 2);
        assert_eq!(out[0].name, "setup:configure_app:entry");
        assert_eq!(out[1].name, "setup:configure_app:exit");
    }

    #[test]
    fn breadcrumb_sticky_and_rolling_merge_chronologically() {
        let store = BreadcrumbStore::<4, 4>::new();
        store.rolling(10, "rolling:before-sticky");
        store.sticky(20, "sticky:middle");
        store.rolling(30, "rolling:after-sticky");
        let mut out = [BreadcrumbRecord::EMPTY; 4];

        let count = store.snapshot(&mut out);

        assert_eq!(count, 3);
        assert_eq!(
            [out[0].monotonic_ms, out[1].monotonic_ms, out[2].monotonic_ms],
            [10, 20, 30]
        );
        assert_eq!(
            [out[0].name, out[1].name, out[2].name],
            ["rolling:before-sticky", "sticky:middle", "rolling:after-sticky"]
        );
    }
}
