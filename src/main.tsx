import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RecordingProvider } from "./contexts/RecordingContext";
import "./i18n";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <RecordingProvider>
        <App />
      </RecordingProvider>
    </BrowserRouter>
  </React.StrictMode>
);
