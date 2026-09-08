import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  archiveAgent,
  authStatus,
  deleteAgent,
  deleteAgentAvatar,
  listAgents,
  restoreAgent,
  setAgentDesktopEnabled,
  startAgent,
  stopAgent,
  uploadAgentAvatar,
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
import { TutorialModal } from "./components/TutorialModal";
import { NewAgentModal } from "./components/NewAgentModal";

const LEFT_DEFAULT_WIDTH = 176;
const RIGHT_DEFAULT_WIDTH = 272;
const LEFT_MIN_WIDTH = 144;
const LEFT_MAX_WIDTH = 340;
const RIGHT_MIN_WIDTH = 240;
const RIGHT_MAX_VIEWPORT_PADDING = 360;
const PANE_SNAP_DISTANCE = 14;

function storedPaneWidth(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapPaneWidth(value: number, defaultWidth: number) {
  return Math.abs(value - defaultWidth) <= PANE_SNAP_DISTANCE ? defaultWidth : value;
}

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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(
    () => localStorage.getItem("desktop-ng-left-open") !== "0",
  );
  const [rightOpen, setRightOpen] = useState(
    () => localStorage.getItem("desktop-ng-right-open") !== "0",
  );
  const [contextTab, setContextTab] = useState<ContextTab>("agent");
  const [contextAgentTab, setContextAgentTab] = useState<ContextAgentTab>("activity");
  const [lifecycleErrors, setLifecycleErrors] = useState<Record<string, string>>({});
  const [leftWidth, setLeftWidth] = useState(() => storedPaneWidth("desktop-ng-left-width", LEFT_DEFAULT_WIDTH));
  const [rightWidth, setRightWidth] = useState(() => storedPaneWidth("desktop-ng-right-width", RIGHT_DEFAULT_WIDTH));

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

  const startLeftResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const raw = clamp(startWidth + moveEvent.clientX - startX, LEFT_MIN_WIDTH, LEFT_MAX_WIDTH);
      const next = snapPaneWidth(raw, LEFT_DEFAULT_WIDTH);
      setLeftWidth(next);
      localStorage.setItem("desktop-ng-left-width", String(next));
    };
    const onUp = () => {
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("pane-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [leftWidth]);

  const startRightResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightWidth;
    const maxWidth = Math.max(RIGHT_MIN_WIDTH, window.innerWidth - RIGHT_MAX_VIEWPORT_PADDING);
    const onMove = (moveEvent: PointerEvent) => {
      const raw = clamp(startWidth + startX - moveEvent.clientX, RIGHT_MIN_WIDTH, maxWidth);
      const next = snapPaneWidth(raw, RIGHT_DEFAULT_WIDTH);
      setRightWidth(next);
      localStorage.setItem("desktop-ng-right-width", String(next));
    };
    const onUp = () => {
      document.body.classList.remove("pane-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    document.body.classList.add("pane-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [rightWidth]);

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
  const [sessionNonce, setSessionNonce] = useState(0);
  const chat = useAgentChat(active, sessionNonce);

  const handleSelectSession = useCallback((agentId: string, sessionId: string) => {
    localStorage.setItem(`acp-session:${agentId}`, sessionId);
    setActiveId(agentId);
    setSessionNonce((n) => n + 1);
  }, []);

  const handleNewSession = useCallback((agentId: string) => {
    localStorage.removeItem(`acp-session:${agentId}`);
    setActiveId(agentId);
    setSessionNonce((n) => n + 1);
  }, []);

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
        setContextAgentTab("advanced");
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

  const onUploadAgentAvatar = useCallback(
    async (id: string, file: File) => {
      let avatarUrl: string | null | undefined;
      await act(id, async () => {
        const result = await uploadAgentAvatar(id, file);
        avatarUrl = result.avatar_url;
      });
      if (avatarUrl !== undefined) {
        const nextAvatarUrl = avatarUrl;
        setAgents((current) =>
          current.map((agent) =>
            agent.id === id ? { ...agent, avatar_url: nextAvatarUrl } : agent,
          ),
        );
      }
    },
    [act],
  );

  const onDeleteAgentAvatar = useCallback(
    async (id: string) => {
      let deleted = false;
      await act(id, async () => {
        await deleteAgentAvatar(id);
        deleted = true;
      });
      if (deleted) {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === id ? { ...agent, avatar_url: null } : agent,
          ),
        );
      }
    },
    [act],
  );

  const onSetAgentDesktopEnabled = useCallback(
    (id: string, enabled: boolean) =>
      act(id, async () => {
        const updated = await setAgentDesktopEnabled(id, enabled);
        setAgents((current) => current.map((agent) => (agent.id === id ? { ...updated, has_desktop: enabled } : agent)));
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
      <div
        className={leftOpen ? "relative flex shrink-0" : "hidden"}
        style={{ "--pane-left-width": `${leftWidth}px` } as CSSProperties}
      >
        <Sidebar
          agents={agents}
          activeId={activeId}
          onSelect={setActiveId}
          onNewAgent={() => setNewAgentOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenTutorial={() => setTutorialOpen(true)}
          onStart={onStart}
          onStop={onStop}
          onRestore={onRestore}
          activeSessionId={chat.activeSessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
        />
        <div
          className="pane-resize-handle pane-resize-handle-left"
          onPointerDown={startLeftResize}
          onDoubleClick={() => {
            setLeftWidth(LEFT_DEFAULT_WIDTH);
            localStorage.setItem("desktop-ng-left-width", String(LEFT_DEFAULT_WIDTH));
          }}
          title="Drag to resize. Double-click to reset."
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
          setContextAgentTab("advanced");
          setRightOpen(true);
          localStorage.setItem("desktop-ng-right-open", "1");
        }}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onOpenLeft={toggleLeft}
        onOpenRight={toggleRight}
      />
      {active && (
        <div
          className={rightOpen ? "relative flex shrink-0" : "hidden"}
          style={{ "--pane-right-width": `${rightWidth}px` } as CSSProperties}
        >
          <div
            className="pane-resize-handle pane-resize-handle-right"
            onPointerDown={startRightResize}
            onDoubleClick={() => {
              setRightWidth(RIGHT_DEFAULT_WIDTH);
              localStorage.setItem("desktop-ng-right-width", String(RIGHT_DEFAULT_WIDTH));
            }}
            title="Drag to resize. Double-click to reset."
          />
          <ContextPanel
            agent={active}
            chat={chat}
            tab={contextTab}
            agentTab={contextAgentTab}
            onTab={setContextTab}
            onAgentTab={setContextAgentTab}
            onArchive={onArchive}
            onRestore={onRestore}
            onStop={onStop}
            onDelete={onDelete}
            onSetAgentDesktopEnabled={onSetAgentDesktopEnabled}
            onUploadAgentAvatar={onUploadAgentAvatar}
            onDeleteAgentAvatar={onDeleteAgentAvatar}
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
            setContextAgentTab("activity");
            refreshAgents();
          }}
        />
      )}
      {tutorialOpen && <TutorialModal onClose={() => setTutorialOpen(false)} />}
    </div>
  );
}
