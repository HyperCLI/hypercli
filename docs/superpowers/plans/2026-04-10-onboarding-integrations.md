# Onboarding & Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock-data AgentView sidebar with a live readiness sidebar and a Directory modal for browsing and connecting integrations.

**Architecture:** Two new top-level components (ReadinessSidebar + DirectoryModal) wired into the agents page. The Directory modal reuses existing wizard components inside a new detail-page pattern. All data is mocked for this push — components accept real gateway data through props for later integration.

**Tech Stack:** React 19, Next.js 16, TypeScript, Tailwind v4, framer-motion, lucide-react. Follows existing Claw design system (glass cards, dark theme, Plus Jakarta Sans).

**Spec:** `docs/superpowers/specs/2026-04-10-onboarding-integrations-design.md`

**No test harness exists** — verification is via lint (`npx eslint`) and visual inspection on the dev server (`npm run dev --filter=@hypercli/claw` on port 4003).

---

### Task 1: Directory data layer — descriptions and category mapping

**Files:**
- Create: `site/apps/claw/src/components/dashboard/directory/directory-descriptions.ts`
- Create: `site/apps/claw/src/components/dashboard/directory/directory-utils.ts`

This task builds the data layer that all other components consume. No UI yet.

- [ ] **Step 1: Create directory folder**

```bash
mkdir -p site/apps/claw/src/components/dashboard/directory
```

- [ ] **Step 2: Write `directory-utils.ts`**

Create `site/apps/claw/src/components/dashboard/directory/directory-utils.ts`:

```typescript
import { PLUGIN_REGISTRY, type PluginMeta } from "../integrations/plugin-registry";

export type DirectoryCategory = "intelligence" | "web" | "channels" | "tools" | "media";

export interface DirectoryCategoryDef {
  id: DirectoryCategory;
  label: string;
  icon: string; // lucide icon name — resolved in components
  description: string;
}

export const DIRECTORY_CATEGORIES: DirectoryCategoryDef[] = [
  { id: "intelligence", label: "Intelligence", icon: "Sparkles", description: "AI models and inference powering your agent" },
  { id: "web", label: "Web", icon: "Globe", description: "Search and browse the internet" },
  { id: "channels", label: "Channels", icon: "MessageSquare", description: "Messaging platforms your agent can join" },
  { id: "tools", label: "Tools", icon: "Wrench", description: "Utilities, memory, code execution, and automation" },
  { id: "media", label: "Media", icon: "Palette", description: "Voice, vision, images, video, and 3D" },
];

/** IDs of plugins that belong in the "web" directory category */
const WEB_PLUGIN_IDS = new Set(["brave", "duckduckgo", "exa", "tavily", "firecrawl"]);

/** Map a DirectoryCategory to filtered plugins from the registry */
export function getPluginsForCategory(category: DirectoryCategory): PluginMeta[] {
  switch (category) {
    case "intelligence":
      // Intelligence is a status page, not a plugin grid.
      // Return AI providers for the "Advanced: Add External Provider" section.
      return PLUGIN_REGISTRY.filter((p) => p.category === "ai-providers");
    case "web":
      return PLUGIN_REGISTRY.filter((p) => WEB_PLUGIN_IDS.has(p.id));
    case "channels":
      return PLUGIN_REGISTRY.filter((p) => p.category === "chat");
    case "tools":
      return PLUGIN_REGISTRY.filter((p) => p.category === "tools" && !WEB_PLUGIN_IDS.has(p.id));
    case "media":
      return PLUGIN_REGISTRY.filter((p) => p.category === "built-in");
    default:
      return [];
  }
}

/** Determine which DirectoryCategory a plugin belongs to */
export function getCategoryForPlugin(pluginId: string): DirectoryCategory | null {
  if (WEB_PLUGIN_IDS.has(pluginId)) return "web";
  const plugin = PLUGIN_REGISTRY.find((p) => p.id === pluginId);
  if (!plugin) return null;
  switch (plugin.category) {
    case "chat": return "channels";
    case "ai-providers": return "intelligence";
    case "tools": return "tools";
    case "built-in": return "media";
    default: return null;
  }
}

/** Check if a plugin is connected based on gateway config */
export function isPluginConnected(pluginId: string, config: Record<string, unknown> | null): boolean {
  if (!config) return false;
  const plugin = PLUGIN_REGISTRY.find((p) => p.id === pluginId);
  if (!plugin) return false;

  const parts = plugin.configPath.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return false;
    }
  }

  if (current && typeof current === "object") {
    const obj = current as Record<string, unknown>;
    return obj.enabled === true || obj.token != null || obj.botToken != null || obj.apiKey != null;
  }
  return false;
}

/** IDs of plugins we mark as "Recommended" when not configured */
export const RECOMMENDED_PLUGIN_IDS = new Set(["duckduckgo", "brave", "memory-core"]);
```

