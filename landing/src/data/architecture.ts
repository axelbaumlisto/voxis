import { Mic, Zap, Brain, Keyboard, Terminal, Cpu } from "lucide-react";

export type IconKey = "terminal" | "cpu" | "mic" | "brain" | "keyboard" | "zap";

export interface Step {
  iconName: IconKey;
  title: string;
  className: string;
  filePath: string;
  subtitle: string;
  desc: string;
  glow: string;
  iconColor: string;
  bgLit: string;
  hex: string;
}

// Shared technical metadata (DRY)
const layers = [
  {
    iconName: "terminal" as IconKey,
    className: "hotkey::HotkeyListener",
    filePath: "src-tauri/src/hotkey/mod.rs",
    glow: "shadow-[0_0_40px_rgba(34,211,238,0.4)] border-cyan-400",
    iconColor: "text-cyan-400",
    bgLit: "bg-cyan-950/80",
    hex: "#22d3ee"
  },
  {
    iconName: "cpu" as IconKey,
    className: "orchestrator::TranscriptionCoordinator",
    filePath: "src-tauri/src/orchestrator/coordinator.rs",
    glow: "shadow-[0_0_40px_rgba(59,130,246,0.4)] border-blue-500",
    iconColor: "text-blue-500",
    bgLit: "bg-blue-950/80",
    hex: "#3b82f6"
  },
  {
    iconName: "mic" as IconKey,
    className: "audio::stream",
    filePath: "src-tauri/src/audio/stream.rs",
    glow: "shadow-[0_0_40px_rgba(234,179,8,0.4)] border-yellow-500",
    iconColor: "text-yellow-500",
    bgLit: "bg-yellow-950/80",
    hex: "#eab308"
  },
  {
    iconName: "brain" as IconKey,
    className: "transcription::TranscriptionClient",
    filePath: "src-tauri/src/transcription/mod.rs",
    glow: "shadow-[0_0_40px_rgba(168,85,247,0.4)] border-purple-500",
    iconColor: "text-purple-500",
    bgLit: "bg-purple-950/80",
    hex: "#a855f7"
  },
  {
    iconName: "keyboard" as IconKey,
    className: "output::OutputHandler",
    filePath: "src-tauri/src/output/mod.rs",
    glow: "shadow-[0_0_40px_rgba(52,211,153,0.4)] border-emerald-400",
    iconColor: "text-emerald-400",
    bgLit: "bg-emerald-950/80",
    hex: "#34d399"
  }
];

export const stepsEn: Step[] = layers.map((layer, index) => {
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

export const stepsRu: Step[] = layers.map((layer, index) => {
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
