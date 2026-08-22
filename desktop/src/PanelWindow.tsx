import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { openMainWindow } from "./api";
import CreateWindow from "./CreateWindow";
import Nav from "./Nav";
import SettingsWindow from "./SettingsWindow";

type View = "new" | "connections";

const TITLES: Record<View, string> = {
  new: "New Agent",
  connections: "Connections",
};

function initialView(): View {
  return new URLSearchParams(window.location.search).get("view") ===
    "connections"
    ? "connections"
    : "new";
}

export default function PanelWindow() {
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    const unlisten = listen<string>("panel-navigate", (event) => {
      if (event.payload === "new" || event.payload === "connections") {
        setView(event.payload);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    void getCurrentWindow().setTitle(TITLES[view]);
  }, [view]);

  const backToAgents = () => {
    void getCurrentWindow()
      .close()
      .then(() => openMainWindow())
      .catch(console.error);
  };

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <Nav
        trail={[
          { label: "Agents", onClick: backToAgents },
          ...(view === "connections"
            ? [
                { label: "New agent", onClick: () => setView("new" as const) },
                { label: "Connections" },
              ]
            : [{ label: "New agent" }]),
        ]}
        action={
          view === "new" ? (
            <button
              type="button"
              className="text-xs text-accent hover:text-brand-hover"
              onClick={() => setView("connections")}
            >
              Connections
            </button>
          ) : (
            <button
              type="button"
              className="text-xs text-accent hover:text-brand-hover"
              onClick={() => setView("new")}
            >
              New agent
            </button>
          )
        }
      />
      {view === "new" ? (
        <CreateWindow onOpenConnections={() => setView("connections")} />
      ) : (
        <SettingsWindow />
      )}
    </div>
  );
}
