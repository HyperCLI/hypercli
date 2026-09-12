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
import { listAcpSessions, listRuntimeSessions } from "../api";
import { useTheme } from "../theme";
import { useAppUpdate } from "../useAppUpdate";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { RUNNING, TRANSITIONAL, agentStateLabel, runtimeFamily, runtimeLabel } from "../agent-utils";
import { canPickChatSession } from "../runtime-client";

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
  busyIds,
  rosterLoading,
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
  /**
   * Agents with a lifecycle command in flight or awaiting roster confirmation.
   * The row's button stays disabled for the whole of it, rather than
   * re-enabling the moment the POST returns and the agent is merely STARTING.
   */
  busyIds?: ReadonlySet<string>;
  /** True while the first roster read is outstanding: empty is not "no agents". */
  rosterLoading?: boolean;
  activeSessionId: string | null;
  onSelectSession: (agentId: string, sessionId: string) => void;
  onNewSession: (agentId: string) => void;
}) {
  const { resolved, setTheme } = useTheme();
  const { state: updateState } = useAppUpdate();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionPickerAgentId, setSessionPickerAgentId] = useState<string | null>(null);
  const [sessionsByAgent, setSessionsByAgent] = useState<Map<string, AcpSessionInfo[]>>(
    () => new Map(),
  );
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const running = agents.filter((a) => a.state === RUNNING).length;
  // A `DELETED` tombstone is not an agent: it gets no row, no Start button.
  const live = agents.filter((a) => a.state !== "ARCHIVED" && a.state !== "DELETED");
  const archived = agents.filter((a) => a.state === "ARCHIVED");

  // Fan out one short-lived session-lister per running chattable agent in
  // parallel (ACP agents over the bridge; runtime agents over their runtime
  // session client), then close all. ~10 agents max per user, so a full
  // sweep is cheap.
  const sessionAgentKey = live
    .filter((a) => a.state === RUNNING && canPickChatSession(a))
    .map((a) => a.id)
    .sort()
    .join(",");
  useEffect(() => {
    const ids = sessionAgentKey ? sessionAgentKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    let inFlight = false;
    const sweep = async () => {
      // One sweep at a time: a slow agent must not stack overlapping sweeps.
      if (inFlight) return;
      inFlight = true;
      setSessionsBusy(true);
      try {
        // Merge per agent as each lister settles: one hanging or failing
        // gateway must never blank the sessions of healthy agents.
        await Promise.all(ids.map(async (id) => {
          try {
            const agent = live.find((a) => a.id === id);
            const list = agent && runtimeFamily(agent.runtime) === "acp"
              ? await listAcpSessions(id)
              : await listRuntimeSessions(id);
            if (cancelled) return;
            setSessionsByAgent((prev) => new Map(prev).set(id, list.sessions));
          } catch {
            // A failed lister surfaces as "no sessions" for that agent only.
          }
        }));
        if (cancelled) return;
        // Drop entries for agents that left the roster.
        setSessionsByAgent((prev) => {
          const keep = new Set(ids);
          const next = new Map([...prev].filter(([id]) => keep.has(id)));
          return next.size === prev.size ? prev : next;
        });
      } finally {
        inFlight = false;
        if (!cancelled) setSessionsBusy(false);
      }
    };
    void sweep();
    const interval = setInterval(() => void sweep(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionAgentKey]);

  const allSessions = live
    .flatMap((agent) =>
      (sessionsByAgent.get(agent.id) ?? []).map((session) => ({ agent, session })),
    )
    .sort((a, b) => {
      const at = a.session.updated_at ? Date.parse(a.session.updated_at) : 0;
      const bt = b.session.updated_at ? Date.parse(b.session.updated_at) : 0;
      return bt - at;
    });
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
            busy={busyIds?.has(agent.id) ?? false}
            onOpenSessionPicker={setSessionPickerAgentId}
          />
        ))}
        {live.length === 0 && archived.length === 0 && (
          <div className="px-2 py-6 text-[12px] text-text-secondary text-center">
            {rosterLoading ? "Loading agents…" : "No agents yet"}
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
                  busy={busyIds?.has(agent.id) ?? false}
                  onOpenSessionPicker={setSessionPickerAgentId}
                  dimmed
                />
              ))}
          </div>
        )}
      </div>

      {sessionAgentKey !== "" && (
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
        </>
      )}
      {sessionAgentKey === "" && <div className="flex-1" />}

      <div className="sidebar-footer">
        {sessionAgentKey !== "" && (
          <div className="sidebar-footer-search flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
            <Search size={11} className="shrink-0 text-text-secondary" />
            <input
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="Search sessions"
              spellCheck={false}
              className="w-full bg-transparent text-[11px] outline-none placeholder:text-text-secondary"
            />
          </div>
        )}
        <div className="sidebar-footer-main">
          <button
            onClick={onNewAgent}
            className="ui-icon-button sidebar-new-agent-button"
          >
            <Plus size={14} />
            New agent
          </button>
          <div className="sidebar-footer-actions">
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
            className="ui-icon-button-sm relative"
            title={
              updateState.status === "available"
                ? `Update available: HyperCLI ${updateState.version}`
                : updateState.status === "downloading"
                  ? "Downloading update…"
                  : "Settings"
            }
          >
            <Settings size={15} />
            {(updateState.status === "available" ||
              updateState.status === "downloading") && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
          </div>
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
  busy,
  onOpenSessionPicker,
  dimmed,
}: {
  agent: AgentSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestore: (id: string) => void;
  busy?: boolean;
  onOpenSessionPicker: (id: string) => void;
  dimmed?: boolean;
}) {
  const persona = usePersona(agent.id);
  const running = agent.state === RUNNING;
  // The roster's own transitional states, plus the window between issuing a
  // command and the roster reporting it — the gap where the old button
  // re-enabled itself and invited a second start.
  const pending = TRANSITIONAL.has(agent.state) || busy === true;
  const transitional = TRANSITIONAL.has(agent.state);
  const archived = agent.state === "ARCHIVED";
  // Every running family with addressable chat sessions — ACP over the
  // bridge, OpenClaw/Hermes over their canonical session client — also opens
  // the session picker on click, but the agent is still selected either way:
  // dismissing the picker without a session must never leave the agent
  // unselected (the user needs the agent active to reach its settings).
  const pickSession = running && canPickChatSession(agent);
  const selectAgent = () => {
    onSelect(agent.id);
    if (pickSession) onOpenSessionPicker(agent.id);
  };
  const subtitle =
    transitional || agent.state === "FAILED"
      ? agentStateLabel(agent.state)
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
          if (pending) return;
          if (archived) onRestore(agent.id);
          else if (running) onStop(agent.id);
          else onStart(agent.id);
        }}
        disabled={pending}
        title={
          pending
            ? transitional
              ? agent.state.toLowerCase()
              : "working…"
            : archived
              ? "Restore"
              : running
                ? "Stop"
                : "Start"
        }
        className={`ui-icon-button shrink-0 w-6 h-6 items-center justify-center ${pending ? "flex" : "hidden group-hover:flex"}`}
      >
        {pending ? (
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
