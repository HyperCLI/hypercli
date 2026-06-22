"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Key,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageSquare,
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
import {
  AGENT_CLEANUP_START_MESSAGE,
  AGENT_STOP_CLEANUP_COOLDOWN_MS,
  createAgentClient,
  createHyperAgentClient,
  createOpenClawAgent,
  isAgentCleanupConflictError,
  startOpenClawAgent,
} from "@/lib/agent-client";
import { formatCpu, formatMemory } from "@/lib/format";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { useAgentLogs } from "@/hooks/useAgentLogs";
import { useAgentShell } from "@/hooks/useAgentShell";
import { useAgentShellActivation } from "@/hooks/useAgentShellActivation";
import { useAgentShellTerminal } from "@/hooks/useAgentShellTerminal";
import { agentAvatar } from "@/lib/avatar";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { IntegrationsDirectoryPanel } from "@/components/dashboard/integrations";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import type { TabId as AgentViewTabId } from "@/components/dashboard/agentViewTypes";
import { MOCK_PARTICIPANTS, type ConversationThread } from "@/components/dashboard/AgentsChannelsSidebar";
import { ChannelCreationWizard } from "@/components/dashboard/ChannelCreationWizard";
import { getCategoryForPlugin, type DirectoryCategory } from "@/components/dashboard/directory/directory-utils";
import { buildSkillsSnapshotCommand, parseSkillSnapshotOutput } from "@/components/dashboard/directory/workspace-skills";
import type { AgentFileEntry, SdkAgent } from "@/types";
import type { FileEntry } from "@/components/dashboard/files/types";
import type { Deployments, OpenClawAgent as SdkOpenClawAgent } from "@hypercli.com/sdk/agents";
import type { HyperAgentCurrentPlan, HyperAgentPlan, HyperAgentSubscriptionSummary, HyperAgentTypeCatalog } from "@hypercli.com/sdk/agent";
import type { Agent, AgentBudget, AgentDesktopTokenResponse, AgentState } from "@/app/dashboard/agents/types";
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
  humanizeKey,
} from "@/lib/openclaw-config";
import { getOpenClawDefaultModel } from "@/lib/openclaw-models";
import { getEffectivePlanName, mergeLaunchSlotInventories } from "@/lib/plan-checkout-state";
import { resolveOpenClawSessionKey } from "@/lib/openclaw-session-key";
import { displayOpenClawSessionName } from "@/lib/openclaw-session-sdk-surface";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { uploadAgentStarterFiles } from "@/lib/agent-starter-files";
import type { CenterPanel } from "@/components/dashboard/agents/page-helpers";
import { AgentSettingsPanel, AgentList, AgentTierSelectionModal, ErrorBanner } from "@/components/dashboard/agents/AgentPanels";
import type { FirstAgentSetupCreateParams } from "@/components/dashboard/agents/FirstAgentSetupWizard";
import { AgentChatPanel, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatPanel";
import { AgentLogsPanel } from "@/components/dashboard/agents/AgentLogsPanel";
import { AgentTerminalPanel } from "@/components/dashboard/agents/AgentTerminalPanel";
import { AgentInspector } from "@/components/dashboard/agents/AgentInspector";
import { AgentMainPanel } from "@/components/dashboard/agents/AgentMainPanel";
import { AgentGatewaySessionProvider, asAgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import { toAgentViewModel } from "@/components/dashboard/agents/agentViewModel";
import { HyperCLILogoLink } from "@/components/HyperCLILogoLink";
import { createAudioMediaRecorder } from "@/lib/audio-recorder";
import { normalizeCronJob } from "@/lib/cron-jobs";

type MainTab = AgentMainTab;
type AgentFileSource = "auto" | "pod" | "s3";

function buildBillingBudget(
  summary: HyperAgentSubscriptionSummary | null,
  currentPlan: HyperAgentCurrentPlan | null,
  typeCatalog: HyperAgentTypeCatalog | null,
): AgentBudget | null {
  if (!summary && !currentPlan) return null;

  const summarySlots = mergeLaunchSlotInventories(summary?.slotInventory, summary?.entitlements?.slotInventory);
  const slots = summary ? summarySlots : mergeLaunchSlotInventories(currentPlan?.slotInventory);
  const pooledTpd = summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? currentPlan?.pooledTpd ?? 0;
  const sizePresets = Object.fromEntries(
    (typeCatalog?.types ?? []).map((type) => [type.id, { cpu: type.cpu, memory: type.memory }]),
  );

  const merged: AgentBudget = {
    slots,
    pooled_tpd: pooledTpd,
  };
  if (Object.keys(sizePresets).length > 0) {
    merged.size_presets = sizePresets;
  }
  return merged;
}

function normalizeAgentFilePath(path: string): string {
  return normalizeOpenClawWorkspaceFilePath(path);
}

function toDashboardFileEntry(entry: AgentFileEntry): FileEntry {
  const path = normalizeAgentFilePath(entry.path);
  return {
    name: entry.name || path.split("/").filter(Boolean).pop() || entry.path,
    path,
    type: entry.type,
    size: entry.size,
    lastModified: entry.last_modified,
  };
}

interface TeamSetupSummary {
  workspaceName?: string;
  priority?: string;
  systems?: string[];
  vocabulary?: string[];
  escalationOwner?: string;
  autonomyLevel?: string;
  trustedSources?: string;
  cadence?: string;
  previewAutomation?: string;
  developerAccess?: string;
  agentName?: string;
  agentRole?: string;
  serviceName?: string | null;
}

interface TeamSetupAction {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  actionLabel: string;
  onClick: () => void;
}

function readTeamSetupSummary(): TeamSetupSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("dev-agent-setup-team-summary");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TeamSetupSummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function teamSummaryValue(value: string | string[] | null | undefined, fallback: string) {
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(", ");
    return joined || fallback;
  }
  return value?.trim() || fallback;
}

function buildTeamFirstPrompt(summary: TeamSetupSummary, selectedAgentName?: string | null) {
  const workspaceName = teamSummaryValue(summary.workspaceName, "our team");
  const priority = teamSummaryValue(summary.priority, "our top priority");
  const trustedSources = teamSummaryValue(summary.trustedSources, "our trusted sources");
  const escalationOwner = teamSummaryValue(summary.escalationOwner, "the escalation owner");
  const agentName = teamSummaryValue(summary.agentName, selectedAgentName || "the agent");
  return `Hi ${agentName}, use our onboarding context for ${workspaceName}. Summarize what you know, focus on "${priority}", name what you still need from ${trustedSources}, and suggest one safe next step. Escalate sensitive decisions to ${escalationOwner}.`;
}

function buildTeamStarterFiles(summary: TeamSetupSummary) {
  const workspaceName = teamSummaryValue(summary.workspaceName, "Team workspace");
  const priority = teamSummaryValue(summary.priority, "Clarify the next useful step");
  const systems = teamSummaryValue(summary.systems, "dashboard, agents");
  const vocabulary = teamSummaryValue(summary.vocabulary, "agent, workspace, setup");
  const trustedSources = teamSummaryValue(summary.trustedSources, "README files and runbooks");
  const escalationOwner = teamSummaryValue(summary.escalationOwner, "team lead");
  const autonomyLevel = teamSummaryValue(summary.autonomyLevel, "read and summarize");
  const cadence = teamSummaryValue(summary.cadence, "weekday mornings");
  const serviceName = teamSummaryValue(summary.serviceName, "the selected channel");
  const agentName = teamSummaryValue(summary.agentName, "Team agent");
  const agentRole = teamSummaryValue(summary.agentRole, "Team helper");

  return [
    {
      name: "agent/agent-profile.md",
      content: `# Agent Profile\n\nName: ${agentName}\nRole: ${agentRole}\nWorkspace: ${workspaceName}\nTeam priority: ${priority}`,
    },
    {
      name: "agent/communication-rules.md",
      content:
        `# Communication Rules\n\n` +
        `- Start with warmth and make the next step clear.\n` +
        `- Autonomy level: ${autonomyLevel}.\n` +
        `- Trusted sources: ${trustedSources}.\n` +
        `- Check-in cadence: ${cadence}.\n` +
        `- Bring in ${escalationOwner} for sensitive decisions, billing, destructive changes, and production risk.\n` +
        `- In ${serviceName}, summarize completed work with links and next steps.`,
    },
    {
      name: "workspace/context.json",
      content: JSON.stringify({
        workspaceName,
        priority,
        systems: systems.split(",").map((item) => item.trim()).filter(Boolean),
        vocabulary: vocabulary.split(",").map((item) => item.trim()).filter(Boolean),
        trustedSources,
        serviceName,
      }, null, 2),
    },
    {
      name: "agent/handoff-policy.md",
      content:
        `# Handoff Policy\n\n` +
        `Escalation owner: ${escalationOwner}\n\n` +
        `Ask before changing billing, rotating secrets, running shell commands, deleting files, resizing agents, or changing scheduled work.`,
    },
  ];
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
// Shell now routes through the gateway WebSocket via lagoon -> K8s exec.

// ── Main component ──

export default function DevAgentSetupAgentsPage() {
  const { getToken, user } = useAgentAuth();
  const router = useRouter();
  const { setAgentMenu } = useDashboardMobileAgentMenu();
  const accountInitial = user?.email?.trim()[0]?.toUpperCase() || "?";
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Agent data
  const [sdkAgents, setSdkAgents] = useState<SdkAgent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [catalogPlans, setCatalogPlans] = useState<HyperAgentPlan[]>([]);
  const [planName, setPlanName] = useState<string | null>(null);
  const [subscriptionSummary, setSubscriptionSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [tokenUsage, setTokenUsage] = useState<number | null>(null);
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

  const markAgentCleanupCooldown = useCallback((agentId: string) => {
    setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
    const existing = stoppedTimersRef.current.get(agentId);
    if (existing) clearTimeout(existing);
    stoppedTimersRef.current.set(agentId, setTimeout(() => {
      setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
      stoppedTimersRef.current.delete(agentId);
    }, AGENT_STOP_CLEANUP_COOLDOWN_MS));
  }, []);

  const [tierSelection, setTierSelection] = useState<AgentTierSelectionState | null>(null);
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileAgentMenuOpen, setMobileAgentMenuOpen] = useState(false);
  const [sidebarCreatorSignal, setSidebarCreatorSignal] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [teamSetupSummary, setTeamSetupSummary] = useState<TeamSetupSummary | null>(null);
  const [teamSetupSafeWriteWarning, setTeamSetupSafeWriteWarning] = useState<string | null>(null);
  const [teamSetupCompanionOpen, setTeamSetupCompanionOpen] = useState(true);
  const [retryingTeamContext, setRetryingTeamContext] = useState(false);
  const [isTeamPlanActive, setIsTeamPlanActive] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedPlan = window.sessionStorage.getItem("dev-agent-setup-plan");
    const teamActive = storedPlan === "team";
    setIsTeamPlanActive(teamActive);
    setTeamSetupSummary(teamActive ? readTeamSetupSummary() : null);
    setTeamSetupSafeWriteWarning(
      teamActive ? window.sessionStorage.getItem("dev-agent-setup-safe-write-warning") : null,
    );
  }, []);

  // Logs
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Shell
  const shellOutputHandlerRef = useRef<(text: string) => void>(() => undefined);

  // Files panel

  // Right sidebar inspector
  const [inspectorTab, setInspectorTab] = useState<AgentViewTabId>("overview");
  const [channelsData, setChannelsData] = useState<Record<string, unknown> | null>(null);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);

  // Overlays for gear dropdown items
  const [showChannelWizard, setShowChannelWizard] = useState(false);
  const [directoryCategory, setDirectoryCategory] = useState<DirectoryCategory | undefined>();
  const [directoryItemId, setDirectoryItemId] = useState<string | undefined>();
  const [directoryDetailOrigin, setDirectoryDetailOrigin] = useState<"chat" | null>(null);

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

  // Settings panel state
  const [settingsName, setSettingsName] = useState("");
  const [, setAgentClusterUnavailable] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [chatDragActive, setChatDragActive] = useState(false);
  const chatDragDepthRef = useRef(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const openConnectionSuggestion = useCallback((suggestion: ChatConnectionSuggestion) => {
    if (suggestion.directoryPluginId) {
      const category = getCategoryForPlugin(suggestion.directoryPluginId) ?? undefined;
      setDirectoryCategory(category);
      setDirectoryItemId(suggestion.directoryPluginId);
      setDirectoryDetailOrigin("chat");
      setMainTab("integrations");
      setMobileShowChat(true);
      return;
    }

    setInspectorTab("connections");
    setInspectorSheetOpen(true);
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const agentClient = deployments ?? createAgentClient(token);
      if (!deployments) {
        setDeployments(agentClient);
      }
      const hyperAgent = createHyperAgentClient(token);
      const [listedAgents, catalogData, currentPlan, summaryData, dailyUsage, typeCatalogData] = await Promise.all([
        agentClient.list(),
        hyperAgent.plans().catch(() => []),
        hyperAgent.currentPlan().catch(() => null),
        hyperAgent.subscriptionSummary().catch(() => null),
        hyperAgent.usageHistory(1).catch(() => null),
        hyperAgent.agentTypes().catch(() => null),
      ]);
      const plans = Array.isArray(catalogData) ? catalogData : [];
      const normalizedCurrentPlan = currentPlan as HyperAgentCurrentPlan | null;
      const summary = (summaryData as HyperAgentSubscriptionSummary | null) || null;
      const typeCatalog = (typeCatalogData as HyperAgentTypeCatalog | null) || null;
      setSdkAgents(listedAgents);
      setBudget(buildBillingBudget(summary, normalizedCurrentPlan, typeCatalog));
      setCatalogPlans(plans);
      setPlanName(getEffectivePlanName(summary, normalizedCurrentPlan, plans));
      setSubscriptionSummary(summary);
      setTokenUsage(dailyUsage?.history?.reduce((total, entry) => total + entry.totalTokens, 0) ?? null);
      setAgentClusterUnavailable(false);
      const setupCreatedAgentId = window.sessionStorage.getItem("dev-agent-setup-created-agent-id");
      setSelectedAgentId((currentId) => {
        if (setupCreatedAgentId && listedAgents.some((item) => item.id === setupCreatedAgentId)) {
          return setupCreatedAgentId;
        }
        if (!currentId) {
          return listedAgents[0]?.id ?? null;
        }
        return listedAgents.some((item) => item.id === currentId)
          ? currentId
          : (listedAgents[0]?.id ?? null);
      });
    } catch (err) {
      const described = describeAgentsPageError(err);
      setError(described.message);
      setAgentClusterUnavailable(described.clusterUnavailable);
      setSdkAgents([]);
      setBudget(null);
      setCatalogPlans([]);
      setDeployments(null);
    } finally {
      setLoading(false);
    }
  }, [deployments, getToken]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const agents = useMemo(() => sdkAgents.map(toAgentViewModel), [sdkAgents]);

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
    () => (selectedSdkAgent ? toAgentViewModel(selectedSdkAgent) : null),
    [selectedSdkAgent],
  );
  const selectedOpenClawAgent = useMemo(
    () => (selectedSdkAgent && typeof (selectedSdkAgent as { connect?: unknown }).connect === "function"
      ? (selectedSdkAgent as SdkOpenClawAgent)
      : null),
    [selectedSdkAgent],
  );
  const selectedAgentState = selectedAgent?.state ?? null;
  const isSelectedTransitioning = selectedAgent && ["PENDING", "STARTING", "STOPPING"].includes(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";
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
  const stoppedTabLabel: Record<CenterPanel, string> = {
    chat: "Chat",
    files: "Files",
    integrations: "Integrations",
    scheduled: "Scheduled",
    logs: "Logs",
    settings: "Settings",
    shell: "Shell",
  };
  const agentTabItems: Array<{ key: MainTab; label: string; icon: typeof MessageSquare }> = [
    { key: "chat", label: "Chat", icon: MessageSquare },
    { key: "scheduled", label: "Scheduled", icon: Timer },
    { key: "logs", label: "Logs", icon: TerminalSquare },
    { key: "shell", label: "Shell", icon: TerminalSquare },
  ];
  const dashboardNavItems: Array<{ label: string; href: string; icon: typeof Bot }> = [
    { label: "Overview", href: "/dashboard", icon: Bot },
    { label: "Agents", href: "/agents", icon: Bot },
    { label: "API Keys", href: "/keys", icon: Key },
    { label: "Plans", href: "/plans", icon: CreditCard },
    { label: "Billing", href: "/dashboard/settings", icon: CreditCard },
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
    shellOutputHandlerRef.current(text);
  }, []);

  const {
    logs,
    status: wsStatus,
    reconnect: reconnectLogs,
  } = useAgentLogs(deployments, selectedAgentId, mainTab === "logs" && selectedAgentState === "RUNNING");

  const shellEnabled = useAgentShellActivation({
    agentId: selectedAgentId,
    agentState: selectedAgentState,
    activeTab: mainTab,
  });

  const {
    status: shellStatus,
    send: sendShell,
    resize: resizeShell,
    reconnect: reconnectShell,
  } = useAgentShell(deployments, {
    agentId: selectedAgentId,
    enabled: shellEnabled,
    onData: handleShellData,
  });

  const {
    shellBoxRef,
    writeOutput: writeShellOutput,
    clearOutput: clearShellOutput,
  } = useAgentShellTerminal({
    agentId: selectedAgentId,
    status: shellStatus,
    visible: mainTab === "shell" && Boolean(isSelectedRunning),
    onInput: sendShell,
    onResize: resizeShell,
  });

  useEffect(() => {
    shellOutputHandlerRef.current = writeShellOutput;
  }, [writeShellOutput]);

  useEffect(() => {
    if (mainTab !== "shell" || (shellStatus !== "connecting" && shellStatus !== "reconnecting")) return;
    clearShellOutput();
  }, [clearShellOutput, mainTab, shellStatus]);

  const chat = useOpenClawSession(
    selectedAgent && isSelectedRunning ? selectedOpenClawAgent : null,
    isSelectedRunning,
  );
  const gatewayChat = asAgentGatewaySession(chat);
  const draftTeamPrompt = useCallback(() => {
    if (!teamSetupSummary) return;
    setMainTab("chat");
    setMobileShowChat(true);
    chat.setInput(buildTeamFirstPrompt(teamSetupSummary, selectedAgent?.name));
  }, [chat, selectedAgent?.name, teamSetupSummary]);

  const retryTeamStarterContext = useCallback(async () => {
    if (!teamSetupSummary || !chat.connected) return;
    setRetryingTeamContext(true);
    try {
      for (const file of buildTeamStarterFiles(teamSetupSummary)) {
        await chat.saveFile(file.name, file.content);
      }
      await chat.saveConfig({
        setup: {
          source: "dev-agent-setup",
          plan: "team",
          team: teamSetupSummary,
          retriedFromWorkspace: true,
        },
      });
      setTeamSetupSafeWriteWarning(null);
      window.sessionStorage.removeItem("dev-agent-setup-safe-write-warning");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Starter context could not be written yet.";
      setTeamSetupSafeWriteWarning(message);
      window.sessionStorage.setItem("dev-agent-setup-safe-write-warning", message);
    } finally {
      setRetryingTeamContext(false);
    }
  }, [chat, teamSetupSummary]);

  const teamSetupActions = useMemo(() => {
    if (!teamSetupSummary) return [];
    return [
      {
        id: "chat",
        icon: MessageSquare,
        title: "Chat with team context",
        body: "Draft the first message from the setup summary.",
        actionLabel: "Draft prompt",
        onClick: draftTeamPrompt,
      },
      {
        id: "files",
        icon: FolderOpen,
        title: "Review starter files",
        body: teamSetupSafeWriteWarning ? "Starter files may need a retry." : "Profile, rules, context, and handoff policy are ready.",
        actionLabel: "Open context",
        onClick: () => {
          setInspectorTab("overview");
          setInspectorSheetOpen(true);
        },
      },
      {
        id: "channels",
        icon: Plug,
        title: "Check channels",
        body: `${teamSummaryValue(teamSetupSummary.serviceName, "The selected channel")} is ready to review from integrations.`,
        actionLabel: "Open channels",
        onClick: () => {
          setDirectoryCategory("channels");
          setDirectoryItemId(undefined);
          setDirectoryDetailOrigin(null);
          setMainTab("integrations");
          setMobileShowChat(true);
        },
      },
      {
        id: "activity",
        icon: TerminalSquare,
        title: "Watch logs and activity",
        body: "Use logs and activity to keep team work explainable.",
        actionLabel: "Open logs",
        onClick: () => {
          setMainTab("logs");
          setMobileShowChat(true);
          setInspectorTab("activity");
          setInspectorSheetOpen(true);
        },
      },
      {
        id: "automation",
        icon: Timer,
        title: "Preview automation",
        body: teamSummaryValue(teamSetupSummary.previewAutomation, "Scheduled routines stay preview-only until created deliberately."),
        actionLabel: "Open cron",
        onClick: () => {
          setInspectorTab("cron");
          setInspectorSheetOpen(true);
        },
      },
      {
        id: "developer-access",
        icon: Key,
        title: "Developer access later",
        body: teamSummaryValue(teamSetupSummary.developerAccess, "Scoped keys can be set up later."),
        actionLabel: "Open keys",
        onClick: () => router.push("/keys"),
      },
    ];
  }, [draftTeamPrompt, router, teamSetupSafeWriteWarning, teamSetupSummary]);

  const activeConnectionStatus = useMemo(() => {
    if (!isSelectedRunning) return null;
    if (mainTab === "files") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    if (mainTab === "logs") return wsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "openclaw" || mainTab === "integrations" || mainTab === "settings") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, mainTab, shellStatus, wsStatus]);

  const listAgentFiles = useCallback(async (path?: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return [];
    const token = await getToken();
    const entries = await createAgentClient(token).filesList(
      selectedAgentId,
      normalizeAgentFilePath(path ?? ""),
      source,
    );
    return (entries as AgentFileEntry[]).map(toDashboardFileEntry);
  }, [getToken, selectedAgentId]);

  const readAgentFile = useCallback(async (path: string, source: AgentFileSource = "auto") => {
    if (!selectedAgentId) return "";
    const token = await getToken();
    return createAgentClient(token).fileRead(selectedAgentId, normalizeAgentFilePath(path), source);
  }, [getToken, selectedAgentId]);

  const loadAgentSkills = useCallback(async () => {
    if (!selectedAgentId) return [];
    const token = await getToken();
    const result = await createAgentClient(token).exec(selectedAgentId, buildSkillsSnapshotCommand(), { timeout: 15_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to read /app/skills from the agent.");
    }
    return parseSkillSnapshotOutput(result.stdout);
  }, [getToken, selectedAgentId]);

  // ── Agent inspector data wiring ──

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
    const defaultModel = getOpenClawDefaultModel(cfg);
    return {
      model: defaultModel || "unknown",
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
  // right inspector (which needs `hasAgent` true to render content).
  const syntheticThreads = useMemo<ConversationThread[]>(() => {
    return agents.map((agent) => ({
      id: agent.id,
      sessionKey: resolveOpenClawSessionKey(agent.id),
      participants: [
        { id: "user", name: "You", type: "user" as const },
        { id: agent.id, name: agent.name || agent.id, type: "agent" as const, meta: agent.meta ?? null },
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
    return chat.cronJobs.map(normalizeCronJob);
  }, [chat.cronJobs]);

  // Derive AgentSession[] from chat.sessions
  const agentSessionsForView = useMemo(() => {
    if (!chat.sessions || chat.sessions.length === 0) return null;
    return chat.sessions.map((session) => {
      const sourceChannelId = typeof session.sourceChannelId === "string" ? session.sourceChannelId : undefined;
      return {
        key: session.key,
        clientMode: session.clientMode,
        clientDisplayName: displayOpenClawSessionName(session),
        createdAt: session.createdAt,
        lastMessageAt: session.lastMessageAt,
        ...(sourceChannelId ? { sourceChannelId } : {}),
      };
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

  const agentCardDataById = useMemo(() => {
    if (!selectedAgent) return {};
    return {
      [selectedAgent.id]: {
        id: selectedAgent.id,
        name: selectedAgent.name || selectedAgent.id,
        state: selectedAgent.state,
        cpuMillicores: selectedAgent.cpu_millicores,
        memoryMib: selectedAgent.memory_mib,
        hostname: selectedAgent.hostname,
        startedAt: selectedAgent.started_at,
        updatedAt: selectedAgent.updated_at,
        lastError: selectedAgent.last_error,
        meta: selectedAgent.meta,
        config: agentConfigForView,
        connections: agentConnectionsForView?.map((connection) => ({
          id: connection.id,
          name: connection.name,
          connected: connection.connected,
        })) ?? null,
        sessions: agentSessionsForView?.map((session) => ({ key: session.key })) ?? null,
        files: agentWorkspaceFilesForView?.map((file) => ({
          name: file.name,
          size: file.size,
        })) ?? null,
        activity: activityEntriesForView?.map((entry) => ({
          id: entry.id,
          action: entry.action,
          detail: entry.detail,
          timestamp: entry.timestamp,
        })) ?? null,
      },
    };
  }, [
    activityEntriesForView,
    agentConfigForView,
    agentConnectionsForView,
    agentSessionsForView,
    agentWorkspaceFilesForView,
    selectedAgent,
  ]);

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

  // ── Actions ──

  const handleStart = async (agentId: string) => {
    const sdkAgent = sdkAgents.find((entry) => entry.id === agentId) ?? null;
    const agent = sdkAgent ? toAgentViewModel(sdkAgent) : null;
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
      if (isAgentCleanupConflictError(err)) {
        markAgentCleanupCooldown(agentId);
        setError(AGENT_CLEANUP_START_MESSAGE);
        return;
      }
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

  const handleCreateFirstAgent = useCallback(async ({ name, iconIndex, size, files }: FirstAgentSetupCreateParams) => {
    try {
      setError(null);
      const token = await getToken();
      const created = await createOpenClawAgent(token, {
        name: name || undefined,
        start: true,
        size,
        meta: { ui: { avatar: { icon_index: iconIndex } } },
      });
      if (created.id) {
        if (files.length > 0) {
          try {
            const agentClient = createAgentClient(token);
            await uploadAgentStarterFiles({
              agentId: created.id,
              files,
              writeFileBytes: (agentId, path, content, destination) => (
                agentClient.fileWriteBytes(agentId, path, content, destination)
              ),
            });
          } catch (uploadError) {
            setError(uploadError instanceof Error
              ? `Agent created, but starter files could not be uploaded: ${uploadError.message}`
              : "Agent created, but starter files could not be uploaded.");
          }
        }
        await fetchAgents();
        setSelectedAgentId(created.id);
        setMainTab("chat");
        setMobileShowChat(true);
        return created.id;
      }
      await fetchAgents();
      setError("Agent was created, but no agent id was returned.");
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create agent";
      setError(message);
      throw err;
    }
  }, [fetchAgents, getToken]);

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
      if (isAgentCleanupConflictError(err)) {
        markAgentCleanupCooldown(agentId);
        setError(AGENT_CLEANUP_START_MESSAGE);
      } else {
        setError(err instanceof Error ? err.message : "Failed to resize and start agent");
      }
    } finally {
      setStartingId(null);
    }
  }, [getToken, markAgentCleanupCooldown]);

  const selectedAgentHasTierOptions = Boolean(selectedAgentStartGuidance?.availableTiers?.length);
  const selectedAgentRecentlyStopped = Boolean(selectedAgent && recentlyStoppedIds.has(selectedAgent.id));
  const selectedAgentTierLaunchBlocked = Boolean(selectedAgentStartGuidance && !selectedAgentHasTierOptions);
  const selectedAgentLaunchBlocked = selectedAgentTierLaunchBlocked || selectedAgentRecentlyStopped;
  const selectedAgentStartBlockedTitle = selectedAgentRecentlyStopped
    ? "Agent is finishing shutdown"
    : selectedAgentStartGuidance?.title;
  const selectedAgentStartBlockedMessage = selectedAgentRecentlyStopped
    ? "Wait a few seconds before starting this agent again."
    : selectedAgentStartGuidance?.message;
  const selectedAgentStarting = Boolean(selectedAgent && startingId === selectedAgent.id);

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
      markAgentCleanupCooldown(agentId);
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
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio recording is not available in this browser.");
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (typeof AudioContext !== "undefined") {
        try {
          audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel(Math.min(avg / 128, 1));
            levelAnimRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
        } catch {
          if (audioCtx) void audioCtx.close();
          audioCtx = null;
          audioContextRef.current = null;
          analyserRef.current = null;
        }
      }

      const mediaRecorder = createAudioMediaRecorder(stream);
      audioChunksRef.current = [];
      setRecordingDuration(0);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (levelAnimRef.current) {
          cancelAnimationFrame(levelAnimRef.current);
          levelAnimRef.current = 0;
        }
        if (audioCtx) void audioCtx.close();
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || audioChunksRef.current[0]?.type || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (levelAnimRef.current) {
        cancelAnimationFrame(levelAnimRef.current);
        levelAnimRef.current = 0;
      }
      if (audioCtx) void audioCtx.close();
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      audioContextRef.current = null;
      analyserRef.current = null;
      setAudioLevel(0);
      setRecording(false);
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
      const voiceFile = { name: filename, path: agentPath, type: audioBlob.type || "audio/webm" };
      await createAgentClient(token).fileWriteBytes(selectedAgent.id, uploadPath, await audioBlob.arrayBuffer());
      await chat.sendMessage(voiceMessage, { displayContent: "", files: [voiceFile] });
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

  const selectedCenterPanel: CenterPanel =
    mainTab === "openclaw"
      ? "settings"
      : mainTab === "files" ||
        mainTab === "integrations" ||
        mainTab === "scheduled" ||
        mainTab === "logs" ||
        mainTab === "shell" ||
        mainTab === "settings"
        ? mainTab
        : "chat";

  useEffect(() => {
    if (!selectedAgent) {
      setAgentMenu(null);
      return;
    }
    setAgentMenu({
      selectedAgentId: selectedAgent.id,
      activeTab: mainTab,
      onSelectTab: (tab) => {
        if (tab === "files") {
          router.push(`/dashboard/agents/${selectedAgent.id}/files`);
          return;
        }
        if (tab === "workspace") {
          setMainTab("chat");
          setMobileShowChat(true);
          return;
        }
        if (tab === "openclaw") {
          setMainTab("settings");
          setMobileShowChat(true);
          return;
        }
        if (tab === "integrations") {
          setDirectoryCategory(undefined);
          setDirectoryItemId(undefined);
          setDirectoryDetailOrigin(null);
          setMainTab("integrations");
          setMobileShowChat(true);
          return;
        }
        if (tab === "settings") {
          setMainTab("settings");
          setMobileShowChat(true);
          return;
        }
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
  }, [selectedAgent, mainTab, deletingId, setAgentMenu, router]);

  // ── Render ──

  return (
    <AgentGatewaySessionProvider session={gatewayChat}>
      <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header + menu (hidden on desktop) */}
      {!isDesktopViewport && (
        <div className="relative flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <HyperCLILogoLink className="h-[31px] w-[102px]" priority />
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

      <ChannelCreationWizard
        open={showChannelWizard}
        onClose={() => setShowChannelWizard(false)}
        availableAgents={agents.map((a) => ({ id: a.id, name: a.name || a.id, type: "agent" as const }))}
        availableUsers={MOCK_PARTICIPANTS.filter((p) => p.type === "user")}
        onCreate={async (channel) => {
          // TODO: raise an SDK/API requirement for channel creation. For now, log and close.
          console.log("Create channel:", channel);
        }}
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

      {teamSetupSummary ? (
        <TeamSetupArrival
          summary={teamSetupSummary}
          agentName={selectedAgent?.name ?? teamSetupSummary.agentName ?? "Your agent"}
          connected={chat.connected}
          warning={teamSetupSafeWriteWarning}
          retrying={retryingTeamContext}
          onDraftPrompt={draftTeamPrompt}
          onRetryContext={() => void retryTeamStarterContext()}
          onOpenContext={() => {
            setInspectorTab("overview");
            setInspectorSheetOpen(true);
          }}
        />
      ) : null}

      {/* Main layout: AgentList + AgentMainPanel + AgentInspector */}
      <div className="flex flex-1 min-h-0">
        <AgentList
          sidebarCollapsed={sidebarCollapsed}
          isDesktopViewport={isDesktopViewport}
          mobileShowChat={mobileShowChat}
          agents={agents}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          setMobileShowChat={setMobileShowChat}
          setSidebarCollapsed={setSidebarCollapsed}
          syntheticThreads={syntheticThreads}
          agentCardDataById={agentCardDataById}
          getToken={getToken}
          createOpenClawAgent={createOpenClawAgent}
          fetchAgents={fetchAgents}
          setError={setError}
          sidebarCreatorSignal={sidebarCreatorSignal}
          setPendingAgentDelete={setPendingAgentDelete}
          accountInitial={accountInitial}
          onOpenSettings={() => {
            setMainTab("settings");
            setMobileShowChat(true);
          }}
          settingsActive={mainTab === "settings"}
          budget={budget}
          subscriptionSummary={subscriptionSummary}
          catalogPlans={catalogPlans}
          updateAgentName={async (agentId, name) => {
            const token = await getToken();
            const updatedAgent = await createAgentClient(token).update(agentId, { name });
            setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
          }}
          showChannels={isTeamPlanActive}
        />

        <AgentMainPanel
            isDesktopViewport={isDesktopViewport}
            mobileShowChat={mobileShowChat}
            selectedAgent={selectedAgent}
            isSelectedRunning={Boolean(isSelectedRunning)}
            burstAgentId={burstAgentId}
            onBurstComplete={() => setBurstAgentId(null)}
            activeConnectionStatus={activeConnectionStatus}
            chatConnected={chat.connected}
            chatConnecting={chat.connecting}
            startingId={startingId}
            recentlyStoppedIds={recentlyStoppedIds}
            selectedAgentLaunchBlocked={selectedAgentLaunchBlocked}
            selectedAgentStartGuidanceTitle={selectedAgentStartBlockedTitle}
            blockedMessage={selectedAgentStartBlockedMessage}
            suggestedTierActions={selectedAgentSuggestedTierActions}
            currentPanel={selectedCenterPanel}
            stoppedTabLabel={stoppedTabLabel[selectedCenterPanel]}
            persistentPanelContent={
              <AgentTerminalPanel
                status={shellStatus}
                shellBoxRef={shellBoxRef}
                visible={mainTab === "shell" && Boolean(isSelectedRunning)}
              />
            }
            panelContent={mainTab === "chat" ? (
              <AgentChatPanel
                chat={gatewayChat}
                selectedAgent={selectedAgent!}
                isSelectedRunning={Boolean(isSelectedRunning)}
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
                onConnectionCta={openConnectionSuggestion}
                onOpenFileFromChat={(path) => {
                  if (!selectedAgent) return;
                  const base = `/dashboard/agents/${selectedAgent.id}/files`;
                  router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
                }}
                slashCommandActions={{
                  onOpenFiles: (path) => {
                    if (!selectedAgent) return;
                    const base = `/dashboard/agents/${selectedAgent.id}/files`;
                    router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
                  },
                  onOpenConfig: () => {
                    setMainTab("settings");
                    setMobileShowChat(true);
                  },
                  onOpenIntegrations: () => {
                    setDirectoryCategory(undefined);
                    setDirectoryItemId(undefined);
                    setDirectoryDetailOrigin(null);
                    setMainTab("integrations");
                    setMobileShowChat(true);
                  },
                  onOpenScheduled: () => {
                    setInspectorTab("cron");
                    setInspectorSheetOpen(true);
                  },
                  onOpenActivity: () => {
                    setInspectorTab("activity");
                    setInspectorSheetOpen(true);
                  },
                  onOpenLogs: () => {
                    setMainTab("logs");
                    setMobileShowChat(true);
                  },
                  onOpenShell: () => {
                    setMainTab("shell");
                    setMobileShowChat(true);
                  },
                  onOpenPlans: () => router.push("/plans"),
                  onOpenBilling: () => router.push("/dashboard/settings"),
                  onStartAgent: async () => {
                    if (selectedAgent) await handleStart(selectedAgent.id);
                  },
                  onStopAgent: async () => {
                    if (selectedAgent) await handleStop(selectedAgent.id);
                  },
                  onNewAgent: () => {
                    setMobileShowChat(false);
                    setSidebarCreatorSignal((v) => v + 1);
                  },
                  onRenameAgent: async (name) => {
                    if (!selectedAgent) return;
                    const token = await getToken();
                    const updatedAgent = await createAgentClient(token).update(selectedAgent.id, { name });
                    setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
                  },
                  onOpenAgentSettings: () => {
                    setMainTab("settings");
                    setMobileShowChat(true);
                  },
                }}
              />
            ) : mainTab === "integrations" ? (
              <IntegrationsDirectoryPanel
                initialCategory={directoryCategory}
                initialPluginId={directoryItemId}
                detailBackLabel={directoryDetailOrigin === "chat" ? "Back to chat" : undefined}
                onDetailBack={directoryDetailOrigin === "chat" ? () => {
                  setDirectoryDetailOrigin(null);
                  setDirectoryItemId(undefined);
                  setMainTab("chat");
                  setMobileShowChat(true);
                } : undefined}
                agentName={selectedAgent?.name || selectedAgent?.pod_name || "Agent"}
                config={chat.config as Record<string, unknown> | null}
                configSchema={chat.configSchema}
                connected={chat.connected}
                onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
                onChannelProbe={async () => chat.channelsStatus(true)}
                onOpenShell={() => setMainTab("shell")}
                onLoadSkills={loadAgentSkills}
                onListFiles={listAgentFiles}
                onReadFile={readAgentFile}
                onIntegrationAuthStart={chat.integrationsAuthStart}
                onIntegrationAuthStatus={chat.integrationsAuthStatus}
                onIntegrationStatus={chat.integrationsStatus}
                onIntegrationDisconnect={chat.integrationsDisconnect}
              />
            ) : mainTab === "settings" || mainTab === "openclaw" ? (
              <AgentSettingsPanel
                agent={selectedAgent}
                user={user}
                getToken={getToken}
                onStartAgent={() => {
                  if (selectedAgent) void handleStart(selectedAgent.id);
                }}
                onStopAgent={() => {
                  if (selectedAgent) void handleStop(selectedAgent.id);
                }}
                agentStarting={selectedAgentStarting}
                agentStopping={Boolean(selectedAgent && stoppingId === selectedAgent.id)}
                agentStartBlocked={selectedAgentLaunchBlocked}
                agentStartBlockedReason={selectedAgentStartBlockedTitle}
                openclawConfig={chat.config}
                openclawModels={chat.models}
                onUpdateAgentName={async (agentId, name) => {
                  const token = await getToken();
                  const updatedAgent = await createAgentClient(token).update(agentId, { name });
                  setSdkAgents((prev) => upsertSdkAgent(prev, updatedAgent));
                }}
                onSaveOpenClawConfig={async (patch) => { await chat.saveConfig(patch); }}
              />
            ) : mainTab === "logs" ? (
              <AgentLogsPanel status={wsStatus} logs={logs} logBoxRef={logBoxRef} />
            ) : mainTab === "shell" ? (
              null
            ) : null}
            onCreate={() => {
              setMobileShowChat(false);
              setSidebarCreatorSignal((v) => v + 1);
            }}
            onCreateAgent={handleCreateFirstAgent}
            budget={budget}
            subscriptionSummary={subscriptionSummary}
            catalogPlans={catalogPlans}
            onShowList={() => setMobileShowChat(false)}
            onShowInspector={() => setInspectorSheetOpen(true)}
            onStart={() => {
              if (selectedAgent) {
                void handleStart(selectedAgent.id);
              }
            }}
            onReconnect={() => {
              if (mainTab === "logs") reconnectLogs();
              if (mainTab === "shell") reconnectShell();
            }}
          />

        <AgentInspector
            isDesktopViewport={isDesktopViewport}
            open={inspectorSheetOpen}
            setOpen={setInspectorSheetOpen}
            selectedAgent={selectedAgent}
            isSelectedRunning={Boolean(isSelectedRunning)}
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            viewProps={{
              ...agentViewVariants,
              showActiveSessions: true,
              showCronManager: true,
              showRecentToolCalls: true,
              tabBarStyle: "v1",
              agentConfig: agentConfigForView,
              agentConnections: agentConnectionsForView,
              agentSessions: agentSessionsForView,
              activityEntries: activityEntriesForView,
              recentToolCalls: recentToolCallsForView,
              agentCronJobs: agentCronJobsForView,
              agentWorkspaceFiles: agentWorkspaceFilesForView,
              onPromptClick: (prompt) => chat.setInput(prompt),
              onCronRemove: (jobId) => { void chat.removeCron(jobId); },
              onMarketplaceClick: () => { setDirectoryCategory(undefined); setDirectoryItemId(undefined); setDirectoryDetailOrigin(null); setMainTab("integrations"); },
              onAgentStart: () => { if (selectedAgent) void handleStart(selectedAgent.id); },
              onAgentStop: () => { if (selectedAgent) void handleStop(selectedAgent.id); },
              agentStarting: selectedAgentStarting,
              agentStopping: Boolean(selectedAgent && stoppingId === selectedAgent.id),
              agentStartBlocked: selectedAgentLaunchBlocked,
              agentStartBlockedReason: selectedAgentStartBlockedTitle,
              onOpenFiles: (path) => {
                if (!selectedAgent) return;
                const base = `/dashboard/agents/${selectedAgent.id}/files`;
                router.push(path ? `${base}?file=${encodeURIComponent(path)}` : base);
              },
              conversationThreads: syntheticThreads,
              selectedConversationThreadId: selectedAgent?.id ?? null,
            }}
          />
      </div>

      {teamSetupSummary && teamSetupCompanionOpen ? (
        <TeamSetupCompanion
          summary={teamSetupSummary}
          actions={teamSetupActions}
          warning={teamSetupSafeWriteWarning}
          connected={chat.connected}
          retrying={retryingTeamContext}
          onRetryContext={() => void retryTeamStarterContext()}
          onClose={() => setTeamSetupCompanionOpen(false)}
        />
      ) : null}
      </div>
    </AgentGatewaySessionProvider>
  );
}

function TeamSetupArrival({
  summary,
  agentName,
  connected,
  warning,
  retrying,
  onDraftPrompt,
  onRetryContext,
  onOpenContext,
}: {
  summary: TeamSetupSummary;
  agentName: string;
  connected: boolean;
  warning: string | null;
  retrying: boolean;
  onDraftPrompt: () => void;
  onRetryContext: () => void;
  onOpenContext: () => void;
}) {
  const workspaceName = teamSummaryValue(summary.workspaceName, "your team");
  const priority = teamSummaryValue(summary.priority, "the team priority");
  const serviceName = teamSummaryValue(summary.serviceName, "your selected channel");

  return (
    <section className="border-b border-border bg-background/95 px-4 py-3">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Team setup
            </span>
            <span className="text-xs text-text-muted">{workspaceName}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {agentName} is ready. We brought over your Team setup context.
          </p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">
            Priority: {priority} · Channel: {serviceName} · Context: {warning ? "needs retry" : "ready"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDraftPrompt}
            className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Draft first prompt
          </button>
          <button
            type="button"
            onClick={warning ? onRetryContext : onOpenContext}
            disabled={warning ? !connected || retrying : false}
            className="btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-60"
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            {warning ? "Retry context" : "View context"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TeamSetupCompanion({
  summary,
  actions,
  warning,
  connected,
  retrying,
  onRetryContext,
  onClose,
}: {
  summary: TeamSetupSummary;
  actions: TeamSetupAction[];
  warning: string | null;
  connected: boolean;
  retrying: boolean;
  onRetryContext: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="fixed bottom-5 right-5 z-40 max-h-[calc(100dvh-2rem)] w-[min(27rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Next helpful things</p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{teamSummaryValue(summary.workspaceName, "Team workspace")}</h2>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            Use what setup collected without turning this into another tour.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-text-muted hover:bg-surface-low hover:text-foreground"
          aria-label="Close setup companion"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto p-3">
        <div className="grid gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className="group rounded-lg border border-border bg-surface-low/50 p-3 text-left transition hover:border-primary/30 hover:bg-surface-low"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{action.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-text-secondary">{action.body}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      {action.actionLabel}
                      <ExternalLink className="h-3 w-3 opacity-70 transition group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {warning ? (
          <div className="mt-3 rounded-lg border border-[#f0c56c]/25 bg-[#f0c56c]/10 p-3">
            <p className="text-xs font-semibold text-foreground">Starter context may need a retry</p>
            <p className="mt-1 text-xs leading-5 text-text-secondary">{warning}</p>
            <button
              type="button"
              onClick={onRetryContext}
              disabled={!connected || retrying}
              className="btn-secondary mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-60"
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry safe context write
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
