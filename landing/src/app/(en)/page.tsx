import LandingPage from "../../components/LandingPage";
import { stepsEn } from "../../data/architecture";

export default function Home() {
  return (
    <LandingPage
      lang="en"
      navLinks={{ architecture: "Architecture", docs: "Documentation", github: "GitHub" }}
      hero={{
        badge: "Tauri v2 + Rust Core",
        title: <>Speak your code. <br /> Write at lightspeed.</>,
        description: "A completely private, blazing fast desktop dictation engine.",
        downloadText: "Download Latest",
        docsText: "Read Docs",
      }}
      steps={stepsEn}
    />
  );
}
