import type { ReactNode } from "react";
import type { Step } from "../data/architecture";
import Architecture from "./Architecture";
import Footer from "./Footer";
import Hero from "./Hero";
import Navbar from "./Navbar";

interface LandingPageProps {
  lang: "en" | "ru";
  navLinks: { architecture: string; docs: string; github: string };
  hero: {
    badge: string;
    title: ReactNode;
    description: string;
    downloadText: string;
    docsText: string;
  };
  steps: Step[];
}

export default function LandingPage({ lang, navLinks, hero, steps }: LandingPageProps) {
  return (
    <main className="min-h-screen relative flex flex-col items-center bg-black w-full">
      <Navbar lang={lang} links={navLinks} />
      <Hero {...hero} />
      <Architecture steps={steps} />
      <Footer />
    </main>
  );
}
