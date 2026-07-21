import { Globe, Cpu } from "lucide-react";
import Link from "next/link";

interface NavbarProps {
  lang: "en" | "ru";
  links: { architecture: string; docs: string; github: string };
}

export default function Navbar({ lang, links }: NavbarProps) {
  return (
    <nav className="w-full max-w-6xl mx-auto px-6 py-6 flex justify-between items-center absolute top-0 left-1/2 -translate-x-1/2 z-50 backdrop-blur-sm bg-transparent border-b border-white/5">
      <div className="text-2xl font-black tracking-tighter text-white drop-shadow-lg flex items-center gap-2">
        <Cpu className="w-6 h-6 text-emerald-400" /> VOXIS
      </div>
      <div className="flex items-center gap-6 text-sm text-zinc-300 font-medium">
        <a href="#architecture" className="hover:text-white transition-colors hidden md:block">{links.architecture}</a>
        <a href="https://docs.voxis.top" className="hover:text-white transition-colors hidden md:block">{links.docs}</a>
        <a href="https://github.com/axelbaumlisto/voice" className="hover:text-white transition-colors hidden md:block">{links.github}</a>
        
        <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full border border-white/10 ml-4 backdrop-blur-md">
          <Globe className="w-4 h-4 text-zinc-400" />
          {lang === "en" ? (
            <>
              <span className="text-white font-bold">EN</span>
              <span className="text-zinc-600">|</span>
              <Link href="/ru" className="hover:text-white transition-colors">RU</Link>
            </>
          ) : (
            <>
              <Link href="/" className="hover:text-white transition-colors">EN</Link>
              <span className="text-zinc-600">|</span>
              <span className="text-white font-bold">RU</span>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
