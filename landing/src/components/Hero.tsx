"use client";

import { motion } from "framer-motion";
import { Download, BookOpen } from "lucide-react";

interface HeroProps {
  badge: string;
  title: React.ReactNode;
  description: string;
  downloadText: string;
  docsText: string;
}

export default function Hero({ badge, title, description, downloadText, docsText }: HeroProps) {
  return (
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
        {badge}
      </motion.div>
      
      <motion.h1 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.1, ease: "easeOut" }}
        className="text-5xl md:text-8xl font-extrabold tracking-tighter mb-6 text-gradient max-w-5xl"
      >
        {title}
      </motion.h1>
      
      <motion.p 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
        className="text-lg md:text-2xl text-zinc-400 max-w-2xl mb-12 font-light"
      >
        {description}
      </motion.p>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
        className="flex flex-col sm:flex-row gap-5"
      >
        <a href="https://github.com/axelbaumlisto/voice/releases" className="flex items-center justify-center gap-2 px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-zinc-200 transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(255,255,255,0.2)]">
          <Download className="w-5 h-5" /> {downloadText}
        </a>
        <a href="https://docs.voxis.top" className="flex items-center justify-center gap-2 px-8 py-4 bg-zinc-900/50 text-white font-bold rounded-full border border-white/20 hover:bg-zinc-800 backdrop-blur-md transition-all">
          <BookOpen className="w-5 h-5" /> {docsText}
        </a>
      </motion.div>
    </section>
  );
}
