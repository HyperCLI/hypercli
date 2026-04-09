"use client";

import { useState } from "react";
import { Bot, ChevronDown, Wrench, FolderOpen, Link2, Activity, Cpu, MemoryStick } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { agentAvatar } from "@/lib/avatar";
import type { StyleVariant, AgentStatus } from "../agentViewTypes";
import {
  MOCK_CONFIG,
  MOCK_CONNECTIONS,
  MOCK_SESSIONS,
  MOCK_STATUS,
  MOCK_ACTIVITY,
} from "../agentViewMockData";
import { formatUptime, relativeTime } from "../agentViewUtils";

/* ── Compact tooltip card for agent avatar hovers ── */

const MOCK_FREQUENT_FILES = [
  { path: "/src/gateway-client.ts", hits: 14 },
  { path: "/src/hooks/useGatewayChat.ts", hits: 9 },
  { path: "/src/lib/api.ts", hits: 7 },
  { path: "/src/components/dashboard/AgentView.tsx", hits: 5 },
  { path: "/package.json", hits: 3 },
];

interface AgentCardTooltipProps {
  agentName: string;
}

export function AgentCardTooltip({ agentName }: AgentCardTooltipProps) {
  const [expanded, setExpanded] = useState(false);
  const status = MOCK_STATUS;
  const allTools = MOCK_CONFIG.tools;
  const enabledTools = allTools.filter((t) => t.enabled).map((t) => t.name);
  const connectedCount = MOCK_CONNECTIONS.filter((c) => c.connected).length;
  const connectedServices = MOCK_CONNECTIONS.filter((c) => c.connected);
  const avatar = agentAvatar(agentName);
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
          <Icon className="w-4 h-4" style={{ color: avatar.fgColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">{agentName}</div>
          <div className="text-[10px] text-text-muted">{MOCK_CONFIG.model} · v{status.version}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${status.state === "RUNNING" ? "bg-[#38D39F]" : "bg-text-muted"}`} />
          <span className="text-[9px] text-text-muted">{status.state.toLowerCase()}</span>
        </div>
      </div>

      <p className="text-[10px] text-text-muted line-clamp-2">{MOCK_CONFIG.systemPrompt}</p>

      <div className="flex flex-wrap gap-1">
        {enabledTools.slice(0, 4).map((t) => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F]">{t}</span>
        ))}
        {enabledTools.length > 4 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-low text-text-muted">+{enabledTools.length - 4}</span>
        )}
      </div>

      <div className="flex gap-3 text-[10px] text-text-muted pt-0.5 border-t border-border">
        <span>{connectedCount} connections</span>
        <span>{MOCK_SESSIONS.length} sessions</span>
        <span>{formatUptime(status.uptime)} up</span>
      </div>

      {/* Expand toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="flex items-center justify-center gap-1 w-full py-1 rounded-md hover:bg-surface-low transition-colors text-[10px] text-text-muted hover:text-foreground"
      >
        <span>{expanded ? "Less" : "More"}</span>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="w-3 h-3" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden space-y-2.5"
          >
            {/* Resource usage */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider">Resources</div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1.5 rounded-md bg-surface-low px-2 py-1.5">
                  <Cpu className="w-3 h-3 text-text-muted flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-medium text-foreground">{status.cpu}%</div>
                    <div className="text-[8px] text-text-muted">CPU</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 rounded-md bg-surface-low px-2 py-1.5">
                  <MemoryStick className="w-3 h-3 text-text-muted flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-medium text-foreground">{Math.round(status.memory.used / 1024 / 1024)}MB</div>
                    <div className="text-[8px] text-text-muted">/ {Math.round(status.memory.total / 1024 / 1024)}MB</div>
                  </div>
                </div>
              </div>
            </div>

            {/* All tools */}
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

            {/* Frequent files */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                <FolderOpen className="w-3 h-3" /> Frequent Files
              </div>
              <div className="space-y-0.5">
                {MOCK_FREQUENT_FILES.slice(0, 4).map((f) => (
                  <div key={f.path} className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                    <span className="text-[10px] text-foreground truncate">{f.path.split("/").pop()}</span>
                    <span className="text-[9px] text-text-muted flex-shrink-0">{f.hits} hits</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Connected services */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                <Link2 className="w-3 h-3" /> Connected
              </div>
              <div className="flex flex-wrap gap-1">
                {connectedServices.map((c) => (
                  <span key={c.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-low text-foreground">{c.name}</span>
                ))}
              </div>
            </div>

            {/* Recent activity */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary uppercase tracking-wider">
                <Activity className="w-3 h-3" /> Recent Activity
              </div>
              <div className="space-y-0.5">
                {MOCK_ACTIVITY.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                    <span className="text-[10px] text-foreground flex-1 min-w-0 truncate">{a.detail}</span>
                    <span className="text-[9px] text-text-muted flex-shrink-0">{relativeTime(a.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
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
}

export function AgentCardModule({
  variant,
  agentName = "My Agent",
  agentStatus,
}: AgentCardModuleProps) {
  const status = agentStatus ?? MOCK_STATUS;
  const configTools = MOCK_CONFIG.tools;
  const enabledTools = configTools.filter((t) => t.enabled).map((t) => t.name);
  const connectedCount = MOCK_CONNECTIONS.filter((c) => c.connected).length;

  if (variant === "v1") {
    return (
      <div className="relative">
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
        <div className="rounded-xl bg-surface-low p-4 space-y-3">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 3 }}
              className="w-10 h-10 rounded-xl bg-[#38D39F]/15 flex items-center justify-center"
            >
              <Bot className="w-5 h-5 text-[#38D39F]" />
            </motion.div>
            <div>
              <div className="text-sm font-semibold text-foreground">
                {agentName}
              </div>
              <div className="text-[10px] text-text-muted">
                {MOCK_CONFIG.model} · v{status.version}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-text-muted line-clamp-2">
            {MOCK_CONFIG.systemPrompt}
          </p>
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
          <div className="flex gap-4 text-[10px] text-text-muted">
            <span>{connectedCount} connections</span>
            <span>{MOCK_SESSIONS.length} sessions</span>
            <span>{formatUptime(status.uptime)} uptime</span>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "v2") {
    return (
      <div className="relative">
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
          mock
        </span>
        <div className="rounded-lg bg-gradient-to-br from-[#38D39F]/5 to-transparent p-3 space-y-2">
          <div className="text-xs font-medium text-foreground">
            {agentName}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Tools", value: enabledTools.length },
              { label: "Links", value: connectedCount },
              { label: "Sessions", value: MOCK_SESSIONS.length },
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
      <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">
        mock
      </span>
      <div className="rounded-md px-3 py-2 flex items-center gap-3 text-[10px] text-text-muted">
        <Bot className="w-4 h-4 text-[#38D39F] shrink-0" />
        <span className="text-foreground font-medium">{agentName}</span>
        <span>·</span>
        <span>{MOCK_CONFIG.model}</span>
        <span>·</span>
        <span>{enabledTools.length} tools</span>
        <span>·</span>
        <span>{connectedCount} connected</span>
      </div>
    </div>
  );
}
