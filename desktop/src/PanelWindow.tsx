import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { openMainWindow } from "./api";
import CreateWindow from "./CreateWindow";
import EditWindow from "./EditWindow";
import Nav from "./Nav";
import SettingsWindow from "./SettingsWindow";

type View = "new" | "connections" | "edit";

const TITLES: Record<View, string> = {
  new: "New Agent",
  connections: "Connections",
  edit: "Edit Agent",
};

function initialView(): View {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "connections") return "connections";
  if (view === "edit" && params.get("agent")) return "edit";
  return "new";
}

export default function PanelWindow() {
  const [view, setView] = useState<View>(initialView);
  const [editAgentId, setEditAgentId] = useState<string>(
    () => new URLSearchParams(window.location.search).get("agent") ?? "",
  );

  useEffect(() => {
    const unlisten = listen<string>("panel-navigate", (event) => {
      // Payload is a view name, optionally `edit:<agentId>`.
      const payload = event.payload;
      if (payload === "new" || payload === "connections") {
        setView(payload);
      } else if (payload.startsWith("edit:")) {
        setEditAgentId(payload.slice("edit:".length));
        setView("edit");
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
            : view === "edit"
              ? [{ label: "Edit agent" }]
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
      ) : view === "edit" ? (
        <EditWindow agentId={editAgentId} />
      ) : (
        <SettingsWindow />
      )}
    </div>
  );
}