- [ ] **Step 3: Write `directory-descriptions.ts`**

Create `site/apps/claw/src/components/dashboard/directory/directory-descriptions.ts`:

```typescript
/** Rich descriptions for high-priority integrations. Keyed by plugin ID. */
export const DIRECTORY_DESCRIPTIONS: Record<string, string> = {
  // Web
  duckduckgo:
    "Search the web without needing an API key. Your agent can look up current information, find answers, and research topics in real time. The simplest way to give your agent web access — just enable it.",
  brave:
    "Fast, privacy-focused web search with an API. Returns rich results including summaries and news. Requires a free API key from Brave.",
  tavily:
    "AI-optimized search built for agents. Returns clean, relevant results with extracted content — less noise than traditional search. Great for research-heavy workflows.",
  exa:
    "Semantic search that understands meaning, not just keywords. Best for finding specific types of content like research papers, documentation, or niche topics.",
  firecrawl:
    "Reads and extracts content from any web page. While search tools find pages, Firecrawl reads them deeply — pulling text, markdown, and structured data. Pair with a search tool for full web access.",

  // Channels
  telegram:
    "Connect your agent to Telegram. Users can DM your agent or add it to group chats. One of the easiest channels to set up — create a bot with BotFather and paste the token.",
  discord:
    "Bring your agent into Discord servers. It can respond to messages, join conversations, and help your community. Set up a Discord bot and invite it to your server.",
  slack:
    "Add your agent to your Slack workspace. It can respond in channels and DMs, making it accessible to your whole team without leaving the tools they already use.",
  whatsapp:
    "Connect your agent to WhatsApp. Requires scanning a QR code through the Shell tab — your agent gets its own WhatsApp session.",
  signal:
    "Privacy-first messaging through Signal. Your agent can receive and respond to encrypted messages. Requires signal-cli registration via the Shell tab.",
  msteams:
    "Bring your agent into Microsoft Teams. Works with Azure Bot registration — your team can chat with the agent directly in their existing workspace.",

  // Tools
  "memory-core":
    "Gives your agent persistent memory across conversations. It remembers context, preferences, and past interactions. Built-in and ready to go — just enable it.",
  "memory-lancedb":
    "Vector-powered memory for smarter recall. Your agent can search through past conversations by meaning, not just keywords. Upgrade from Core memory for agents that handle complex, ongoing work.",
  openshell:
    "Lets your agent execute shell commands in a sandboxed environment. Essential for agents that need to run code, install packages, or automate system tasks.",
  "diagnostics-otel":
    "OpenTelemetry diagnostics for monitoring agent health. Track performance, identify bottlenecks, and debug issues with your agent's runtime.",

  // Media
  "builtin-voice":
    "Your agent can speak aloud with 9 preset voices, or clone any voice from a short audio sample. Uses Qwen3-TTS for natural, expressive speech.",
  "builtin-speech":
    "Transcribes audio files in any language. Send your agent a voice memo and it converts it to text automatically. Powered by Faster-Whisper.",
  "builtin-vision":
    "Your agent can see and understand images. Send a screenshot, photo, or diagram and ask questions about it.",
  "builtin-images":
    "Generate images from text descriptions or edit existing images. Your agent can create illustrations, diagrams, and visual content on demand.",
  "builtin-video":
    "Create short videos from text descriptions or images. Your agent can produce visual content for presentations, social media, or documentation.",
  "builtin-3d":
    "Turn images into 3D models. Upload a photo of an object and your agent generates a textured 3D model you can rotate and inspect.",
};

/** Get the rich description for a plugin, falling back to the registry description */
export function getPluginDescription(pluginId: string, registryDescription: string): string {
  return DIRECTORY_DESCRIPTIONS[pluginId] ?? registryDescription;
}
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd site && npx tsc --noEmit --project apps/claw/tsconfig.json 2>&1 | head -20
```

Expected: no errors related to the new files (may show pre-existing errors elsewhere).

- [ ] **Step 5: Commit**

```bash
git add site/apps/claw/src/components/dashboard/directory/
git commit -m "Add directory data layer — descriptions and category mapping"
```

---

### Task 2: ReadinessSidebar component

**Files:**
- Create: `site/apps/claw/src/components/dashboard/ReadinessSidebar.tsx`

- [ ] **Step 1: Write ReadinessSidebar**

