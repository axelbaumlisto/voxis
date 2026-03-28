# Transcription Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to retry failed transcriptions via UI with stored audio.

**Architecture:** FIFO queue of up to 3 failed transcriptions stored as `.wav` + `.json` pairs in config dir. Frontend displays cards with retry/dismiss buttons. Retry re-sends audio to same provider.

**Tech Stack:** Rust (storage + commands), React (hook + UI), Tauri events

---

## Task 1: FailedAudioStorage Rust Module

**Files:**
- Create: `src-tauri/src/storage/failed_audio.rs`
- Modify: `src-tauri/src/storage/mod.rs`

**Step 1: Write the failing test**

```rust
// In src-tauri/src/storage/failed_audio.rs
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_save_and_list() {
        let temp = TempDir::new().unwrap();
        let storage = FailedAudioStorage::new(temp.path());

        let id = storage.save(b"audio data", "API error", None, "groq").unwrap();
        assert_eq!(id, "001");

        let items = storage.list().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].error, "API error");
        assert_eq!(items[0].provider, "groq");
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_save_and_list`
Expected: FAIL - module doesn't exist

**Step 3: Write minimal implementation**

```rust
// src-tauri/src/storage/failed_audio.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedTranscription {
    pub id: String,
    pub error: String,
    pub whisper_text: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub provider: String,
}

pub struct FailedAudioStorage {
    dir: PathBuf,
}

impl FailedAudioStorage {
    pub fn new(config_dir: &Path) -> Self {
        let dir = config_dir.join("failed_audio");
        fs::create_dir_all(&dir).ok();
        Self { dir }
    }

    fn audio_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.wav", id))
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.json", id))
    }

    fn next_id(&self) -> String {
        for i in 1..=MAX_ENTRIES {
            let id = format!("{:03}", i);
            if !self.meta_path(&id).exists() {
                return id;
            }
        }
        // All slots full - rotate
        self.rotate();
        format!("{:03}", MAX_ENTRIES)
    }

    fn rotate(&self) {
        // Delete 001, shift 002->001, 003->002
        let _ = fs::remove_file(self.audio_path("001"));
        let _ = fs::remove_file(self.meta_path("001"));

        for i in 2..=MAX_ENTRIES {
            let old_id = format!("{:03}", i);
            let new_id = format!("{:03}", i - 1);
            let _ = fs::rename(self.audio_path(&old_id), self.audio_path(&new_id));
            let _ = fs::rename(self.meta_path(&old_id), self.meta_path(&new_id));
        }
    }

    pub fn save(
        &self,
        audio: &[u8],
        error: &str,
        whisper_text: Option<&str>,
        provider: &str,
    ) -> Result<String, String> {
        let id = self.next_id();

        fs::write(self.audio_path(&id), audio)
            .map_err(|e| format!("Failed to save audio: {}", e))?;

        let meta = FailedTranscription {
            id: id.clone(),
            error: error.to_string(),
            whisper_text: whisper_text.map(String::from),
            timestamp: Utc::now(),
            provider: provider.to_string(),
        };

        let json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        fs::write(self.meta_path(&id), json)
            .map_err(|e| format!("Failed to save metadata: {}", e))?;

        Ok(id)
    }

    pub fn list(&self) -> Result<Vec<FailedTranscription>, String> {
        let mut items = Vec::new();
        for i in 1..=MAX_ENTRIES {
            let id = format!("{:03}", i);
            let meta_path = self.meta_path(&id);
            if meta_path.exists() {
                let json = fs::read_to_string(&meta_path)
                    .map_err(|e| format!("Failed to read {}: {}", id, e))?;
                let meta: FailedTranscription = serde_json::from_str(&json)
                    .map_err(|e| format!("Failed to parse {}: {}", id, e))?;
                items.push(meta);
            }
        }
        Ok(items)
    }

    pub fn get_audio(&self, id: &str) -> Result<Vec<u8>, String> {
        fs::read(self.audio_path(id))
            .map_err(|e| format!("Failed to read audio {}: {}", id, e))
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _ = fs::remove_file(self.audio_path(id));
        let _ = fs::remove_file(self.meta_path(id));
        Ok(())
    }
}
```

**Step 4: Add module to mod.rs**

Add to `src-tauri/src/storage/mod.rs`:
```rust
pub mod failed_audio;
pub use failed_audio::{FailedAudioStorage, FailedTranscription};
```

**Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test test_save_and_list`
Expected: PASS

**Step 6: Write rotation test**

```rust
#[test]
fn test_rotation() {
    let temp = TempDir::new().unwrap();
    let storage = FailedAudioStorage::new(temp.path());

    storage.save(b"audio1", "error1", None, "groq").unwrap();
    storage.save(b"audio2", "error2", None, "groq").unwrap();
    storage.save(b"audio3", "error3", None, "groq").unwrap();
    storage.save(b"audio4", "error4", None, "groq").unwrap(); // triggers rotation

    let items = storage.list().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0].error, "error2"); // 001 was error1, now error2
    assert_eq!(items[2].error, "error4"); // newest
}
```

**Step 7: Run test**

Run: `cd src-tauri && cargo test test_rotation`
Expected: PASS

**Step 8: Commit**

```bash
git add src-tauri/src/storage/failed_audio.rs src-tauri/src/storage/mod.rs
git commit -m "feat: add FailedAudioStorage for retry functionality"
```

---

## Task 2: Tauri Commands for Failed Transcriptions

**Files:**
- Create: `src-tauri/src/commands/failed.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/setup.rs` (register commands)

**Step 1: Create commands module**

```rust
// src-tauri/src/commands/failed.rs
use crate::storage::{AppPaths, FailedAudioStorage, FailedTranscription};
use tauri::State;

#[tauri::command]
pub fn get_failed_transcriptions(
    paths: State<'_, AppPaths>,
) -> Result<Vec<FailedTranscription>, String> {
    let storage = FailedAudioStorage::new(paths.config_dir());
    storage.list()
}

#[tauri::command]
pub fn dismiss_failed_transcription(
    id: String,
    paths: State<'_, AppPaths>,
) -> Result<(), String> {
    let storage = FailedAudioStorage::new(paths.config_dir());
    storage.remove(&id)
}
```

**Step 2: Add to commands/mod.rs**

```rust
pub mod failed;
```

**Step 3: Register in setup.rs**

Add to `command_handler()` in setup.rs:
```rust
commands::failed::get_failed_transcriptions,
commands::failed::dismiss_failed_transcription,
```

**Step 4: Run cargo check**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 5: Commit**

```bash
git add src-tauri/src/commands/failed.rs src-tauri/src/commands/mod.rs src-tauri/src/setup.rs
git commit -m "feat: add commands for failed transcriptions"
```

---

## Task 3: Integration - Save Failed Transcriptions

**Files:**
- Modify: `src-tauri/src/orchestrator/transcription.rs`
- Modify: `src-tauri/src/orchestrator/mod.rs` (add audio to context)

**Step 1: Add audio_data to TranscriptionContext**

In `src-tauri/src/orchestrator/mod.rs`, update `TranscriptionContext`:
```rust
pub struct TranscriptionContext {
    pub app: AppHandle,
    pub state: Arc<Mutex<RecordingState>>,
    pub overlay: Arc<Mutex<Box<dyn OverlayBackend>>>,
    pub audio_data: Vec<u8>,  // ADD THIS
}
```

**Step 2: Pass audio_data when creating context**

Update where `TranscriptionContext` is created to include `audio_data: audio_data.clone()`.

**Step 3: Save on transcription error**

In `transcription.rs`, in the error branch of `run_transcription()`:
```rust
Err(e) => {
    // Save for retry
    if let Ok(paths) = ctx.app.try_state::<AppPaths>() {
        let storage = FailedAudioStorage::new(paths.config_dir());
        let _ = storage.save(&ctx.audio_data, &e, None, &config.transcription_provider);
        let _ = ctx.app.emit("failed-transcriptions-updated", ());
    }
    handle_transcription_error(&ctx, &e, false).await;
    return;
}
```

**Step 4: Add import**

```rust
use crate::storage::{AppPaths, FailedAudioStorage};
```

**Step 5: Run cargo check**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 6: Commit**

```bash
git add src-tauri/src/orchestrator/
git commit -m "feat: save failed transcriptions for retry"
```

---

## Task 4: Retry Command

**Files:**
- Modify: `src-tauri/src/commands/failed.rs`

**Step 1: Add retry_transcription command**

```rust
use crate::config::AppConfig;
use crate::orchestrator::transcription::run_transcription;
use crate::storage::{AppPaths, FailedAudioStorage, HistorySqliteStorage, HistoryEntry};
use tauri::{AppHandle, State};
use chrono::Utc;

#[tauri::command]
pub async fn retry_transcription(
    id: String,
    app: AppHandle,
    paths: State<'_, AppPaths>,
) -> Result<String, String> {
    let storage = FailedAudioStorage::new(paths.config_dir());

    // Get metadata and audio
    let items = storage.list()?;
    let meta = items.iter().find(|i| i.id == id)
        .ok_or("Failed transcription not found")?;
    let audio = storage.get_audio(&id)?;

    // Load config
    let config_storage = crate::storage::ConfigSqliteStorage::new(paths.config_db());
    let config: AppConfig = config_storage.load().unwrap_or_default();

    // Retry transcription
    let result = run_transcription(&config, audio).await?;

    // Success - add to history
    let history = HistorySqliteStorage::new(paths.history_db())?;
    let entry = HistoryEntry {
        id: 0,
        text: result.text.clone(),
        timestamp: Utc::now(),
        audio_file: None,
        language: result.language,
    };
    history.add_entry(&entry).map_err(|e| e.to_string())?;

    // Remove from failed
    storage.remove(&id)?;

    // Emit events
    let _ = app.emit("failed-transcriptions-updated", ());
    let _ = app.emit("history-updated", ());
    let _ = app.emit("transcription", &result.text);

    Ok(result.text)
}
```

**Step 2: Register command in setup.rs**

Add to `command_handler()`:
```rust
commands::failed::retry_transcription,
```

**Step 3: Run cargo check**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 4: Commit**

```bash
git add src-tauri/src/commands/failed.rs src-tauri/src/setup.rs
git commit -m "feat: add retry_transcription command"
```

---

## Task 5: Frontend - Commands and Hook

**Files:**
- Modify: `src/lib/commands.ts`
- Create: `src/hooks/useFailedTranscriptions.ts`

**Step 1: Add commands to commands.ts**

```typescript
export interface FailedTranscription {
  id: string;
  error: string;
  whisper_text: string | null;
  timestamp: string;
  provider: string;
}

