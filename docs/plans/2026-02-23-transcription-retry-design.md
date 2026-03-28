# Transcription Retry Feature

## Overview

When transcription fails (API error, timeout, etc.), save the audio and allow user to retry.

## Storage

Location: `~/.config/soupawhisper/failed_audio/`

```
failed_audio/
├── 001.wav
├── 001.json   # metadata
├── 002.wav
├── 002.json
├── 003.wav
└── 003.json
```

**Metadata (JSON):**
```json
{
  "error": "API timeout",
  "whisper_text": "partial text if any",
  "timestamp": "2026-02-23T15:30:00Z",
  "provider": "groq"
}
```

**Rotation:** FIFO, max 3 entries. On 4th error, delete oldest (`001.*`), shift others.

## Backend (Rust)

### New module: `storage/failed_audio.rs`

```rust
pub struct FailedTranscription {
    pub id: String,           // "001", "002", "003"
    pub error: String,
    pub whisper_text: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub provider: String,
}

pub struct FailedAudioStorage {
    dir: PathBuf,
}

impl FailedAudioStorage {
    pub fn new(config_dir: &Path) -> Self;
    pub fn save(&self, audio: &[u8], error: &str, whisper_text: Option<&str>, provider: &str) -> Result<String>;
    pub fn list(&self) -> Result<Vec<FailedTranscription>>;
    pub fn get_audio(&self, id: &str) -> Result<Vec<u8>>;
    pub fn remove(&self, id: &str) -> Result<()>;
}
```

### New commands

```rust
#[tauri::command]
pub fn get_failed_transcriptions() -> Vec<FailedTranscription>;

#[tauri::command]
pub async fn retry_transcription(id: String) -> Result<String, String>;

#[tauri::command]
pub fn dismiss_failed_transcription(id: String) -> Result<(), String>;
```

### Integration

In `transcription.rs`, when `run_transcription()` fails:
1. Save audio + metadata via `FailedAudioStorage::save()`
2. Emit `failed-transcriptions-updated` event
3. Continue with current error handling

## Frontend (React)

### New hook: `useFailedTranscriptions`

```typescript
interface FailedTranscription {
  id: string;
  error: string;
  whisperText: string | null;
  timestamp: string;
}

function useFailedTranscriptions() {
  const [items, setItems] = useState<FailedTranscription[]>([]);

  // Listen to failed-transcriptions-updated event
  // Fetch on mount

  const retry = async (id: string) => { ... };
  const dismiss = async (id: string) => { ... };

  return { items, retry, dismiss };
}
```

### UI: `FailedTranscriptionCard`

In HomePage, below error-card:

```tsx
{failedItems.map(item => (
  <div className="failed-transcription-card" key={item.id}>
    <p className="error-text">{item.error}</p>
    {item.whisperText && <p className="whisper-text">{item.whisperText}</p>}
    <div className="actions">
      <button onClick={() => retry(item.id)}>Try Again</button>
      <button onClick={() => dismiss(item.id)}>Dismiss</button>
    </div>
  </div>
))}
```

## Data Flow

1. User records → transcription fails
2. Backend saves `003.wav` + `003.json`, rotates if needed
3. Backend emits `failed-transcriptions-updated`
4. Frontend updates list, shows card
5. User clicks "Try Again"
6. Backend reads `003.wav`, retranscribes
7. Success → add to history, delete `003.*`, emit events
8. Failure → update `003.json` with new error

## Error Handling

- Retry uses same provider from metadata
- On retry success: result goes to history, failed entry deleted
- On retry failure: update error in metadata, keep in list
- Dismiss: delete files, remove from list