Create `site/apps/claw/src/components/dashboard/ReadinessSidebar.tsx`:

```typescript
"use client";

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Globe,
  MessageSquare,
  Wrench,
  Palette,
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
  RECOMMENDED_PLUGIN_IDS,
} from "./directory/directory-utils";

// ── Types ──

interface AgentInfo {
  id: string;
  name: string;
  pod_name?: string;
  state: string;
  cpu_millicores?: number;
  memory_mib?: number;
  hostname?: string;
  started_at?: string;
  created_at?: string;
}

export interface ReadinessSidebarProps {
  agent: AgentInfo;
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, any> | null;
  connected: boolean;
  onOpenDirectory: (category?: DirectoryCategory) => void;
}

// ── Mock readiness (used when config is null) ──

const MOCK_READINESS: Record<DirectoryCategory, { active: boolean; label: string; detail: string }> = {
  intelligence: { active: true, label: "Kimi K2.5", detail: "1 AIU Plan · 500M tokens/day" },
  web: { active: false, label: "Not configured", detail: "Your agent can't search the internet" },
  channels: { active: false, label: "Not connected", detail: "No messaging platforms" },
  tools: { active: true, label: "1 active", detail: "Memory (Core)" },
  media: { active: true, label: "Available", detail: "Requires HyperClaw balance" },
};

// ── Category icon map ──

const CATEGORY_ICONS: Record<DirectoryCategory, React.ElementType> = {
  intelligence: Sparkles,
  web: Globe,
  channels: MessageSquare,
  tools: Wrench,
  media: Palette,
};

// ── Component ──

export function ReadinessSidebar({
  agent,
  config,
  channelsStatus,
  connected,
  onOpenDirectory,
}: ReadinessSidebarProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  // Derive readiness from real config or use mocks
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
        : { active: false, label: "Not configured", detail: "Your agent can't search the internet" },
      channels: connectedChannels.length > 0
        ? { active: true, label: `${connectedChannels.length} connected`, detail: connectedChannels.map((p) => p.displayName).join(", ") }
        : { active: false, label: "Not connected", detail: "No messaging platforms" },
      tools: connectedTools.length > 0
        ? { active: true, label: `${connectedTools.length} active`, detail: connectedTools.map((p) => p.displayName).join(", ") }
        : { active: false, label: "Minimal", detail: "Browse available tools" },
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
      return cat === "media" ? null : "Manage →";
    }
    switch (cat) {
      case "web": return "Set up →";
      case "channels": return "Connect →";
      case "tools": return "Browse more →";
      default: return "View →";
    }
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-[#0a0a0b]">
      {/* ── Agent Header ── */}
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

      {/* ── Readiness Categories ── */}
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

      {/* ── Agent Info (collapsed) ── */}
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
                    <span className="text-xs text-text-muted">{formatCpu(agent.cpu_millicores)} · {formatMemory(agent.memory_mib)}</span>
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
```

- [ ] **Step 2: Verify no lint/type errors**

```bash
cd site && npx tsc --noEmit --project apps/claw/tsconfig.json 2>&1 | grep -i "ReadinessSidebar\|directory-utils\|directory-desc" | head -10
```

Expected: no errors referencing these new files.

- [ ] **Step 3: Commit**

```bash
git add site/apps/claw/src/components/dashboard/ReadinessSidebar.tsx
git commit -m "Add ReadinessSidebar component with mock data fallback"
```

---

### Task 3: DirectoryModal shell and grid

**Files:**
- Create: `site/apps/claw/src/components/dashboard/DirectoryModal.tsx`
- Create: `site/apps/claw/src/components/dashboard/directory/DirectoryGrid.tsx`

- [ ] **Step 1: Write DirectoryGrid**

Create `site/apps/claw/src/components/dashboard/directory/DirectoryGrid.tsx`:

