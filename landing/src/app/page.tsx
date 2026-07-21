import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Architecture from "../components/Architecture";
import Footer from "../components/Footer";
import { stepsEn } from "../data/architecture";

export default function Home() {
  return (
    <main className="min-h-screen relative flex flex-col items-center bg-black w-full">
      <Navbar 
        lang="en" 
        links={{ architecture: "Architecture", docs: "Documentation", github: "GitHub" }} 
      />
      <Hero 
        badge="Tauri v2 + Rust Core"
        title={<>Speak your code. <br /> Write at lightspeed.</>}
        description="A completely private, blazing fast desktop dictation engine."
        downloadText="Download Latest"
        docsText="Read Docs"
      />
      <Architecture steps={stepsEn} />
      <Footer />
    </main>
  );
}
