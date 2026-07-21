import Navbar from "../../components/Navbar";
import Hero from "../../components/Hero";
import Architecture from "../../components/Architecture";
import Footer from "../../components/Footer";
import { stepsRu } from "../../data/architecture";

export default function HomeRu() {
  return (
    <main className="min-h-screen relative flex flex-col items-center bg-black w-full">
      <Navbar 
        lang="ru" 
        links={{ architecture: "Архитектура", docs: "Документация", github: "GitHub" }} 
      />
      <Hero 
        badge="Tauri v2 + Ядро на Rust"
        title={<>Диктуй код. <br /> Пиши со скоростью мысли.</>}
        description="Абсолютно приватный, молниеносный десктопный движок для диктовки."
        downloadText="Скачать (Win/Mac/Linux)"
        docsText="Документация"
      />
      <Architecture steps={stepsRu} />
      <Footer />
    </main>
  );
}
