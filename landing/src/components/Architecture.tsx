"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Mic, Zap, Brain, Keyboard, Terminal, Cpu } from "lucide-react";

interface Step {
  iconName: string;
  title: string;
  className: string;
  subtitle: string;
  desc: string;
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

export default function Architecture({ steps }: ArchitectureProps) {
  const containerRef = useRef(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    // 5 states now. The fly-through math:
    // 0 -> 0.1: Unpacking
    // 0.1 -> 1.0: Flying through 5 layers
    let f = 0;
    if (latest >= 0.1) {
      f = ((latest - 0.1) / 0.9) * 4.99; // 0 to almost 5
    }
    setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(f))));
  });

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
      <div className="hidden md:flex sticky top-0 h-screen w-full flex-row items-center justify-center overflow-hidden px-10 lg:px-20 bg-gradient-to-b from-[#050505] to-[#0a0a0a]">
        
        {/* Left Side: Info Glass */}
        <div className="w-1/2 flex items-center justify-center z-30 h-full">
          <div className="w-full max-w-lg relative">
            <AnimatePresence mode="wait">
              {steps.map((step, i) => (
                i === active && (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    transition={{ duration: 0.3 }}
                    className={`bg-black/40 backdrop-blur-3xl rounded-[32px] border border-white/10 ${step.glow.replace('shadow-', 'shadow-2xl shadow-')} overflow-hidden`}
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
                         
                         <div className={`w-full p-4 rounded-xl bg-[#0d1117]/80 border border-white/5 font-mono text-sm shadow-inner ${step.iconColor} flex items-center justify-between`}>
                           <span>{step.className}</span>
                           <span className="text-zinc-600 text-xs">.rs</span>
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
        <div className="w-1/2 h-[80vh] md:h-full flex items-center justify-center perspective-[2500px] z-10">
          <motion.div 
            className="relative w-[500px] h-[500px]"
            style={{ 
              transform: "rotateX(60deg) rotateZ(-45deg)", 
              transformStyle: "preserve-3d" 
            }}
          >
            {/* 
              Z-Index Fix: We must render the elements in reverse order so that 
              top layers (i=0) appear visually above bottom layers (i=4) when 
              stacking contexts collapse, preventing lower layers from bleeding through.
            */}
            {[...steps].reverse().map((step, revI) => {
              const i = steps.length - 1 - revI;
              const Icon = IconMap[step.iconName];
              
              const currentZ = useTransform(scrollYProgress, (p) => {
                let spread = 60;
                let fly = 0;
                if (p < 0.1) {
                  spread = 60 + (p / 0.1) * 740; 
                } else {
                  spread = 800;
                  fly = ((p - 0.1) / 0.9) * 4.99; 
                }
                return (i - fly) * -spread;
              });

              // Dynamic Z-index: The active layer gets 50. 
              // Layers in the distance get lower z-indexes.
              // Layers behind the camera get 0.
              const dynamicZIndex = useTransform(currentZ, (zVal) => {
                if (zVal > 100) return 0; // Behind camera
                if (zVal > -100 && zVal <= 100) return 50; // Active layer is king
                // Distance layers: the further they are (more negative), the lower the z-index
                return Math.max(1, 40 + Math.round(zVal / 100)); 
              });

              const opacity = useTransform(currentZ, (zVal) => {
                // If the layer is behind the camera (popped off the stack)
                if (zVal > 400) return 0;
                if (zVal > 100) return 0.2; // Keep it dimly visible when passed
                
                // Active or incoming distance
                if (zVal < -3000) return 0.05; // Deep in the well
                if (zVal < -1000) return 0.3;  // Approaching
                return 1; // Active
              });
              
              const isActive = i === active;

              return (
                <motion.div
                  key={i}
                  style={{ 
                    translateZ: currentZ, 
                    opacity: opacity,
                    zIndex: dynamicZIndex,
                  }}
                  className={`absolute inset-0 rounded-[40px] border flex items-center justify-center
                    ${isActive ? step.glow + " bg-black/95 shadow-2xl" : 'border-white/10 bg-zinc-950/95 shadow-[0_10px_30px_rgba(0,0,0,0.8)]'}
                  `}
                >
                  <div className="absolute inset-0 pcb-grid opacity-20 rounded-[40px]"></div>

                  {/* SVG Block Diagram Traces */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60" viewBox="0 0 500 500">
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
                  </svg>

                  {/* Block Diagram Components */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    
                    {/* Top Data Port */}
                    <div className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mb-8 shadow-inner">
                      Input I/O
                    </div>

                    <div className="flex items-center gap-8 relative z-10">
                      {/* Left Helper Node */}
                      <div className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></div>

                      {/* Main Class Chip */}
                      <div className={`w-56 h-56 border-2 ${isActive ? step.glow : 'border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]'} bg-[#050505] rounded-3xl flex flex-col items-center justify-center relative transition-all duration-300`}>
                        <div className="absolute top-3 left-3 w-2 h-2 rounded-full bg-zinc-800"></div>
                        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-zinc-800"></div>
                        <div className="absolute bottom-3 left-3 w-2 h-2 rounded-full bg-zinc-800"></div>
                        <div className="absolute bottom-3 right-3 w-2 h-2 rounded-full bg-zinc-800"></div>
                        
                        <div className={`p-4 rounded-2xl bg-black border border-white/10 mb-4 shadow-inner ${step.iconColor}`}>
                          {Icon && <Icon className="w-12 h-12" />}
                        </div>
                        <div className="text-xs font-mono text-white tracking-widest text-center px-4">
                          {step.className}
                        </div>
                      </div>

                      {/* Right Helper Node */}
                      <div className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></div>
                    </div>

                    {/* Bottom Data Port */}
                    <div className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mt-8 shadow-inner">
                      Output I/O
                    </div>

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
