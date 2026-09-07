import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  archiveAgent,
  authStatus,
  deleteAgent,
  listAgents,
  restoreAgent,
  startAgent,
  stopAgent,
  type AgentSummary,
  type AuthStatus,
} from "./api";
import { useTheme } from "./theme";
import { useAgentChat } from "./useAgentChat";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { ContextPanel } from "./components/ContextPanel";
import type { ContextAgentTab, ContextTab } from "./components/ContextPanel";
import { SignIn } from "./components/SignIn";
import { SettingsModal } from "./components/SettingsModal";
import { NewAgentModal } from "./components/NewAgentModal";

function hasTauriIpc() {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  return typeof internals?.transformCallback === "function";
}

export default function App() {
  useTheme();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(
    () => localStorage.getItem("desktop-ng-left-open") !== "0",
  );
  const [rightOpen, setRightOpen] = useState(
    () => localStorage.getItem("desktop-ng-right-open") !== "0",
  );
  const [contextTab, setContextTab] = useState<ContextTab>("agent");
  const [contextAgentTab, setContextAgentTab] = useState<ContextAgentTab>("screen");
  const [lifecycleErrors, setLifecycleErrors] = useState<Record<string, string>>({});

  const toggleLeft = useCallback(() => {
    setLeftOpen((v) => {
      localStorage.setItem("desktop-ng-left-open", v ? "0" : "1");
      return !v;
    });
  }, []);
  const toggleRight = useCallback(() => {
    setRightOpen((v) => {
      localStorage.setItem("desktop-ng-right-open", v ? "0" : "1");
      return !v;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.key.toLowerCase() !== "b") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      e.preventDefault();
      if (e.shiftKey) toggleRight();
      else toggleLeft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLeft, toggleRight]);

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await authStatus());
    } catch {
      setAuth({ signed_in: false, api_base: "" });
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      setAgents(await listAgents());
    } catch {
      setAgents([]);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!auth?.signed_in) return;
    refreshAgents();
    const unlisten = hasTauriIpc()
      ? listen("agents-updated", () => refreshAgents())
      : Promise.resolve(() => undefined);
    const transitional = agents.some((a) =>
      ["CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"].includes(a.state),
    );
    const poll = setInterval(refreshAgents, transitional ? 4000 : 30000);
    return () => {
      unlisten.then((f) => f());
      clearInterval(poll);
    };
  }, [auth?.signed_in, agents, refreshAgents]);

  useEffect(() => {
    if (activeId && !agents.some((a) => a.id === activeId)) setActiveId(null);
  }, [agents, activeId]);

  const active = agents.find((a) => a.id === activeId) ?? null;
  const chat = useAgentChat(active);

  const act = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setLifecycleErrors((current) => {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
      try {
        await fn();
      } catch (e) {
        setLifecycleErrors((current) => ({
          ...current,
          [id]: e instanceof Error ? e.message : String(e),
        }));
        setContextTab("agent");
        setContextAgentTab("logs");
        setRightOpen(true);
        localStorage.setItem("desktop-ng-right-open", "1");
      } finally {
        await refreshAgents();
      }
    },
    [refreshAgents],
  );

  const onStart = useCallback((id: string) => act(id, () => startAgent(id)), [act]);
  const onStop = useCallback((id: string) => act(id, () => stopAgent(id)), [act]);
  const onArchive = useCallback((id: string) => act(id, () => archiveAgent(id)), [act]);
  const onRestore = useCallback((id: string) => act(id, () => restoreAgent(id)), [act]);
  const onDelete = useCallback(
    (id: string) =>
      act(id, async () => {
        await deleteAgent(id);
        setActiveId((current) => (current === id ? null : current));
      }),
    [act],
  );

  const upsertAgent = useCallback((agent: AgentSummary) => {
    setAgents((current) => {
      const index = current.findIndex((item) => item.id === agent.id);
      if (index === -1) return [agent, ...current];
      const next = [...current];
      next[index] = agent;
      return next;
    });
  }, []);

  if (!auth) {
    return <div className="h-full bg-background" />;
  }

  if (!auth.signed_in) {
    return <SignIn onSignedIn={refreshAuth} />;
  }

  return (
    <div className="h-full flex bg-background">
      <div className={leftOpen ? "contents" : "hidden"}>
        <Sidebar
          agents={agents}
          activeId={activeId}
          onSelect={setActiveId}
          onNewAgent={() => setNewAgentOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onStart={onStart}
          onStop={onStop}
          onRestore={onRestore}
        />
      </div>
      <ChatPane
        agent={active}
        chat={chat}
        lifecycleError={active ? lifecycleErrors[active.id] ?? null : null}
        onStart={onStart}
        onRestore={onRestore}
        onOpenLogs={() => {
          setContextTab("agent");
          setContextAgentTab("logs");
          setRightOpen(true);
          localStorage.setItem("desktop-ng-right-open", "1");
        }}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onOpenLeft={toggleLeft}
        onOpenRight={toggleRight}
      />
      {active && (
        <div className={rightOpen ? "contents" : "hidden"}>
          <ContextPanel
            agent={active}
            chat={chat}
            tab={contextTab}
            agentTab={contextAgentTab}
            onTab={setContextTab}
            onAgentTab={setContextAgentTab}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        </div>
      )}
      {settingsOpen && (
        <SettingsModal
          apiBase={auth.api_base}
          onClose={() => setSettingsOpen(false)}
          onSignedOut={() => {
            setSettingsOpen(false);
            setAgents([]);
            setActiveId(null);
            refreshAuth();
          }}
        />
      )}
      {newAgentOpen && (
        <NewAgentModal
          onClose={() => setNewAgentOpen(false)}
          onCreated={(agent) => {
            setNewAgentOpen(false);
            upsertAgent(agent);
            setActiveId(agent.id);
            setContextTab("agent");
            setContextAgentTab("screen");
            refreshAgents();
          }}
        />
      )}
    </div>
  );
}
