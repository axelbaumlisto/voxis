# Landing Page 3D Scroll Architecture Plan

## Core Concept
The landing page replaces separate flat sections (Code, Architecture Diagram) with a **Single Unified 3D Isometric Scroll**. 
As the user scrolls, they "dive" through 5 distinct layers of a printed circuit board (PCB) stack. Each layer represents a core architectural module of the Rust backend. The left panel shows the description and the actual Rust source code snippet for that layer.

## Layers (The Stack)

### 🟢 Layer 1: OS Boundary (Граница ОС)
- **Icon / Color:** Terminal, Cyan (`text-cyan-400`).
- **Concept:** Interaction with the operating system. We demonstrate global low-level hooks bypassing app sandboxes.
- **Target Class:** `shortcut::Listener`
- **Code Snippet:** Using `rdev::listen` to capture intent instantly.

### 🔵 Layer 2: State Machine (Оркестратор)
- **Icon / Color:** CPU, Blue (`text-blue-500`).
- **Concept:** The brain of the app. Managing thread-safe transitions between `Idle`, `Recording`, and `Transcribing`.
- **Target Class:** `orchestrator::Orchestrator`
- **Code Snippet:** Modifying `Arc<Mutex<Stage>>` safely.

### 🟡 Layer 3: Audio Subsystem (Захват Звука)
- **Icon / Color:** Microphone, Yellow (`text-yellow-500`).
- **Concept:** Lock-free audio capture directly from ALSA/PipeWire/CoreAudio into memory.
- **Target Class:** `audio::Recorder`
- **Code Snippet:** `cpal::device.build_input_stream` and `WavWriter`.

### 🟣 Layer 4: AI Inference (Облачный вывод)
- **Icon / Color:** Brain, Purple (`text-purple-500`).
- **Concept:** Multipart async upload to Groq LPU (or OpenAI) to achieve millisecond latency.
- **Target Class:** `transcription::Groq`
- **Code Snippet:** `reqwest::multipart::Form` and `.send().await`.

### 🟢 Layer 5: Output Engine (Эмуляция клавиатуры)
- **Icon / Color:** Keyboard, Emerald (`text-emerald-400`).
- **Concept:** Surfacing back to the OS. Dropping privileges and simulating keystrokes in the active window.
- **Target Class:** `output::AutoType`
- **Code Snippet:** `self.enigo.key_sequence(text)`.

## Visual Execution
- **Desktop:** The 5 PCBs are rendered using CSS 3D Transforms (`rotateX`, `rotateZ`, `perspective`). As the user scrolls, active layers light up (glow, pulse, SVG traces), while passed layers drop away (`translateZ: -400`) and future layers sit in the background. The left panel updates the text and code snippet seamlessly.
- **Mobile:** The 3D stack is hidden. The layers render as a standard vertical "Bento Grid" sequence of glassmorphism cards.