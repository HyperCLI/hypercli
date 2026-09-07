import { useEffect, useRef, useState } from "react";
import {
  Brain,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  GraduationCap,
  Hand,
  Play,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { agentExec, agentFiles, type AgentExecResult, type AgentFileEntry, type AgentSummary } from "../api";
import type { ActivityEntry, AgentChat } from "../useAgentChat";
import { PERSONA_COLORS, PERSONA_ICONS, setPersona, usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { RUNNING, TRANSITIONAL, runtimeFamily, runtimeLabel } from "../agent-utils";
import { useAgentLogs } from "../useAgentLogs";

type Tab = "agent" | "routines" | "settings" | "activity";
type AgentTab = "screen" | "shell" | "logs" | "files";

export type ContextTab = Tab;
export type ContextAgentTab = AgentTab;

const TEXT_TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "routines", label: "Routines" },
  { id: "settings", label: "Settings" },
];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function useLocalBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  });
  const set = (v: boolean) => {
    localStorage.setItem(key, v ? "1" : "0");
    setValue(v);
  };
  return [value, set];
}

export function ContextPanel({
  agent,
  chat,
  tab,
  agentTab,
  onTab,
  onAgentTab,
  onArchive,
  onRestore,
  onDelete,
}: {
  agent: AgentSummary | null;
  chat: AgentChat;
  tab: ContextTab;
  agentTab: ContextAgentTab;
  onTab: (tab: ContextTab) => void;
  onAgentTab: (tab: ContextAgentTab) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="app-pane-right">
      <header className="app-header">
        <div data-tauri-drag-region className="drag-fill" />
        <div className="app-header-content px-4">
          <div className="segmented-tabs w-full">
            {TEXT_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`segmented-tab flex-1 ${tab === t.id ? "segmented-tab-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!agent ? (
          <div className="pt-10 text-center text-[12px] text-text-secondary px-4">
            Select an agent to inspect it.
          </div>
        ) : tab === "agent" ? (
          <AgentTabPanel agent={agent} tab={agentTab} onTab={onAgentTab} />
        ) : tab === "routines" ? (
          <RoutinesTab />
        ) : tab === "activity" ? (
          <ActivityTab chat={chat} />
        ) : (
          <SettingsTab
            agent={agent}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
          />
        )}
      </div>
    </aside>
  );
}

function AgentTabPanel({ agent, tab, onTab }: { agent: AgentSummary; tab: AgentTab; onTab: (tab: AgentTab) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
        <div className="segmented-tabs w-full">
          {(["screen", "shell", "logs", "files"] as const).map((id) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              className={`segmented-tab flex-1 capitalize ${tab === id ? "segmented-tab-active" : ""}`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "screen" ? <ScreenTab agent={agent} /> : tab === "shell" ? <ShellTab agent={agent} /> : tab === "logs" ? <LogsTab agent={agent} active={tab === "logs"} /> : <FilesTab agent={agent} />}
      </div>
    </div>
  );
}

function ShellTab({ agent }: { agent: AgentSummary }) {
  const [command, setCommand] = useState("pwd && ls -la");
  const [result, setResult] = useState<AgentExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningCommand, setRunningCommand] = useState(false);
  const canRun = agent.state === RUNNING && command.trim() && !runningCommand;

  const run = async () => {
    const next = command.trim();
    if (!next || runningCommand) return;
    setRunningCommand(true);
    setError(null);
    try {
      setResult(await agentExec(agent.id, next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningCommand(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Caption>SHELL</Caption>
          <div className="mt-1 text-[11px] text-text-secondary">
            {agent.state === RUNNING ? "Run a command in this agent" : "Start the agent to run commands"}
          </div>
        </div>
        <button
          onClick={run}
          disabled={!canRun}
          className="ui-secondary-button flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Play size={12} />
          Run
        </button>
      </div>
      <textarea
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void run();
          }
        }}
        disabled={agent.state !== RUNNING}
        className="min-h-[72px] w-full resize-none rounded-lg border border-border bg-card p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-accent disabled:text-text-secondary"
        spellCheck={false}
      />
      {error && <div className="mt-3 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{error}</div>}
      <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary whitespace-pre-wrap">
        {runningCommand
          ? "Running..."
          : result
            ? `$ ${command.trim()}\nexit ${result.exitCode}\n\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`
            : "Press Cmd+Enter to run."}
      </pre>
    </div>
  );
}

function FilesTab({ agent }: { agent: AgentSummary }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<AgentFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextPath = path) => {
    setLoading(true);
    setError(null);
    try {
      const files = await agentFiles(agent.id, nextPath);
      setPath(nextPath);
      setEntries(files.sort(compareFileEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPath("");
    setEntries([]);
    setError(null);
    void load("");
  }, [agent.id]);

  const parent = parentPath(path);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Caption>FILES</Caption>
          <div className="mt-1 truncate font-mono text-[10.5px] text-text-secondary">/{path || ""}</div>
        </div>
        <button
          onClick={() => void load(path)}
          disabled={loading}
          className="ui-icon-button-sm disabled:opacity-40"
          aria-label="Refresh files"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {error && <div className="mb-3 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{error}</div>}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {path && (
          <button
            onClick={() => void load(parent)}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[12px] hover:bg-active-row"
          >
            <Folder size={14} className="text-text-secondary" />
            ..
          </button>
        )}
        <div className="max-h-full overflow-y-auto">
          {loading && entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-text-secondary">Loading files...</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-text-secondary">
              {error ? "Could not load this folder." : "No files here."}
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={`${entry.type}:${entry.path}`}
                onClick={() => entry.type === "directory" && void load(entry.path)}
                disabled={entry.type !== "directory"}
                className="flex w-full items-center gap-2 border-b border-border/70 px-3 py-2 text-left text-[12px] last:border-b-0 enabled:hover:bg-active-row disabled:cursor-default"
              >
                {entry.type === "directory" ? (
                  <Folder size={14} className="shrink-0 text-accent" />
                ) : (
                  <FileText size={14} className="shrink-0 text-text-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="shrink-0 text-[10px] text-text-secondary">
                    {entry.size_formatted ?? formatBytes(entry.size)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-text-secondary">
        Browses {agent.name}'s persisted workspace, including stopped agents when file storage is available.
      </p>
    </div>
  );
}

function compareFileEntries(a: AgentFileEntry, b: AgentFileEntry) {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function parentPath(path: string) {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

function formatBytes(size: number | undefined) {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function LogsTab({ agent, active }: { agent: AgentSummary; active: boolean }) {
  const streamable = active && agent.state !== "STOPPED" && agent.state !== "ARCHIVED";
  const logs = useAgentLogs(agent, streamable);
  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.lines.length]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Caption>LOGS</Caption>
          <div className="mt-1 text-[11px] text-text-secondary">
            {logs.phase === "connecting"
              ? "Connecting"
              : logs.phase === "connected"
                ? "Live"
                : logs.phase === "closed"
                  ? "Disconnected"
                  : logs.phase === "error"
                    ? "Failed"
                    : agent.state === "STOPPED" || agent.state === "ARCHIVED"
                      ? "Offline"
                      : "Idle"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={logs.clear} className="text-[11px] text-text-secondary hover:text-foreground transition-colors">
            Clear
          </button>
          <button onClick={logs.retry} disabled={!streamable} className="text-[11px] font-medium text-accent hover:underline disabled:text-text-secondary disabled:no-underline">
            Retry
          </button>
        </div>
      </div>
      {logs.error && (
        <div className="mb-2 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">
          {logs.error}
        </div>
      )}
      <pre
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary whitespace-pre-wrap"
      >
        {logs.lines.length > 0
          ? logs.lines.join("\n")
          : streamable
            ? "Waiting for logs..."
            : "Start the agent to stream logs."}
      </pre>
    </div>
  );
}

function Caption({ children }: { children: string }) {
  return <div className="side-caption">{children}</div>;
}

function ScreenTab({ agent }: { agent: AgentSummary }) {
  const running = agent.state === RUNNING;
  const family = runtimeFamily(agent.runtime);
  const status = running ? "Running" : TRANSITIONAL.has(agent.state) ? "Idle" : "Stopped";
  if (family !== "openclaw") {
    return (
      <div className="p-4 space-y-3">
        <Caption>SCREEN</Caption>
        <div className="soft-card px-3 py-8 text-center">
          <Terminal size={20} className="mx-auto mb-2 text-text-secondary" />
          <div className="text-[12px] font-medium">No screen for {runtimeLabel(agent.runtime)}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            Screen control is available for OpenClaw agents. Use Shell, Logs, or Files for this runtime.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      <Caption>{`${agent.name.toUpperCase()}'S SCREEN`}</Caption>

      <div className="soft-card overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
          <span className="flex gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full bg-border-strong" />
            <span className="w-2 h-2 rounded-full bg-border-strong" />
            <span className="w-2 h-2 rounded-full bg-border-strong" />
          </span>
          <div className="flex-1 min-w-0 rounded-md bg-surface border border-border px-2 py-1 text-[10px] text-text-secondary truncate">
            {agent.hostname ?? "No session yet"}
          </div>
        </div>
        <div className="p-2.5 space-y-1.5">
          <div className="h-2 rounded-full bg-border/70 w-3/5" />
          <div className="h-2 rounded-full bg-border/70 w-full" />
          <div className="h-2 rounded-full bg-border/70 w-5/6" />
          <div className="h-2 rounded-full bg-border/70 w-2/5" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span
            className={`w-1.5 h-1.5 rounded-full ${running ? "bg-success" : "bg-text-secondary/50"}`}
          />
          {status}
        </span>
        {agent.hostname && (
          <button
            onClick={() => openUrl(`https://${agent.hostname}`)}
            className="text-[11px] text-accent hover:underline transition-colors"
          >
            View live →
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          disabled
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border-strong text-[12px] font-medium px-3 py-2 disabled:opacity-40 transition-colors"
        >
          <GraduationCap size={13} />
          Teach a task
        </button>
        <button
          disabled
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background text-[12px] font-medium px-3 py-2 disabled:opacity-40 transition-colors"
        >
          <Hand size={13} />
          Take over
        </button>
      </div>

      <div className="soft-card px-3 py-2.5">
        <div className="text-[12px] font-medium mb-0.5">Your agent's computer</div>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Runs in your cloud — same browser sessions, same{" "}
          <code className="font-mono text-[10px]">/workspace</code> across restarts.
        </p>
      </div>
    </div>
  );
}

function RoutinesTab() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Caption>0 ROUTINES</Caption>
        <button
          disabled
          className="text-[11px] font-medium text-text-secondary disabled:opacity-40 transition-colors"
        >
          + New routine
        </button>
      </div>

      <div className="soft-card px-4 py-6 text-center">
        <CalendarClock size={20} className="mx-auto text-text-secondary mb-2" />
        <div className="text-[12px] font-medium mb-0.5">No routines yet</div>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Scheduled runs for this agent will show up here.
        </p>
      </div>

      <p className="text-[11px] text-text-secondary leading-relaxed">
        Routines run in the cloud on schedule, even when your computer is off.
      </p>
    </div>
  );
}

function SettingsTab({
  agent,
  onArchive,
  onRestore,
  onDelete,
}: {
  agent: AgentSummary;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const persona = usePersona(agent.id);
  const [notify, setNotify] = useLocalBool(`desktop-ng-notify:${agent.id}`, true);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
        <Avatar
          name={agent.name}
          url={agent.avatar_url}
          size={44}
          color={persona.color}
          icon={persona.icon}
        />
        <p className="text-[11px] text-text-secondary leading-snug">
          Agents read each other's descriptions to decide who to hand work to.
        </p>
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Color</div>
        <div className="flex flex-wrap gap-2">
          {PERSONA_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setPersona(agent.id, { color })}
              className="w-5 h-5 rounded-full transition-colors"
              style={{
                backgroundColor: color,
                boxShadow:
                  persona.color === color
                    ? `0 0 0 2px var(--surface), 0 0 0 4px ${color}`
                    : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Icon</div>
        <div className="flex flex-wrap gap-1.5">
          {PERSONA_ICONS.map((icon) => (
            <button
              key={icon}
              onClick={() => setPersona(agent.id, { icon })}
              className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                persona.icon === icon
                  ? "border-accent bg-accent-tint"
                  : "border-border hover:bg-active-row"
              }`}
            >
              <Avatar name={agent.name} size={16} color={persona.color} icon={icon} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Name</div>
        <input
          value={agent.name}
          disabled
          className="ui-field-muted"
        />
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Title</div>
        <input
          key={`title-${agent.id}`}
          defaultValue={persona.title ?? ""}
          onBlur={(e) => setPersona(agent.id, { title: e.target.value || undefined })}
          placeholder="Title — e.g. Sales pipeline"
          className="ui-field"
        />
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Description</div>
        <textarea
          key={`desc-${agent.id}`}
          defaultValue={persona.description ?? ""}
          onBlur={(e) => setPersona(agent.id, { description: e.target.value || undefined })}
          placeholder="Description — what this agent owns"
          rows={4}
          className="ui-field resize-none"
        />
        <p className="mt-1 text-[10px] text-text-secondary leading-snug">
          This is the routing table for the whole team — keep it specific.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0">
          <div className="text-[12px] font-medium">Notifications</div>
          <div className="text-[10px] text-text-secondary leading-snug">
            Get notified when this agent finishes or needs input.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={notify}
          onClick={() => setNotify(!notify)}
          className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors ${
            notify ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${
              notify ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      </div>

      <button
        disabled
        className="w-full rounded-lg border border-border-strong text-[12px] font-medium py-2 disabled:opacity-40 transition-colors"
      >
        Share as template
      </button>

      </div>
      <div className="shrink-0 border-t border-border bg-surface p-3">
        <DangerZone agent={agent} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />
      </div>
    </div>
  );
}

const ACTIVITY_STATUS_STYLE: Record<string, string> = {
  completed: "text-success",
  failed: "text-error",
  in_progress: "text-warning",
};

function ActivityTab({ chat }: { chat: AgentChat }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = chat.activity.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-1.5 flex items-baseline justify-between gap-2">
        <Caption>ACTIVITY</Caption>
        <span className="text-[10px] text-text-secondary">
          {chat.activity.length === 0
            ? "No updates yet"
            : `Last updated ${formatTime(chat.activity[chat.activity.length - 1].ts)}`}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {chat.activity.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  if (entry.kind === "usage" || entry.kind === "note") {
    return (
      <div className="px-2 py-1">
        <div className="text-[11px] text-text-secondary font-mono leading-snug">
          {entry.title}
        </div>
        <div className="text-[10px] text-text-secondary/70">{formatTime(entry.ts)}</div>
      </div>
    );
  }
  if (entry.kind === "thinking") {
    return (
        <div className="tool-card">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-text-secondary"
        >
          <Brain size={12} className="shrink-0" />
          <span className="text-[11px] flex-1">Thinking</span>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {open && entry.detail && (
          <div className="px-2.5 pb-2 text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">
            {entry.detail}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="tool-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        <Terminal size={12} className="text-text-secondary shrink-0" />
        <span className="text-[11px] truncate flex-1">{entry.title}</span>
        {entry.durationMs != null && (
          <span className="text-[10px] text-text-secondary shrink-0">
            {(entry.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {entry.status && (
          <span
            className={`text-[10px] font-medium shrink-0 ${ACTIVITY_STATUS_STYLE[entry.status] ?? "text-text-secondary"}`}
          >
            {entry.status.replace(/_/g, " ")}
          </span>
        )}
        {open ? (
          <ChevronDown size={12} className="text-text-secondary shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-text-secondary shrink-0" />
        )}
      </button>
      {open && entry.detail && (
        <div className="px-2.5 pb-2">
          <code className="block text-[10.5px] font-mono text-text-secondary break-all whitespace-pre-wrap">
            {entry.detail}
          </code>
        </div>
      )}
      <div className="px-2.5 pb-1.5 -mt-0.5 text-[10px] text-text-secondary/70">
        {formatTime(entry.ts)}
      </div>
    </div>
  );
}

function DangerZone({
  agent,
  onArchive,
  onRestore,
  onDelete,
}: {
  agent: AgentSummary;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const stopped = agent.state === "STOPPED";
  const archived = agent.state === "ARCHIVED";

  return (
    <div className="space-y-3">
      <Caption>AGENT</Caption>
      <dl className="soft-card divide-y divide-border">
        <Row label="Runtime" value={runtimeLabel(agent.runtime)} />
        {agent.size && <Row label="Size" value={agent.size} />}
        {agent.hostname && <Row label="Host" value={agent.hostname} mono />}
      </dl>
      <div>
        <div className="side-caption text-error mb-2">
          DANGER ZONE
        </div>
        <div className="rounded-lg border border-error/40 bg-error-bg/40 divide-y divide-border">
          {archived ? (
            <DangerRow
              title="Restore agent"
              description="Bring storage back from the archive."
              action="Restore"
              onClick={() => onRestore(agent.id)}
            />
          ) : (
            <DangerRow
              title="Archive agent"
              description={stopped ? "Pack storage away; restore anytime." : "Stop the agent first."}
              action={confirm === "archive" ? "Confirm" : "Archive"}
              disabled={!stopped}
              onClick={() => {
                if (confirm === "archive") {
                  setConfirm(null);
                  onArchive(agent.id);
                } else setConfirm("archive");
              }}
            />
          )}
          <DangerRow
            title="Delete agent"
            description={
              stopped || archived ? "Gone for good. Files in the archive stay." : "Stop the agent first."
            }
            action={confirm === "delete" ? "Confirm" : "Delete"}
            disabled={!stopped && !archived}
            onClick={() => {
              if (confirm === "delete") {
                setConfirm(null);
                onDelete(agent.id);
              } else setConfirm("delete");
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
      <dt className="text-text-secondary shrink-0">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function DangerRow({
  title,
  description,
  action,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium">{title}</div>
        <div className="text-[11px] text-text-secondary">{description}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="ui-danger-button"
      >
        {action}
      </button>
    </div>
  );
}
