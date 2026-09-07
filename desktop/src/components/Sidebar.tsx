import { useState } from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Loader2,
  Moon,
  Play,
  Plus,
  Settings,
  Square,
  Sun,
} from "lucide-react";
import type { AgentSummary } from "../api";
import { useTheme } from "../theme";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { RUNNING, TRANSITIONAL, runtimeLabel } from "../agent-utils";

export function Sidebar({
  agents,
  activeId,
  onSelect,
  onNewAgent,
  onOpenSettings,
  onStart,
  onStop,
  onRestore,
}: {
  agents: AgentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewAgent: () => void;
  onOpenSettings: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const { resolved, setTheme } = useTheme();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const running = agents.filter((a) => a.state === RUNNING).length;
  const live = agents.filter((a) => a.state !== "ARCHIVED");
  const archived = agents.filter((a) => a.state === "ARCHIVED");

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

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {live.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            active={agent.id === activeId}
            onSelect={onSelect}
            onStart={onStart}
            onStop={onStop}
            onRestore={onRestore}
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
                  dimmed
                />
              ))}
          </div>
        )}
      </div>

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
    </aside>
  );
}

function AgentRow({
  agent,
  active,
  onSelect,
  onStart,
  onStop,
  onRestore,
  dimmed,
}: {
  agent: AgentSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestore: (id: string) => void;
  dimmed?: boolean;
}) {
  const persona = usePersona(agent.id);
  const running = agent.state === RUNNING;
  const transitional = TRANSITIONAL.has(agent.state);
  const archived = agent.state === "ARCHIVED";
  const subtitle = transitional
    ? agent.state === "STARTING"
      ? "booting"
      : agent.state.toLowerCase()
    : persona.title ?? runtimeLabel(agent.runtime);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(agent.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(agent.id)}
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
