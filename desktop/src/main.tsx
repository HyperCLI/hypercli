import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import PanelWindow from "./PanelWindow";
import "./index.css";

const currentWindow = getCurrentWindow();
const label = currentWindow.label;

document.body.dataset.window = label;

// Keep the native window chrome in lockstep with the OS appearance.
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => {
  void currentWindow.setTheme(systemTheme.matches ? "dark" : "light");
};
applyTheme();
systemTheme.addEventListener("change", applyTheme);

const root = label === "panel" ? <PanelWindow /> : <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{root}</StrictMode>,
);
