// Shared technical metadata (DRY)
const layers = [
  {
    iconName: "terminal",
    className: "hotkey::HotkeyListener",
    code: `pub struct HotkeyListener {
    should_stop: Arc<AtomicBool>,
    target_key: Arc<AtomicU32>, // Thread-safe key id
}

impl HotkeyListener {
    pub fn start(&self, app: AppHandle, hotkey: &str) {
        let app_clone = app.clone();
        rdev::listen(move |evt| {
            // Emits semantic intent events to Tauri
            match evt.event_type {
                EventType::KeyPress(key) => {
                    let key_id = key_to_u32(key);
                    if key_id == current_target && key_id != 0 && !is_pressed {
                        is_pressed = true;
                        last_pressed_key = Some(key);
                        app_clone.emit("hotkey-pressed", ());
                    }
                },
                EventType::KeyRelease(key) => {
                    if is_pressed && last_pressed_key == Some(key) {
                        is_pressed = false;
                        last_pressed_key = None;
                        app_clone.emit("hotkey-released", ());
                    }
                },
                _ => {}
            }
        });
    }
}`,
    glow: "shadow-[0_0_40px_rgba(34,211,238,0.4)] border-cyan-400",
    iconColor: "text-cyan-400",
    bgLit: "bg-cyan-950/80",
    hex: "#22d3ee"
  },
  {
    iconName: "cpu",
    className: "orchestrator::TranscriptionCoordinator",
    code: `pub struct TranscriptionCoordinator {
    tx: Option<Sender<Command>>,
    stage: Arc<Mutex<Stage>>, 
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl TranscriptionCoordinator {
    // Pure lifecycle coordinator. 
    // Side effects (queueing & capture) live in RecordingCoordinator.
    pub fn on_press(&self) {
        self.send(Command::Press);
    }
}`,
    glow: "shadow-[0_0_40px_rgba(59,130,246,0.4)] border-blue-500",
    iconColor: "text-blue-500",
    bgLit: "bg-blue-950/80",
    hex: "#3b82f6"
  },
  {
    iconName: "mic",
    className: "audio::stream",
    code: `fn build_stream<T: cpal::Sample>(/*...*/) -> Result<cpal::Stream, AudioError> {
    device.build_input_stream(
        &config,
        move |data: &[T], _| {
            // Safe lock recovery on poisoned mutexes
            let mut samples_guard = lock_or_recover(&samples);
            process_chunk(data, channels, &mut samples_guard, /*...*/);
        },
        err_fn, None
    )
}
// WAV encoding and VAD happens on AudioRecorder::stop()`,
    glow: "shadow-[0_0_40px_rgba(234,179,8,0.4)] border-yellow-500",
    iconColor: "text-yellow-500",
    bgLit: "bg-yellow-950/80",
    hex: "#eab308"
  },
  {
    iconName: "brain",
    className: "transcription::TranscriptionClient",
    code: `pub struct TranscriptionClient {
    api_key: String,
    model: String,
    language: Option<String>,
    translate: bool,
    client: reqwest::Client,
    api_url: String, // Overridable via api_url_override
}

impl TranscriptionClient {
    pub async fn transcribe(&self, audio_data: Vec<u8>) 
        -> Result<TranscriptionResult, TranscriptionError> {
        let part = Part::bytes(audio_data).file_name("audio.wav");
        // Async multipart upload
    }
}`,
    glow: "shadow-[0_0_40px_rgba(168,85,247,0.4)] border-purple-500",
    iconColor: "text-purple-500",
    bgLit: "bg-purple-950/80",
    hex: "#a855f7"
  },
  {
    iconName: "keyboard",
    className: "output::OutputHandler",
    code: `pub struct OutputHandler {
    typer: Box<dyn PlatformTyper>,
    typing_delay_ms: u32,
    clipboard_factory: ClipboardFactory,
}

impl OutputHandler {
    pub fn type_text(&self, text: &str) -> Result<(), OutputError> {
        // Dependency Inversion via PlatformTyper trait
        if let Err(e) = self.typer.type_text(text, self.typing_delay_ms) {
            // Fails over to clipboard paste implementation
            self.copy_and_paste(text)?;
            return Err(OutputError::TypingError(e.to_string()));
        }
        Ok(())
    }
}`,
    glow: "shadow-[0_0_40px_rgba(52,211,153,0.4)] border-emerald-400",
    iconColor: "text-emerald-400",
    bgLit: "bg-emerald-950/80",
    hex: "#34d399"
  }
];

export const stepsEn = layers.map((layer, index) => {
  const content = [
    {
      title: "OS Boundary",
      subtitle: "STAGE 1 // INPUT",
      desc: "Global low-level OS hooks via rdev. Emits filtered hotkey-pressed/hotkey-released intent events to Tauri for instant capture.",
    },
    {
      title: "State Machine",
      subtitle: "STAGE 2 // CORE",
      desc: "A pure state machine serializing the lifecycle. Real side effects (like appending to the TranscriptionQueue) are decoupled into dedicated orchestrators.",
    },
    {
      title: "Audio Subsystem",
      subtitle: "STAGE 3 // SENSORS",
      desc: "Low-latency CPAL capture using safe lock recovery (lock_or_recover). Performs VAD and WAV encoding cleanly upon stop().",
    },
    {
      title: "AI Inference",
      subtitle: "STAGE 4 // CLOUD",
      desc: "Multipart async upload to Groq LPU (or custom OpenAI endpoints via api_url_override) parsed into a strictly-typed Result.",
    },
    {
      title: "Output Engine",
      subtitle: "STAGE 5 // ACTUATOR",
      desc: "Surfacing back to OS. Simulates keystrokes using the abstract PlatformTyper trait, falling back to pasting if typing fails.",
    }
  ];
  return { ...layer, ...content[index] };
});

export const stepsRu = layers.map((layer, index) => {
  const content = [
    {
      title: "Граница ОС",
      subtitle: "ЭТАП 1 // ВВОД",
      desc: "Глобальные хуки через rdev. Фильтрует нажатия по атомарному ключу и отправляет семантические события в ядро Tauri.",
    },
    {
      title: "State Machine",
      subtitle: "ЭТАП 2 // ЯДРО",
      desc: "Чистая стейт-машина. Сериализует жизненный цикл записи, делегируя добавление задач в TranscriptionQueue профильным координаторам.",
    },
    {
      title: "Аудио Подсистема",
      subtitle: "ЭТАП 3 // СЕНСОРЫ",
      desc: "Низколатентный захват звука через CPAL (с безопасным восстановлением локов). VAD-фильтрация и кодирование WAV выполняются при остановке.",
    },
    {
      title: "Нейросеть (LPU)",
      subtitle: "ЭТАП 4 // ОБЛАКО",
      desc: "Асинхронная отправка аудио на процессоры Groq (или любой кастомный OpenAI endpoint через api_url_override) со строгой типизацией ответов.",
    },
    {
      title: "Движок Вывода",
      subtitle: "ЭТАП 5 // АКТЮАТОР",
      desc: "Возврат в ОС. Эмуляция нативных нажатий через трейт PlatformTyper с изящным фоллбеком на буфер обмена в случае ошибки ввода.",
    }
  ];
  return { ...layer, ...content[index] };
});
