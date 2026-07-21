import LandingPage from "../../../components/LandingPage";
import { stepsRu } from "../../../data/architecture";

export default function HomeRu() {
  return (
    <LandingPage
      lang="ru"
      navLinks={{ architecture: "Архитектура", docs: "Документация", github: "GitHub" }}
      hero={{
        badge: "Tauri v2 + Ядро на Rust",
        title: <>Диктуй код. <br /> Пиши со скоростью мысли.</>,
        description: "Абсолютно приватный, молниеносный десктопный движок для диктовки.",
        downloadText: "Скачать (Win/Mac/Linux)",
        docsText: "Документация",
      }}
      steps={stepsRu}
    />
  );
}
