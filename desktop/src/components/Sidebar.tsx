import { useEffect, useState } from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Loader2,
  MessageSquarePlus,
  Moon,
  Play,
  Plus,
  Search,
  Settings,
  Square,
  Sun,
} from "lucide-react";
import type { AgentSummary, AcpSessionInfo } from "../api";
import { listAcpSessions } from "../api";
import { useTheme } from "../theme";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { RUNNING, TRANSITIONAL, runtimeFamily, runtimeLabel } from "../agent-utils";

export function Sidebar({
  agents,
  activeId,
  onSelect,
  onNewAgent,
  onOpenSettings,
  onOpenTutorial,
  onStart,
  onStop,
  onRestore,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: {
  agents: AgentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewAgent: () => void;
  onOpenSettings: () => void;
  onOpenTutorial: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestore: (id: string) => void;
  activeSessionId: string | null;
  onSelectSession: (agentId: string, sessionId: string) => void;
  onNewSession: (agentId: string) => void;
}) {
  const { resolved, setTheme } = useTheme();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionPickerAgentId, setSessionPickerAgentId] = useState<string | null>(null);
  const [sessionsByAgent, setSessionsByAgent] = useState<Map<string, AcpSessionInfo[]>>(
    () => new Map(),
  );
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const running = agents.filter((a) => a.state === RUNNING).length;
  const live = agents.filter((a) => a.state !== "ARCHIVED");
  const archived = agents.filter((a) => a.state === "ARCHIVED");

  // Fan out one short-lived session-lister per running ACP agent in parallel
  // (the bridge is N-client, so this never fights the chat client), then
  // close all. ~10 agents max per user, so a full sweep is cheap.
  const acpAgentKey = live
    .filter((a) => a.state === RUNNING && runtimeFamily(a.runtime) === "acp")
    .map((a) => a.id)
    .sort()
    .join(",");
  useEffect(() => {
    const ids = acpAgentKey ? acpAgentKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    const sweep = async () => {
      setSessionsBusy(true);
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const list = await listAcpSessions(id);
              return [id, list.sessions] as const;
            } catch {
              return [id, null] as const;
            }
          }),
        );
        if (cancelled) return;
        setSessionsByAgent((prev) => {
          const next = new Map(prev);
          for (const [id, sessions] of results) {
            if (sessions !== null) next.set(id, sessions);
          }
          return next;
        });
      } finally {
        if (!cancelled) setSessionsBusy(false);
      }
    };
    void sweep();
    const interval = setInterval(() => void sweep(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [acpAgentKey]);

  const allSessions = live.flatMap((agent) =>
    (sessionsByAgent.get(agent.id) ?? []).map((session) => ({ agent, session })),
  );
  const sessionPickerAgent = sessionPickerAgentId
    ? live.find((agent) => agent.id === sessionPickerAgentId) ?? null
    : null;
  const filteredSessions = allSessions.filter(({ agent, session }) => {
    if (!sessionQuery.trim()) return true;
    const query = sessionQuery.trim().toLowerCase();
    return (
      (session.title ?? "").toLowerCase().includes(query) ||
      session.session_id.toLowerCase().includes(query) ||
      agent.name.toLowerCase().includes(query)
    );
  });

  return (
    <aside className="app-pane-left">
      <div className="relative shrink-0">
        <div data-tauri-drag-region className="absolute inset-0" />
        <div className="sidebar-brand">
          <div className="text-[11px] text-text-secondary">
            {running} running · {agents.length} agents
          </div>
        </div>
      </div>

      <div className="side-caption px-3.5 pt-1.5 pb-1">
        AGENTS
      </div>

      <div className="max-h-[45%] shrink-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {live.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            active={agent.id === activeId}
            onSelect={onSelect}
            onStart={onStart}
            onStop={onStop}
            onRestore={onRestore}
            onOpenSessionPicker={setSessionPickerAgentId}
          />
        ))}
        {live.length === 0 && archived.length === 0 && (
          <div className="px-2 py-6 text-[12px] text-text-secondary text-center">
            No agents yet
          </div>
        )}
        {archived.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setArchivedOpen(!archivedOpen)}
              className="side-caption w-full flex items-center gap-1.5 px-2 py-1 hover:text-foreground transition-colors"
            >
              {archivedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              ARCHIVED ({archived.length})
            </button>
            {archivedOpen &&
              archived.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === activeId}
                  onSelect={onSelect}
                  onStart={onStart}
                  onStop={onStop}
                  onRestore={onRestore}
                  onOpenSessionPicker={setSessionPickerAgentId}
                  dimmed
                />
              ))}
          </div>
        )}
      </div>

      {acpAgentKey !== "" && (
        <>
          <div className="side-caption px-3.5 pt-1.5 pb-1 flex items-center justify-between">
            SESSIONS
            {sessionsBusy && sessionsByAgent.size === 0 && (
              <Loader2 size={11} className="animate-spin text-text-secondary" />
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {sessionsByAgent.size === 0 && (
              <div className="px-2 py-4 text-[11px] text-text-secondary text-center">
                {sessionsBusy ? "Loading sessions…" : "No sessions yet"}
              </div>
            )}
            {sessionsByAgent.size > 0 && filteredSessions.length === 0 && (
              <div className="px-2 py-4 text-[11px] text-text-secondary text-center">
                No matches
              </div>
            )}
            {filteredSessions.map(({ agent, session }) => (
              <SessionRow
                key={`${agent.id}:${session.session_id}`}
                agent={agent}
                session={session}
                active={agent.id === activeId && session.session_id === activeSessionId}
                onSelect={onSelectSession}
              />
            ))}
          </div>
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
              <Search size={11} className="shrink-0 text-text-secondary" />
              <input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Search sessions"
                spellCheck={false}
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-text-secondary"
              />
            </div>
          </div>
        </>
      )}
      {acpAgentKey === "" && <div className="flex-1" />}

      <div className="border-t border-border px-2 py-2 flex items-center justify-between">
        <button
          onClick={onNewAgent}
          className="ui-icon-button flex items-center gap-1.5 px-2 py-1.5 text-[12px]"
        >
          <Plus size={14} />
          New agent
        </button>
        <div className="flex items-center">
          <button
            onClick={onOpenTutorial}
            className="ui-icon-button-sm"
            title="Help"
          >
            <CircleHelp size={15} />
          </button>
          <button
            onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            className="ui-icon-button-sm"
            title="Toggle theme"
          >
            {resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={onOpenSettings}
            className="ui-icon-button-sm"
            title="Settings"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {sessionPickerAgent && (
        <SessionPicker
          agent={sessionPickerAgent}
          sessions={sessionsByAgent.get(sessionPickerAgent.id) ?? []}
          activeSessionId={sessionPickerAgent.id === activeId ? activeSessionId : null}
          onClose={() => setSessionPickerAgentId(null)}
          onNewSession={(agentId) => {
            onNewSession(agentId);
            setSessionPickerAgentId(null);
          }}
          onSelectSession={(agentId, sessionId) => {
            onSelectSession(agentId, sessionId);
            setSessionPickerAgentId(null);
          }}
        />
      )}
    </aside>
  );
}

function SessionPicker({
  agent,
  sessions,
  activeSessionId,
  onClose,
  onNewSession,
  onSelectSession,
}: {
  agent: AgentSummary;
  sessions: AcpSessionInfo[];
  activeSessionId: string | null;
  onClose: () => void;
  onNewSession: (agentId: string) => void;
  onSelectSession: (agentId: string, sessionId: string) => void;
}) {
  const persona = usePersona(agent.id);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card max-h-[78vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Avatar
            name={agent.name}
            url={agent.avatar_url}
            size={24}
            color={persona.color}
            icon={persona.icon}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{agent.name}</div>
            <div className="text-[11px] text-text-secondary">Choose a session</div>
          </div>
        </div>
        <div className="max-h-[calc(78vh-57px)] overflow-y-auto p-3 space-y-1.5">
          <button
            onClick={() => onNewSession(agent.id)}
            className="group flex w-full items-center gap-3 rounded-lg border border-accent/35 bg-accent/10 px-3 py-3 text-left transition-colors hover:bg-accent/15"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <MessageSquarePlus size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">New session</div>
              <div className="text-[11px] text-text-secondary">Start with a fresh prompt</div>
            </div>
          </button>

          {sessions.length > 0 && (
            <div className="side-caption px-1 pt-2 pb-0.5">PREVIOUS</div>
          )}
          {sessions.map((session) => (
            <button
              key={session.session_id}
              onClick={() => onSelectSession(agent.id, session.session_id)}
              className={`agent-row ${session.session_id === activeSessionId ? "agent-row-active" : "agent-row-idle"}`}
            >
              <Avatar
                name={agent.name}
                url={agent.avatar_url}
                size={22}
                color={persona.color}
                icon={persona.icon}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium">
                  {session.title?.trim() || "Untitled session"}
                </div>
                <div className="truncate text-[10px] text-text-secondary">
                  {formatSessionMeta(session)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionRow({
  agent,
  session,
  active,
  onSelect,
}: {
  agent: AgentSummary;
  session: AcpSessionInfo;
  active: boolean;
  onSelect: (agentId: string, sessionId: string) => void;
}) {
  const persona = usePersona(agent.id);
  return (
    <button
      onClick={() => onSelect(agent.id, session.session_id)}
      className={`group agent-row w-full text-left ${active ? "agent-row-active" : "agent-row-idle"}`}
    >
      <Avatar
        name={agent.name}
        url={agent.avatar_url}
        size={20}
        color={persona.color}
        icon={persona.icon}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium truncate">
          {session.title?.trim() || "Untitled session"}
        </div>
        <div className="text-[10px] text-text-secondary truncate">
          {agent.name} · {formatSessionTime(session.updated_at)}
        </div>
      </div>
    </button>
  );
}

function formatSessionTime(updatedAt: string | null): string {
  if (!updatedAt) return "";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatSessionMeta(session: AcpSessionInfo): string {
  const parts = [session.cwd?.trim(), formatSessionTime(session.updated_at)].filter(Boolean);
  return parts.join(" · ") || session.session_id;
}

function AgentRow({
  agent,
  active,
  onSelect,
  onStart,
  onStop,
  onRestore,
  onOpenSessionPicker,
  dimmed,
}: {
  agent: AgentSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenSessionPicker: (id: string) => void;
  dimmed?: boolean;
}) {
  const persona = usePersona(agent.id);
  const running = agent.state === RUNNING;
  const transitional = TRANSITIONAL.has(agent.state);
  const archived = agent.state === "ARCHIVED";
  const pickSession = running && runtimeFamily(agent.runtime) === "acp";
  const selectAgent = () => {
    if (pickSession) onOpenSessionPicker(agent.id);
    else onSelect(agent.id);
  };
  const subtitle = transitional
    ? agent.state === "STARTING"
      ? "booting"
      : agent.state.toLowerCase()
    : persona.title ?? runtimeLabel(agent.runtime);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={selectAgent}
      onKeyDown={(e) => e.key === "Enter" && selectAgent()}
      className={`group agent-row ${
        active ? "agent-row-active" : "agent-row-idle"
      } ${dimmed ? "opacity-55" : ""}`}
    >
      <Avatar
        name={agent.name}
        url={agent.avatar_url}
        size={24}
        color={persona.color}
        icon={persona.icon}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium truncate">{agent.name}</div>
        <div className="text-[11px] text-text-secondary truncate">
          {subtitle}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (transitional) return;
          if (archived) onRestore(agent.id);
          else if (running) onStop(agent.id);
          else onStart(agent.id);
        }}
        disabled={transitional}
        title={
          transitional
            ? agent.state.toLowerCase()
            : archived
              ? "Restore"
              : running
                ? "Stop"
                : "Start"
        }
        className={`ui-icon-button shrink-0 w-6 h-6 items-center justify-center ${transitional ? "flex" : "hidden group-hover:flex"}`}
      >
        {transitional ? (
          <Loader2 size={13} className="animate-spin" />
        ) : archived ? (
          <ArchiveRestore size={13} />
        ) : running ? (
          <Square size={11} />
        ) : (
          <Play size={13} />
        )}
      </button>
      {running && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center group-hover:hidden">
          <span className="status-dot bg-success" />
        </div>
      )}
    </div>
  );
}
