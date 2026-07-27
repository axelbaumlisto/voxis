//! Crash diagnostics primitives.
//!
//! Task 3 adds the in-memory breadcrumbs that later diagnostics tasks can flush
//! from fatal-signal handlers or heartbeat snapshots.

pub mod breadcrumbs;