```typescript
"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import type { PluginMeta } from "../integrations/plugin-registry";
import { isPluginConnected, RECOMMENDED_PLUGIN_IDS } from "./directory-utils";

interface DirectoryGridProps {
  plugins: PluginMeta[];
  config: Record<string, unknown> | null;
  onSelectPlugin: (pluginId: string) => void;
}

export function DirectoryGrid({ plugins, config, onSelectPlugin }: DirectoryGridProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return plugins;
    const q = search.toLowerCase();
    return plugins.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [plugins, search]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-surface-low border border-border text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-[#38D39F]/50"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No integrations match your search.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((plugin) => {
            const connected = isPluginConnected(plugin.id, config);
            const recommended = !connected && RECOMMENDED_PLUGIN_IDS.has(plugin.id);
            const Icon = plugin.icon;

            return (
              <motion.button
                key={plugin.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectPlugin(plugin.id)}
                className="text-left rounded-xl border border-border bg-surface-low/30 p-4 hover:bg-surface-low/60 hover:border-[#38D39F]/30 transition-colors relative"
              >
                {connected && (
                  <div className="absolute top-3 right-3 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#38D39F]" />
                    <span className="text-[10px] text-[#38D39F] font-medium">Connected</span>
                  </div>
                )}
                {recommended && (
                  <div className="absolute top-3 right-3">
                    <span className="text-[10px] font-medium text-[#f0c56c] bg-[#f0c56c]/10 px-1.5 py-0.5 rounded">
                      Recommended
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface-low flex items-center justify-center shrink-0 border border-border">
                    <Icon className="w-4.5 h-4.5 text-text-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{plugin.displayName}</div>
                    <div className="text-xs text-text-muted mt-0.5 line-clamp-2">{plugin.description}</div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write DirectoryModal**

Create `site/apps/claw/src/components/dashboard/DirectoryModal.tsx`:

```typescript
"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  Globe,
  MessageSquare,
  Wrench,
  Palette,
  ArrowLeft,
} from "lucide-react";
import {
  type DirectoryCategory,
  DIRECTORY_CATEGORIES,
  getPluginsForCategory,
} from "./directory/directory-utils";
import { DirectoryGrid } from "./directory/DirectoryGrid";
import { DirectoryDetail } from "./directory/DirectoryDetail";
import { IntelligencePanel } from "./directory/IntelligencePanel";

// ── Category icon map ──

const CATEGORY_ICONS: Record<DirectoryCategory, React.ElementType> = {
  intelligence: Sparkles,
  web: Globe,
  channels: MessageSquare,
  tools: Wrench,
  media: Palette,
};

// ── Props ──

export interface DirectoryModalProps {
  open: boolean;
  onClose: () => void;
  initialCategory?: DirectoryCategory;
  initialItemId?: string;
  config: Record<string, unknown> | null;
  channelsStatus: Record<string, any> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onOpenShell: () => void;
}

// ── Component ──

