//! `EventSink` \u2014 the injectable seam between the pipeline (`pipeline.rs`)
//! and however events actually reach the frontend. Task 3 had no event
//! emission at all (the stub pipeline never emitted `voxis://state`/
//! `voxis://level`/`voxis://result`); Task 3b's pipeline needs to emit
//! all three from code that is unit-tested with **no Tauri runtime**
//! (`[ADO-2/3 minors]`, "for 3b: injectable emitter for events") \u2014 a
//! hard `AppHandle::emit` call in `pipeline.rs` would make every guard/
//! lease/pipeline test require a running Tauri app just to observe which
//! events fired.

use serde_json::Value;
use std::sync::Mutex;

/// Emits one of the plugin's three events (`voxis://state`/`voxis://level`/
/// `voxis://result`, `models::{STATE_EVENT,LEVEL_EVENT,RESULT_EVENT}`) to
/// whatever is actually listening. `Send + Sync` so it can live behind an
/// `Arc<dyn EventSink>` in `PluginState` and be cloned into a spawned
/// pipeline task (`pipeline::spawn`) with no lifetime tied to the
/// triggering command invocation.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

/// Production implementation: `AppHandle::emit` broadcasts to every
/// window in the host app (there's exactly one dictation session/overlay
/// surface at a time by design, so "all windows" rather than a specific
/// target is the right default \u2014 same as `tauri-plugin-lifecycle`/
/// `tauri-plugin-capture` in the naked host).
pub struct TauriEventSink<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriEventSink<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: tauri::Runtime> EventSink for TauriEventSink<R> {
    fn emit(&self, event: &str, payload: Value) {
        use tauri::Emitter;
        if let Err(e) = self.app.emit(event, payload) {
            tracing::warn!(event, error = %e, "EventSink: failed to emit plugin event to host windows");
        }
    }
}

/// Test double: records every `emit` call in order instead of touching
/// any runtime, so pipeline/lease/guard tests can assert exactly which
/// events fired (and in what order/how many times) with a plain
/// `RecordingSink::new()` \u2014 no `tauri::test` harness needed.
#[derive(Default)]
pub struct RecordingSink {
    events: Mutex<Vec<(String, Value)>>,
}

impl RecordingSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every `(event, payload)` recorded so far, in emission order.
    pub fn events(&self) -> Vec<(String, Value)> {
        self.events.lock().unwrap().clone()
    }

    /// The most recently emitted payload for `event`, if any.
    pub fn last(&self, event: &str) -> Option<Value> {
        self.events.lock().unwrap().iter().rev().find(|(name, _)| name == event).map(|(_, v)| v.clone())
    }

    /// How many times `event` has been emitted so far.
    pub fn count(&self, event: &str) -> usize {
        self.events.lock().unwrap().iter().filter(|(name, _)| name == event).count()
    }
}

impl EventSink for RecordingSink {
    fn emit(&self, event: &str, payload: Value) {
        self.events.lock().unwrap().push((event.to_string(), payload));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_sink_records_events_in_order() {
        let sink = RecordingSink::new();
        sink.emit("voxis://state", serde_json::json!("recording"));
        sink.emit("voxis://level", serde_json::json!({"rms": 0.1}));
        sink.emit("voxis://state", serde_json::json!("idle"));

        let events = sink.events();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].0, "voxis://state");
        assert_eq!(events[2].1, serde_json::json!("idle"));
        assert_eq!(sink.count("voxis://state"), 2);
        assert_eq!(sink.last("voxis://state"), Some(serde_json::json!("idle")));
        assert_eq!(sink.last("voxis://result"), None);
    }
}
