"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Mic, Zap, Brain, Keyboard, Terminal, Cpu } from "lucide-react";
import type { Step, IconKey } from "../data/architecture";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface ArchitectureProps {
  steps: Step[];
}

const IconMap: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  cpu: Cpu,
  mic: Mic,
  zap: Zap,
  brain: Brain,
  keyboard: Keyboard,
};

const SPREAD = 620;
const FOCUS_POP = 80;
const EPSILON = 0.4;

function BoardLayer({
  step,
  index,
  scrollYProgress,
  active,
  stepCount,
}: {
  step: Step;
  index: number;
  scrollYProgress: ReturnType<typeof useScroll>["scrollYProgress"];
  active: number;
  stepCount: number;
}) {
  const i = index;
  const Icon = IconMap[step.iconName];
  const isActive = i === active;

  const currentZ = useTransform(scrollYProgress, (p) => {
    // START COMPACTED: spread = 40 (tightly stacked like a real chip)
    // EXPLODE: expand to 620 over the first 10% of scroll
    let spread = 40; 
    let fly = 0;
    
    if (p < 0.1) {
      spread = 40 + (p / 0.1) * (SPREAD - 40);
    } else {
      spread = SPREAD;
      fly = ((p - 0.1) / 0.9) * 4.99; 
    }

    const distance = i - fly;
    const baseDepth = distance * -spread;

    const pop = Math.abs(distance) < EPSILON ? FOCUS_POP * (1 - Math.abs(distance) / EPSILON) : 0;
    
    // When compacted (p < 0.05), push the whole stack closer to the camera so it's readable
    const globalOffset = p < 0.05 ? 300 : 0;
    
    return baseDepth + pop + globalOffset;
  });

  const opacity = useTransform(
    currentZ,
    [-3200, -1600, -700, 0, 180, 420],
    [0.04,   0.22,  0.6, 1, 0.12, 0],
    { clamp: true }
  );

  const blurValue = useTransform(
    currentZ,
    [-2000, -500, 0, 200, 500],
    ["blur(12px)", "blur(4px)", "blur(0px)", "blur(0px)", "blur(8px)"]
  );

  const isIntro = useTransform(scrollYProgress, (p) => p < 0.05);

  return (
    <motion.div
      style={{
        translateZ: currentZ,
        opacity,
        filter: blurValue,
        transformStyle: "preserve-3d",
      }}
      className={`absolute inset-0 rounded-[40px] border flex items-center justify-center transition-all duration-300
        ${isActive ? step.glow + " bg-black/95 shadow-[0_30px_60px_rgba(0,0,0,0.8)]" : 'border-white/5 bg-zinc-950/80 shadow-[0_10px_30px_rgba(0,0,0,0.5)]'}
      `}
    >
      <div className="absolute inset-0 pcb-grid opacity-20 rounded-[40px]"></div>

      <motion.svg 
        className="absolute inset-0 w-full h-full pointer-events-none opacity-60" 
        viewBox="0 0 500 500"
        style={{ opacity: isIntro.get() ? 0.1 : 0.6 }} // Fade traces when compacted
      >
        <defs>
          <marker id={`arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={step.hex} />
          </marker>
        </defs>
        <path d="M 250 100 L 250 170" stroke={step.hex} strokeWidth="3" strokeDasharray="6 6" markerEnd={`url(#arrow-${i})`} />
        <path d="M 250 330 L 250 400" stroke={step.hex} strokeWidth="3" strokeDasharray="6 6" markerEnd={`url(#arrow-${i})`} />
        <path d="M 100 250 L 140 250" stroke={step.hex} strokeWidth="2" opacity="0.5" />
        <path d="M 360 250 L 400 250" stroke={step.hex} strokeWidth="2" opacity="0.5" />
        <circle cx="250" cy="100" r="4" fill={step.hex} />
        <circle cx="250" cy="400" r="4" fill={step.hex} />
      </motion.svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div style={{ opacity: isIntro.get() ? 0 : 1 }} className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mb-8 shadow-inner">
          Input I/O
        </motion.div>

        <div className="flex items-center gap-8 relative z-10">
          <motion.div style={{ opacity: isIntro.get() ? 0 : 1 }} className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></motion.div>

          <div className={`w-56 h-56 border-2 ${isActive ? step.glow : 'border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]'} bg-[#050505] rounded-3xl flex flex-col items-center justify-center relative transition-all duration-300`}>
            <div className="absolute top-3 left-3 w-2 h-2 rounded-full bg-zinc-800"></div>
            <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-zinc-800"></div>
            <div className="absolute bottom-3 left-3 w-2 h-2 rounded-full bg-zinc-800"></div>
            <div className="absolute bottom-3 right-3 w-2 h-2 rounded-full bg-zinc-800"></div>
            
            <div className={`p-4 rounded-2xl bg-black border border-white/10 mb-4 shadow-inner ${step.iconColor}`}>
              {Icon && <Icon className="w-12 h-12" />}
            </div>
            <motion.div style={{ opacity: isIntro.get() ? 0 : 1 }} className="text-xs font-mono text-white tracking-widest text-center px-4">
              {step.className}
            </motion.div>
          </div>

          <motion.div style={{ opacity: isIntro.get() ? 0 : 1 }} className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></motion.div>
        </div>

        <motion.div style={{ opacity: isIntro.get() ? 0 : 1 }} className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mt-8 shadow-inner">
          Output I/O
        </motion.div>
      </div>
    </motion.div>
  );
}

export default function Architecture({ steps }: ArchitectureProps) {
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    let f = 0;
    if (latest >= 0.1) {
      f = ((latest - 0.1) / 0.9) * 4.99;
    }
    setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(f))));
  });

  const introOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0]);
  const introY = useTransform(scrollYProgress, [0, 0.05], [0, -30]);
  const introPointer = useTransform(scrollYProgress, [0, 0.05], ["auto", "none"]);

  return (
    <section id="architecture" ref={containerRef} className="relative w-full bg-black md:h-[600vh]">
      
      {/* --- MOBILE VIEW: Bento Stack --- */}
      <div className="md:hidden flex flex-col items-center justify-center px-4 py-20 gap-8">
        <div className="text-center mb-8">
           <h2 className="text-4xl font-extrabold text-white">System Layers</h2>
           <p className="text-zinc-400 mt-2">SOLID Rust Architecture</p>
        </div>
        {steps.map((step, i) => {
          const Icon = IconMap[step.iconName];
          return (
            <div key={i} className={`w-full max-w-lg bg-black/60 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden ${step.glow}`}>
              <div className="absolute inset-0 pcb-grid opacity-10"></div>
              <div className="relative z-10 p-6 flex flex-col items-start text-left border-white/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`p-3 rounded-xl bg-black/50 border border-white/10 ${step.iconColor}`}>
                    {Icon && <Icon className="w-6 h-6" />}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono font-bold tracking-widest uppercase" style={{ color: step.hex }}>
                      {step.className}
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
            </div>
          );
        })}
      </div>

      {/* --- DESKTOP VIEW: Exploding Multi-Layer Chip Fly-Through --- */}
      {isDesktop && (
        <div className="hidden md:flex sticky top-0 h-screen w-full flex-row items-center justify-center overflow-hidden px-10 lg:px-20 bg-gradient-to-b from-[#050505] to-[#0a0a0a]">
          
          {/* Left Side: Info Glass */}
          <div className="w-1/2 flex flex-col items-center justify-center z-30 h-full relative">
            <div className="w-full max-w-lg relative">
              
              {/* Intro Card (0% - 5% scroll) */}
              <motion.div
                style={{ opacity: introOpacity, y: introY, pointerEvents: introPointer as any, position: "absolute", width: "100%", zIndex: 40 }}
                className="bg-black/60 backdrop-blur-3xl rounded-[32px] border border-white/20 shadow-2xl shadow-emerald-500/20 overflow-hidden"
              >
                <div className="p-10 relative">
                   <div className="absolute inset-0 pcb-grid opacity-10"></div>
                   <div className="relative z-10">
                     <div className="text-xs font-mono font-bold tracking-widest uppercase mb-1 text-emerald-400">
                       UNDER THE HOOD
                     </div>
                     <h3 className="text-4xl font-extrabold text-white mb-6">
                       System Architecture
                     </h3>
                     <p className="text-zinc-300 text-lg leading-relaxed font-light mb-6">
                       A monolithic Rust core orchestrating OS events, audio streams, and cloud inference. 
                       <br/><br/>
                       <strong>Scroll down</strong> to explode the chip and fly through the layers.
                     </p>
                   </div>
                </div>
              </motion.div>

              {/* Layer Cards (5% - 100% scroll) */}
              <AnimatePresence mode="wait">
                {scrollYProgress.get() >= 0.05 && steps.map((step, i) => (
                  i === active && (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                      transition={{ duration: 0.3 }}
                      className={`absolute top-1/2 -translate-y-1/2 w-full bg-black/40 backdrop-blur-3xl rounded-[32px] border border-white/10 ${step.glow.replace('shadow-', 'shadow-2xl shadow-')} overflow-hidden`}
                    >
                      <div className="p-10 relative">
                         <div className="absolute inset-0 pcb-grid opacity-5"></div>
                         <div className="relative z-10">
                           <div className="flex items-center gap-4 mb-6">
                              <div className={`p-4 rounded-2xl bg-black/80 border border-white/10 shadow-inner ${step.iconColor}`}>
                                {IconMap[step.iconName] && (() => { const I = IconMap[step.iconName]; return <I className="w-8 h-8" /> })()}
                              </div>
                              <div>
                                <div className="text-xs font-mono font-bold tracking-widest uppercase mb-1" style={{ color: step.hex }}>
                                  {step.subtitle}
                                </div>
                                <h3 className="text-4xl font-extrabold text-white">
                                  {step.title}
                                </h3>
                              </div>
                           </div>
                           
                           <p className="text-zinc-300 text-lg leading-relaxed font-light mb-6">
                             {step.desc}
                           </p>
                           
                           <div className={`w-full p-4 rounded-xl bg-[#0d1117]/80 border border-white/5 font-mono text-sm shadow-inner ${step.iconColor} flex flex-col md:flex-row md:items-center justify-between gap-2 overflow-hidden`}>
                             <span className="truncate" title={step.className}>{step.className}</span>
                             <span className="text-zinc-600 text-xs shrink-0">.rs</span>
                           </div>
                         </div>
                      </div>
                    </motion.div>
                  )
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Side: The Exploding 3D Chip Stack */}
          <div className="w-1/2 h-full flex items-center justify-center perspective-[2500px] z-10">
            <motion.div
              className="relative w-[500px] h-[500px]"
              style={{
                transform: "rotateX(60deg) rotateZ(-45deg)",
                transformStyle: "preserve-3d",
              }}
            >
              {steps.map((step, i) => (
                <BoardLayer
                  key={i}
                  step={step}
                  index={i}
                  scrollYProgress={scrollYProgress}
                  active={active}
                  stepCount={steps.length}
                />
              ))}
            </motion.div>
          </div>
        </div>
      )}
    </section>
  );
}
