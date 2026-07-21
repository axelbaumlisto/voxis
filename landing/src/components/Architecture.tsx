"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Mic, Zap, Brain, Keyboard, Terminal, Cpu } from "lucide-react";

interface Step {
  iconName: string;
  title: string;
  className: string;
  subtitle: string;
  desc: string;
  code: string;
  glow: string;
  iconColor: string;
  bgLit: string;
  hex: string;
}

interface ArchitectureProps {
  steps: Step[];
}

const IconMap: Record<string, any> = {
  terminal: Terminal,
  cpu: Cpu,
  mic: Mic,
  zap: Zap,
  brain: Brain,
  keyboard: Keyboard,
};

// Функция подсветки синтаксиса Rust (простая)
const highlightCode = (code: string, colorClass: string) => {
  return code.split('\n').map((line, idx) => {
    const highlighted = line
      .replace(/pub struct|pub fn|impl|async fn|move/g, '<span class="text-pink-400">$&</span>')
      .replace(/self|mut|String|Result|Arc|Mutex|Sender|Vec|u8/g, '<span class="text-blue-400">$&</span>')
      .replace(/Listener|Orchestrator|Recorder|GroqClient|AutoType|Stage/g, `<span class="${colorClass}">$&</span>`)
      .replace(/\/\/.*/g, '<span class="text-zinc-500 italic">$&</span>');
    return (
      <div key={idx} dangerouslySetInnerHTML={{__html: highlighted}} />
    );
  });
};

