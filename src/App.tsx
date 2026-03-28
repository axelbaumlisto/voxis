import { Routes, Route, useNavigate } from "react-router-dom";
import { useTauriEvent } from "./hooks/useTauriEvent";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import SettingsPage from "./pages/SettingsPage";
import HistoryPage from "./pages/HistoryPage";
import DictionaryPage from "./pages/DictionaryPage";

function App() {
  const navigate = useNavigate();

  // Listen for navigation events from tray menu (DRY: uses useTauriEvent hook)
  useTauriEvent<string>("navigate", (path) => {
    navigate(path);
  }, [navigate]);

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="dictionary" element={<DictionaryPage />} />
      </Route>
    </Routes>
  );
}

export default App;
