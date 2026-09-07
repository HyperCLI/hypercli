import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> })
  .__TAURI_INTERNALS__;
document.documentElement.classList.add(
  typeof tauriInternals?.invoke === "function" ? "tauri-shell" : "browser-shell",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
