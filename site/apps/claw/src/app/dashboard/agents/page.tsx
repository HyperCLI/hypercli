"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOpenClawConfigValue,
  describeOpenClawConfigNode,
  normalizeOpenClawConfigSchemaNode,
} from "@hypercli.com/sdk/openclaw/gateway";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Key,
  CreditCard,
  ExternalLink,
  Loader2,
  Plus,
  MessageSquare,
  Play,
  RefreshCw,
  TerminalSquare,
  Trash2,
  Settings,
  SlidersHorizontal,
  PanelLeft,
  PanelLeftOpen,
  Plug,
  Menu,
  X,
  Gauge,
  Link2,
  Zap,
  Timer,
  FolderOpen,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { createAgentClient, createOpenClawAgent, startOpenClawAgent } from "@/lib/agent-client";
import { formatCpu, formatMemory } from "@/lib/format";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { useAgentLogs } from "@/hooks/useAgentLogs";
import { useAgentShell } from "@/hooks/useAgentShell";
import { agentAvatar } from "@/lib/avatar";
import { AgentCreationWizard } from "@/components/dashboard/AgentCreationWizard";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { IntegrationsPage } from "@/components/dashboard/integrations";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { AgentView } from "@/components/dashboard/AgentView";
import type { TabId as AgentViewTabId } from "@/components/dashboard/agentViewTypes";
import { Sheet, SheetContent, Tooltip, TooltipTrigger, TooltipContent } from "@hypercli/shared-ui";
import { AgentCardTooltip } from "@/components/dashboard/modules/AgentCardModule";
import { AgentsChannelsSidebar, MOCK_PARTICIPANTS, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { ChannelCreationWizard } from "@/components/dashboard/ChannelCreationWizard";
import { DirectoryModal } from "@/components/dashboard/DirectoryModal";
import type { DirectoryCategory } from "@/components/dashboard/directory/directory-utils";
import type { SdkAgent } from "@/types";
import type { Deployments, OpenClawAgent as SdkOpenClawAgent } from "@hypercli.com/sdk/agents";
import type { Agent, AgentBudget, AgentDesktopTokenResponse, AgentState, JsonObject } from "./types";
import {
  describeAgentTierStartGuidance,
  describeAgentsPageError,
  getAgentSizePresets,
  inferAgentTier,
  parseEntitlementSlotTier,
  titleizeTier,
  type AgentTierSelectionState,
} from "@/lib/agent-tier";
import {
  OPENCLAW_SYNC_ROOT,
  OPENCLAW_WORKSPACE_DIR,
  OPENCLAW_WORKSPACE_PREFIX,
  asObject,
  deepCloneJsonObject,
  getOpenClawUiHint,
  getPathValue,
  humanizeKey,
  setPathValue,
  sortOpenClawEntries,
} from "@/lib/openclaw-config";
import {
  AgentLaunchPrompt,
  ConnectionStatusIndicator,
  GearDropdown,
  type CenterPanel,
} from "@/components/dashboard/agents/page-helpers";
import { AgentEmptyState, AgentSettingsModal, AgentSidebarPane, AgentTierSelectionModal, ErrorBanner, OpenClawConfigModal } from "@/components/dashboard/agents/AgentPanels";
import { AgentChatPanel } from "@/components/dashboard/agents/AgentChatPanel";
import { AgentLogsPanel } from "@/components/dashboard/agents/AgentLogsPanel";
import { AgentTerminalPanel } from "@/components/dashboard/agents/AgentTerminalPanel";

// ── Constants ──

type MainTab = AgentMainTab;

function toDashboardAgent(agent: SdkAgent): Agent {
  return {
    id: agent.id,
    name: agent.name ?? agent.id,
    user_id: agent.userId,
    pod_id: agent.podId || null,
    pod_name: agent.podName || null,
    state: (agent.state || "STOPPED").toUpperCase() as AgentState,
    cpu_millicores: Math.round((agent.cpu || 0) * 1000),
    memory_mib: Math.round((agent.memory || 0) * 1024),
    hostname: agent.hostname ?? null,
    started_at: agent.startedAt?.toISOString() ?? null,
    stopped_at: agent.stoppedAt?.toISOString() ?? null,
    last_error: agent.lastError ?? null,
    created_at: agent.createdAt?.toISOString() ?? null,
    updated_at: agent.updatedAt?.toISOString() ?? null,
    meta: agent.meta ?? null,
  };
}

function upsertSdkAgent(prev: SdkAgent[], nextAgent: SdkAgent): SdkAgent[] {
  const index = prev.findIndex((agent) => agent.id === nextAgent.id);
  if (index === -1) {
    return [...prev, nextAgent];
  }
  const next = [...prev];
  next[index] = nextAgent;
  return next;
}

function removeSdkAgent(prev: SdkAgent[], agentId: string): SdkAgent[] {
  return prev.filter((agent) => agent.id !== agentId);
}
// Shell now routes through backend WebSocket via lagoon → K8s exec

// ── Main component ──

export default function AgentsPage() {
  const { getToken } = useAgentAuth();
  const router = useRouter();
  const { setAgentMenu } = useDashboardMobileAgentMenu();
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Agent data
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [recentlyStoppedIds, setRecentlyStoppedIds] = useState<Set<string>>(new Set());
  const stoppedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  useEffect(() => {
    return () => { stoppedTimersRef.current.forEach((t) => clearTimeout(t)); };
  }, []);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDialogInitialStep, setCreateDialogInitialStep] = useState(0);
  const [createDialogPreferredTier, setCreateDialogPreferredTier] = useState<string | null>(null);
  const [tierSelection, setTierSelection] = useState<AgentTierSelectionState | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileAgentMenuOpen, setMobileAgentMenuOpen] = useState(false);
  const [sidebarCreatorSignal, setSidebarCreatorSignal] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("agents.sidebarCollapsed") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("agents.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Logs
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Shell
  const shellBoxRef = useRef<HTMLDivElement | null>(null);
  const shellTerminalRef = useRef<Terminal | null>(null);
  const shellFitAddonRef = useRef<FitAddon | null>(null);
  const shellSessionAgentRef = useRef<string | null>(null);
  const shellBufferRef = useRef<string[]>([]);

  // Files panel

  // Right sidebar (AgentView)
  const [agentViewTab, setAgentViewTab] = useState<AgentViewTabId>("overview");
  const [channelsData, setChannelsData] = useState<Record<string, unknown> | null>(null);
  const [agentViewSheetOpen, setAgentViewSheetOpen] = useState(false);

  // Modal overlays for gear dropdown items
  const [showOpenclawModal, setShowOpenclawModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showChannelWizard, setShowChannelWizard] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryCategory, setDirectoryCategory] = useState<DirectoryCategory | undefined>();

  // Hatching animation state tracking
  const prevStatesRef = useRef<Map<string, AgentState>>(new Map());
  const [burstAgentId, setBurstAgentId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktopViewport(mediaQuery.matches);
    apply();
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, []);

  // Settings modal state
  const [settingsName, setSettingsName] = useState("");
  const [, setAgentClusterUnavailable] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [openclawDraft, setOpenclawDraft] = useState<JsonObject | null>(null);
  const [openclawSaving, setOpenclawSaving] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);
  const [openclawSuccess, setOpenclawSuccess] = useState<string | null>(null);
  const [activeOpenclawSection, setActiveOpenclawSection] = useState<string | null>(null);
  const [openclawMapDraftKeys, setOpenclawMapDraftKeys] = useState<Record<string, string>>({});
  const [chatDragActive, setChatDragActive] = useState(false);
  const openclawPaneRef = useRef<HTMLDivElement | null>(null);
  const chatDragDepthRef = useRef(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch agents ──
  const selectedAgentIdRef = useRef(selectedAgentId);
  useEffect(() => { selectedAgentIdRef.current = selectedAgentId; }, [selectedAgentId]);

  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      setDeployments(agentClient);
      const [listedAgents, budgetData] = await Promise.all([
        agentClient.list(),
        agentClient.budget().catch(() => null),
      ]);
      setSdkAgents(listedAgents);
      setBudget((budgetData as AgentBudget | null) || null);
      setAgentClusterUnavailable(false);
      const currentId = selectedAgentIdRef.current;
      if (!currentId && listedAgents.length > 0) {
        setSelectedAgentId(listedAgents[0].id);
      }
      if (currentId && !listedAgents.find((item) => item.id === currentId)) {
        setSelectedAgentId(listedAgents[0]?.id || null);
      }
    } catch (err) {
      const described = describeAgentsPageError(err);
      setError(described.message);
      setAgentClusterUnavailable(described.clusterUnavailable);
      setSdkAgents([]);
      setBudget(null);
      setDeployments(null);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const agents = useMemo(() => sdkAgents.map(toDashboardAgent), [sdkAgents]);

  // Detect STARTING→RUNNING for burst
  useEffect(() => {
    const prev = prevStatesRef.current;
    for (const agent of agents) {
      const prevState = prev.get(agent.id);
      if (prevState && (prevState === "STARTING" || prevState === "PENDING") && agent.state === "RUNNING") {
        setBurstAgentId(agent.id);
      }
    }
    const next = new Map<string, AgentState>();
    for (const agent of agents) next.set(agent.id, agent.state);
    prevStatesRef.current = next;
  }, [agents]);

  const selectedSdkAgent = useMemo(
    () => (selectedAgentId ? sdkAgents.find((agent) => agent.id === selectedAgentId) ?? null : null),
    [sdkAgents, selectedAgentId],
  );
  const selectedAgent = useMemo(
    () => (selectedSdkAgent ? toDashboardAgent(selectedSdkAgent) : null),
    [selectedSdkAgent],
  );
  const selectedOpenClawAgent = useMemo(
    () => (selectedSdkAgent && typeof (selectedSdkAgent as { connect?: unknown }).connect === "function"
      ? (selectedSdkAgent as SdkOpenClawAgent)
      : null),
    [selectedSdkAgent],
  );
  const selectedAgentState = selectedAgent?.state ?? null;
  const isSelectedTransitioning = selectedAgent && ["PENDING", "STARTING"].includes(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";
  const selectedAgentTier = useMemo(
    () => (selectedAgent ? inferAgentTier(selectedAgent, budget) : null),
    [selectedAgent, budget],
  );
  useEffect(() => {
    if (!selectedAgentId || !selectedAgentState || !["PENDING", "STARTING", "STOPPING"].includes(selectedAgentState)) {
      return;
    }

    const timer = setInterval(() => {
      void fetchAgents();
    }, 2000);

    return () => clearInterval(timer);
  }, [fetchAgents, selectedAgentId, selectedAgentState]);

  const selectedAgentStartGuidance = useMemo(
    () =>
      selectedAgent && (selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED")
        ? describeAgentTierStartGuidance(selectedAgent, budget)
        : null,
    [selectedAgent, budget],
  );
  const stoppedTabLabel: Record<"chat" | "logs" | "shell", string> = {
    chat: "Chat",
    logs: "Logs",
    shell: "Shell",
  };
  const agentTabItems: Array<{ key: MainTab; label: string; icon: typeof MessageSquare }> = [
    { key: "chat", label: "Chat", icon: MessageSquare },
    { key: "logs", label: "Logs", icon: TerminalSquare },
    { key: "shell", label: "Shell", icon: TerminalSquare },
  ];
  const dashboardNavItems: Array<{ label: string; href: string; icon: typeof Bot }> = [
    { label: "Overview", href: "/dashboard", icon: Bot },
    { label: "Agents", href: "/agents", icon: Bot },
    { label: "API Keys", href: "/keys", icon: Key },
    { label: "Plans", href: "/plans", icon: CreditCard },
    { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
    { label: "Settings", href: "/dashboard/settings", icon: Settings },
  ];

  // Sync settings fields when selected agent changes
  useEffect(() => {
    if (selectedAgent) {
      setSettingsName(selectedAgent.name || "");
    }
  }, [selectedAgentId]);

  useEffect(() => {
    setMobileAgentMenuOpen(false);
  }, [mainTab, selectedAgentId, isDesktopViewport]);

  // ── Gateway Chat hook ──
  const handleShellData = useCallback((text: string) => {
    if (!text) return;
    shellBufferRef.current.push(text);
    shellTerminalRef.current?.write(text);
  }, []);

  const {
    logs,
    status: wsStatus,
    reconnect: reconnectLogs,
  } = useAgentLogs(deployments, selectedAgentId, mainTab === "logs" && selectedAgentState === "RUNNING");

  const {
    status: shellStatus,
    send: sendShell,
    resize: resizeShell,
    reconnect: reconnectShell,
  } = useAgentShell(deployments, {
    agentId: selectedAgentId,
    enabled: mainTab === "shell" && selectedAgentState === "RUNNING",
    onData: handleShellData,
  });

  const chat = useOpenClawSession(
    selectedAgent && isSelectedRunning ? selectedOpenClawAgent : null,
    mainTab === "chat" || mainTab === "workspace" || mainTab === "openclaw" || mainTab === "integrations",
  );
  const activeConnectionStatus = useMemo(() => {
    if (mainTab === "files") return "connected" as const;
    if (!isSelectedRunning) return null;
    if (mainTab === "logs") return wsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "openclaw" || mainTab === "integrations") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, mainTab, shellStatus, wsStatus]);

  const openclawSchemaBundle = chat.configSchema;
  const openclawSchemaRoot = useMemo(
    () => asObject(openclawSchemaBundle?.schema ?? null),
    [openclawSchemaBundle]
  );
  const openclawSchemaProperties = useMemo(
    () => asObject(openclawSchemaRoot?.properties ?? null),
    [openclawSchemaRoot]
  );

  const openclawSections = useMemo(
    () => sortOpenClawEntries(Object.entries(openclawSchemaProperties ?? {}), openclawSchemaBundle),
    [openclawSchemaBundle, openclawSchemaProperties]
  );

  useEffect(() => {
    const cfg = asObject(chat.config);
    setOpenclawDraft(deepCloneJsonObject(cfg ?? {}));
    setOpenclawError(null);
    setOpenclawSuccess(null);
  }, [selectedAgentId, chat.config]);

  useEffect(() => {
    if (!activeOpenclawSection && openclawSections.length > 0) {
      setActiveOpenclawSection(openclawSections[0][0]);
    }
    if (activeOpenclawSection && !openclawSections.find(([k]) => k === activeOpenclawSection)) {
      setActiveOpenclawSection(openclawSections[0]?.[0] ?? null);
    }
  }, [openclawSections, activeOpenclawSection]);

  useEffect(() => {
    if (mainTab !== "openclaw") return;
    openclawPaneRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeOpenclawSection, mainTab]);

  // ── AgentView right-sidebar data wiring ──

  // Probe channel status when gateway connects, and refresh after config save
  useEffect(() => {
    if (!chat.connected) {
      setChannelsData(null);
      return;
    }
    let cancelled = false;
    chat.channelsStatus(false).then((data) => {
      if (!cancelled) setChannelsData(data as Record<string, unknown>);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chat.connected, chat.channelsStatus]);

  // Derive AgentConfig from raw chat.config (model, system prompt, tools)
  const agentConfigForView = useMemo(() => {
    const cfg = asObject(chat.config);
    if (!cfg) return null;
    const llm = asObject(cfg.llm) ?? {};
    const toolsObj = asObject(cfg.tools) ?? {};
    const tools = Object.entries(toolsObj).map(([name, val]) => {
      const entry = asObject(val);
      return { name, enabled: entry?.enabled === true };
    });
    return {
      model: typeof llm.model === "string" ? llm.model : "unknown",
      systemPrompt: typeof llm.system === "string" ? llm.system : (typeof llm.systemPrompt === "string" ? llm.systemPrompt : ""),
      tools,
    };
  }, [chat.config]);

  // Module variants per design doc Section 2 — only enable what's in scope.
  // Out-of-scope modules (Section 11) stay "off" by default.
  // Overview: Agent Card, Active Sessions, Workspace Files, What Can I Do?, Example Prompts
  // Activity: filterable event log
  // Connections: flat list + CTA
  // Cron: scheduled jobs manager
  const agentViewVariants = useMemo(() => ({
    // Overview — in scope
    agentCardVariant: "v1" as const,
    workspaceFilesVariant: "v1" as const,
    whatCanIDoVariant: "v1" as const,
    examplePromptsVariant: "v1" as const,
    // Activity tab
    activityVariant: "v1" as const,
    // Connections tab
    connectionRowStyle: "v1" as const,
  }), []);

  // One thread per agent, used by both the left ConversationsSidebar and the
  // right AgentView (which needs `hasAgent` true to render content).
  const syntheticThreads = useMemo<ConversationThread[]>(() => {
    return agents.map((agent) => ({
      id: agent.id,
      sessionKey: "main",
      participants: [
        { id: "user", name: "You", type: "user" as const },
        { id: agent.id, name: agent.name || agent.id, type: "agent" as const },
      ],
      kind: "user-agent" as const,
      title: agent.name || agent.pod_name || agent.id,
      lastMessage: agent.state === "RUNNING" ? "Connected" : agent.state.toLowerCase(),
      lastMessageBy: agent.id,
      lastMessageAt: agent.updated_at ? new Date(agent.updated_at).getTime() : Date.now(),
      messageCount: agent.id === selectedAgentId ? chat.messages.length : 0,
      unreadCount: 0,
      isActive: agent.state === "RUNNING",
    }));
  }, [agents, selectedAgentId, chat.messages.length]);

  // Derive RecentToolCall[] by flattening toolCalls across assistant messages.
  // Newest last (matches the Activity tab order).
  const recentToolCallsForView = useMemo(() => {
    if (!chat.messages || chat.messages.length === 0) return null;
    const out: Array<{ id: string; name: string; args: string; result?: string; timestamp: number }> = [];
    chat.messages.forEach((msg) => {
      if (msg.role !== "assistant" || !msg.toolCalls) return;
      const ts = msg.timestamp ?? Date.now();
      msg.toolCalls.forEach((tc, idx) => {
        out.push({
          id: tc.id ?? `${ts}-${idx}`,
          name: tc.name,
          args: tc.args,
          result: tc.result,
          timestamp: ts,
        });
      });
    });
    return out.length > 0 ? out.slice(-20) : null;
  }, [chat.messages]);

  // Derive ActivityEntry[] from chat.activityFeed (icons added per type)
  const activityEntriesForView = useMemo(() => {
    if (!chat.activityFeed || chat.activityFeed.length === 0) return null;
    return chat.activityFeed.map((entry) => {
      let icon = MessageSquare;
      if (entry.type === "tool") icon = SlidersHorizontal;
      else if (entry.type === "error") icon = X;
      else if (entry.type === "system") icon = Settings;
      else if (entry.type === "connection") icon = Link2;
      else if (entry.type === "skill") icon = Zap;
      else if (entry.type === "cron") icon = Timer;
      return { ...entry, icon };
    });
  }, [chat.activityFeed]);

  // Derive workspace files from chat.files (gateway only returns files, not directories)
  const agentWorkspaceFilesForView = useMemo(() => {
    if (!chat.files || chat.files.length === 0) return null;
    return chat.files.map((f) => ({
      name: f.name,
      type: "file" as const,
      size: f.size,
    }));
  }, [chat.files]);

  // Derive CronJob[] from chat.cronJobs
  const agentCronJobsForView = useMemo(() => {
    if (!chat.cronJobs || chat.cronJobs.length === 0) return null;
    return chat.cronJobs.map((j) => {
      const entry = j as Record<string, unknown>;
      return {
        id: typeof entry.id === "string" ? entry.id : String(entry.id ?? ""),
        schedule: typeof entry.schedule === "string" ? entry.schedule : "",
        prompt: typeof entry.prompt === "string" ? entry.prompt : "",
        description: typeof entry.description === "string" ? entry.description : "",
        enabled: entry.enabled !== false,
        lastRun: typeof entry.lastRun === "number" ? entry.lastRun : undefined,
        nextRun: typeof entry.nextRun === "number" ? entry.nextRun : undefined,
      };
    });
  }, [chat.cronJobs]);

  // Derive AgentSession[] from chat.sessions
  const agentSessionsForView = useMemo(() => {
    if (!chat.sessions || chat.sessions.length === 0) return null;
    return chat.sessions.map((s) => {
      const entry = s as Record<string, unknown>;
      const key = typeof entry.key === "string" ? entry.key : String(entry.id ?? "");
      const clientMode = typeof entry.clientMode === "string" ? entry.clientMode : (typeof entry.client === "string" ? entry.client : "unknown");
      const clientDisplayName = typeof entry.clientDisplayName === "string" ? entry.clientDisplayName : (typeof entry.displayName === "string" ? entry.displayName : key);
      const createdAt = typeof entry.createdAt === "number" ? entry.createdAt : Date.now();
      const lastMessageAt = typeof entry.lastMessageAt === "number" ? entry.lastMessageAt : createdAt;
      return { key, clientMode, clientDisplayName, createdAt, lastMessageAt };
    });
  }, [chat.sessions]);

  // Derive Connection[] from channelsStatus response
  const agentConnectionsForView = useMemo(() => {
    const channels = asObject(channelsData?.channels);
    if (!channels) return null;
    return Object.entries(channels).map(([key, val]) => {
      const entry = asObject(val) ?? {};
      const configured = entry.configured === true;
      const running = entry.running === true;
      return {
        id: key,
        name: humanizeKey(key),
        icon: Plug,
        category: "Communication",
        connected: configured && running,
        description: configured ? (running ? "Active" : "Configured · idle") : "Not configured",
      };
    });
  }, [channelsData]);

  const effectiveOpenclawSection = useMemo(
    () => (isDesktopViewport ? (activeOpenclawSection ?? openclawSections[0]?.[0] ?? null) : activeOpenclawSection),
    [activeOpenclawSection, isDesktopViewport, openclawSections]
  );

  const visibleOpenclawSections = useMemo(() => {
    if (!effectiveOpenclawSection) return openclawSections;
    const selected = openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection);
    return selected ? [selected] : openclawSections;
  }, [effectiveOpenclawSection, openclawSections]);

  const activeOpenclawSectionEntry = useMemo(
    () => openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection) ?? null,
    [effectiveOpenclawSection, openclawSections]
  );

  const activeOpenclawSectionLabel = useMemo(() => {
    if (!activeOpenclawSectionEntry) return null;
    const [sectionKey, sectionSchema] = activeOpenclawSectionEntry;
    return (
      getOpenClawUiHint(openclawSchemaBundle, [sectionKey])?.label?.trim()
      || (typeof asObject(sectionSchema)?.title === "string"
        ? String(asObject(sectionSchema)?.title)
        : humanizeKey(sectionKey))
    );
  }, [activeOpenclawSectionEntry, openclawSchemaBundle]);

  const updateOpenclawPath = useCallback((path: string[], value: unknown) => {
    setOpenclawDraft((prev) => {
      const base = prev ? deepCloneJsonObject(prev) : {};
      return setPathValue(base, path, value);
    });
  }, []);

  const removeOpenclawPath = useCallback((path: string[]) => {
    setOpenclawDraft((prev) => {
      if (!prev || path.length === 0) return prev;
      const base = deepCloneJsonObject(prev);
      const parentPath = path.slice(0, -1);
      const leafKey = path[path.length - 1];
      const parent = parentPath.length === 0 ? base : getPathValue(base, parentPath);
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
        return base;
      }
      delete (parent as JsonObject)[leafKey];
      return base;
    });
  }, []);

  const addOpenclawMapEntry = useCallback((path: string[], schemaRaw: unknown) => {
    const pathKey = path.join(".");
    const nextKey = (openclawMapDraftKeys[pathKey] ?? "").trim();
    if (!nextKey) return;
    updateOpenclawPath([...path, nextKey], createOpenClawConfigValue(schemaRaw));
    setOpenclawMapDraftKeys((prev) => ({ ...prev, [pathKey]: "" }));
  }, [openclawMapDraftKeys, updateOpenclawPath]);

  const saveOpenclawPatch = useCallback(async (patch: JsonObject, successText: string) => {
    setOpenclawSaving(true);
    setOpenclawError(null);
    setOpenclawSuccess(null);
    try {
      await chat.saveConfig(patch);
      setOpenclawSuccess(successText);
    } catch (err) {
      setOpenclawError(err instanceof Error ? err.message : "Failed to save OpenClaw config");
    } finally {
      setOpenclawSaving(false);
    }
  }, [chat]);

  const saveOpenclawSection = useCallback(async (sectionKey: string) => {
    if (!openclawDraft) return;
    await saveOpenclawPatch({ [sectionKey]: openclawDraft[sectionKey] }, `Saved section: ${sectionKey}`);
  }, [openclawDraft, saveOpenclawPatch]);

  const saveAllOpenclaw = useCallback(async () => {
    if (!openclawDraft) return;
    await saveOpenclawPatch(openclawDraft, "Saved all OpenClaw settings");
  }, [openclawDraft, saveOpenclawPatch]);

  const renderOpenclawField = useCallback((schemaRaw: unknown, path: string[], depth = 0): React.ReactNode => {
    try {
    const schema = normalizeOpenClawConfigSchemaNode(schemaRaw);
    const descriptor = describeOpenClawConfigNode(schemaRaw);
    const hint = getOpenClawUiHint(openclawSchemaBundle, path);
    const title =
      hint?.label?.trim() ||
      (typeof schema.title === "string" ? schema.title : "") ||
      humanizeKey(path[path.length - 1] || "setting");
    const description =
      hint?.help?.trim() ||
      (typeof schema.description === "string" ? schema.description : "");
    const placeholder =
      hint?.placeholder && hint.placeholder.trim() ? hint.placeholder : undefined;
    const typeRaw = schema.type;
    const type = Array.isArray(typeRaw)
      ? (typeRaw.find((entry) => entry !== "null") as string | undefined)
      : (typeof typeRaw === "string" ? typeRaw : undefined);
    const enumValues: unknown[] = Array.isArray(schema.enum) ? schema.enum : [];
    const currentValue = openclawDraft ? getPathValue(openclawDraft, path) : undefined;
    const key = path.join(".");

    const propertyKeys = descriptor.properties;
    const additionalSchema = descriptor.additionalPropertySchema;
    if (type === "object" || Object.keys(propertyKeys).length > 0 || descriptor.additionalProperties) {
      const entries = Object.keys(propertyKeys).length > 0
        ? sortOpenClawEntries(Object.entries(propertyKeys), openclawSchemaBundle, path)
        : [];
      const dynamicEntries = descriptor.additionalProperties && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
        ? Object.entries(currentValue as JsonObject).filter(([childKey]) => !(childKey in propertyKeys))
        : [];
      if (entries.length === 0 && dynamicEntries.length === 0 && !descriptor.additionalProperties) {
        // Fallback: render JSON editor for object schemas with no resolved properties (e.g. unresolved $ref)
        if (typeof console !== "undefined") {
          console.warn(`[OpenClaw] Section "${key}" has type "object" but no resolved properties. Schema may contain unresolved $ref.`, schema);
        }
        const onFallbackChange = (raw: string) => {
          try {
            updateOpenclawPath(path, JSON.parse(raw));
            setOpenclawError(null);
          } catch {
            setOpenclawError(`Invalid JSON at ${path.join(".")}`);
          }
        };
        return (
          <div key={key} className="space-y-1">
            <label className="block text-sm text-text-secondary">{title}</label>
            {description && <p className="text-xs text-text-muted">{description}</p>}
            <textarea
              value={typeof currentValue === "undefined" || currentValue === null ? "{}" : JSON.stringify(currentValue, null, 2)}
              onChange={(e) => onFallbackChange(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={placeholder}
              className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong"
            />
          </div>
        );
      }
      return (
        <div key={key} className={depth > 0 ? "rounded-lg border border-border p-3 space-y-3" : "space-y-3"}>
          {depth > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {hint?.advanced && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    advanced
                  </span>
                )}
              </div>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          )}
          {entries.map(([childKey, childSchema]) => renderOpenclawField(childSchema, [...path, childKey], depth + 1))}
          {descriptor.additionalProperties && (
            <div className="space-y-3">
              {dynamicEntries.map(([childKey]) => (
                <div key={`${key}-dynamic-${childKey}`} className="rounded-lg border border-border/70 bg-surface-low/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{childKey}</p>
                    <button
                      type="button"
                      onClick={() => removeOpenclawPath([...path, childKey])}
                      className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-[#d05f5f]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                  {renderOpenclawField(additionalSchema ? { ...additionalSchema, title: childKey } : { title: childKey, type: "object" }, [...path, childKey], depth + 1)}
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-3 md:flex-row md:items-center">
                <input
                  type="text"
                  value={openclawMapDraftKeys[key] ?? ""}
                  onChange={(e) => setOpenclawMapDraftKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`Add ${title.toLowerCase()} key`}
                  className="flex-1 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border-strong"
                />
                <button
                  type="button"
                  onClick={() => addOpenclawMapEntry(path, additionalSchema ?? { type: "object" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low"
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    const onJsonValueChange = (raw: string) => {
      try {
        updateOpenclawPath(path, JSON.parse(raw));
        setOpenclawError(null);
      } catch {
        setOpenclawError(`Invalid JSON at ${path.join(".")}`);
      }
    };

    return (
      <div key={key} className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label className="block text-sm text-text-secondary">{title}</label>
          {hint?.sensitive && (
            <span className="rounded-full border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#d05f5f]">
              sensitive
            </span>
          )}
          {hint?.advanced && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
              advanced
            </span>
          )}
        </div>
        {description && <p className="text-xs text-text-muted">{description}</p>}
        {enumValues.length > 0 ? (
          <select
            value={currentValue == null ? "" : JSON.stringify(currentValue)}
            onChange={(e) => {
              if (!e.target.value) {
                updateOpenclawPath(path, null);
                return;
              }
              const nextValue = enumValues.find((value) => JSON.stringify(value) === e.target.value);
              updateOpenclawPath(path, nextValue ?? e.target.value);
            }}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          >
            <option value="">(unset)</option>
            {enumValues.map((value) => (
              <option key={`${key}-enum-${JSON.stringify(value)}`} value={JSON.stringify(value)}>
                {String(value)}
              </option>
            ))}
          </select>
        ) : type === "boolean" ? (
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={Boolean(currentValue)}
              onChange={(e) => updateOpenclawPath(path, e.target.checked)}
              className="rounded border-border bg-surface-low"
            />
            Enabled
          </label>
        ) : type === "number" || type === "integer" ? (
          <input
            type="number"
            value={typeof currentValue === "number" ? String(currentValue) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                updateOpenclawPath(path, null);
                return;
              }
              const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
              if (!Number.isNaN(parsed)) updateOpenclawPath(path, parsed);
            }}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        ) : type === "array" || type === "object" ? (
          <textarea
            value={typeof currentValue === "undefined" ? "" : JSON.stringify(currentValue, null, 2)}
            onChange={(e) => onJsonValueChange(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong"
          />
        ) : (
          <input
            type={hint?.sensitive ? "password" : "text"}
            value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
            onChange={(e) => updateOpenclawPath(path, e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        )}
      </div>
    );
    } catch (err) {
      const key = path.join(".");
      console.error(`[OpenClaw] Failed to render field "${key}":`, err);
      return (
        <div key={key} className="text-xs text-[#d05f5f] p-2 rounded border border-[#d05f5f]/30">
          Failed to render {key}: {err instanceof Error ? err.message : String(err)}
        </div>
      );
    }
  }, [addOpenclawMapEntry, openclawDraft, openclawMapDraftKeys, openclawSchemaBundle, removeOpenclawPath, updateOpenclawPath]);

  // Auto-scroll chat — only when user is near bottom (not scrolled up reading)
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 100px of the end
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    const count = chat.messages.length;
    if (count !== lastMsgCountRef.current) {
      lastMsgCountRef.current = count;
      // Always scroll on new message (user sent or agent started replying)
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    } else if (isNearBottomRef.current) {
      // Streaming update — only scroll if already near bottom
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    }
  }, [chat.messages]);

  // When a reply finishes streaming, snap to the last line regardless of
  // scroll position so the end of the message is always visible.
  const prevSendingRef = useRef(chat.sending);
  useEffect(() => {
    if (prevSendingRef.current && !chat.sending) {
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
    prevSendingRef.current = chat.sending;
  }, [chat.sending]);

  // Scroll to bottom when user switches back to chat tab.
  // useLayoutEffect runs synchronously after DOM commit (refs are set)
  // but before browser paint, so the user never sees the un-scrolled state.
  useLayoutEffect(() => {
    if (mainTab === "chat" && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [mainTab]);

  // ── Desktop launch bootstrap ──
  const issueAgentAccessToken = useCallback(
    async (agentId: string, hostname: string): Promise<string> => {
      const authToken = await getToken();
      const tokenData = await createAgentClient(authToken).refreshToken(agentId) as AgentDesktopTokenResponse;
      return `https://desktop-${hostname}/_jwt_auth?jwt=${encodeURIComponent(tokenData.token)}`;
    },
    [getToken]
  );

  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);

  useEffect(() => {
    if (mainTab !== "shell") return;
    if (!shellBoxRef.current) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 3000,
      theme: {
        background: "#0c1016",
        foreground: "#d8dde7",
        cursor: "#d8dde7",
        selectionBackground: "#2a3445",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(shellBoxRef.current);

    requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });

    if (shellSessionAgentRef.current !== selectedAgentId) {
      shellBufferRef.current = [];
      shellSessionAgentRef.current = selectedAgentId;
    }

    for (const chunk of shellBufferRef.current) {
      term.write(chunk);
    }

    const disposable = term.onData((data) => {
      sendShell(data);
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      resizeShell(rows, cols);
    });

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    shellTerminalRef.current = term;
    shellFitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener("resize", onResize);
      resizeDisposable.dispose();
      disposable.dispose();
      term.dispose();
      shellTerminalRef.current = null;
      shellFitAddonRef.current = null;
    };
  }, [mainTab, resizeShell, selectedAgentId, sendShell]);

  // ── Actions ──

  const handleStart = async (agentId: string) => {
    const sdkAgent = sdkAgents.find((entry) => entry.id === agentId) ?? null;
    const agent = sdkAgent ? toDashboardAgent(sdkAgent) : null;
    const guidance = describeAgentTierStartGuidance(agent, budget);
    if (guidance) {
      if (guidance.availableTiers.length > 0) {
        setTierSelection({ agentId, guidance });
      } else {
        setError(guidance.message);
      }
      return;
    }
    setStartingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      const startedAgent = await startOpenClawAgent(token, agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, startedAgent));
    } catch (err) {
      const requestedTier = parseEntitlementSlotTier(err);
      if (requestedTier) {
        const fallbackPreset = getAgentSizePresets(budget)[requestedTier];
        const tierGuidance = describeAgentTierStartGuidance(
          agent && inferAgentTier(agent, budget) === requestedTier
            ? agent
            : fallbackPreset
              ? {
                  cpu_millicores: fallbackPreset.cpu_millicores,
                  memory_mib: fallbackPreset.memory_mib,
                }
              : null,
          budget,
        );
        setError(tierGuidance?.message ?? (err instanceof Error ? err.message : "Failed to start agent"));
      } else {
        setError(err instanceof Error ? err.message : "Failed to start agent");
      }
    } finally {
      setStartingId(null);
    }
  };

  const openCreateDialog = useCallback((options?: { initialStep?: number; preferredTier?: string | null }) => {
    setCreateDialogInitialStep(options?.initialStep ?? 0);
    setCreateDialogPreferredTier(options?.preferredTier ?? null);
    setShowCreateDialog(true);
  }, []);

  const closeCreateDialog = useCallback(() => {
    setShowCreateDialog(false);
    setCreateDialogInitialStep(0);
    setCreateDialogPreferredTier(null);
  }, []);
  const handleResizeAndStart = useCallback(async (agentId: string, tier: string) => {
    setStartingId(agentId);
    setError(null);
    setTierSelection(null);
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const resizedAgent = await agentClient.resize(agentId, { size: tier });
      setSdkAgents((prev) => upsertSdkAgent(prev, resizedAgent));
      const startedAgent = await startOpenClawAgent(token, agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, startedAgent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resize and start agent");
    } finally {
      setStartingId(null);
    }
  }, [getToken]);

  const selectedAgentHasTierOptions = Boolean(selectedAgentStartGuidance?.availableTiers?.length);
  const selectedAgentLaunchBlocked = Boolean(selectedAgentStartGuidance && !selectedAgentHasTierOptions);

  const selectedAgentSuggestedTierActions = useMemo(
    () =>
      (selectedAgentStartGuidance?.availableTiers ?? []).map((entry) => ({
        label: `Resize To ${titleizeTier(entry.tier)} And Start (${entry.available} free)`,
        onSelect: () => {
          if (selectedAgent) {
            void handleResizeAndStart(selectedAgent.id, entry.tier);
          }
        },
      })),
    [handleResizeAndStart, selectedAgent, selectedAgentStartGuidance],
  );

  const handleStop = async (agentId: string) => {
    setStoppingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      const stoppedAgent = await createAgentClient(token).stop(agentId);
      setSdkAgents((prev) => upsertSdkAgent(prev, stoppedAgent));
      // Cooldown: disable Start for 5s while backend cleans up
      setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
      const existing = stoppedTimersRef.current.get(agentId);
      if (existing) clearTimeout(existing);
      stoppedTimersRef.current.set(agentId, setTimeout(() => {
        setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
        stoppedTimersRef.current.delete(agentId);
      }, 10000));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setStoppingId(null);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await createAgentClient(token).delete(agentId);
      if (selectedAgentId === agentId) setSelectedAgentId(null);
      setSdkAgents((prev) => removeSdkAgent(prev, agentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeletingId(null);
      setPendingAgentDelete(null);
    }
  };

  const handleSaveName = async () => {
    if (!selectedAgent || selectedAgent.state !== "STOPPED") return;
    const trimmed = settingsName.trim();
    if (!trimmed || trimmed === (selectedAgent.name || "")) return;
    setSavingName(true);
    try {
      const token = await getToken();
      const updatedAgent = await createAgentClient(token).update(selectedAgent.id, { name: trimmed });
      setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename agent");
    } finally {
      setSavingName(false);
    }
  };

  const handleOpenDesktop = async (agent: Agent) => {
    if (!agent.hostname) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningDesktopId(agent.id);
    setError(null);
    try {
      const desktopUrl = new URL(await issueAgentAccessToken(agent.id, agent.hostname));
      if (popup) { popup.location.href = desktopUrl.toString(); } else {
        const fallback = window.open(desktopUrl.toString(), "_blank");
        if (fallback) fallback.opener = null;
      }
    } catch (err) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : "Failed to open desktop");
    } finally {
      setOpeningDesktopId(null);
    }
  };

  // Audio recording
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [audioPreviewPlaying, setAudioPreviewPlaying] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelAnimRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analyser for volume visualization
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Volume level animation loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(avg / 128, 1)); // normalize to 0-1
        levelAnimRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      setRecordingDuration(0);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(levelAnimRef.current);
        audioCtx.close();
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      // Mic permission denied
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const discardAudio = useCallback(() => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioPreviewDuration(0);
    setAudioPreviewPlaying(false);
    setRecordingDuration(0);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl) return;
    const previewAudio = new Audio(audioUrl);
    previewAudio.preload = "metadata";
    const syncDuration = () => {
      if (Number.isFinite(previewAudio.duration) && previewAudio.duration > 0) {
        setAudioPreviewDuration(Math.round(previewAudio.duration));
      }
    };
    const onPlay = () => setAudioPreviewPlaying(true);
    const onPause = () => setAudioPreviewPlaying(false);
    previewAudio.addEventListener("loadedmetadata", syncDuration);
    previewAudio.addEventListener("durationchange", syncDuration);
    previewAudio.addEventListener("play", onPlay);
    previewAudio.addEventListener("pause", onPause);
    previewAudio.addEventListener("ended", onPause);
    audioPreviewRef.current = previewAudio;
    return () => {
      previewAudio.pause();
      previewAudio.removeEventListener("loadedmetadata", syncDuration);
      previewAudio.removeEventListener("durationchange", syncDuration);
      previewAudio.removeEventListener("play", onPlay);
      previewAudio.removeEventListener("pause", onPause);
      previewAudio.removeEventListener("ended", onPause);
      previewAudio.src = "";
      audioPreviewRef.current = null;
      setAudioPreviewPlaying(false);
    };
  }, [audioUrl]);

  const toggleAudioPreviewPlayback = useCallback(() => {
    const previewAudio = audioPreviewRef.current;
    if (!previewAudio) return;
    if (previewAudio.paused) {
      void previewAudio.play();
      return;
    }
    previewAudio.pause();
  }, []);

  const sendAudio = useCallback(async () => {
    if (!audioBlob || !selectedAgent || sendingAudio || !chat.connected) return;
    setSendingAudio(true);
    try {
      const token = await getToken();
      const timestamp = Date.now();
      const filename = `voice-${timestamp}.webm`;
      const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${filename}`;
      const agentPath = `${OPENCLAW_WORKSPACE_DIR}/${filename}`;
      const voiceMessage = `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${agentPath}\``;
      await createAgentClient(token).fileWriteBytes(selectedAgent.id, uploadPath, await audioBlob.arrayBuffer());
      // Keep input state in sync and send in one action.
      chat.setInput(voiceMessage);
      await chat.sendMessage(voiceMessage);
      discardAudio();
    } catch (e) {
      console.error("Audio upload failed:", e);
      setError(e instanceof Error ? e.message : "Audio upload failed");
    } finally {
      setSendingAudio(false);
    }
  }, [audioBlob, chat, discardAudio, selectedAgent, getToken, sendingAudio]);

  const handleChatFileDrop = useCallback(async (fileList: FileList | File[]) => {
    if (!selectedAgent || !chat.connected) return;

    const files = Array.from(fileList);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const uploaded: Array<{ name: string; path: string; type: string }> = [];

      for (const file of files) {
        const uploadPath = `${OPENCLAW_WORKSPACE_PREFIX}/${file.name}`;
        await agentClient.fileWriteBytes(selectedAgent.id, uploadPath, await file.arrayBuffer());
        uploaded.push({
          name: file.name,
          path: `${OPENCLAW_SYNC_ROOT}/${uploadPath}`,
          type: file.type,
        });
      }

      if (imageFiles.length > 0) {
        const dt = new DataTransfer();
        imageFiles.forEach((file) => dt.items.add(file));
        chat.addAttachments(dt.files);
      }
      chat.addPendingFiles(uploaded);
    } catch (e) {
      console.error("Chat file upload failed:", e);
      setError(e instanceof Error ? e.message : "File upload failed");
    }
  }, [chat, getToken, selectedAgent]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleSendChat = () => {
    if (chat.sending) {
      chat.setInput("");
      chat.addPendingMessage(chat.input);
      return;
    }
    chat.sendMessage();
  };

  useEffect(() => {
    if (!selectedAgent) {
      setAgentMenu(null);
      return;
    }
    setAgentMenu({
      selectedAgentId: selectedAgent.id,
      activeTab: mainTab,
      onSelectTab: (tab) => {
        setMainTab(tab);
        setMobileShowChat(true);
      },
      onDelete: () => {
        setPendingAgentDelete({
          id: selectedAgent.id,
          name: selectedAgent.name || selectedAgent.id,
        });
      },
      deleting: deletingId === selectedAgent.id,
    });
    return () => setAgentMenu(null);
  }, [selectedAgent, mainTab, deletingId, setAgentMenu]);

  // ── Render ──

  return (
    <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header + menu (hidden on desktop) */}
      {!isDesktopViewport && (
        <div className="relative flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2 text-xl font-bold">
            <span aria-label="HyperClaw brand">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">Claw</span>
            </span>
            <span className="text-text-muted font-medium">Agents</span>
          </div>
          <button
            onClick={() => setMobileAgentMenuOpen((open) => !open)}
            className="p-2 rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            aria-label={mobileAgentMenuOpen ? "Close agent menu" : "Open agent menu"}
          >
            {mobileAgentMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          {mobileAgentMenuOpen && (
            <div className="absolute right-4 top-[calc(100%-0.25rem)] z-30 w-64 rounded-xl border border-border bg-background shadow-2xl">
              <div className="p-2 space-y-1">
                <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                  Dashboard
                </p>
                {dashboardNavItems.map(({ label, href, icon: Icon }) => (
                  <button
                    key={`mobile-nav-${href}`}
                    onClick={() => {
                      router.push(href);
                      setMobileAgentMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
                <button
                  onClick={() => {
                    openCreateDialog();
                    setMobileAgentMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Agent</span>
                </button>
              </div>
              {selectedAgent && (
                <>
                  <div className="border-t border-border p-2 space-y-1">
                    <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                      Agent
                    </p>
                    {agentTabItems.map(({ key, label, icon: Icon }) => (
                      <button
                        key={`mobile-tab-${key}`}
                        onClick={() => {
                          setMainTab(key);
                          setMobileAgentMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          mainTab === key
                            ? "bg-surface-low text-foreground"
                            : "text-text-muted hover:text-foreground hover:bg-surface-low/70"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-border p-2 space-y-1">
                    {(mainTab === "logs" || mainTab === "shell") && (
                      <button
                        onClick={() => {
                          if (mainTab === "logs") reconnectLogs();
                          if (mainTab === "shell") reconnectShell();
                          setMobileAgentMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Reconnect</span>
                      </button>
                    )}
                    {isSelectedRunning && selectedAgent.hostname && (
                      <button
                        onClick={() => {
                          void handleOpenDesktop(selectedAgent);
                          setMobileAgentMenuOpen(false);
                        }}
                        disabled={openingDesktopId === selectedAgent.id}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70 disabled:opacity-60"
                      >
                        {openingDesktopId === selectedAgent.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        <span>Desktop</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setPendingAgentDelete({ id: selectedAgent.id, name: selectedAgent.name || selectedAgent.id });
                        setMobileAgentMenuOpen(false);
                      }}
                      disabled={deletingId === selectedAgent.id}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-[#d05f5f] hover:bg-surface-low/70 disabled:opacity-60"
                    >
                      {deletingId === selectedAgent.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      <span>Delete Agent</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <AgentCreationWizard
        open={showCreateDialog}
        onClose={closeCreateDialog}
        initialStep={createDialogInitialStep}
        preferredTypeId={createDialogPreferredTier}
        onCreated={() => {
          closeCreateDialog();
          fetchAgents();
        }}
        budget={budget}
      />
      <ChannelCreationWizard
        open={showChannelWizard}
        onClose={() => setShowChannelWizard(false)}
        availableAgents={agents.map((a) => ({ id: a.id, name: a.name || a.id, type: "agent" as const }))}
        availableUsers={MOCK_PARTICIPANTS.filter((p) => p.type === "user")}
        onCreate={async (channel) => {
          // TODO: backend endpoint for channel creation. For now, log and close.
          console.log("Create channel:", channel);
        }}
      />
      <DirectoryModal
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        initialCategory={directoryCategory}
        config={chat.config as Record<string, unknown> | null}
        channelsStatus={channelsData}
        connected={chat.connected}
        onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
        onChannelProbe={async () => chat.channelsStatus(true)}
        onOpenShell={() => { setMainTab("shell"); setDirectoryOpen(false); }}
      />
      <ConfirmDialog
        open={Boolean(pendingAgentDelete)}
        title="Delete Agent"
        message={
          pendingAgentDelete
            ? `Delete agent "${pendingAgentDelete.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={Boolean(pendingAgentDelete && deletingId === pendingAgentDelete.id)}
        onCancel={() => setPendingAgentDelete(null)}
        onConfirm={() => {
          if (pendingAgentDelete) void handleDelete(pendingAgentDelete.id);
        }}
      />
      <AgentTierSelectionModal
        tierSelection={tierSelection}
        setTierSelection={setTierSelection}
        handleResizeAndStart={handleResizeAndStart}
        titleizeTier={titleizeTier}
      />


      {/* Main layout: Sidebar + Panel */}
      <div className="flex flex-1 min-h-0">
        {/* ── Agents / Channels Sidebar (left) ── */}
        <AgentSidebarPane
          sidebarCollapsed={sidebarCollapsed}
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileShowChat}
          agents={agents}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          setMobileShowChat={setMobileShowChat}
          setSidebarCollapsed={setSidebarCollapsed}
          syntheticThreads={syntheticThreads}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          fetchAgents={fetchAgents}
          setError={setError}
          openCreateDialog={() => openCreateDialog()}
          sidebarCreatorSignal={sidebarCreatorSignal}
          setPendingAgentDelete={setPendingAgentDelete}
          updateAgentName={async (agentId, name) => {
            const token = await getToken();
            const updatedAgent = await createAgentClient(token).update(agentId, { name });
            setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
          }}
        />

        {/* ── Main Panel ── */}
        <div className={`flex-1 flex-col min-w-0 ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
          {!selectedAgent ? (
            <AgentEmptyState
              onCreate={() => {
                setSidebarCollapsed(false);
                setMobileShowChat(false);
                setSidebarCreatorSignal((v) => v + 1);
              }}
            />
          ) : (
            <>
              {/* Agent header + tabs */}
              <div className="relative px-4 h-14 border-b border-border flex items-center gap-3 min-w-0">
                {/* Mobile back button */}
                <button
                  onClick={() => setMobileShowChat(false)}
                  className={`${isDesktopViewport ? "hidden" : "block"} text-text-muted hover:text-foreground`}
                  aria-label="Show agents list"
                >
                  <PanelLeft className="w-5 h-5" />
                </button>

                {/* Agent name + status */}
                <div className="relative z-10 flex items-center gap-2 min-w-0 flex-shrink-0">
                  {(() => {
                    const avatar = agentAvatar(selectedAgent.name || selectedAgent.id, selectedAgent.meta);
                    const AvatarIcon = avatar.icon;
                    return (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                        {avatar.imageUrl ? (
                          <img src={avatar.imageUrl} alt={`${selectedAgent.name} avatar`} className="w-full h-full object-cover" />
                        ) : (
                          <AvatarIcon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                        )}
                      </div>
                    );
                  })()}
                  {activeConnectionStatus && <ConnectionStatusIndicator status={activeConnectionStatus} />}
                </div>

                {/* Center — agent/conversation name + status (status hidden when connected) */}
                <div className="flex-1 min-w-0 text-center">
                  <p className="text-sm font-medium text-foreground truncate">
                    {selectedAgent.name || selectedAgent.pod_name || "Agent"}
                  </p>
                  {!chat.connected && (
                    <p className="text-xs text-text-muted">
                      {chat.connecting ? "Connecting to gateway..." : selectedAgent.state === "RUNNING" ? "Disconnected" : selectedAgent.state}
                    </p>
                  )}
                </div>

                {/* Files button — routes to the workspace files page */}
                {(() => {
                  const fileCount = chat.files?.length ?? 0;
                  return (
                    <button
                      onClick={() => router.push(`/dashboard/agents/${selectedAgent.id}/files`)}
                      className="relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-text-muted hover:text-foreground hover:border-text-muted/30 hover:bg-surface-low transition-all flex-shrink-0"
                      title="Open workspace files"
                    >
                      <FolderOpen className="w-4 h-4" />
                      <span className="hidden sm:inline">Files</span>
                      {fileCount > 0 && (
                        <span className="text-[9px] tabular-nums px-1.5 py-0.5 rounded-full bg-surface-low text-text-muted">
                          {fileCount}
                        </span>
                      )}
                    </button>
                  );
                })()}

                {/* Right actions */}
                <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
                  <div className={`${isDesktopViewport ? "hidden" : "flex"} items-center gap-1`}>
                    {selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED" ? (
                      <button
                        onClick={() => handleStart(selectedAgent.id)}
                        disabled={
                          startingId === selectedAgent.id ||
                          recentlyStoppedIds.has(selectedAgent.id) ||
                          selectedAgentLaunchBlocked
                        }
                        className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                        aria-label="Start agent"
                        title={
                          selectedAgentLaunchBlocked
                            ? selectedAgentStartGuidance?.title
                            : selectedAgentStartGuidance?.title ||
                          (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")
                        }
                      >
                        {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        <span className="hidden xl:inline">Start</span>
                      </button>
                    ) : null}
                  </div>

                  <div className={`${isDesktopViewport ? "flex" : "hidden"} items-center gap-2`}>
                    <div className="flex items-center gap-1">
                      {selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED" ? (
                        <button
                          onClick={() => handleStart(selectedAgent.id)}
                          disabled={
                            startingId === selectedAgent.id ||
                            recentlyStoppedIds.has(selectedAgent.id) ||
                            selectedAgentLaunchBlocked
                          }
                          className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                          aria-label="Start agent"
                          title={
                            selectedAgentLaunchBlocked
                              ? selectedAgentStartGuidance?.title
                              : selectedAgentStartGuidance?.title ||
                            (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")
                          }
                        >
                          {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          <span className="hidden xl:inline">Start</span>
                        </button>
                      ) : null}

                      {(mainTab === "logs" || mainTab === "shell") && (
                        <button
                          onClick={() => { if (mainTab === "logs") reconnectLogs(); if (mainTab === "shell") reconnectShell(); }}
                          className="p-1 text-text-muted hover:text-foreground transition-colors"
                          title="Reconnect"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}

                    </div>
                  </div>

                  {/* Mobile — open AgentView bottom sheet */}
                  {!isDesktopViewport && (
                    <button
                      onClick={() => setAgentViewSheetOpen(true)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
                      title="Agent details"
                    >
                      <Gauge className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Gear dropdown */}
                  <GearDropdown
                    currentPanel={(mainTab === "logs" || mainTab === "shell" ? mainTab : "chat") as CenterPanel}
                    onSelectPanel={(panel) => setMainTab(panel)}
                    onOpenConfig={() => setShowOpenclawModal(true)}
                    onOpenSettings={() => setShowSettingsModal(true)}
                  />

                  {/* Add participant button — hidden for now */}
                </div>
              </div>

              {/* Panel content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {/* Hatching animation for transitioning agents */}
                {(isSelectedTransitioning || burstAgentId === selectedAgent.id) ? (
                  <div className="h-full flex items-center justify-center">
                    <AgentHatchAnimation
                      state={selectedAgent.state === "RUNNING" ? "RUNNING" : selectedAgent.state as "PENDING" | "STARTING"}
                      onBurstComplete={() => setBurstAgentId(null)}
                    />
                  </div>
                ) : !isSelectedRunning ? (
                  <AgentLaunchPrompt
                    label={stoppedTabLabel[(mainTab === "logs" || mainTab === "shell" ? mainTab : "chat") as "chat" | "logs" | "shell"]}
                    launching={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id)}
                    onLaunch={() => { void handleStart(selectedAgent.id); }}
                    blockedTitle={selectedAgentStartGuidance?.title}
                    blockedMessage={selectedAgentStartGuidance?.message}
                    suggestedTierActions={selectedAgentSuggestedTierActions}
                  />
                ) : mainTab === "chat" ? (
                  <AgentChatPanel
                    chat={chat}
                    selectedAgent={selectedAgent}
                    isSelectedRunning={isSelectedRunning}
                    chatDragActive={chatDragActive}
                    setChatDragActive={setChatDragActive}
                    chatDragDepthRef={chatDragDepthRef}
                    handleChatFileDrop={handleChatFileDrop}
                    chatScrollRef={chatScrollRef}
                    handleChatScroll={handleChatScroll}
                    chatEndRef={chatEndRef}
                    recording={recording}
                    audioLevel={audioLevel}
                    recordingDuration={recordingDuration}
                    stopRecording={stopRecording}
                    audioUrl={audioUrl}
                    audioPreviewPlaying={audioPreviewPlaying}
                    audioPreviewDuration={audioPreviewDuration}
                    toggleAudioPreviewPlayback={toggleAudioPreviewPlayback}
                    discardAudio={discardAudio}
                    sendAudio={sendAudio}
                    sendingAudio={sendingAudio}
                    startRecording={startRecording}
                    handleSendChat={handleSendChat}
                    formatDuration={formatDuration}
                  />
                ) : mainTab === "logs" ? (
                  <AgentLogsPanel status={wsStatus} logs={logs} logBoxRef={logBoxRef} />
                ) : mainTab === "shell" ? (
                  <AgentTerminalPanel status={shellStatus} shellBoxRef={shellBoxRef} />
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* ── Right Sidebar — AgentView (desktop) ── */}
        {selectedAgent && isDesktopViewport && (
          <div className="w-80 flex-shrink-0 border-l border-border flex flex-col min-h-0">
            <AgentView
              {...agentViewVariants}
              agentName={selectedAgent.name || selectedAgent.id}
              activeTab={agentViewTab}
              onTabChange={setAgentViewTab}
              showActiveSessions
              showCronManager
              showRecentToolCalls
              tabBarStyle="v1"
              agentStatus={isSelectedRunning ? {
                state: selectedAgent.state as "RUNNING",
                uptime: selectedAgent.started_at ? Date.now() - new Date(selectedAgent.started_at).getTime() : 0,
                cpu: selectedAgent.cpu_millicores / 10,
                memory: { used: selectedAgent.memory_mib, total: selectedAgent.memory_mib },
              } : {
                state: (selectedAgent.state === "PENDING" || selectedAgent.state === "FAILED"
                  ? "STOPPED"
                  : selectedAgent.state) as "RUNNING" | "STOPPED" | "STARTING" | "STOPPING",
                uptime: 0,
                cpu: 0,
                memory: { used: 0, total: selectedAgent.memory_mib },
              }}
              agentConfig={agentConfigForView}
              agentConnections={agentConnectionsForView}
              agentSessions={agentSessionsForView}
              activityEntries={activityEntriesForView}
              recentToolCalls={recentToolCallsForView}
              agentCronJobs={agentCronJobsForView}
              agentWorkspaceFiles={agentWorkspaceFilesForView}
              onPromptClick={(prompt) => chat.setInput(prompt)}
              onCronRemove={(jobId) => { void chat.removeCron(jobId); }}
              onMarketplaceClick={() => { setDirectoryCategory(undefined); setDirectoryOpen(true); }}
              onAgentStart={() => { void handleStart(selectedAgent.id); }}
              onAgentStop={() => { void handleStop(selectedAgent.id); }}
              agentStarting={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id)}
              agentStopping={stoppingId === selectedAgent.id}
              agentStartBlocked={selectedAgentLaunchBlocked}
              agentStartBlockedReason={selectedAgentStartGuidance?.title}
              onOpenFiles={(path) => {
                const base = `/dashboard/agents/${selectedAgent.id}/files`;
                router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
              }}
              conversationThreads={syntheticThreads}
              selectedConversationThreadId={selectedAgent.id}
            />
          </div>
        )}
      </div>

      {/* ── Mobile Bottom Sheet — AgentView ── */}
      {selectedAgent && !isDesktopViewport && (
        <Sheet open={agentViewSheetOpen} onOpenChange={setAgentViewSheetOpen}>
          <SheetContent
            side="bottom"
            className="h-[80dvh] p-0 border-t border-border bg-background"
          >
            <div className="h-full flex flex-col min-h-0">
              <AgentView
                {...agentViewVariants}
                agentName={selectedAgent.name || selectedAgent.id}
                activeTab={agentViewTab}
                onTabChange={setAgentViewTab}
                showActiveSessions
                showCronManager
                showRecentToolCalls
                tabBarStyle="v1"
                agentStatus={isSelectedRunning ? {
                  state: selectedAgent.state as "RUNNING",
                  uptime: selectedAgent.started_at ? Date.now() - new Date(selectedAgent.started_at).getTime() : 0,
                  cpu: selectedAgent.cpu_millicores / 10,
                  memory: { used: selectedAgent.memory_mib, total: selectedAgent.memory_mib },
                } : selectedAgent.state === "STOPPED" ? {
                  state: "STOPPED",
                  uptime: 0,
                  cpu: 0,
                  memory: { used: 0, total: selectedAgent.memory_mib },
                } : null}
                agentConfig={agentConfigForView}
                agentConnections={agentConnectionsForView}
                agentSessions={agentSessionsForView}
                activityEntries={activityEntriesForView}
                recentToolCalls={recentToolCallsForView}
                agentCronJobs={agentCronJobsForView}
                agentWorkspaceFiles={agentWorkspaceFilesForView}
                onPromptClick={(prompt) => chat.setInput(prompt)}
                onCronRemove={(jobId) => { void chat.removeCron(jobId); }}
                onMarketplaceClick={() => { setDirectoryCategory(undefined); setDirectoryOpen(true); }}
                onAgentStart={() => { void handleStart(selectedAgent.id); }}
                onAgentStop={() => { void handleStop(selectedAgent.id); }}
                agentStarting={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id)}
                agentStopping={stoppingId === selectedAgent.id}
                agentStartBlocked={selectedAgentLaunchBlocked}
                agentStartBlockedReason={selectedAgentStartGuidance?.title}
                onOpenFiles={(path) => {
                const base = `/dashboard/agents/${selectedAgent.id}/files`;
                router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
              }}
                conversationThreads={syntheticThreads}
                selectedConversationThreadId={selectedAgent.id}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <OpenClawConfigModal
        open={showOpenclawModal}
        agent={selectedAgent}
        onClose={() => setShowOpenclawModal(false)}
        openclawSections={openclawSections}
        openclawSchemaBundle={openclawSchemaBundle}
        effectiveOpenclawSection={effectiveOpenclawSection}
        setActiveOpenclawSection={setActiveOpenclawSection}
        activeOpenclawSectionLabel={activeOpenclawSectionLabel}
        openclawSaving={openclawSaving}
        openclawDraft={openclawDraft}
        openclawError={openclawError}
        openclawSuccess={openclawSuccess}
        chat={chat}
        visibleOpenclawSections={visibleOpenclawSections}
        renderOpenclawField={renderOpenclawField}
        saveOpenclawSection={saveOpenclawSection}
        saveAllOpenclaw={saveAllOpenclaw}
        openclawPaneRef={openclawPaneRef}
      />

      <AgentSettingsModal
        open={showSettingsModal}
        agent={selectedAgent}
        onClose={() => setShowSettingsModal(false)}
        settingsName={settingsName}
        setSettingsName={setSettingsName}
        savingName={savingName}
        handleSaveName={handleSaveName}
        selectedAgentTier={selectedAgentTier ? titleizeTier(selectedAgentTier) : null}
        chat={chat}
        handleStop={handleStop}
        stoppingId={stoppingId}
        setPendingAgentDelete={setPendingAgentDelete}
      />
    </div>
  );
}
