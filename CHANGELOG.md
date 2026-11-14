# Changelog

## v0.1.21 (Voxis desktop)

No app changes beyond 0.1.20.

### Fixed
- **The bare macOS binary `voxis-macos-arm64` is notarized** (it was only
  Developer-ID signed, so a browser download was blocked by Gatekeeper;
  `brew install` was not affected). A bare Mach-O cannot be stapled — Gatekeeper
  checks its ticket online.

## v0.1.20 (Voxis desktop)

### Added
- **Settings → "Export to edit"** next to the theme selector: copies the
  selected theme (builtin or yours) to `<config>/themes/<id>_custom` and shows
  the folder; the selection does not change.
- **`voxis --version` / `-V` and `--help`** print and exit without starting the
  app (the Homebrew formula test checks the version).

### Fixed
- Theme errors (export, preview) show the real message instead of
  "Unknown … error".
- Startup retire of untouched old builtin copies ignores OS files Finder/Explorer
  drop into folders (`.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`); they move
  along with the folder.

## v0.1.19 (Voxis desktop)

No app changes beyond 0.1.18.

### Changed
- **macOS build moved to macOS 26 + Xcode 26.6** (the shared build VM; was the older
  macOS 14 VM): every Mach-O in `Voxis.app` is signed inside-out with
  Developer ID + hardened runtime + microphone entitlement; the app and the DMG
  are notarized and stapled. The Homebrew `voxis-macos-arm64` binary is now the
  same build as the DMG's, re-signed standalone (was a separate build lane).
- The overlay plugin for hosts is released separately as `tauri-plugin-voxis`
  0.8.0 / guest-js 0.10.0 (see the plugin section below).

## v0.1.18 (Voxis desktop)

### Changed
- **Builtin themes live in the app binary**: they update and disappear with the
  app (no frozen first-launch copy), and the bare `voxis-linux-x64-gui` /
  `voxis-windows-x64-gui.exe` builds have them with no themes folder next to the
  binary. `<config>/themes` holds only your themes: a valid folder with a
  builtin's id shadows it, an export lands as `<id>_custom` (then `_custom_1`,
  `_custom_2`, …).
- **Startup moves untouched old builtin copies** to `<config>/themes-retired/`
  (rename only, nothing deleted; collision → `<id>.1`). Edited copies stay and
  keep shadowing (as long as they are a valid theme); a copy that cannot be moved
  is retried on the next start, and a copy edited only in whitespace (even inside
  strings) counts as untouched. Untouched copies of removed builtins no longer
  linger in Settings (the 28 orbs dropped in v0.1.16) — edited copies stay.
- **A selected theme that no longer exists falls back to `default`** (and the
  fallback is saved); a present-but-broken user theme keeps its selection.

## v0.1.17 (Voxis desktop)

Re-release of 0.1.16 with correct artifacts. 0.1.16's Linux binary, .deb and
.rpm were stale (built from an older image after the Linux docker build failed
silently), and it shipped no signed macOS DMG (Apple notary 403: a developer
agreement had expired). No app changes beyond 0.1.16.

### Fix
- **Release pipeline**: the Linux lane now fails on a failed `docker build`,
  clears last run's outputs first and checks the `.deb` carries this version;
  the macOS lane prints Apple's notarytool error instead of a bare `rc=1`.

## v0.1.16 (Voxis desktop)

### Remove
- **Orb themes trimmed to five**: SHDR-03, SHDR-06, SHDR-07, Rocaille, Falls.
  28 other `orb_*` builtins removed (sources, bundled `src-tauri/themes`,
  guest-js generated copies, plugin `BUILTIN_THEMES`). A user whose selected
  theme was removed falls back as for any missing theme. Already-seeded copies
  in `<config>/themes` are not deleted by the app.