export function DirectoryModal({
  open,
  onClose,
  initialCategory,
  initialItemId,
  config,
  channelsStatus,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
}: DirectoryModalProps) {
  const [activeCategory, setActiveCategory] = useState<DirectoryCategory>(initialCategory ?? "web");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(initialItemId ?? null);

  // Sync with initial props when modal opens
  useEffect(() => {
    if (open) {
      if (initialCategory) setActiveCategory(initialCategory);
      setSelectedItemId(initialItemId ?? null);
    }
  }, [open, initialCategory, initialItemId]);

  const plugins = useMemo(() => getPluginsForCategory(activeCategory), [activeCategory]);

  const handleCategoryChange = useCallback((cat: DirectoryCategory) => {
    setActiveCategory(cat);
    setSelectedItemId(null);
  }, []);

  const handleBackToGrid = useCallback(() => {
    setSelectedItemId(null);
  }, []);

  const handleCloseModal = useCallback(() => {
    onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleCloseModal]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60"
            onClick={handleCloseModal}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-4 sm:inset-8 lg:inset-12 z-50 flex rounded-2xl border border-border bg-[#111113] shadow-2xl overflow-hidden"
          >
            {/* Left Nav */}
            <nav className="w-[200px] shrink-0 border-r border-border bg-[#0c0c0e] flex flex-col">
              <div className="px-4 py-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">Directory</h2>
              </div>
              <div className="flex-1 py-2 px-2 space-y-0.5">
                {DIRECTORY_CATEGORIES.map((cat) => {
                  const Icon = CATEGORY_ICONS[cat.id];
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleCategoryChange(cat.id)}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? "bg-[#38D39F]/10 text-foreground font-medium border-l-2 border-[#38D39F] -ml-0.5 pl-[10px]"
                          : "text-text-muted hover:text-foreground hover:bg-surface-low/40"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {selectedItemId && (
                    <button
                      onClick={handleBackToGrid}
                      className="text-text-muted hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {DIRECTORY_CATEGORIES.find((c) => c.id === activeCategory)?.label}
                    </h3>
                    <p className="text-xs text-text-muted">
                      {DIRECTORY_CATEGORIES.find((c) => c.id === activeCategory)?.description}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseModal}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeCategory === "intelligence" ? (
                  <IntelligencePanel
                    config={config}
                    onSaveConfig={onSaveConfig}
                  />
                ) : selectedItemId ? (
                  <DirectoryDetail
                    pluginId={selectedItemId}
                    config={config}
                    connected={connected}
                    onSaveConfig={onSaveConfig}
                    onChannelProbe={onChannelProbe}
                    onOpenShell={onOpenShell}
                    onBack={handleBackToGrid}
                    onCloseModal={handleCloseModal}
                  />
                ) : (
                  <DirectoryGrid
                    plugins={plugins}
                    config={config}
                    onSelectPlugin={setSelectedItemId}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add site/apps/claw/src/components/dashboard/DirectoryModal.tsx site/apps/claw/src/components/dashboard/directory/DirectoryGrid.tsx
git commit -m "Add DirectoryModal shell and DirectoryGrid"
```

---

### Task 4: DirectoryDetail — detail page with wizard integration

**Files:**
- Create: `site/apps/claw/src/components/dashboard/directory/DirectoryDetail.tsx`

- [ ] **Step 1: Write DirectoryDetail**

Create `site/apps/claw/src/components/dashboard/directory/DirectoryDetail.tsx`:

```typescript
"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { PLUGIN_REGISTRY, type PluginMeta } from "../integrations/plugin-registry";
import { getPluginDescription } from "./directory-descriptions";
import { isPluginConnected } from "./directory-utils";

// Import existing wizards
import { TelegramWizard } from "../integrations/TelegramWizard";
import { DiscordWizard } from "../integrations/DiscordWizard";
import { SlackWizard } from "../integrations/SlackWizard";
import { TokenSetupWizard } from "../integrations/TokenSetupWizard";
import { QrLoginWizard } from "../integrations/QrLoginWizard";
import { TtsPanel } from "../integrations/TtsPanel";

interface DirectoryDetailProps {
  pluginId: string;
  config: Record<string, unknown> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onOpenShell: () => void;
  onBack: () => void;
  onCloseModal: () => void;
}

export function DirectoryDetail({
  pluginId,
  config,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
  onBack,
  onCloseModal,
}: DirectoryDetailProps) {
  const plugin = useMemo(() => PLUGIN_REGISTRY.find((p) => p.id === pluginId), [pluginId]);
  const [enabling, setEnabling] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);

  if (!plugin) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-text-muted">Integration not found.</p>
      </div>
    );
  }

  const pluginConnected = isPluginConnected(plugin.id, config);
  const description = getPluginDescription(plugin.id, plugin.description);
  const Icon = plugin.icon;

  // Simple enable for plugins with no wizard/fields
  const handleSimpleEnable = async () => {
    setEnabling(true);
    try {
      const parts = plugin.configPath.split(".");
      const patch: Record<string, unknown> = {};
      let current = patch;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = {};
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = { enabled: true };
      await onSaveConfig(patch);
      setJustEnabled(true);
    } finally {
      setEnabling(false);
    }
  };

  // Determine which setup UI to render
  const renderSetup = () => {
    // Already connected
    if (pluginConnected || justEnabled) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-[#38D39F]/30 bg-[#38D39F]/5 p-4 flex items-center gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-[#38D39F] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#38D39F]">Connected</p>
            <p className="text-xs text-text-muted mt-0.5">This integration is active on your agent.</p>
          </div>
        </motion.div>
      );
    }

    // Telegram wizard
    if (plugin.id === "telegram") {
      return (
        <TelegramWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    // Discord wizard
    if (plugin.id === "discord") {
      return (
        <DiscordWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    // Slack wizard
    if (plugin.id === "slack") {
      return (
        <SlackWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    // QR-based (WhatsApp, Zalo Personal)
    if (plugin.id === "whatsapp" || plugin.id === "zalouser") {
      return (
        <QrLoginWizard
          pluginId={plugin.id}
          displayName={plugin.displayName}
          onEnable={onSaveConfig}
          onOpenShell={() => { onCloseModal(); onOpenShell(); }}
          onClose={onBack}
          configPath={plugin.configPath}
        />
      );
    }

    // Token setup wizard (has setupFields)
    if (plugin.setupFields && plugin.setupFields.length > 0) {
      return (
        <TokenSetupWizard
          pluginId={plugin.id}
          displayName={plugin.displayName}
          fields={plugin.setupFields}
          setupUrl={plugin.setupUrl}
          setupHint={plugin.setupHint}
          skipVerification={plugin.skipVerification}
          configPath={plugin.configPath}
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    // Built-in panels (media)
    if (plugin.id === "builtin-voice") {
      return <TtsPanel config={config} onSaveConfig={onSaveConfig} />;
    }
    if (plugin.hasBuiltinPanel) {
      // Info-only panels for speech, vision, images, video, 3d
      return (
        <div className="rounded-xl border border-border bg-surface-low/30 p-4">
          <p className="text-sm text-text-muted">
            This capability is included with your HyperClaw plan. It activates automatically when needed — no setup required.
          </p>
          <p className="text-xs text-text-muted mt-2">Uses pooled inference tokens.</p>
        </div>
      );
    }

    // API key plugins (setupUrl but no setupFields — search tools, etc.)
    if (plugin.setupUrl || plugin.setupHint) {
      return (
        <div className="space-y-3">
          {plugin.setupHint && (
            <p className="text-sm text-text-muted">{plugin.setupHint}</p>
          )}
          {plugin.setupUrl && (
            <a
              href={plugin.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[#38D39F] hover:underline"
            >
              Get API key <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={handleSimpleEnable}
            disabled={enabling}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {enabling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Enable
          </button>
        </div>
      );
    }

    // Default: simple enable button
    return (
      <button
        onClick={handleSimpleEnable}
        disabled={enabling}
        className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
      >
        {enabling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Enable
      </button>
    );
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-surface-low flex items-center justify-center border border-border shrink-0">
          <Icon className="w-6 h-6 text-text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-semibold text-foreground">{plugin.displayName}</h3>
          <p className="text-sm text-text-muted mt-1">{plugin.description}</p>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
      </div>

      {/* Setup */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Setup</h4>
        {renderSetup()}
      </div>

      {/* Info Footer */}
      <div className="border-t border-border pt-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">Config path</span>
          <span className="text-[11px] text-text-muted font-mono">{plugin.configPath}</span>
        </div>
        {plugin.setupUrl && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">Documentation</span>
            <a href={plugin.setupUrl} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-[#38D39F] hover:underline inline-flex items-center gap-1">
              Visit <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TtsPanel props compatibility**

Check that `TtsPanel` accepts `config` and `onSaveConfig` props. If it doesn't match, wrap it with the right props. Read the TtsPanel interface:

```bash
cd site && grep -A 10 "interface.*Props" apps/claw/src/components/dashboard/integrations/TtsPanel.tsx | head -15
```

Adjust the `<TtsPanel>` call in DirectoryDetail if needed to match its actual props.

- [ ] **Step 3: Commit**

```bash
git add site/apps/claw/src/components/dashboard/directory/DirectoryDetail.tsx
git commit -m "Add DirectoryDetail with wizard integration"
```

---

### Task 5: IntelligencePanel

**Files:**
- Create: `site/apps/claw/src/components/dashboard/directory/IntelligencePanel.tsx`

- [ ] **Step 1: Write IntelligencePanel**

Create `site/apps/claw/src/components/dashboard/directory/IntelligencePanel.tsx`:

```typescript
"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Zap,
  Brain,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

interface IntelligencePanelProps {
  config: Record<string, unknown> | null;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
}

// Mock plan data (replace with real API data when available)
const MOCK_PLAN = {
  name: "1 AIU Plan",
  tokensPerDay: "500M",
  tpmLimit: "600K",
  rpmLimit: "3,000",
  billingReset: "2026-05-10",
};

const MOCK_MODELS = [
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    contextWindow: "262K",
    capabilities: ["Reasoning", "Vision", "Tool Use"],
    description: "High-performance reasoning model with extended context. Excellent for complex analysis and multi-step tasks.",
  },
  {
    id: "glm-5",
    name: "GLM-5",
    contextWindow: "202K",
    capabilities: ["Reasoning", "Tool Use"],
    description: "Fast, capable reasoning model. Great for general-purpose tasks and quick responses.",
  },
];

export function IntelligencePanel({ config, onSaveConfig }: IntelligencePanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-[#38D39F]/20 bg-[#38D39F]/5 p-5"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#38D39F]/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-[#38D39F]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">HyperClaw Intelligence</h3>
            <p className="text-sm text-text-muted mt-1">
              Your agent's reasoning is powered by HyperClaw's inference network.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Plan</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.name}</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Tokens / Day</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.tokensPerDay}</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Rate Limits</p>
            <p className="text-sm font-semibold text-foreground">{MOCK_PLAN.tpmLimit} TPM · {MOCK_PLAN.rpmLimit} RPM</p>
          </div>
          <div className="rounded-lg bg-[#0a0a0b]/50 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-muted mb-1">Billing Reset</p>
            <p className="text-sm font-semibold text-foreground">{new Date(MOCK_PLAN.billingReset).toLocaleDateString()}</p>
          </div>
        </div>
      </motion.div>

      {/* Model Cards */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Available Models</h4>
        <div className="space-y-3">
          {MOCK_MODELS.map((model) => (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-border bg-surface-low/30 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-low flex items-center justify-center shrink-0 border border-border">
                  <Brain className="w-4.5 h-4.5 text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{model.name}</span>
                    <span className="text-[10px] text-text-muted font-mono">{model.contextWindow} ctx</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">{model.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {model.capabilities.map((cap) => (
                      <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-low border border-border text-text-muted">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Advanced: External Providers */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-foreground transition-colors"
        >
          {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Add External Provider
        </button>
        {advancedOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-3 rounded-xl border border-border bg-surface-low/30 p-4"
          >
            <p className="text-sm text-text-muted mb-3">
              HyperClaw provides all the intelligence your agent needs. Add external providers if you have specific model requirements.
            </p>
            <p className="text-xs text-text-muted">
              Configure external providers in the{" "}
              <span className="text-foreground font-medium">OpenClaw</span> tab for full control over provider settings, model aliases, and fallback chains.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add site/apps/claw/src/components/dashboard/directory/IntelligencePanel.tsx
git commit -m "Add IntelligencePanel for Intelligence category"
```

---

### Task 6: Wire into agents page

**Files:**
- Modify: `site/apps/claw/src/app/dashboard/agents/page.tsx`

This is the integration task — replacing AgentView with ReadinessSidebar, removing the Integrations tab, and adding DirectoryModal state.

- [ ] **Step 1: Add imports**

At the top of `site/apps/claw/src/app/dashboard/agents/page.tsx`, replace the AgentView import and add new imports. Find:

```typescript
import { AgentView, ConnectionDetail, type TabId as AgentViewTabId } from "@/components/dashboard/AgentView";
```

Replace with:

```typescript
import { ReadinessSidebar } from "@/components/dashboard/ReadinessSidebar";
import { DirectoryModal } from "@/components/dashboard/DirectoryModal";
import type { DirectoryCategory } from "@/components/dashboard/directory/directory-utils";
```

Also remove the IntegrationsPage import:

```typescript
import { IntegrationsPage } from "@/components/dashboard/integrations";
```

- [ ] **Step 2: Add Directory modal state**

Find the `agentViewTab` state declaration (around line 817):

```typescript
  const [agentViewTab, setAgentViewTab] = useState<AgentViewTabId>("overview");
```

Replace with:

```typescript
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryCategory, setDirectoryCategory] = useState<DirectoryCategory | undefined>();
```

Add a handler nearby:

```typescript
  const handleOpenDirectory = useCallback((category?: DirectoryCategory) => {
    setDirectoryCategory(category);
    setDirectoryOpen(true);
  }, []);

  // Mock callbacks for directory (swap for real gateway calls when available)
  const mockSaveConfig = useCallback(async (_patch: Record<string, unknown>) => {
    await new Promise((r) => setTimeout(r, 500));
  }, []);

  const mockChannelProbe = useCallback(async () => {
    return { channels: {} };
  }, []);
```

- [ ] **Step 3: Remove Integrations tab from tab list**

Find the tab definitions (around line 946-956). Remove the integrations entry:

```typescript
    { key: "integrations", label: "Integrations", icon: Plug },
```

Also remove `"integrations"` from any `mainTab` type union or conditional checks where it appears (around line 990).

- [ ] **Step 4: Remove IntegrationsPage rendering**

Find the integrations tab rendering block (around line 3093-3104):

```typescript
                ) : mainTab === "integrations" && selectedAgent ? (
                  /* ── Integrations Tab ── */
                  <div className="h-full overflow-y-auto">
                    <IntegrationsPage
                      config={chat.config as Record<string, unknown> | null}
                      configSchema={chat.configSchema}
                      connected={chat.connected}
                      onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
                      onChannelProbe={async () => chat.channelsStatus(true)}
                      onOpenShell={() => setMainTab("shell")}
                    />
                  </div>
```

Remove this entire block.

- [ ] **Step 5: Replace AgentView with ReadinessSidebar**

Find the right sidebar section (around line 3205-3251):

```typescript
        {/* ── Right Sidebar — AgentView ── */}
        {selectedAgent && isDesktopViewport && (
          <div className="w-80 flex-shrink-0 border-l border-border flex flex-col min-h-0">
            {selectedConnection ? (
              <ConnectionDetail
                connection={selectedConnection}
                onClose={() => setSelectedConnection(null)}
              />
            ) : (
              <AgentView
                agentName={selectedAgent.name || selectedAgent.pod_name || "Agent"}
                onConnectionSelect={(conn) => setSelectedConnection(conn)}
                activeTab={agentViewTab}
                onTabChange={setAgentViewTab}
                ...all the variant props...
              />
            )}
          </div>
        )}
```

Replace the entire block with:

```typescript
        {/* ── Right Sidebar — Readiness ── */}
        {selectedAgent && isDesktopViewport && (
          <div className="w-80 flex-shrink-0 border-l border-border flex flex-col min-h-0">
            <ReadinessSidebar
              agent={selectedAgent}
              config={chat.config as Record<string, unknown> | null}
              channelsStatus={null}
              connected={chat.connected}
              onOpenDirectory={handleOpenDirectory}
            />
          </div>
        )}
```

- [ ] **Step 6: Add DirectoryModal before closing tags**

Just before the final `</div>` closings at the bottom of the JSX return (around line 3253), add:

```typescript
        {/* ── Directory Modal ── */}
        <DirectoryModal
          open={directoryOpen}
          onClose={() => setDirectoryOpen(false)}
          initialCategory={directoryCategory}
          config={chat.config as Record<string, unknown> | null}
          channelsStatus={null}
          connected={chat.connected}
          onSaveConfig={chat.connected ? async (patch) => { await chat.saveConfig(patch); } : mockSaveConfig}
          onChannelProbe={chat.connected ? async () => chat.channelsStatus(true) : mockChannelProbe}
          onOpenShell={() => { setDirectoryOpen(false); setMainTab("shell"); }}
        />
```

- [ ] **Step 7: Clean up unused imports**

Remove any now-unused imports: `AgentView`, `ConnectionDetail`, `AgentViewTabId`, `IntegrationsPage`, `Plug` (if only used for integrations tab icon).

Verify with:

```bash
cd site && npx tsc --noEmit --project apps/claw/tsconfig.json 2>&1 | head -30
```

- [ ] **Step 8: Verify on dev server**

```bash
cd site && npx turbo run dev --filter=@hypercli/claw
```

Open `http://localhost:4003/dashboard/agents/` in browser. Verify:
- Right sidebar shows ReadinessSidebar with 5 readiness categories
- Clicking any category opens the Directory modal
- Modal shows left nav, grid of integrations, and detail pages
- Existing tabs (Chat, Logs, Shell, Files, OpenClaw, Settings) still work
- Integrations tab is gone

- [ ] **Step 9: Commit**

```bash
git add site/apps/claw/src/app/dashboard/agents/page.tsx
git commit -m "Wire ReadinessSidebar and DirectoryModal into agents page"
```

---

### Task 7: Polish and verify full flow

**Files:**
- Possibly modify: any of the new files for fixes found during verification

- [ ] **Step 1: Full visual walkthrough**

With the dev server running, walk through the complete flow:

1. Load `/dashboard/agents/` — sidebar shows, all categories visible
2. Click "Web" → modal opens to Web category with 5 search tools
3. Click "DuckDuckGo" → detail page with rich description + Enable button
4. Click Enable → simulated success, shows "Connected" state
5. Back to grid → DuckDuckGo shows green "Connected" badge
6. Switch to Channels via left nav → 22 messaging integrations
7. Click Telegram → detail page with TelegramWizard inline
8. Switch to Intelligence → status page with plan info + model cards
9. Switch to Media → 6 built-in capability cards
10. Close modal → sidebar is visible
11. Click "+" in sidebar header → modal opens with no specific category

- [ ] **Step 2: Fix any visual/functional issues found**

Address any styling inconsistencies, broken layouts, or interaction bugs.

- [ ] **Step 3: Lint check**

```bash
cd site && npx eslint apps/claw/src/components/dashboard/ReadinessSidebar.tsx apps/claw/src/components/dashboard/DirectoryModal.tsx apps/claw/src/components/dashboard/directory/ --max-warnings 0
```

Fix any lint errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "Polish onboarding flow — visual fixes and lint cleanup"
```

---

### Task Summary

| Task | What | Files | Est. Lines |
|------|------|-------|-----------|
| 1 | Data layer (descriptions + utils) | 2 new | ~200 |
| 2 | ReadinessSidebar | 1 new | ~250 |
| 3 | DirectoryModal + DirectoryGrid | 2 new | ~350 |
| 4 | DirectoryDetail (wizard host) | 1 new | ~200 |
| 5 | IntelligencePanel | 1 new | ~150 |
| 6 | Wire into agents page | 1 modified | ~50 net |
| 7 | Polish and verify | various | ~50 |

**Total: 7 new files, 1 modified, ~1250 lines of new code.**
