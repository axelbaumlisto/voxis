import { useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useTauriEvent } from "./hooks/useTauriEvent";
import Layout from "./components/Layout";
import SettingsPage from "./pages/SettingsPage";
import HistoryPage from "./pages/HistoryPage";
import DictionaryPage from "./pages/DictionaryPage";
import OnboardingPage from "./pages/OnboardingPage";
import { commands } from "./bindings";

/** First-run gate: if `commands.isFirstRun()` is true, push the user
 *  to `/onboarding` once on mount. Failures of the command (e.g. in
 *  a non-Tauri synthetic environment) are swallowed silently \u2014 the
 *  app should never get stuck behind a missing command. */
function useFirstRunGate() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked) return;
    void (async () => {
      try {
        const result = await commands.isFirstRun();
        if (result.status === "ok" && result.data === true) {
          navigate("/onboarding");
        }
      } catch {
        // ignore \u2014 synthetic envs or partial binding mocks
      } finally {
        setChecked(true);
      }
    })();
  }, [checked, navigate]);
}

function App() {
  const navigate = useNavigate();

  // Listen for navigation events from tray menu (DRY: uses useTauriEvent hook)
  useTauriEvent<string>("navigate", (path) => {
    navigate(path);
  }, [navigate]);

  // First-run check (idempotent, runs once per mount).
  useFirstRunGate();

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        {/* History is the home page. `/history` is kept as a mandatory
            alias because several e2e specs navigate to it directly. */}
        <Route index element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="dictionary" element={<DictionaryPage />} />
      </Route>
      {/* Onboarding lives outside the Layout shell so the first-run
          flow gets a clean full-page canvas. */}
      <Route path="/onboarding" element={<OnboardingPage />} />
    </Routes>
  );
}

export default App;
