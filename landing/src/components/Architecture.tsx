"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useMotionValueEvent, AnimatePresence } from "framer-motion";
import { Mic, Zap, Brain, Keyboard, Terminal, Cpu } from "lucide-react";
import type { Step, IconKey } from "../data/architecture";
import { useMediaQuery } from "../hooks/useMediaQuery";
import SectionHeading from "./ui/SectionHeading";

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
const FOCUS_POP = 120;
const EPSILON = 0.5;
const UNPACK_END = 0.1; // scroll fraction spent "unpacking" the stack

/**
 * Shared fly-through progression. `fly` ranges from 0 to (stepCount - 1) + a hair,
 * so every layer (including the last) becomes the focused one. Data-driven, not hard-coded to 5.
 */
function flyProgress(p: number, stepCount: number): { spread: number; fly: number } {
  const maxFly = Math.max(stepCount - 1, 0) + 0.499;
  if (p < UNPACK_END) {
    return { spread: 60 + (p / UNPACK_END) * (SPREAD - 60), fly: 0 };
  }
  return { spread: SPREAD, fly: ((p - UNPACK_END) / (1 - UNPACK_END)) * maxFly };
}

/** A single depth-sorted PCB layer. Occlusion is pure geometry (no z-index). */
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
    const { spread, fly } = flyProgress(p, stepCount);
    const distance = i - fly;
    const baseDepth = distance * -spread;
    const pop = Math.abs(distance) < EPSILON ? FOCUS_POP * (1 - Math.abs(distance) / EPSILON) : 0;
    return baseDepth + pop;
  });

  const opacity = useTransform(
    currentZ,
    [-3200, -1600, -700, 0, 180, 420],
    [0.04, 0.22, 0.6, 1, 0.12, 0],
    { clamp: true }
  );

  const blur = useTransform(
    currentZ,
    [-3200, -1500, -600, 0, 200],
    ["blur(14px)", "blur(8px)", "blur(3px)", "blur(0px)", "blur(8px)"],
    { clamp: true }
  );

  const scale = useTransform(currentZ, [-200, 0, 200], [0.98, 1.04, 0.98], { clamp: true });

  return (
    <motion.div
      style={{
        translateZ: currentZ,
        opacity,
        filter: blur,
        scale,
        transformStyle: "preserve-3d",
      }}
      className={`absolute inset-0 rounded-[40px] border flex items-center justify-center
        ${isActive ? step.glow + " bg-black/95 shadow-2xl" : "border-white/5 bg-zinc-950/85 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"}
      `}
    >
      <div className={`absolute inset-0 pcb-grid rounded-[40px] ${isActive ? "opacity-30" : "opacity-20"}`}></div>

      {/* SVG Block Diagram Traces */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 500 500"
        style={isActive ? { filter: `drop-shadow(0 0 4px ${step.hex})`, opacity: 1 } : { opacity: 0.25 }}
      >
        <defs>
          <marker id={`arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={step.hex} />
          </marker>
        </defs>
        <path
          d="M 250 100 L 250 170"
          stroke={step.hex}
          strokeWidth="3"
          strokeDasharray="6 6"
          markerEnd={`url(#arrow-${i})`}
          style={isActive ? { animation: "traceFlow 1.1s linear infinite" } : undefined}
        />
        <path
          d="M 250 330 L 250 400"
          stroke={step.hex}
          strokeWidth="3"
          strokeDasharray="6 6"
          markerEnd={`url(#arrow-${i})`}
          style={isActive ? { animation: "traceFlow 1.1s linear infinite" } : undefined}
        />
        <path d="M 100 250 L 140 250" stroke={step.hex} strokeWidth="2" opacity="0.5" />
        <path d="M 360 250 L 400 250" stroke={step.hex} strokeWidth="2" opacity="0.5" />
        <circle cx="250" cy="100" r="4" fill={step.hex} />
        <circle cx="250" cy="400" r="4" fill={step.hex} />
      </svg>

      {/* Block Diagram Components */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mb-8 shadow-inner">
          Input I/O
        </div>

        <div className="flex items-center gap-8 relative z-10">
          <div className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></div>

          <div className={`w-56 h-56 border-2 ${isActive ? step.glow : "border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]"} bg-[var(--color-surface-2)] rounded-3xl flex flex-col items-center justify-center relative transition-all duration-300`}>
            <div className={`absolute top-3 left-3 w-2 h-2 rounded-full ${isActive ? "" : "bg-zinc-800"}`} style={isActive ? { backgroundColor: step.hex, opacity: 0.6 } : undefined}></div>
            <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${isActive ? "" : "bg-zinc-800"}`} style={isActive ? { backgroundColor: step.hex, opacity: 0.6 } : undefined}></div>
            <div className={`absolute bottom-3 left-3 w-2 h-2 rounded-full ${isActive ? "" : "bg-zinc-800"}`} style={isActive ? { backgroundColor: step.hex, opacity: 0.6 } : undefined}></div>
            <div className={`absolute bottom-3 right-3 w-2 h-2 rounded-full ${isActive ? "" : "bg-zinc-800"}`} style={isActive ? { backgroundColor: step.hex, opacity: 0.6 } : undefined}></div>

            <div className={`p-4 rounded-2xl bg-black border border-white/10 mb-4 shadow-inner ${step.iconColor}`}>
              {Icon && <Icon className="w-12 h-12" />}
            </div>
            <div className="text-xs font-mono text-white tracking-widest text-center px-4">
              {step.className}
            </div>
          </div>

          <div className="w-12 h-32 bg-white/5 border border-white/10 rounded-md shadow-inner"></div>
        </div>

        <div className="w-32 h-8 bg-white/5 border border-white/10 rounded-md flex items-center justify-center text-[10px] font-mono text-zinc-500 mt-8 shadow-inner">
          Output I/O
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Desktop-only fly-through. Mounted only when the viewport is >= 768px, so its
 * Framer Motion hooks (useScroll / useMotionValueEvent / per-layer useTransform)
 * never run on mobile. Receives the SAME containerRef the parent puts on the
 * <section>, so the useScroll math is identical to the previous inline version.
 */
function ArchitectureDesktop({
  containerRef,
  steps,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  steps: Step[];
}) {
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const { fly } = flyProgress(latest, steps.length);
    const next = Math.min(steps.length - 1, Math.max(0, Math.round(fly)));
    // Only update when the rounded index actually changes (avoids per-tick re-renders).
    setActive((prev) => (prev === next ? prev : next));
  });

  return (
    <div className="hidden md:flex sticky top-0 h-screen w-full flex-row items-center justify-center overflow-hidden px-10 lg:px-20 bg-gradient-to-b from-[var(--color-surface-2)] to-[var(--color-surface)]">
      {/* Bridge heading — links the centered hero to the left-anchored layers */}
      <SectionHeading
        eyebrow="// SYSTEM ARCHITECTURE"
        eyebrowColor="var(--color-muted)"
        title="Under the hood"
        size="sm"
        gradient
        className="absolute top-[max(6vh,var(--space-2xl))] left-1/2 -translate-x-1/2 z-40 text-center pointer-events-none [&>div:first-child]:mb-2 lg:[&>h2]:text-4xl"
      />

      {/* Left Side: Info Glass */}
      <div className="w-1/2 flex items-center justify-center z-30 h-full">
        <div className="w-full max-w-[var(--container-card)] relative">
          <AnimatePresence mode="wait">
            {steps.map(
              (step, i) =>
                i === active && (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                    transition={{ duration: 0.3 }}
                    className={`glass-card glass-card-max ${step.glow.replace("shadow-", "shadow-2xl shadow-")}`}
                  >
                    <div className="p-10 relative">
                      <div className="absolute inset-0 pcb-grid opacity-5"></div>
                      <div className="relative z-10">
                        <div className="flex items-center gap-4 mb-6">
                          <div className={`glass-tile p-4 ${step.iconColor}`}>
                            {IconMap[step.iconName] &&
                              (() => {
                                const I = IconMap[step.iconName];
                                return <I className="w-8 h-8" />;
                              })()}
                          </div>
                          <div>
                            <div className="pill mb-1" style={{ color: step.hex }}>
                              {step.subtitle}
                            </div>
                            <h3 className="text-4xl font-extrabold text-white">{step.title}</h3>
                          </div>
                        </div>

                        <p className="text-[var(--color-foreground)] text-lg leading-relaxed font-light mb-6">
                          {step.desc}
                        </p>

                        <div className={`w-full pill-code ${step.iconColor}`} style={{ fontFamily: "var(--font-mono)" }}>
                          <span>{step.className}</span>
                          <span className="text-zinc-600 text-xs">{step.filePath}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right Side: The Exploding 3D Chip Stack (pure depth-sorted, no z-index) */}
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
  );
}

export default function Architecture({ steps }: ArchitectureProps) {
  const containerRef = useRef<HTMLElement>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  return (
    <section id="architecture" ref={containerRef} className="section-pinned relative bg-black md:h-[600vh]">
      {/* --- MOBILE VIEW: Bento Stack --- */}
      <div className="md:hidden flex flex-col items-center justify-center px-[var(--space-md)] py-[var(--space-2xl)] gap-[var(--space-lg)]">
        <SectionHeading
          title="System Layers"
          description="SOLID Rust Architecture"
          size="md"
          className="mb-[var(--space-lg)] [&>p]:mt-2 [&>p]:font-normal"
        />
        {steps.map((step, i) => {
          const Icon = IconMap[step.iconName];
          return (
            <div key={i} className={`w-full max-w-[var(--container-card)] glass-card glass-card-strong ${step.glow}`}>
              <div className="absolute inset-0 pcb-grid opacity-10"></div>
              <div className="relative z-10 p-6 flex flex-col items-start text-left">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`glass-tile p-3 ${step.iconColor}`}>
                    {Icon && <Icon className="w-6 h-6" />}
                  </div>
                  <div>
                    <div className="pill text-[10px]" style={{ color: step.hex }}>
                      {step.subtitle}
                    </div>
                    <h3 className="text-xl font-extrabold text-white">{step.title}</h3>
                  </div>
                </div>
                <p className="text-[var(--color-foreground)] text-sm leading-relaxed font-light mb-4">
                  {step.desc}
                </p>
                <div className={`w-full pill-code text-xs ${step.iconColor}`} style={{ fontFamily: "var(--font-mono)" }}>
                  {step.className}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- DESKTOP VIEW: Exploding Multi-Layer Chip Fly-Through --- */}
      {isDesktop && <ArchitectureDesktop containerRef={containerRef} steps={steps} />}
    </section>
  );
}