export async function getFailedTranscriptions(): Promise<FailedTranscription[]> {
  return invoke<FailedTranscription[]>("get_failed_transcriptions");
}

export async function retryTranscription(id: string): Promise<string> {
  return invoke<string>("retry_transcription", { id });
}

export async function dismissFailedTranscription(id: string): Promise<void> {
  return invoke<void>("dismiss_failed_transcription", { id });
}
```

**Step 2: Create hook**

```typescript
// src/hooks/useFailedTranscriptions.ts
import { useState, useCallback, useEffect } from "react";
import {
  getFailedTranscriptions,
  retryTranscription,
  dismissFailedTranscription,
  FailedTranscription,
} from "../lib/commands";
import { useTauriEvent } from "./useTauriEvent";

export function useFailedTranscriptions() {
  const [items, setItems] = useState<FailedTranscription[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getFailedTranscriptions();
      setItems(data);
    } catch (e) {
      console.error("Failed to load failed transcriptions:", e);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Listen for updates
  useTauriEvent("failed-transcriptions-updated", refresh);

  const retry = useCallback(async (id: string) => {
    setRetrying(id);
    try {
      await retryTranscription(id);
    } catch (e) {
      console.error("Retry failed:", e);
    } finally {
      setRetrying(null);
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      await dismissFailedTranscription(id);
      await refresh();
    } catch (e) {
      console.error("Dismiss failed:", e);
    }
  }, [refresh]);

  return { items, retry, dismiss, retrying };
}
```

**Step 3: Run frontend build check**

Run: `bun run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/lib/commands.ts src/hooks/useFailedTranscriptions.ts
git commit -m "feat: add useFailedTranscriptions hook"
```

---

## Task 6: Frontend - UI Component

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/styles/home.css`

**Step 1: Import hook in HomePage**

```typescript
import { useFailedTranscriptions } from "../hooks/useFailedTranscriptions";
```

**Step 2: Use hook and render cards**

After existing error card, add:
```tsx
const { items: failedItems, retry, dismiss, retrying } = useFailedTranscriptions();

// In JSX, after error-card:
{failedItems.map((item) => (
  <div className="failed-transcription-card" key={item.id}>
    <p className="error-text">{item.error}</p>
    {item.whisper_text && (
      <p className="whisper-text">{item.whisper_text}</p>
    )}
    <div className="failed-actions">
      <button
        onClick={() => retry(item.id)}
        disabled={retrying === item.id}
      >
        {retrying === item.id ? "Retrying..." : "Try Again"}
      </button>
      <button onClick={() => dismiss(item.id)} className="dismiss">
        Dismiss
      </button>
    </div>
  </div>
))}
```

**Step 3: Add styles**

```css
/* src/styles/home.css */
.failed-transcription-card {
  background: var(--card-background);
  border: 1px solid var(--error-color);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
}

.failed-transcription-card .error-text {
  color: var(--error-color);
  margin: 0 0 8px 0;
  font-size: 0.9rem;
}

.failed-transcription-card .whisper-text {
  color: var(--text-muted);
  margin: 0 0 12px 0;
  font-style: italic;
  font-size: 0.85rem;
}

.failed-actions {
  display: flex;
  gap: 8px;
}

.failed-actions button {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
}

.failed-actions button:first-child {
  background: var(--primary-color);
  color: white;
  border: none;
}

.failed-actions button.dismiss {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.failed-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

**Step 4: Run dev and verify visually**

Run: `bun run tauri dev`
Expected: Cards appear when transcription fails

**Step 5: Commit**

```bash
git add src/pages/HomePage.tsx src/styles/home.css
git commit -m "feat: add failed transcription retry UI"
```

---

## Task 7: Final Testing

**Step 1: Run all Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All pass

**Step 2: Run frontend tests**

Run: `bun run test:run`
Expected: All pass

**Step 3: Manual test**

1. Disconnect network
2. Record and release hotkey
3. Verify error card appears with "Try Again"
4. Reconnect network
5. Click "Try Again"
6. Verify text appears in history

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete transcription retry functionality"
```