### Fix
- **Linux: overlay blinking.** WebKitGTK's DMA-BUF renderer flickers
  transparent windows on Arch/AMD Mesa and NVIDIA; `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  is now set at startup unless the user set it.

### Add
- **The overlay can be moved by a grip.** A green ✛ in the top-left corner:
  press-and-hold (300 ms) to drag, a short tap passes through, double-click
  returns to the preset position. The spot is persisted (`overlay.custom_x/y`)
  and survives restarts and theme switches.
- **Both grips appear only on hover** and fade out after the pointer leaves;
  they stay pinned for the whole drag/resize.
- **Live theme preview**: picking a theme in Settings shows it on the overlay
  immediately.
- **Linux: the overlay window is built at the theme's footprint** (and rebuilt
  on a size change) — KWin/XWayland ignores runtime resizes of a Dock window,
  so the window used to stay larger than the orb.
- **The overlay can be resized from its bottom-right corner.** A grip appears
  on hover (next to the existing move grip) and drags a SQUARE edge —
  every theme draws into a square canvas, and the orb shaders normalise by
  `min(w, h)`, so a rectangular window would squash them. While the user moves
  OR resizes, the overlay draws its own outline: an orb fills the window edge
  to edge, so nothing else says where the window ends. The size is persisted
  (`overlay.custom_w/h`), wins over the theme's manifest footprint, and
  survives restarts and theme switches; a double-click on the grip drops it
  back to the theme. Limits 56…1024 logical px, clamped on BOTH sides
  (`orchestrator/overlay_resize.rs` is the single definition, and a test
  asserts the TS mirror in `src/overlay/resize.ts` agrees).
- The gesture plumbing both grips need (pointer capture, one call per
  animation frame, last-position flush on release) now lives in
  `overlay/gesture.ts` with its own tests — `DragGrip` and `ResizeGrip` differ
  only in what they compute from the pointer. The resize grip reads its
  starting edge from `innerWidth/innerHeight` (the overlay webview fills the
  window exactly), and the Rust side has ONE `apply_overlay_size` used by both
  the per-frame command and the persisted one.
- Why not `startResizeDragging()`: with `decorations:false` +
  `transparent:true` + `macOSPrivateApi:true` AppKit accepts that gesture and
  then silently declines to resize. The grip therefore drives the geometry
  itself (`resize_overlay_window` per rAF frame, like the move grip already
  did), which is the documented workaround for this exact window shape.
  The window's `min_inner_size == max_inner_size == footprint` pin is gone
  (it would clamp every resize to zero); `resizable(false)` stays, because it
  only disables OS borders/gestures, not programmatic `set_size`.

## v0.1.15 (Voxis desktop)

### Change
- **One WebGL lifetime for every shader theme** (`builtin/_shared/gl-theme.ts`):
  canvas + 2× supersample, context, compile/link, the full-screen triangle,
  the rAF loop with its `visibilitychange` pause, and full disposal now exist
  ONCE. The orb adapter and both hand-rolled shader themes (metaballs3d,
  lavalamp) were three copies of that plumbing — the part that must not be got
  wrong is exactly the part not to triplicate. A theme now owns its shader and
  its uniforms; the surface clears, draws and cleans up. The refactor caught a
  real bug in itself: moving `drawArrays` into the surface left the orbs
  rendering NOTHING until it was put back, which the pixel probe showed
  instantly (area 38102 → 0 → 38101).

## v0.1.14 (Voxis desktop)

### Add
- **All 33 Orbkit orbs are now themes** (was 5): `orb_*` — Dispersion,
  Rocaille, and the rest of the set, each its shader plus a table of numbers
  behind `_shared/orb-kit.ts`. The adapter gained the two clocks the remaining
  shaders need (`uTime`, orbkit's half-speed ambient; `uAnim`, whose rate
  follows the voice), which is exactly the kind of gap the shared runtime
  exists to absorb once instead of 28 times.
- Licensing is mechanical: the 14 orbs Orbkit wrote are MIT; the 19 ported
  from XorDev are **non-commercial with attribution** (Voxis is free), and
  every manifest carries a `credit` string that names which is which — so if
  Voxis ever monetises, those 19 are a single grep away from being removed.
- Gates: `orb_family.test.ts` covers all 33 structurally (valid module, credit,
  square size); `e2e/orb-themes.spec.ts` mounts every one in real Chromium +
  SwiftShader and requires that the frame visibly changes with the voice level
  (a fingerprint of sampled pixels, not an aggregate threshold — full-frame
  orbs react in ways mean-brightness does not capture).

## v0.1.13 (Voxis desktop)

### Add
- **Orb theme family from Orbkit** (https://github.com/zzzzshawn/orbkit): five
  WebGL orbs ported to the overlay theme contract — `orb_hydrogen`
  (|psi|² orbital), `orb_ion` (plasma globe), `orb_nimbus` (volumetric cloud),
  `orb_phosphor` (CRT ASCII matrix), `orb_dither` (1-bit dithered dome). One
  shared adapter, `builtin/_shared/orb-kit.ts`, carries the whole contract:
  orbkit's `idle | thinking | speaking` states map onto our modes (recording
  → speaking with `uInput` ← `audioLevel`), its `integrate: true` rates become
  accumulated clocks so a mode change glides instead of jumping phase, colour
  uniforms (`uC_*`) come from the orb's schema, and every orb inherits the
  same 2× supersample / graceful-WebGL-fallback / full-dispose behaviour.
  Each theme is then only its shader plus a table of numbers. Every manifest
  carries a machine-readable `credit` — Orbkit's own orbs (these five) are MIT;
  if a themed port of XorDev's shaders is added later it is NON-COMMERCIAL
  only, and `credit` is what makes that mechanically removable.
  Gates: `src/theme-engine/builtin/__tests__/orb_family.test.ts` (structure,
  credit, square size) and `e2e/orb-themes.spec.ts` (real Chromium +
  SwiftShader: each orb compiles, draws, and changes with the voice level).

## v0.1.12 (Voxis desktop)

### Fix
- **A device re-enumeration is now a silent rebind, not an error** (owner
  2026-10-20: «деактивировал и деактивировал это не должно быть ошибкой»).
  0.1.11 caught the dead stream (2 s of exact zeros → visible error → next
  press reopens). It was still the wrong shape: the mic coming back is
  normal, and the app should simply follow it. `audio/hotplug.rs` registers
  one CoreAudio listener on `kAudioHardwarePropertyDevices` (plain C
  callback, no blocks, no new crates) and latches the change; the next
  `start()` drops the stale always-on stream without waiting on its teardown
  and opens the CURRENT device by name — so the first take after a USB blink
  works, with no message and no restart. The 2 s digital-silence guard stays
  as the safety net for the cases the listener cannot see (muted mic, a
  listener that failed to arm).

## `tauri-plugin-voxis` 0.8.0 / `@voxis/tauri-plugin-voxis` (guest-js) 0.10.0

- **Five new WebGL orb themes** — `orb_falls`, `orb_rocaille`,
  `orb_shdr_03`, `orb_shdr_06`, `orb_shdr_07` join
  `settings::BUILTIN_THEMES` and the generated guest-js set; nothing a 0.7.5
  host had was removed. Every shader theme (the orbs, `lavalamp`,
  `metaballs3d`, …) also now draws through ONE shared WebGL lifetime
  (`_shared/gl-theme.ts`) instead of each carrying its own
  canvas/context/rAF/dispose.
- **`voxis-core`'s `OverlayConfig` gains `custom_x`/`custom_y`/`custom_w`/
  `custom_h`** — the exact spot and size of a user-dragged/resized overlay
  (logical px, `None` = follow the preset `position`/`margin`/theme
  footprint), persisted as the `overlay_custom_*` keys. `ConfigSqliteStorage::
  set_overlay_theme` writes **just** the `overlay_theme` key, for a caller
  changing one setting of an already-loaded config — `save` would rewrite
  every key, including values `load` silently defaulted because it could not
  parse them. These are public fields, so a host constructing `OverlayConfig`
  with a struct literal must add them (hence the minor bump).
- **The desktop's dead-stream stop moved into `voxis-core`**: it now exports
  `guard::is_digital_silence`, `DEAD_STREAM_SILENCE_MS` and
  `StopReason::DeviceSilent` (used by the Voxis desktop's recording guard);
  the plugin does not emit it, so no host-facing contract changed.
- guest-js 0.10.0 is a **re-vendor**: the generated theme set gains the five
  new orb themes even though no hand-written API moved.

## `tauri-plugin-voxis` 0.7.5 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.5

- **The API key field's help no longer names a button that may not be on
  screen** (owner 17.10: on an iPhone/iPad with NO key stored, the field
  still read «Leave it empty to keep the saved key. To remove it, press
  «Forget the key».» — but «Forget the key» is only rendered when a key
  exists, so the sentence described a control the person could not see).
  The `apiKey` `help` is now state-neutral and lets the button speak for
  itself: en «Leave it empty to keep the saved key.» / ru «Пустое поле —
  оставить сохранённый ключ.». Nothing else changed; 0.7.4's copy fix
  (no `null`/`clearApiKey`/implementation words in human-facing strings)
  stays, and the guest-js test that pins this help now also rejects
  «Forget the key»/«Забыть ключ» in any human-facing manifest string — it
  found no other reference.

## `tauri-plugin-voxis` 0.7.4 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.4

- **The API key field's help text speaks to a person, not an implementer**
  (owner 16.10: on an iPhone 15 the Settings → Dictation (Voxis) field
  rendered «…a separate host action (an explicit null erase — see
  clearApiKey)…» verbatim). The manifest's `apiKey` `help` is now:
  en «Leave it empty to keep the saved key. To remove it, press «Forget
  the key».» / ru «Пустое поле — оставить сохранённый ключ. Чтобы удалить
  его, нажмите «Забыть ключ».». No identifiers, no `null`, no
  implementation words — the three-valued wire contract stays documented
  in `client.ts`/`CHANGELOG`, where it belongs. A guest-js test now pins
  that copy and rejects `null`/`clearApiKey`/`settings_set`/`host action`
  in any human-facing manifest string (label/help/hint/placeholder/
  disabledReason/successMessage/errorMessages); it found no other leak.

## `tauri-plugin-voxis` 0.7.3 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.3

- **A WRONG API key can now be REMOVED, not only replaced** (owner
  14–15.10: a device stuck with a bad key had to reinstall).
  `settings_set`'s `apiKey` becomes three-valued: **absent keeps** the
  stored key (unchanged — old guests sending partial patches are
  unaffected), **`null` erases** it (the secret is deleted from the
  `SecretStore`, `status.hasApiKey` flips to `false`, dictation stays
  enabled — only `start`'s `noApiKey` gate cares), and an
  **empty/whitespace string keeps** it (the «leave empty to keep» form
  value, unchanged). No separate command; `set_provider`'s `""` = clear
  semantics are untouched.
- guest-js 0.9.3: `VoxisSettingsPatch.apiKey` is documented as
  `string | null` with the three-valued semantics, and the client gains
  `clearApiKey()` — a helper sending `{ apiKey: null }`. The manifest's
  `apiKey` field spells the contract out in `help` (empty save keeps;
  removal is the explicit null erase via `clearApiKey`).

## `tauri-plugin-voxis` 0.7.2 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.2

- **The pill theme select shows theme names, not raw ids** (owner 14.10:
  `all_aquarium`, `didinium_drift`, `winamp_classic`). `settings_get`
  `status` gains `themes: { value, label: { en, ru } }[]` — `value` is the
  theme id, `label` the theme's own `theme.json` `"name"` (`All Aquarium`,
  `Lava Lamp`, `Metaballs 2.5D`, …; proper names, so `ru` = `en`). The
  manifest declares `status.themes` as `"options"` and the `theme` select's
  `optionsFrom` now points at it. `status.themeIds` stays (declared, still
  sent) for compatibility.
- Schema v1 (no version bump, additive): the `optionsFrom` item shape is
  now spelled out — `string` or `DynamicSelectOption { value, label }`
  with `label` either `{ en, ru }` or a plain string; new helper
  `dynamicOptionLabel(item, lang)`. `validateSettingsManifest` now also
  rejects an `optionsFrom` whose `status`/`host` path is not declared
  `"string[]"` or `"options"`.

## `tauri-plugin-voxis` 0.7.1 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.1

- **Hiding the pill no longer forgets its corner** (owner 14.10). The
  settings manifest's `overlayPlacement` select loses its 6th «hidden»
  option and keeps only the five positions (`bottom-right` default,
  `bottom-left`, `top-right`, `top-left`, `center`); a new host toggle
  `overlayHidden` (default `false`, «Hide the pill (hotkey or chip only)» /
  «Не показывать пилюлю (хоткей или чип)», `enabledWhen` `status.hasApiKey`)
  hides it. `overlayPlacement` and the offsets are `visibleWhen`
  `overlayHidden != true` (offsets additionally hidden for `center`).
  Hosts that persisted `overlayPlacement: "hidden"` should migrate it to
  `overlayHidden: true` + the default corner. Manifest-only change; no
  Rust behaviour change.

## `tauri-plugin-voxis` 0.7.0 / `@voxis/tauri-plugin-voxis` (guest-js) 0.9.0

- **The plugin describes its own settings.** guest-js exports a JSON settings
  manifest (`voxisSettingsManifest`, `settingsManifest()`; schema v1 types +
  `validateSettingsManifest` in `settings.ts`): sections of fields
  (`toggle`/`select`/`text`/`secret`/`number`/`status`/`action`/`file-import`),
  `{ en, ru }` labels, and declared behaviour — the API key is `required`
  (red until `status.hasApiKey`), every pill control is `enabledWhen`
  `status.hasApiKey` («No API key — the dictation pill is off»), the global
  hotkey and «Import from Voxis desktop» show only where the build has them.
  Host-owned prefs (`enabled`, `overlayPlacement`, offsets, `dictationChord`)
  are described with `store: "host"`. A host renders a tab from it instead of
  a hand-written Voxis form.
- **New commands `settings_get` / `settings_set`** (in `voxis:default`;
  desktop and mobile): `{ values, status }` over the existing profile,
  secret store, hotkey backend and theme — no second store. The API key is
  write-only (never returned; empty keeps it). Bad values reject
  `{ kind: "invalid", field, message }` and save nothing. guest-js:
  `getSettings()`, `setSettings(values)`.
## v0.1.11 (Voxis desktop)

### Fix
- **Dictation still died (and needed app restarts) after the USB mic
  re-enumerated** — the 0.1.10 fix only covered a stream with NO callbacks.
  Owner's Mac 2026-10-20: coreaudiod deactivated BY-V at 15:21:41 and
  activated it again 0.3 s later, but CoreAudio kept the OLD IOProc alive:
  callbacks kept arriving, every sample exactly 0.0. Three takes (3.7 s,
  0.5 s, 3.0 s) were recorded as pure digital silence, Whisper returned
  "Продолжение следует…", the hallucination guard threw it away — nothing in
  History, no error, and only an app restart produced a working stream
  (verified: `ffmpeg` from the same device had signal, so the hardware was
  fine). Two additions:
  1. the recording guard stops a take after 2 s whose PEAK is still exactly
     0.0 (`StopReason::DeviceSilent`) — a live mic always has a noise floor,
     so exact zeros mean a stale/muted stream, not a quiet room;
  2. `AudioRecorder::stop` treats "held ≥ 1 s with no non-zero sample" as
     `NoAudioFromDevice` (visible error), abandons the stale stream without
     joining it, so the NEXT press opens the device afresh — no restart.
  Tests: guard decision mapping, signalled-vs-silent stop paths, and the
  silent-while-callbacks-flow case.

## @voxis/tauri-plugin-voxis (guest-js) 0.8.0

- **`board: false`**: the expanded window without its dark `#111` board — only
  the theme is drawn (naked lays the always-shown `idleTheme` window over
  terminal text; owner 2026-09-29: «доска оверлея совсем прозрачной должна
  быть»). Default unchanged; the compact handle keeps its fill.
