"use client";

import { motion } from "framer-motion";
import { Download, BookOpen } from "lucide-react";
import Container from "./ui/Container";

interface HeroProps {
  badge: string;
  title: React.ReactNode;
  description: string;
  downloadText: string;
  docsText: string;
}

export default function Hero({ badge, title, description, downloadText, docsText }: HeroProps) {
  return (
    <section className="section-hero flex flex-col items-center justify-center text-center relative z-10 min-h-screen">
      <div className="absolute inset-0 bg-grid opacity-30 z-[-1]"></div>
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 w-[60vw] h-[40vw] bg-[var(--color-accent-blue)]/20 rounded-full mix-blend-screen blur-[150px] z-[-1]"></div>

      <Container width="prose" className="flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="badge mb-[var(--space-lg)]"
        >
          <span className="badge-dot animate-pulse" />
          {badge}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.1, ease: "easeOut" }}
          className="text-5xl md:text-8xl font-extrabold tracking-tighter mb-[var(--space-md)] text-gradient"
        >
          {title}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
          className="text-lg md:text-2xl text-[var(--color-muted)] mb-[var(--space-xl)] font-light"
        >
          {description}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
          className="flex flex-col sm:flex-row gap-[var(--space-sm)]"
        >
          <a href="https://github.com/axelbaumlisto/voice/releases" className="btn-base btn-primary">
            <Download className="w-5 h-5" /> {downloadText}
          </a>
          <a href="https://docs.voxis.top" className="btn-base btn-secondary">
            <BookOpen className="w-5 h-5" /> {docsText}
          </a>
        </motion.div>
      </Container>
    </section>
  );
}
