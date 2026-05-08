"use client";

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Globe,
  MessageSquare,
  Wrench,
  Palette,
  Box,
  Plus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import { formatCpu, formatMemory } from "@/lib/format";
import {
  type DirectoryCategory,
  DIRECTORY_CATEGORIES,
  getPluginsForCategory,
  isPluginConnected,
} from "./directory/directory-utils";

// ── Types ──

interface AgentInfo {
  id: string;
  name: string;
  pod_name?: string | null;
  state: string;
  cpu_millicores?: number;
  memory_mib?: number;
  hostname?: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

export interface ReadinessSidebarProps {
  agent: AgentInfo;
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, unknown> | null;
  connected: boolean;
  onOpenDirectory: (category?: DirectoryCategory) => void;
}

// ── Mock readiness (used when config is null) ──

const MOCK_READINESS: Record<DirectoryCategory, { active: boolean; label: string; detail: string }> = {
  intelligence: { active: true, label: "Kimi K2.5", detail: "1 AIU Plan \u00b7 500M tokens/day" },
  web: { active: false, label: "Not configured", detail: "Your agent can\u2019t search the internet" },
  channels: { active: false, label: "Not connected", detail: "No messaging platforms" },
  tools: { active: true, label: "1 active", detail: "Memory (Core)" },
  skills: { active: true, label: "Available", detail: "App skills directory" },
  media: { active: true, label: "Available", detail: "Requires HyperClaw balance" },
};

// ── Category icon map ──

const CATEGORY_ICONS: Record<DirectoryCategory, React.ElementType> = {
  intelligence: Sparkles,
  web: Globe,
  channels: MessageSquare,
  tools: Wrench,
  skills: Box,
  media: Palette,
};

// ── Component ──

export function ReadinessSidebar({
  agent,
  config,
  connected,
  onOpenDirectory,
}: ReadinessSidebarProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  const readiness = useMemo(() => {
    if (!config) return MOCK_READINESS;

    const webPlugins = getPluginsForCategory("web");
    const connectedWeb = webPlugins.filter((p) => isPluginConnected(p.id, config));

    const channelPlugins = getPluginsForCategory("channels");
    const connectedChannels = channelPlugins.filter((p) => isPluginConnected(p.id, config));

    const toolPlugins = getPluginsForCategory("tools");
    const connectedTools = toolPlugins.filter((p) => isPluginConnected(p.id, config));

    return {
      intelligence: { active: true, label: "Kimi K2.5", detail: "HyperClaw inference active" },
      web: connectedWeb.length > 0
        ? { active: true, label: `${connectedWeb.length} active`, detail: connectedWeb.map((p) => p.displayName).join(", ") }
        : { active: false, label: "Not configured", detail: "Your agent can\u2019t search the internet" },
      channels: connectedChannels.length > 0
        ? { active: true, label: `${connectedChannels.length} connected`, detail: connectedChannels.map((p) => p.displayName).join(", ") }
        : { active: false, label: "Not connected", detail: "No messaging platforms" },
      tools: connectedTools.length > 0
        ? { active: true, label: `${connectedTools.length} active`, detail: connectedTools.map((p) => p.displayName).join(", ") }
        : { active: false, label: "Minimal", detail: "Browse available tools" },
      skills: { active: true, label: "Available", detail: "App skills directory" },
      media: { active: true, label: "Available", detail: "Requires HyperClaw balance" },
    } satisfies Record<DirectoryCategory, { active: boolean; label: string; detail: string }>;
  }, [config]);

  const avatar = agentAvatar(agent.name || agent.pod_name || "Agent");
  const AvatarIcon = avatar.icon;

  const isRecommended = (cat: DirectoryCategory) =>
    cat === "web" && !readiness.web.active;

  const statusColor = (cat: DirectoryCategory) => {
    if (readiness[cat].active) return "#38D39F";
    if (isRecommended(cat)) return "#f0c56c";
    return "#6b7280";
  };

  const ctaLabel = (cat: DirectoryCategory) => {
    if (readiness[cat].active) {
      return cat === "media" ? null : "Manage \u2192";
    }
    switch (cat) {
      case "web": return "Set up \u2192";
      case "channels": return "Connect \u2192";
      case "tools": return "Browse more \u2192";
      case "skills": return "View \u2192";
      default: return "View \u2192";
    }
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-[#0a0a0b]">
      {/* Agent Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: avatar.bgColor }}
        >
          <AvatarIcon className="w-5 h-5" style={{ color: avatar.fgColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">
            {agent.name || agent.pod_name || "Agent"}
          </div>
          <div className={`text-xs font-medium ${
            agent.state === "RUNNING" ? "text-[#38D39F]" :
            agent.state === "STOPPED" ? "text-text-muted" :
            "text-[#f0c56c]"
          }`}>
            {agent.state}
          </div>
        </div>
        <button
          onClick={() => onOpenDirectory()}
          className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
          title="Open Directory"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Readiness Categories */}
      <div className="flex-1 px-3 py-3 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted/60 mb-2 px-1">
          Agent Readiness
        </p>

        {DIRECTORY_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id];
          const state = readiness[cat.id];
          const color = statusColor(cat.id);
          const cta = ctaLabel(cat.id);
          const recommended = isRecommended(cat.id);

          return (
            <button
              key={cat.id}
              onClick={() => onOpenDirectory(cat.id)}
              className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-surface-low/60 transition-colors group"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                <span className="text-sm font-medium text-foreground flex-1">{cat.label}</span>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              </div>
              <div className="mt-1 ml-[26px]">
                <span className="text-xs text-text-muted">{state.detail}</span>
                {recommended && (
                  <span className="ml-2 text-[10px] font-medium text-[#f0c56c] bg-[#f0c56c]/10 px-1.5 py-0.5 rounded">
                    Recommended
                  </span>
                )}
              </div>
              {cta && (
                <div className="mt-1.5 ml-[26px]">
                  <span className="text-xs text-[#38D39F] opacity-0 group-hover:opacity-100 transition-opacity">
                    {cta}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Agent Info (collapsed) */}
      <div className="border-t border-border">
        <button
          onClick={() => setInfoOpen(!infoOpen)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-text-muted hover:text-foreground transition-colors"
        >
          {infoOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Agent Info
        </button>
        <AnimatePresence>
          {infoOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Agent ID</span>
                  <span className="text-xs text-text-muted font-mono">{agent.id.slice(0, 12)}...</span>
                </div>
                {agent.cpu_millicores != null && agent.memory_mib != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Resources</span>
                    <span className="text-xs text-text-muted">{formatCpu(agent.cpu_millicores)} \u00b7 {formatMemory(agent.memory_mib)}</span>
                  </div>
                )}
                {agent.hostname && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Hostname</span>
                    <span className="text-xs text-text-muted font-mono truncate ml-2">{agent.hostname}</span>
                  </div>
                )}
                {agent.created_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">Created</span>
                    <span className="text-xs text-text-muted">{new Date(agent.created_at).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