export default function Architecture({ steps }: ArchitectureProps) {
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    // 5 states now
    if (latest < 0.20) setActive(0);
    else if (latest < 0.40) setActive(1);
    else if (latest < 0.60) setActive(2);
    else if (latest < 0.80) setActive(3);
    else setActive(4);
  });

  return (
    <section id="architecture" ref={containerRef} className="relative w-full bg-black md:h-[500vh]">
      
      {/* --- MOBILE VIEW: Bento Stack --- */}
      <div className="md:hidden flex flex-col items-center justify-center px-4 py-20 gap-8">
        <div className="text-center mb-8">
           <h2 className="text-4xl font-extrabold text-white">The Stack</h2>
           <p className="text-zinc-400 mt-2">Diving through the SOLID layers</p>
        </div>
        {steps.map((step, i) => {
          const Icon = IconMap[step.iconName];
          return (
            <div key={i} className={`w-full max-w-lg bg-black/60 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden ${step.glow}`}>
              <div className="absolute inset-0 pcb-grid opacity-10"></div>
              
              <div className="relative z-10 p-6 flex flex-col items-start text-left border-b border-white/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`p-3 rounded-xl bg-black/50 border border-white/10 ${step.iconColor}`}>
                    {Icon && <Icon className="w-6 h-6" />}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono font-bold tracking-widest uppercase" style={{ color: step.hex }}>
                      {step.subtitle}
                    </div>
                    <h3 className="text-xl font-extrabold text-white">
                      {step.title}
                    </h3>
                  </div>
                </div>
                <p className="text-zinc-300 text-sm leading-relaxed font-light mb-4">
                  {step.desc}
                </p>
              </div>

              {/* Code Snippet on Mobile */}
              <div className="relative z-10 p-4 bg-[#0d1117]/80">
                <div className="text-xs font-mono text-zinc-500 mb-2">{step.className}</div>
                <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto text-zinc-300">
                  <code>{highlightCode(step.code, step.iconColor)}</code>
                </pre>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- DESKTOP VIEW: Isometric Deep Dive --- */}
      <div className="hidden md:flex sticky top-0 h-screen w-full flex-row items-center justify-center overflow-hidden px-10 lg:px-20">
        
        {/* Left Side: Info & Code */}
        <div className="w-1/2 flex items-center justify-center z-20 h-full">
          <div className="w-full max-w-xl relative">
            <AnimatePresence mode="wait">
              {steps.map((step, i) => (
                i === active && (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    transition={{ duration: 0.3 }}
                    className={`bg-black/60 backdrop-blur-2xl rounded-[32px] border ${step.glow.replace('shadow-', 'hover:shadow-')} shadow-2xl overflow-hidden`}
                  >
                    {/* Header Info */}
                    <div className="p-8 lg:p-10 relative">
                       <div className="absolute inset-0 pcb-grid opacity-10"></div>
                       <div className="relative z-10">
                         <div className="flex items-center gap-4 mb-6">
                            <div className={`p-4 rounded-2xl bg-black/50 border border-white/10 ${step.iconColor}`}>
                              {IconMap[step.iconName] && (() => { const I = IconMap[step.iconName]; return <I className="w-8 h-8" /> })()}
                            </div>
                            <div>
                              <div className="text-xs font-mono font-bold tracking-widest uppercase" style={{ color: step.hex }}>
                                {step.subtitle}
                              </div>
                              <h3 className="text-4xl font-extrabold text-white">
                                {step.title}
                              </h3>
                            </div>
                         </div>
                         <p className="text-zinc-300 text-lg leading-relaxed font-light">
                           {step.desc}
                         </p>
                       </div>
                    </div>

                    {/* Code Snippet Dark Theme */}
                    <div className="bg-[#0d1117] border-t border-white/5 p-8 relative">
                      {/* Fake mac window buttons */}
                      <div className="absolute top-4 left-4 flex gap-1.5 opacity-50">
                        <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      </div>
                      <div className="text-center text-xs font-mono text-zinc-500 mb-4 tracking-widest">{step.className}.rs</div>
                      
                      <pre className="text-sm font-mono leading-loose overflow-x-auto text-zinc-300">
                        <code>{highlightCode(step.code, step.iconColor)}</code>
                      </pre>
                    </div>
                  </motion.div>
                )
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Side: 5-Layer PCB Stack */}
        <div className="w-1/2 h-[80vh] md:h-full flex items-center justify-center perspective-[2000px] z-10">
          <motion.div 
            className="relative w-[400px] h-[400px]"
            style={{ 
              transform: "rotateX(60deg) rotateZ(-45deg)", 
              transformStyle: "preserve-3d" 
            }}
          >
            {steps.map((step, i) => {
              const isActive = i === active;
              const isPast = i < active;
              
              // Z calculation: Top layer is i=0.
              // When active, the layer raises up slightly.
              // Past layers drop deep down.
              const baseZ = (4 - i) * 120; 
              let activeZ = baseZ;
              let opacity = 0.2;
              
              if (isActive) {
                activeZ = baseZ + 80;
                opacity = 1;
              } else if (isPast) {
                activeZ = baseZ - 400; // Drop through the floor
                opacity = 0;
              }

              const Icon = IconMap[step.iconName];
              
              return (
                <motion.div
                  key={i}
                  animate={{
                    translateZ: activeZ,
                    opacity: opacity,
                    scale: isActive ? 1.05 : 1,
                  }}
                  transition={{ duration: 0.7, type: "spring", bounce: 0.15 }}
                  className={`absolute inset-0 rounded-[50px] border flex items-center justify-center
                    ${isActive ? step.glow + " " + step.bgLit : 'border-white/10 bg-zinc-950 backdrop-blur-md'}
                  `}
                  style={{ transformStyle: "preserve-3d" }}
                >
                  <div className="absolute inset-0 pcb-grid opacity-40 rounded-[50px]"></div>
                  
                  <div className={`absolute inset-0 opacity-30 ${isActive ? 'animate-pulse' : ''}`}>
                    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                      <path d="M 60 60 L 120 60 L 180 120 L 300 120" fill="transparent" stroke={step.hex} strokeWidth="5" />
                      <path d="M 300 240 L 180 240 L 120 300 L 60 300" fill="transparent" stroke={step.hex} strokeWidth="5" />
                      <path d="M 200 60 L 250 60 L 300 110" fill="transparent" stroke={step.hex} strokeWidth="2" strokeDasharray="5,5" />
                      <circle cx="60" cy="60" r="6" fill={step.hex} />
                      <circle cx="300" cy="120" r="6" fill={step.hex} />
                      <circle cx="60" cy="300" r="6" fill={step.hex} />
                    </svg>
                  </div>

                  {isActive && (
                     <div className="absolute top-6 left-6 w-3 h-3 rounded-full bg-white animate-ping shadow-[0_0_15px_#fff]"></div>
                  )}

                  <div 
                    className={`relative z-10 p-8 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl ${isActive ? step.iconColor : 'text-zinc-600'}`}
                    style={{ transform: "translateZ(40px)" }}
                  >
                    {Icon && <Icon className="w-16 h-16" />}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

      </div>
    </section>
  );
}
