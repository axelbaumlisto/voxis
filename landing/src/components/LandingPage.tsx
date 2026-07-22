"use client";

import { useTranslation } from "react-i18next";
import Navbar from "./Navbar";
import Hero from "./Hero";
import Architecture from "./Architecture";
import Footer from "./Footer";
import { stepsEn, stepsRu } from "../data/architecture";

export default function LandingPage({ lang }: { lang: "en" | "ru" }) {
  const isRu = lang === "ru";
  
  const navLinks = isRu
    ? { architecture: "Архитектура", docs: "Документация", github: "GitHub" }
    : { architecture: "Architecture", docs: "Documentation", github: "GitHub" };

  const heroProps = isRu
    ? {
        badge: "Tauri v2 + Ядро на Rust",
        title: <>Диктуй код. <br /> Пиши со скоростью мысли.</>,
        description: "Абсолютно приватный, молниеносный десктопный движок для диктовки.",
        downloadText: "Скачать (Win/Mac/Linux)",
        docsText: "Документация",
      }
    : {
        badge: "Tauri v2 + Rust Core",
        title: <>Speak your code. <br /> Write at lightspeed.</>,
        description: "A completely private, blazing fast desktop dictation engine.",
        downloadText: "Download Latest",
        docsText: "Read Docs",
      };

  return (
    <main className="min-h-screen relative flex flex-col items-center bg-black w-full">
      <Navbar lang={lang} links={navLinks} />
      <Hero {...heroProps} />
      <Architecture steps={isRu ? stepsRu : stepsEn} />
      <Footer lang={lang} />
    </main>
  );
}
