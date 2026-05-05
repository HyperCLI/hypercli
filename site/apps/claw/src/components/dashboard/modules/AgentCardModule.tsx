"use client";

import { useState } from "react";
import { Bot, ChevronDown, Wrench, FolderOpen, Link2, Activity, Cpu, MemoryStick, Play, Square, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { formatCpu, formatMemory } from "@/lib/format";
import type { StyleVariant, AgentStatus } from "../agentViewTypes";
import {
  MOCK_CONFIG,
  MOCK_CONNECTIONS,
  MOCK_SESSIONS,
  MOCK_STATUS,
} from "../agentViewMockData";
import { formatBytes, formatUptime, relativeTime } from "../agentViewUtils";

/* ── Compact tooltip card for agent avatar hovers ── */

export interface AgentCardTooltipData {
  id: string;
  name: string;
  state?: string | null;
  cpuMillicores?: number | null;
  memoryMib?: number | null;
  hostname?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
  meta?: AgentMeta | null;
  config?: {
    model?: string | null;
    systemPrompt?: string | null;
    tools?: { name: string; enabled: boolean }[];
  } | null;
  connections?: { id: string; name?: string; connected?: boolean | null }[] | null;
  sessions?: { key?: string }[] | null;
  files?: { name: string; path?: string; size?: number | null }[] | null;
  activity?: { id: string; action?: string; detail?: string; timestamp?: number }[] | null;
}

interface AgentCardTooltipProps {
  agentName: string;
  agent?: AgentCardTooltipData | null;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function normalizeState(state: string | null | undefined): string {
  return state?.trim().toUpperCase() || "UNKNOWN";
}

function stateDotClass(state: string): string {
  if (state === "RUNNING") return "bg-[#38D39F]";
  if (state === "FAILED") return "bg-[#d05f5f]";
  if (state === "PENDING" || state === "STARTING" || state === "STOPPING") return "bg-[#f0c56c]";
  return "bg-text-muted";
}

function displayFileName(file: { name: string; path?: string }): string {
  return file.name || file.path?.split("/").filter(Boolean).pop() || "file";
}

function isDisplayText(value: string | null | undefined): value is string {
  return Boolean(value);
}

export function AgentCardTooltip({ agentName, agent }: AgentCardTooltipProps) {
  const [expanded, setExpanded] = useState(false);
  const name = agent?.name || agentName;
  const state = normalizeState(agent?.state);
  const allTools = agent?.config?.tools ?? [];
  const enabledTools = allTools.filter((t) => t.enabled).map((t) => t.name);
  const connectedServices = (agent?.connections ?? []).filter((c) => c.connected);
  const startedAt = parseTimestamp(agent?.startedAt);
  const updatedAt = parseTimestamp(agent?.updatedAt);
  const subtitle = [
    agent?.config?.model || null,
    agent?.hostname || null,
  ].filter(isDisplayText).join(" · ");
  const stats = [
    agent?.connections ? `${connectedServices.length} connections` : null,
    agent?.sessions ? `${agent.sessions.length} sessions` : null,
    state === "RUNNING" && startedAt ? `Started ${relativeTime(startedAt)}` : null,
    updatedAt ? `Updated ${relativeTime(updatedAt)}` : null,
  ].filter(isDisplayText);
  const hasResourceData = Boolean(agent?.cpuMillicores || agent?.memoryMib);
  const activity = agent?.activity?.filter((entry) => entry.detail || entry.action).slice(0, 3) ?? [];
  const files = agent?.files?.slice(0, 4) ?? [];
  const hasExpandedDetails = hasResourceData || allTools.length > 0 || files.length > 0 || Boolean(agent?.connections) || activity.length > 0;
  const avatar = agentAvatar(name, agent?.meta);
  const Icon = avatar.icon;

  return (
    <motion.div
      initial={false}
      animate={{ width: expanded ? 360 : 256 }}
      transition={{ duration: 0.15, ease: "easeInOut" }}
      className="rounded-lg bg-[#1a1a1c] border border-border shadow-xl p-3 space-y-2"
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: avatar.bgColor }}
        >
          {avatar.imageUrl ? (
            <span
              aria-label={`${name} avatar`}
              className="h-full w-full rounded-lg bg-cover bg-center"
              style={{ backgroundImage: `url(${JSON.stringify(avatar.imageUrl)})` }}
            />
          ) : (
            <Icon className="w-4 h-4" style={{ color: avatar.fgColor }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground truncate">{name}</div>
          <div className="text-[10px] text-text-muted truncate">{subtitle || (agent ? "SDK agent" : "No agent data loaded")}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${stateDotClass(state)}`} />
          <span className="text-[9px] text-text-muted">{state.toLowerCase()}</span>
        </div>
      </div>

      {agent?.lastError ? (
        <p className="text-[10px] text-[#d05f5f] line-clamp-2">{agent.lastError}</p>
      ) : agent?.config?.systemPrompt ? (
        <p className="text-[10px] text-text-muted line-clamp-2">{agent.config.systemPrompt}</p>
      ) : null}

      {enabledTools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {enabledTools.slice(0, 4).map((t) => (
            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F]">{t}</span>
          ))}
          {enabledTools.length > 4 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-low text-text-muted">+{enabledTools.length - 4}</span>
          )}
        </div>
      )}

      {stats.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted pt-0.5 border-t border-border">
          {stats.map((stat) => <span key={stat}>{stat}</span>)}
        </div>
      )}

      {/* Expand toggle */}
      {hasExpandedDetails && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="flex items-center justify-center gap-1 w-full py-1 rounded-md hover:bg-surface-low transition-colors text-[10px] text-text-muted hover:text-foreground"
        >
          <span>{expanded ? "Less" : "More"}</span>
          <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-3 h-3" />
          </motion.span>
        </button>
      )}

      <AnimatePresence initial={false}>
        {expanded && hasExpandedDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden space-y-2.5"
          >
            {/* Resource usage */}
            {hasResourceData && (
              <div className="space-y-1.5">
                <div className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider">Resources</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {agent?.cpuMillicores ? (
                    <div className="flex items-center gap-1.5 rounded-md bg-surface-low px-2 py-1.5">
                      <Cpu className="w-3 h-3 text-text-muted flex-shrink-0" />
                      <div>
                        <div className="text-[10px] font-medium text-foreground">{formatCpu(agent.cpuMillicores)}</div>
                        <div className="text-[8px] text-text-muted">CPU</div>
                      </div>
                    </div>
                  ) : null}
                  {agent?.memoryMib ? (
                    <div className="flex items-center gap-1.5 rounded-md bg-surface-low px-2 py-1.5">
                      <MemoryStick className="w-3 h-3 text-text-muted flex-shrink-0" />
                      <div>
                        <div className="text-[10px] font-medium text-foreground">{formatMemory(agent.memoryMib)}</div>
                        <div className="text-[8px] text-text-muted">Memory</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* All tools */}
            {allTools.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                  <Wrench className="w-3 h-3" /> Tools
                </div>
                <div className="flex flex-wrap gap-1">
                  {allTools.map((t) => (
                    <span
                      key={t.name}
                      className={`text-[9px] px-1.5 py-0.5 rounded-full ${t.enabled ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-low text-text-muted line-through"}`}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Workspace files */}
            {files.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                  <FolderOpen className="w-3 h-3" /> Workspace Files
                </div>
                <div className="space-y-0.5">
                  {files.map((f) => (
                    <div key={f.path ?? f.name} className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                      <span className="text-[10px] text-foreground truncate">{displayFileName(f)}</span>
                      {typeof f.size === "number" && (
                        <span className="text-[9px] text-text-muted flex-shrink-0">{formatBytes(f.size)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connected services */}
            {agent?.connections && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                  <Link2 className="w-3 h-3" /> Connected
                </div>
                <div className="flex flex-wrap gap-1">
                  {connectedServices.length > 0 ? (
                    connectedServices.map((c) => (
                      <span key={c.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-low text-foreground">{c.name ?? c.id}</span>
                    ))
                  ) : (
                    <span className="text-[10px] text-text-muted">No active connections</span>
                  )}
                </div>
              </div>
            )}

            {/* Recent activity */}
            {activity.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                  <Activity className="w-3 h-3" /> Recent Activity
                </div>
                <div className="space-y-0.5">
                  {activity.map((a) => (
                    <div key={a.id} className="flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                      <span className="text-[10px] text-foreground flex-1 min-w-0 truncate">{a.detail || a.action}</span>
                      {typeof a.timestamp === "number" && (
                        <span className="text-[9px] text-text-muted flex-shrink-0">{relativeTime(a.timestamp)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface AgentCardModuleProps {
  variant: StyleVariant;
  agentName?: string;
  agentStatus?: AgentStatus | null;
  config?: { model: string; systemPrompt?: string; tools: { name: string; enabled: boolean }[] } | null;
  connections?: { id: string; connected: boolean }[] | null;
  sessions?: { key: string }[] | null;
  /** Start the agent (only shown when state is STOPPED/FAILED). */
  onStart?: () => void;
  /** Stop the agent (only shown when state is RUNNING). */
  onStop?: () => void;
  /** Loading flag for the start action. */
  starting?: boolean;
  /** Loading flag for the stop action. */
  stopping?: boolean;
  /** When true, the start button is disabled (e.g. tier capacity exhausted). */
  startBlocked?: boolean;
  /** Tooltip text for the disabled-start state. */
  startBlockedReason?: string;
}

export function AgentCardModule({
  variant,
  agentName = "My Agent",
  agentStatus,
  config: configProp,
  connections: connectionsProp,
  sessions: sessionsProp,
  onStart,
  onStop,
  starting = false,
  stopping = false,
  startBlocked = false,
  startBlockedReason,
}: AgentCardModuleProps) {
  // Render real agent data only. When a field hasn't loaded yet we show
  // empty/placeholder values — never mock data — so the card never
  // misrepresents a real agent. Mock fallbacks are reserved for the
  // "fully unbound" demo/storybook case (no name, no status, no config).
  const hasRealBinding = Boolean(agentStatus || configProp || connectionsProp || sessionsProp);
  const status: AgentStatus = agentStatus ?? (hasRealBinding
    ? { state: "STOPPED", uptime: 0, cpu: 0, memory: { used: 0, total: 0 }, version: "" }
    : MOCK_STATUS);
  const config = configProp ?? (hasRealBinding
    ? { model: "", systemPrompt: "", tools: [] as { name: string; enabled: boolean }[] }
    : MOCK_CONFIG);
  const isMock = !hasRealBinding;
  const configTools = config.tools;
  const enabledTools = configTools.filter((t) => t.enabled).map((t) => t.name);
  const sessionsCount = sessionsProp?.length ?? (hasRealBinding ? 0 : MOCK_SESSIONS.length);
  const connectedCount = (connectionsProp ?? (hasRealBinding ? [] : MOCK_CONNECTIONS)).filter((c) => c.connected).length;

  // State-driven action button
  const isRunning = status.state === "RUNNING";
  const isStopped = status.state === "STOPPED" || (status.state as string) === "FAILED";
  const isTransitioning = !isRunning && !isStopped; // PENDING, STARTING, STOPPING
  const avatar = agentAvatar(agentName);
  const AvatarIcon = avatar.icon;

  const renderActionButton = () => {
    if (isStopped && onStart) {
      return (
        <button
          onClick={onStart}
          disabled={starting || startBlocked}
          title={startBlocked ? startBlockedReason : "Start agent"}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          <span>Start</span>
        </button>
      );
    }
    if (isRunning && onStop) {
      return (
        <button
          onClick={onStop}
          disabled={stopping}
          title="Stop agent"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-border text-text-secondary hover:bg-surface-low hover:text-foreground transition-colors disabled:opacity-50"
        >
          {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
          <span>Stop</span>
        </button>
      );
    }
    if (isTransitioning) {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-[#f0c56c]/30 text-[#f0c56c]">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{status.state.charAt(0) + status.state.slice(1).toLowerCase()}…</span>
        </span>
      );
    }
    return null;
  };

  if (variant === "v1") {
    return (
      <div className="relative">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>}
        <div className="rounded-xl bg-surface-low p-4 space-y-3">
          <div className="flex items-center gap-3">
            <motion.div
              animate={isRunning ? { scale: [1, 1.05, 1] } : {}}
              transition={{ repeat: Infinity, duration: 3 }}
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{ backgroundColor: avatar.bgColor }}
            >
              {avatar.imageUrl ? (
                <img src={avatar.imageUrl} alt={`${agentName} avatar`} className="w-full h-full object-cover" />
              ) : (
                <AvatarIcon className="w-5 h-5" style={{ color: avatar.fgColor }} />
              )}
            </motion.div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {agentName}
              </div>
              {(config.model || status.version) && (
                <div className="text-[10px] text-text-muted truncate">
                  {config.model}{status.version ? ` · v${status.version}` : ""}
                </div>
              )}
            </div>
            {renderActionButton()}
          </div>
          {config.systemPrompt && (
            <p className="text-[10px] text-text-muted line-clamp-2">
              {config.systemPrompt}
            </p>
          )}
          {enabledTools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {enabledTools.map((t) => (
                <span
                  key={t}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-4 text-[10px] text-text-muted">
            <span>{connectedCount} connections</span>
            <span>{sessionsCount} sessions</span>
            {isRunning && <span>{formatUptime(status.uptime)} uptime</span>}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "v2") {
    return (
      <div className="relative">
        {isMock && <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>}
        <div className="rounded-lg bg-gradient-to-br from-[#38D39F]/5 to-transparent p-3 space-y-2">
          <div className="text-xs font-medium text-foreground">
            {agentName}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Tools", value: enabledTools.length },
              { label: "Links", value: connectedCount },
              { label: "Sessions", value: sessionsCount },
            ].map((stat, idx) => (
              <motion.div
                key={idx}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: idx * 0.1, type: "spring" }}
                className="py-1.5 rounded-md bg-background/50"
              >
                <div className="text-sm font-bold text-[#38D39F]">
                  {stat.value}
                </div>
                <div className="text-[9px] text-text-muted">
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // v3: Compact inline
  return (
    <div className="relative">
      {isMock && (
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
      )}
      <div className="rounded-md px-3 py-2 flex items-center gap-3 text-[10px] text-text-muted">
        <Bot className="w-4 h-4 text-[#38D39F] shrink-0" />
        <span className="text-foreground font-medium">{agentName}</span>
        {config.model && (<>
          <span>·</span>
          <span>{config.model}</span>
        </>)}
        <span>·</span>
        <span>{enabledTools.length} tools</span>
        <span>·</span>
        <span>{connectedCount} connected</span>
      </div>
    </div>
  );
}