- **Fix: an `idleTheme` window was born 8px off where it then stayed.**
  `initialPosition` was the expanded window's top-left, while `setPosition`
  (0.7.0) means the compact resting spot and grows from it — so the host's
  first re-anchor to the SAME spot moved the window by the size difference
  (naked: window 64×64 at x=770 over a 56×56 ring at x=762 after the first
  viewport change). One rule (`placeAtRest`) now places both. A persisted
  position keeps its meaning (the pill's own last top-left).

## v0.1.10 (Voxis desktop)

Same code as v0.1.9. v0.1.9 shipped without macOS artifacts: the CI host's
persistent checkout carried a stray local edit that removed `macos-private-api`
from `src-tauri/Cargo.toml`, the VM built exactly that, and `transparent()`
failed to compile. Published tags are immutable, so this is the macOS release;
the release job now stashes host leftovers before building (`release.yml`).

## v0.1.9 (Voxis desktop)

### Fix
- **Dictation went silent after a USB microphone blinked, until the app was
  restarted** (owner's Mac, 2026-10-06, BY-V). CoreAudio deactivated the mic
  for 0.6 s and brought it back as a NEW device; the always-on stream (the
  "Pause/Play" fast-resume path on macOS) kept resuming the OLD one, which
  `play()`s without error and never calls back. Every hold — 6, 12, 16 s —
  came out as 0 ms of audio and was filed as a "too short" recording:
  nothing in History, no error anywhere. Two rules now:
  1. a resumed stream must deliver a callback within 400 ms or it is torn
     down and the device reopened by name (self-heal, no restart);
  2. a hold ≥ 1 s with zero callbacks is `NoAudioFromDevice` — a visible
     error ("Microphone delivered no audio for N s — check the device or
     pick another one in Settings"), and the dead stream is closed so the
     next start reopens. Taps under 1 s keep the quiet "too short" path.
  Tests drive both with a fake stream that honours Play/Pause/Close like
  cpal's loop but either calls back or stays silent.
- **Secure Input banner could stay stale in an occluded window.** WKWebView
  reports `document.visibilityState === "hidden"` while the window is covered,
  and the 5 s poll skipped that case — so the banner reflected the state from
  before the window was covered until the next poll after it came back
  (seen once on 0.1.8: Secure Input on, Voxis brought forward, no banner). The
  poll now runs unconditionally (microseconds) and re-reads on
  `visibilitychange`. Verified on-screen: dialog with a password field →
  banner names `osascript (pid …)` in a window nobody activated; dialog closed
  → banner gone within one poll.
- `HistoryPage` clipboard test flaked from worker starvation under load;
  its assertion now waits 5 s instead of 1.

## v0.1.8 (Voxis desktop)

### Add
- **"Secure Input is on — held by Terminal (pid 812)" banner** (macOS). While
  any app holds Secure Event Input (a password field, `sudo` in Terminal, a
  password manager's lock screen) NO process receives global keyboard events,
  so the Voxis hotkey goes dead with no error anywhere — the "полный ноль"
  hunt of 2026-09-18 spent an hour ruling this out by hand. Voxis now asks the
  OS (`IsSecureEventInputEnabled`) with the permission checks and every 5 s
  while visible, names the holder (`kCGSSessionSecureInputPID` via `ioreg` →
  `ps`), and shows a banner with no button: nothing Voxis can do about it,
  the text says who to look at. Off macOS the command always reports "off".
  `check_secure_input` command; `permissions::secure_input` with a tested
  pure parser; banner tests.

## v0.1.7 (Voxis desktop)

### Fix
- **Right Ctrl (`ctrl_r`) never worked as a hotkey on macOS** — and it is the
  app's default. `rdev`'s macOS keycode table (`key_from_code`) has no arm for
  virtual keycode 62 (Right Control), so a physical right-Ctrl press reached
  the listener as `Key::Unknown(62)` and could never match; left Ctrl and
  right Cmd were unaffected. Found live on the owner's Mac (Voxis silent on
  right Ctrl while a WebKit key probe showed the OS sending a clean
  `ControlRight`, keyCode 62 / location 2). Fixed with one shared repair seam,
  `voxis_core::hotkey::normalize_rdev_key` (macOS-only `Unknown(62) →
  ControlRight`), applied before matching in both rdev-fed listeners: the
  desktop app's `hotkey_callback` and `tauri-plugin-voxis`'s `RdevHotkey`.
  Tests pin that `Unknown(62)` drives a full press+release for `ctrl_r` and
  that other unknown codes stay invisible; the source gate (`no log or sink
  call outside a target-key guard`) still holds. Verified on hardware: real
  right-Ctrl hold → recording → transcript.

## v0.1.6 (Voxis desktop)

### Fix
- Six `AppConfig` fields were saved to `config.db` **as read-only defaults
  every time the app restarted**, silently discarding whatever the user had
  actually set in Settings: `api_url_override` (a configured self-hosted
  transcription endpoint quietly reverted to the Groq default on next
  launch), `min_recording_ms`, and `vad.backend` / `vad.onset_frames` /
  `vad.hangover_frames` / `vad.prefill_frames`. `ConfigSqliteStorage::save`/
  `load` write/read fields by hand (not a generic (de)serializer), and
  these six were read but never written — found while building
  `tauri-plugin-voxis`'s desktop-profile import path (Task 6/6b: a real
  round-trip through the profile importer got 0 requests at the configured
  `api_url_override`, because the value it read back from `config.db` was
  never the one that had been saved). Fixed in `crates/voxis-core/src/
  storage/config_sqlite.rs`. Added a guard test,
  `every_app_config_field_round_trips_through_sqlite`, that constructs a
  **fully non-default** `AppConfig` (including every nested struct, with
  no `..Default::default()` anywhere in the literal) and asserts save→load
  equality field-by-field via destructuring (so a newly-added `AppConfig`
  field that isn't wired into the destructuring pattern fails to compile,
  rather than silently passing an incomplete check) — the previous test
  covering this path used `..Default::default()` for most fields, which is
  exactly the style that let all six of these slip through unnoticed.

### New
- **"Share profile to device"** (Settings): sends the current provider,
  model, language, guard timeouts, dictionary, LLM providers/prompts, theme
  and hotkey to a phone/tablet running a `tauri-plugin-voxis` host, over
  two paths — a one-time QR code + LAN transfer (single-use token, 120s
  window or first successful fetch, whichever comes first; the QR's own
  256-bit key travels in the code, a 6-digit code shown alongside it is a
  second factor only, never transmitted) or a passphrase-protected `.vxp`
  file export (Argon2id + ChaCha20-Poly1305, phrase/key shown once). API
  keys and other secrets never touch the destination's on-disk profile
  storage — they route through the destination's own `SecretStore`.

### Dependencies
- `h2` 0.4.19 (RUSTSEC-2026-0258), `quinn-proto` 0.11.18
  (RUSTSEC-2026-0185), `rustls` 0.23.45 (RUSTSEC-2026-0285), `quick-xml`
  0.42.0 via tauri-plugin-notification 2.4.0 / plist 1.10.1
  (RUSTSEC-2026-0194, -0195) bumped. `cargo audit` is clean of
  vulnerabilities (12 unmaintained-warnings remain, transitive via
  tauri/gtk); policy file `.cargo/audit.toml`.

### Internal
- The engine (`AppConfig`, storage, transcription, LLM, learning, the
  recording guard, the WAV encoder, the hotkey parser, `VoxisProfile`) moved
  into a new pure-Rust workspace member, `voxis-core` — no `tauri`/`cpal`/
  `rdev`/`enigo`/`arboard` dependency, buildable for `aarch64-apple-ios`
  with zero feature flags. Voxis desktop (`voice_lib`) now consumes it via
  `pub use` plus a small tauri-specific shim layer; behaviour is unchanged
  (regression-gated by a full local-vs-post-split config/history/dictionary
  data snapshot test, plus the existing `cargo test --lib` suite). The
  Cargo workspace root moved from `src-tauri/Cargo.toml` to a new root
  `/Cargo.toml`; **`/Cargo.lock` now lives at the repo root**, not
  `src-tauri/Cargo.lock` — see `.pi/skills/voxis-deploy/SKILL.md`'s updated
  release checklist. This split is what makes `tauri-plugin-voxis` (below)
  possible: the plugin and Voxis desktop now share one engine instead of
  two copies of it.

## `tauri-plugin-voxis` 0.1.0 / `@voxis/tauri-plugin-voxis` (guest-js) 0.2.0

guest-js 0.2.0 (was 0.1.1): `<voxis-overlay>` renders every Voxis theme at its
manifest size (`overlay_width`/`overlay_height`, e.g. Lava Lamp 120×120,
Vorticella 240×240) while recording/transcribing and rests as a compact 56×56
handle with no theme mounted (no WebGL loop while idle); `idleTheme` opt-in,
`voxis-overlay-resize` event, `el.size`/`el.lifecycle`. iOS floor is **16.0**;
17+ APIs (mic-mute signal, Live Activity Stop) are gated at their call sites.


New, separate artifacts — not part of the Voxis desktop app release above.
Voxis's dictation engine (hotkey/tap → record → silence/duration guard →
transcribe → dictionary → optional LLM post-process), packaged as an
embeddable Tauri 2 plugin (desktop via `cpal`/`rdev`, iOS via
`AVAudioEngine`/Keychain) plus a typed guest-js client and a
`<voxis-overlay>` recording-pill web component, for third-party Tauri apps
that want Voxis-quality dictation inside their own app rather than
switching to the standalone Voxis app. First integration target: `naked`
(desktop + iPad, in progress in that project's own repo). See
**[crates/tauri-plugin-voxis/README.md](crates/tauri-plugin-voxis/README.md)**
(Rust) and
**[crates/tauri-plugin-voxis/guest-js/README.md](crates/tauri-plugin-voxis/guest-js/README.md)**
(TypeScript) for the full API/integration reference, and
**[docs/PLUGIN.md](docs/PLUGIN.md)** for the architecture/guarantees/test
gates this changelog entry doesn't repeat.

## v0.1.5

Silence guard calibrated on hardware: threshold −46 → −34 dBFS (room floor on a
MacBook Air built-in mic measured −44…−36 dBFS, so v0.1.4's guard never armed and a
silent take could still be transcribed and auto-typed as a Whisper hallucination).
Guard logs per-take peak RMS for future calibration. No other changes.

## v0.1.4

macOS release lane: sign every bundled executable (voice AND typing_bench) with
Developer ID + Hardened Runtime + entitlements; v0.1.3's notarization was rejected on
typing_bench, so v0.1.3 shipped without a DMG (Linux/Windows/Homebrew tarball
unaffected). No app-code changes.

## v0.1.3

Fixes the "stuck recording" class of incidents (recording never stops, RAM grows to
gigabytes, multi-GB WAV dumps, app goes deaf until restart) and adds a recording guard.

### Root cause fixed
- Press/release ordering race: a hotkey/overlay release arriving while the press was
  blocked in the (0.2–5 s) synchronous microphone-permission probe was silently dropped,
  leaving a recording nobody would stop. Now: single-flight start, release-pending
  checkpoints, deterministic — the recording either never starts or stops immediately.
- Microphone permission probe is native (AVFoundation, ~10–40 ms) instead of `osascript`.

### Recording guard (new settings, Recording section)
- Auto-stop after continuous silence (default 60 s + ~10 s detection window; 0 = off)
  with a warning beep 3 s before. A take that was silent from start to finish is
  discarded instead of transcribed, to avoid an auto-typed Whisper silence hallucination.
- Max recording length (default 10 min; 0 = off — recording still stops at ~13 min, the
  transcription limit; the raw audio buffer keeps a separate, larger safety backstop).
- Buffer is hard-capped at the native sample rate; memory is released on stop.

### Robustness
- One serialized stop path for hotkey release, toggle press, cancel button and the guard;
  toggle mode's tap-to-stop (previously dead code) works.
- Dead audio stream mid-recording recovers to idle with an error cue instead of pinning
  the app in "Recording" — on the next stop request, or automatically once the recording
  guard notices the stream died.
- Oversize audio (>25 MB) is rejected before any disk write or network call; the
  failed-audio and debug dumps no longer write multi-GB files.
- Overlay spectrum logging throttled; heartbeat no longer fsyncs every 10 s.

### macOS release pipeline
- CI now codesigns (Developer ID, Hardened Runtime + microphone/Apple-Events
  entitlements), notarizes and staples a DMG (falls back to an ad-hoc-signed DMG when
  signing secrets are absent; unstapled if Apple's queue exceeds 30 min — see
  `docs/MACOS_SIGNING_TODO.md`); own VM image and a host-wide launch lock.

## v0.1.2

First signed+notarized macOS DMG via the CI lane (commit e188a8d); no app-code changes.

## v0.1.1

CI/release-pipeline hardening (no user-facing app changes):
- Release publishes deb/rpm to both Forgejo and GitHub with hard-fail asserts.
- Homebrew tap `axelbaumlisto/homebrew-voxis` wired up with a tarball integrity
  gate (`brew install axelbaumlisto/voxis/voxis`, macOS arm64).
- Docs regeneration decoupled from release into a scheduled workflow that opens
  a PR to main (deploys to docs.voxis.top via GitHub Pages).
- Re-publish guard prevents overwriting an already-published tag.

## v0.1.0

First public release of Voxis — a private, local-first voice dictation app
(Tauri v2 + Rust core). Records audio via a global hotkey, transcribes through
a Whisper-compatible HTTP endpoint (Groq by default), and outputs text via
clipboard or auto-typing.

### Highlights
- Global push-to-talk hotkey with buffered concurrent recordings
- Whisper-compatible transcription (custom endpoints via `api_url_override`)
- Dictionary word-replacement + learning suggestions
- Optional LLM post-processing with multi-prompt templates
- Clipboard and auto-typing output backends
- Transcription history with SQLite storage
- Themeable recording overlay (manifest v2 theme engine)

### Downloads
- **Linux**: `voxis-linux-x64-gui` (binary), `Voxis_0.1.0_amd64.deb`, `Voxis-0.1.0-1.x86_64.rpm`
- **Windows**: `voxis-windows-x64-gui.exe` (portable), `Voxis_0.1.0_x64-setup.exe` (NSIS installer)
- **macOS**: unsigned Apple Silicon binary (`voxis-macos-arm64`) — DMG signing/notarization to follow

Binaries are unsigned in this release.
### tauri-plugin-voxis hardening (2026-09-16, before the first hosted release)
- `AudioCapture::start`/`stop` run on `spawn_blocking` (a slow capture backend / mobile IPC no
  longer blocks the plugin's async worker). A `cancel()`/`stop()` (incl. Hold-mode cancel on
  webview death and the iOS Live Activity Stop) arriving while `start()` is still opening the
  device is queued and applied the instant the session attaches — previously it would have been
  dropped (cancel) or, for Stop via Live Activity, panicked (aborting the app in release).
- `voxis://result` now carries `sessionId`; hosts correlate results by id (guest-js `dictate()`
  does), not by "the next result after my start()". The event fires after the session slot is
  freed, so a `start()` triggered by the result never hits `AlreadyRecording`.
- New `voxis://error {kind:"permissionDenied"}` when the desktop global-hotkey listener fails
  after registration (macOS Accessibility revoked) — was invisible to hosts.
- `secrets.json` written temp → fsync → rename (never half-written); `RecDir` sweep logs and
  continues past a stuck file; `CpalCapture::stop()` returns in ≤25 ms instead of up to 250 ms.
- iOS: `AVAudioEngine` is rebuilt after `mediaServicesWereReset` (was Failed until app restart).
- Dead `hound`/`regex` dependencies dropped; dictionary application shared with voxis-core.

