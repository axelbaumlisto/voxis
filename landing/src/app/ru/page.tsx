"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Mic, Zap, Brain, Keyboard, Download, BookOpen, Globe, Cpu } from "lucide-react";

const architectureSteps = [
  {
    icon: <Mic className="w-12 h-12" />,
    title: "Глобальный Хоткей",
    subtitle: "СЛОЙ 1 // ПОВЕРХНОСТЬ ОС",
    desc: "Перехватывает шорткат глобально с нулевой задержкой, минуя песочницы приложений для мгновенного захвата намерения.",
    glow: "shadow-[0_0_40px_rgba(34,211,238,0.4)] border-cyan-400",
    iconColor: "text-cyan-400",
    bgLit: "bg-cyan-950/80",
    hex: "#22d3ee"
  },
  {
    icon: <Zap className="w-12 h-12" />,
    title: "Ядро на Rust",
    subtitle: "СЛОЙ 2 // ПОД КАПОТОМ",
    desc: "Захватывает сырой звук из ALSA/PipeWire через CPAL. Поток безопасен для памяти, буферизуется асинхронно и кодируется в WAV.",
    glow: "shadow-[0_0_40px_rgba(59,130,246,0.4)] border-blue-500",
    iconColor: "text-blue-500",
    bgLit: "bg-blue-950/80",
    hex: "#3b82f6"
  },
  {
    icon: <Brain className="w-12 h-12" />,
    title: "Whisper AI Inference",
    subtitle: "СЛОЙ 3 // ОБЛАЧНАЯ НЕЙРОСЕТЬ",
    desc: "Звук попадает на LPU процессоры Groq (модель whisper-large-v3) или OpenAI. Нейросеть разбирает технический жаргон за миллисекунды.",
    glow: "shadow-[0_0_40px_rgba(168,85,247,0.4)] border-purple-500",
    iconColor: "text-purple-500",
    bgLit: "bg-purple-950/80",
    hex: "#a855f7"
  },
  {
    icon: <Keyboard className="w-12 h-12" />,
    title: "Симуляция ввода",
    subtitle: "СЛОЙ 4 // ВОЗВРАТ НА ПОВЕРХНОСТЬ",
    desc: "Оркестратор на Rust получает текст и симулирует нативные нажатия клавиш, печатая результат прямо в ваше активное окно.",
    glow: "shadow-[0_0_40px_rgba(52,211,153,0.4)] border-emerald-400",
    iconColor: "text-emerald-400",
    bgLit: "bg-emerald-950/80",
    hex: "#34d399"
  },
];

export default function HomeRu() {
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    if (latest < 0.25) setActive(0);
    else if (latest < 0.5) setActive(1);
    else if (latest < 0.75) setActive(2);
    else setActive(3);
  });

  return (
    <main className="min-h-screen relative flex flex-col items-center bg-black overflow-hidden">
      
      {/* Navbar */}
      <nav className="w-full max-w-6xl mx-auto px-6 py-6 flex justify-between items-center absolute top-0 left-1/2 -translate-x-1/2 z-50 backdrop-blur-sm bg-transparent border-b border-white/5">
        <div className="text-2xl font-black tracking-tighter text-white drop-shadow-lg flex items-center gap-2">
          <Cpu className="w-6 h-6 text-emerald-400" /> VOXIS
        </div>
        <div className="flex items-center gap-6 text-sm text-zinc-300 font-medium">
          <a href="#architecture" className="hover:text-white transition-colors hidden md:block">Архитектура</a>
          <a href="https://docs.voxis.top/ru/" className="hover:text-white transition-colors hidden md:block">Документация</a>
          <a href="https://github.com/axelbaumlisto/voice" className="hover:text-white transition-colors hidden md:block">GitHub</a>
          
          <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full border border-white/10 ml-4 backdrop-blur-md">
            <Globe className="w-4 h-4 text-zinc-400" />
            <a href="/" className="hover:text-white transition-colors">EN</a>
            <span className="text-zinc-600">|</span>
            <span className="text-white font-bold">RU</span>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="w-full min-h-screen flex flex-col items-center justify-center text-center px-4 relative z-10 pt-20">
        <div className="absolute inset-0 bg-grid opacity-30 z-[-1]"></div>
        <div className="absolute top-[30%] left-[50%] -translate-x-1/2 w-[60vw] h-[40vw] bg-blue-600/20 rounded-full mix-blend-screen filter blur-[150px] z-[-1]"></div>
        
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/40 border border-white/10 text-xs font-semibold text-zinc-300 mb-8 backdrop-blur-md"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></span>
          Tauri v2 + Rust Core
        </motion.div>
        
        <motion.h1 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.1, ease: "easeOut" }}
          className="text-5xl md:text-8xl font-extrabold tracking-tighter mb-6 text-gradient max-w-5xl"
        >
          Диктуй код. <br /> Пиши со скоростью мысли.
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
          className="text-lg md:text-2xl text-zinc-400 max-w-2xl mb-12 font-light"
        >
          Абсолютно приватный, молниеносный десктопный движок для диктовки. Зажми шорткат, говори, и ИИ напечатает текст за тебя в любом приложении.
        </motion.p>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
          className="flex flex-col sm:flex-row gap-5"
        >
          <a href="https://github.com/axelbaumlisto/voice/releases" className="flex items-center justify-center gap-2 px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-zinc-200 transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(255,255,255,0.2)]">
            <Download className="w-5 h-5" /> Скачать (Win/Mac/Linux)
          </a>
          <a href="https://docs.voxis.top/ru/" className="flex items-center justify-center gap-2 px-8 py-4 bg-zinc-900/50 text-white font-bold rounded-full border border-white/20 hover:bg-zinc-800 backdrop-blur-md transition-all">
            <BookOpen className="w-5 h-5" /> Документация
          </a>
        </motion.div>
      </section>

      {/* PCB Isometric Stack Section */}
      <section id="architecture" ref={containerRef} className="relative w-full h-[400vh] bg-zinc-950">
        
        <div className="sticky top-0 h-screen w-full flex flex-col md:flex-row items-center justify-center overflow-hidden px-6 lg:px-20">
          
          {/* Left Text Block */}
          <div className="w-full md:w-1/2 flex items-center justify-center z-20 h-[40vh] md:h-full mt-20 md:mt-0">
            <div className="w-full max-w-lg relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 20, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -20, filter: "blur(10px)" }}
                  transition={{ duration: 0.4 }}
                  className="bg-black/60 backdrop-blur-xl p-8 lg:p-10 rounded-3xl border border-white/10 shadow-2xl"
                >
                  <div className="text-sm font-mono font-bold mb-3 tracking-widest" style={{ color: architectureSteps[active].hex }}>
                    {architectureSteps[active].subtitle}
                  </div>
                  <h3 className="text-3xl lg:text-5xl font-extrabold mb-4 text-white">
                    {architectureSteps[active].title}
                  </h3>
                  <p className="text-zinc-300 text-lg leading-relaxed font-light">
                    {architectureSteps[active].desc}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Right Isometric PCB Stack */}
          <div className="w-full md:w-1/2 h-[60vh] md:h-full flex items-center justify-center perspective-1500 z-10">
            
            <motion.div 
              className="relative w-[280px] h-[280px] md:w-[350px] md:h-[350px]"
              style={{ 
                transform: "rotateX(55deg) rotateZ(-45deg)", 
                transformStyle: "preserve-3d" 
              }}
            >
              {architectureSteps.map((step, i) => {
                const isActive = i === active;
                const baseZ = (3 - i) * 120; 
                
                return (
                  <motion.div
                    key={i}
                    animate={{
                      translateZ: baseZ,
                      scale: isActive ? 1.05 : 1,
                    }}
                    transition={{ duration: 0.5, type: "spring" }}
                    className={`absolute inset-0 rounded-[40px] border-2 transition-all duration-500 flex items-center justify-center overflow-hidden
                      ${isActive ? step.glow + " " + step.bgLit : 'border-white/20 bg-black/80 backdrop-blur-sm'}
                    `}
                  >
                    <div className="absolute inset-0 pcb-grid opacity-30"></div>
                    
                    <div className={`absolute inset-0 opacity-20 ${isActive ? 'animate-pulse' : ''}`}>
                      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                        <path d="M 50 50 L 100 50 L 150 100 L 250 100" fill="transparent" stroke={step.hex} strokeWidth="4" />
                        <path d="M 250 200 L 150 200 L 100 250 L 50 250" fill="transparent" stroke={step.hex} strokeWidth="4" />
                        <circle cx="50" cy="50" r="5" fill={step.hex} />
                        <circle cx="250" cy="100" r="5" fill={step.hex} />
                      </svg>
                    </div>

                    <div className={`relative z-10 p-6 rounded-2xl bg-black/50 backdrop-blur-md border border-white/10 ${isActive ? step.iconColor : 'text-zinc-600'}`}>
                      {step.icon}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full py-12 text-center text-zinc-500 text-sm border-t border-white/5 z-10 bg-black">
        <p>&copy; 2026 Voxis (SoupaWhisper) Project. Open source under the MIT License.</p>
      </footer>
    </main>
  );
}
