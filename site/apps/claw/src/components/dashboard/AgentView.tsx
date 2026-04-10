"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Store,
  Sparkles,
  Activity,
  Layers,
  Link2,
  Gauge,
  Timer,
  Wrench,
  Check,
  Trash2,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";
import { agentAvatar } from "@/lib/avatar";
import { ConversationGraphModule } from "./ConversationsSidebar";
import { AgentFocusModule } from "./modules/AgentFocusModule";
import { GroupPermissionsModule } from "./modules/GroupPermissionsModule";
import { AgentChangelogModule } from "./modules/AgentChangelogModule";
import { DecisionLogModule } from "./modules/DecisionLogModule";
import { HandoffModule } from "./modules/HandoffModule";
import { WhatCanIDoPanel } from "./modules/WhatCanIDoPanel";
import { ConnectionRow } from "./modules/ConnectionRow";
import { CompletenessRingModule } from "./modules/CompletenessRingModule";
import { StatusCardModule } from "./modules/StatusCardModule";
import { ConfigModule } from "./modules/ConfigModule";
import { ModelCapsModule } from "./modules/ModelCapsModule";
import { ToolUsageModule } from "./modules/ToolUsageModule";
import { LimitsModule } from "./modules/LimitsModule";
import { AchievementsModule } from "./modules/AchievementsModule";
import { PermissionsModule } from "./modules/PermissionsModule";
import { ProvidersModule } from "./modules/ProvidersModule";
import { AgentUrlsModule } from "./modules/AgentUrlsModule";
import { GatewayStatusModule } from "./modules/GatewayStatusModule";
import { WorkspaceFilesModule } from "./modules/WorkspaceFilesModule";
import { QuickActionsModule } from "./modules/QuickActionsModule";
import { ToolDiscoveryModule } from "./modules/ToolDiscoveryModule";
import { AgentCardModule } from "./modules/AgentCardModule";
import { InteractionPatternsModule } from "./modules/InteractionPatternsModule";
import { ExamplePromptsModule } from "./modules/ExamplePromptsModule";
import { SessionsModule } from "./modules/SessionsModule";
import { ExecQueueModule } from "./modules/ExecQueueModule";
import { NudgesModule } from "./modules/NudgesModule";
import { ChannelsModule } from "./modules/ChannelsModule";
import { SubAgentsModule } from "./modules/SubAgentsModule";
import { ConnectionRecsModule } from "./modules/ConnectionRecsModule";
import { CapabilityDiffModule } from "./modules/CapabilityDiffModule";
import { MembersModule } from "./modules/MembersModule";
import { AgentRosterModule } from "./modules/AgentRosterModule";
import { GroupActivityFeedModule } from "./modules/GroupActivityFeedModule";
import { ThreadSummaryModule } from "./modules/ThreadSummaryModule";
import { MentionsTasksModule } from "./modules/MentionsTasksModule";
import { SharedFilesModule } from "./modules/SharedFilesModule";
import { PinnedItemsModule } from "./modules/PinnedItemsModule";
import { SharedWorkspaceModule } from "./modules/SharedWorkspaceModule";
import type { TabId, StyleVariant, ActivityType, ActivityEntry, Connection, AgentViewProps, ConnectionDetailProps } from "./agentViewTypes";
import type { ConversationThread } from "./ConversationsSidebar";
import {
  CATEGORY_ICONS, ACTIVITY_TYPE_COLORS,
  MOCK_CONNECTIONS, MOCK_SKILLS, MOCK_ACTIVITY, MOCK_STATUS,
  MOCK_CONFIG, MOCK_SESSIONS,
  MOCK_CRONS, MOCK_TOOL_CALLS,
  ONBOARDING_STEPS,
  OVERVIEW_MODULE_KEYS,
} from "./agentViewMockData";
import { relativeTime } from "./agentViewUtils";

export type { TabId, StyleVariant } from "./agentViewTypes";

function threadKindLabel(kind: "user-agent" | "agent-agent" | "group"): string {
  if (kind === "user-agent") return "direct";
  if (kind === "agent-agent") return "agent-to-agent";
  return "group";
}

// ── Component ──

export function AgentView({
  agentName = "Agent",
  onConnectionSelect,
  className,
  activeTab: controlledTab,
  onTabChange,
  showSearch: showSearchProp = true,
  showRecommended: showRecommendedProp = true,
  showMarketplace: showMarketplaceProp = true,
  connectionRowStyle = "off",
  tabBarStyle = "off",
  skillsVariant = "off",
  activityVariant = "off",
  completenessRingVariant = "off",
  quickActionsVariant = "off",
  emptyStatesVariant = "off",
  toolDiscoveryVariant = "off",
  connectionRecsVariant = "off",
  capabilityDiffVariant = "off",
  agentCardVariant = "off",
  nudgesVariant = "off",
  onboardingVariant = "off",
  whatCanIDoVariant = "off",
  modelCapsVariant = "off",
  toolUsageVariant = "off",
  interactionPatternsVariant = "off",
  examplePromptsVariant = "off",
  limitsVariant = "off",
  achievementsVariant = "off",
  permissionsVariant = "off",
  channelsVariant = "off",
  providersVariant = "off",
  execQueueVariant = "off",
  agentUrlsVariant = "off",
  gatewayStatusVariant = "off",
  workspaceFilesVariant = "off",
  membersVariant = "off",
  agentRosterVariant = "off",
  groupActivityFeedVariant = "off",
  threadSummaryVariant = "off",
  mentionsTasksVariant = "off",
  sharedFilesVariant = "off",
  pinnedItemsVariant = "off",
  sharedWorkspaceVariant = "off",
  agentFocusVariant = "off",
  groupPermissionsVariant = "off",
  agentChangelogVariant = "off",
  decisionLogVariant = "off",
  handoffVariant = "off",
  conversationGraphVariant = "off",
  conversationThreads,
  selectedConversationThreadId = null,
  showStatusCard = true,
  showConfigQuickView = true,
  showActiveSessions = true,
  showCronManager = true,
  showRecentToolCalls = true,
  showSubAgents = true,
  agentStatus: agentStatusProp,
  agentConfig: agentConfigProp,
  agentSessions: agentSessionsProp,
  agentConnections: agentConnectionsProp,
}: AgentViewProps) {
  const status = agentStatusProp ?? MOCK_STATUS;
  const config = agentConfigProp ?? MOCK_CONFIG;
  const sessions = agentSessionsProp ?? MOCK_SESSIONS;
  const connections = agentConnectionsProp ?? MOCK_CONNECTIONS;
  const isMockData = !agentConfigProp;
  const [internalTab, setInternalTab] = useState<TabId>(controlledTab ?? "overview");
  const activeTab = controlledTab ?? internalTab;

  useEffect(() => {
    if (controlledTab) setInternalTab(controlledTab);
  }, [controlledTab]);

  const handleTabChange = useCallback((tab: TabId) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  const [search, setSearch] = useState("");
  const [myConnectionsOpen, setMyConnectionsOpen] = useState(true);
  const [recommendedOpen, setRecommendedOpen] = useState(true);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [cronJobs, setCronJobs] = useState(MOCK_CRONS);
  const [activityFilter, setActivityFilter] = useState<ActivityType | "all">("all");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [whatCanIDoOpen, setWhatCanIDoOpen] = useState(false);
  const [overviewMenuOpen, setOverviewMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Contextual module visibility ──

  // Derive active conversation kind from selected thread
  const selectedThread = useMemo(
    () => conversationThreads?.find((t) => t.id === selectedConversationThreadId) ?? null,
    [conversationThreads, selectedConversationThreadId],
  );
  const activeConversationKind = selectedThread?.kind ?? null;
  const conversationHasAgent = selectedThread?.participants?.some((p) => p.type === "agent") ?? false;
  const hasAgent = !!(selectedThread && conversationHasAgent);

  // Reset to overview when no agent conversation is selected
  useEffect(() => {
    if (!hasAgent && activeTab !== "overview") {
      handleTabChange("overview");
    }
  }, [hasAgent, activeTab, handleTabChange]);

  // Unique agents across all conversation threads (for empty-state prompt)
  const availableAgents = useMemo(() => {
    if (!conversationThreads) return [];
    const seen = new Set<string>();
    const agents: { id: string; name: string }[] = [];
    for (const t of conversationThreads) {
      for (const p of t.participants) {
        if (p.type === "agent" && !seen.has(p.id)) {
          seen.add(p.id);
          agents.push({ id: p.id, name: p.name });
        }
      }
    }
    return agents;
  }, [conversationThreads]);

  // Experience tier toggle (persisted)
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("agentview_show_advanced") === "true";
  });
  useEffect(() => {
    localStorage.setItem("agentview_show_advanced", String(showAdvanced));
  }, [showAdvanced]);

  // Which modules are contextually available (tier + conversation kind)
  const availableModuleKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const mod of OVERVIEW_MODULE_KEYS) {
      if (mod.tier === "advanced" && !showAdvanced) continue;
      if (mod.contextFilter && mod.contextFilter.length > 0 && activeConversationKind) {
        if (!mod.contextFilter.includes(activeConversationKind)) continue;
      }
      keys.add(mod.key);
    }
    return keys;
  }, [showAdvanced, activeConversationKind]);

  // Manual toggle state — defaultVisible modules start shown, rest hidden
  const [hiddenModules, setHiddenModules] = useState<Set<string>>(() =>
    new Set(OVERVIEW_MODULE_KEYS.filter((m) => !m.defaultVisible).map((m) => m.key)),
  );

  // Auto-show default modules when conversation kind changes
  const prevKindRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeConversationKind === prevKindRef.current) return;
    prevKindRef.current = activeConversationKind;
    if (!activeConversationKind) return;
    setHiddenModules((prev) => {
      const next = new Set(prev);
      for (const mod of OVERVIEW_MODULE_KEYS) {
        if (!mod.defaultVisible) continue;
        // General defaults always auto-show
        if (!mod.contextFilter || mod.contextFilter.length === 0) {
          next.delete(mod.key);
          continue;
        }
        // Contextual defaults only auto-show when kind matches
        if (mod.contextFilter.includes(activeConversationKind)) {
          next.delete(mod.key);
        }
      }
      return next;
    });
  }, [activeConversationKind]);

  const toggleModule = useCallback((key: string) => {
    setHiddenModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Module is visible only if it's both available (context+tier) and not manually hidden
  const isModuleVisible = useCallback(
    (key: string) => availableModuleKeys.has(key) && !hiddenModules.has(key),
    [hiddenModules, availableModuleKeys],
  );

  const showAllModules = useCallback(() => {
    setHiddenModules((prev) => {
      const next = new Set(prev);
      for (const key of availableModuleKeys) next.delete(key);
      return next;
    });
  }, [availableModuleKeys]);

  const hideAllModules = useCallback(() => {
    setHiddenModules(new Set(OVERVIEW_MODULE_KEYS.map((m) => m.key)));
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!overviewMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOverviewMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overviewMenuOpen]);

  const filteredActivity = useMemo(
    () => activityFilter === "all" ? MOCK_ACTIVITY : MOCK_ACTIVITY.filter((a) => a.type === activityFilter),
    [activityFilter],
  );

  const activityTypes: { value: ActivityType | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "message", label: "Messages" },
    { value: "tool", label: "Tools" },
    { value: "connection", label: "Connections" },
    { value: "cron", label: "Cron" },
    { value: "error", label: "Errors" },
    { value: "system", label: "System" },
  ];

  const myConnections = useMemo(() => MOCK_CONNECTIONS.filter((c) => c.connected), []);
  const recommended = useMemo(() => MOCK_CONNECTIONS.filter((c) => !c.connected), []);

  const filteredMy = useMemo(
    () => search ? myConnections.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase())) : myConnections,
    [search, myConnections],
  );

  const filteredRecommended = useMemo(
    () => search ? recommended.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.category.toLowerCase().includes(search.toLowerCase())) : recommended,
    [search, recommended],
  );

  const handleConnectionClick = useCallback((conn: Connection) => {
    setSelectedConnection(conn.id);
    onConnectionSelect?.(conn);
  }, [onConnectionSelect]);

  const toggleCron = useCallback((id: string) => {
    setCronJobs((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  }, []);

  const removeCron = useCallback((id: string) => {
    setCronJobs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Build tabs list — conditionally include cron
  const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
    { id: "overview", label: "Overview", icon: Gauge },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "skills", label: "Skills", icon: Layers },
    { id: "connections", label: "Connections", icon: Link2 },
    ...(showCronManager ? [{ id: "cron" as TabId, label: "Cron", icon: Timer }] : []),
  ];

  // ── Tab bar styles ──
  function renderTabBar() {
    const isTabDisabled = (id: TabId) => !hasAgent && id !== "overview";

    if (tabBarStyle === "v1") {
      return (
        <div className="flex gap-1 p-2 flex-shrink-0 flex-wrap">
          {tabs.map((tab) => {
            const disabled = isTabDisabled(tab.id);
            return (
              <button key={tab.id} onClick={() => !disabled && handleTabChange(tab.id)} disabled={disabled}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${disabled ? "text-text-muted/40 cursor-not-allowed" : activeTab === tab.id ? "bg-[#38D39F]/15 text-[#38D39F]" : "text-text-muted hover:text-text-secondary hover:bg-surface-low"}`}
              >{tab.label}</button>
            );
          })}
        </div>
      );
    }
    if (tabBarStyle === "v2") {
      return (
        <div className="p-2 flex-shrink-0">
          <div className="flex bg-surface-low rounded-lg p-0.5">
            {tabs.map((tab) => {
              const disabled = isTabDisabled(tab.id);
              return (
                <button key={tab.id} onClick={() => !disabled && handleTabChange(tab.id)} disabled={disabled}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${disabled ? "text-text-muted/40 cursor-not-allowed" : activeTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-text-muted hover:text-text-secondary"}`}
                >{tab.label}</button>
              );
            })}
          </div>
        </div>
      );
    }
    if (tabBarStyle === "v3") {
      return (
        <div className="flex border-b border-border flex-shrink-0">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            const disabled = isTabDisabled(tab.id);
            return (
              <button key={tab.id} onClick={() => !disabled && handleTabChange(tab.id)} disabled={disabled}
                className={`flex-1 flex flex-col items-center gap-0.5 px-1 py-2 text-[9px] font-medium transition-colors ${disabled ? "text-text-muted/40 cursor-not-allowed" : activeTab === tab.id ? "text-[#38D39F] border-b-2 border-[#38D39F]" : "text-text-muted hover:text-text-secondary"}`}
              >
                <TabIcon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      );
    }
    // Default — underline
    return (
      <div className="flex border-b border-border flex-shrink-0">
        {tabs.map((tab) => {
          const disabled = isTabDisabled(tab.id);
          return (
            <button key={tab.id} onClick={() => !disabled && handleTabChange(tab.id)} disabled={disabled}
              className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${disabled ? "text-text-muted/40 cursor-not-allowed" : activeTab === tab.id ? "text-foreground border-b-2 border-[#38D39F]" : "text-text-muted hover:text-text-secondary"}`}
            >{tab.label}</button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-background border border-border rounded-xl overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center">
        <div className="flex-1 min-w-0">{renderTabBar()}</div>
        {activeTab === "overview" && hasAgent && (
          <div className="relative flex-shrink-0 pr-2" ref={menuRef}>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => setOverviewMenuOpen(!overviewMenuOpen)}
              className="p-1.5 rounded-md hover:bg-surface-low text-text-muted hover:text-foreground transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </motion.button>
            {overviewMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-border bg-[#1a1a1c] shadow-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Modules</span>
                  <div className="flex gap-1">
                    <button onClick={showAllModules} className="text-[10px] text-[#38D39F] hover:underline">All</button>
                    <span className="text-[10px] text-text-muted">|</span>
                    <button onClick={hideAllModules} className="text-[10px] text-text-muted hover:text-[#d05f5f]">None</button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {(["general", "single-conversation", "group-conversation"] as const).map((section) => {
                    const sectionMods = OVERVIEW_MODULE_KEYS.filter(
                      (m) => m.section === section && availableModuleKeys.has(m.key),
                    );
                    if (sectionMods.length === 0) return null;
                    return (
                      <div key={section}>
                        {sectionMods.map((mod) => (
                          <button
                            key={mod.key}
                            onClick={() => toggleModule(mod.key)}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-low transition-colors"
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${isModuleVisible(mod.key) ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                              }`}>
                              {isModuleVisible(mod.key) && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className={`text-[11px] ${isModuleVisible(mod.key) ? "text-foreground" : "text-text-muted"}`}>{mod.label}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border px-3 py-2">
                  <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-2 w-full text-left"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${showAdvanced ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                      }`}>
                      {showAdvanced && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="text-[10px] text-text-secondary">Show advanced modules</span>
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* ── Onboarding Tour Overlay ── */}
      {onboardingVariant !== "off" && !onboardingDismissed && (
        <div className="relative">
          {onboardingVariant === "v1" && (
            // v1: Top banner with step dots
            <motion.div
              initial={{ y: -40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-[#38D39F]/10 border-b border-[#38D39F]/20 px-3 py-2"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-[#38D39F]">Getting Started</span>
                <button onClick={() => setOnboardingDismissed(true)} className="text-[10px] text-text-muted hover:text-foreground">Skip</button>
              </div>
              <div className="flex items-center gap-2 mb-1">
                {(() => { const StepIcon = ONBOARDING_STEPS[onboardingStep].icon; return <StepIcon className="w-3.5 h-3.5 text-[#38D39F]" />; })()}
                <span className="text-xs text-foreground font-medium">{ONBOARDING_STEPS[onboardingStep].title}</span>
              </div>
              <p className="text-[10px] text-text-muted mb-2">{ONBOARDING_STEPS[onboardingStep].desc}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {ONBOARDING_STEPS.map((_, idx) => (
                    <motion.div key={idx} className={`w-1.5 h-1.5 rounded-full ${idx === onboardingStep ? "bg-[#38D39F]" : "bg-[#38D39F]/25"}`}
                      animate={idx === onboardingStep ? { scale: [1, 1.4, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                  ))}
                </div>
                <button onClick={() => onboardingStep < ONBOARDING_STEPS.length - 1 ? setOnboardingStep(onboardingStep + 1) : setOnboardingDismissed(true)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[#38D39F]/20 text-[#38D39F] font-medium hover:bg-[#38D39F]/30">
                  {onboardingStep < ONBOARDING_STEPS.length - 1 ? "Next" : "Done"}
                </button>
              </div>
            </motion.div>
          )}
          {onboardingVariant === "v2" && (
            // v2: Full card overlay with all steps visible
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-3">
              <div className="rounded-xl border border-[#38D39F]/25 bg-[#38D39F]/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#38D39F]">Welcome to your agent</span>
                  <button onClick={() => setOnboardingDismissed(true)} className="text-[10px] text-text-muted hover:text-foreground">Dismiss</button>
                </div>
                {ONBOARDING_STEPS.map((step, idx) => {
                  const StepIcon = step.icon;
                  return (
                    <motion.div key={idx} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}
                      className="flex items-start gap-2 py-1">
                      <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2, delay: idx * 0.3 }}>
                        <StepIcon className="w-3.5 h-3.5 text-[#38D39F] mt-0.5" />
                      </motion.div>
                      <div>
                        <div className="text-xs font-medium text-foreground">{step.title}</div>
                        <div className="text-[10px] text-text-muted">{step.desc}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
          {onboardingVariant === "v3" && (
            // v3: Floating tooltip style
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="absolute inset-x-3 top-2 z-10">
              <div className="rounded-lg bg-[#1a1a1c] border border-[#38D39F]/30 shadow-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                    <Sparkles className="w-3.5 h-3.5 text-[#38D39F]" />
                  </motion.div>
                  <span className="text-xs font-medium text-foreground">{ONBOARDING_STEPS[onboardingStep].title}</span>
                  <span className="text-[9px] text-text-muted ml-auto">{onboardingStep + 1}/{ONBOARDING_STEPS.length}</span>
                </div>
                <p className="text-[10px] text-text-muted mb-1.5">{ONBOARDING_STEPS[onboardingStep].desc}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => onboardingStep < ONBOARDING_STEPS.length - 1 ? setOnboardingStep(onboardingStep + 1) : setOnboardingDismissed(true)}
                    className="text-[10px] px-2 py-0.5 rounded bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25">
                    {onboardingStep < ONBOARDING_STEPS.length - 1 ? "Next →" : "Got it ✓"}
                  </button>
                  <button onClick={() => setOnboardingDismissed(true)} className="text-[10px] text-text-muted hover:text-foreground">Skip</button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* ── Overview tab (flex column: scroll + fixed bottom) ── */}
      {activeTab === "overview" && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          {hasAgent ? (
          <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">

            {/* ── Section: General (divider hidden) ── */}

            {/* ── Completeness Ring ── */}
            {completenessRingVariant !== "off" && isModuleVisible("completeness") && (
              <CompletenessRingModule variant={completenessRingVariant} />
            )}


            {/* Config Quick-View */}
            {showConfigQuickView && isModuleVisible("config") && (
              <ConfigModule />
            )}

            {/* ── 1. Model Capabilities ── */}
            {modelCapsVariant !== "off" && isModuleVisible("modelCaps") && (
              <ModelCapsModule variant={modelCapsVariant} />
            )}

            {/* ── 2. Tool Usage Heatmap ── */}
            {toolUsageVariant !== "off" && isModuleVisible("toolUsage") && (
              <ToolUsageModule variant={toolUsageVariant} />
            )}

            {/* ── 5. Limits & Boundaries ── */}
            {limitsVariant !== "off" && isModuleVisible("limits") && (
              <LimitsModule variant={limitsVariant} />
            )}

            {/* ── 6. Recent Achievements ── */}
            {achievementsVariant !== "off" && isModuleVisible("achievements") && (
              <AchievementsModule variant={achievementsVariant} />
            )}

            {/* ── 7. Permission Map ── */}
            {permissionsVariant !== "off" && isModuleVisible("permissions") && (
              <PermissionsModule variant={permissionsVariant} />
            )}

            {/* ── Model Providers ── */}
            {providersVariant !== "off" && isModuleVisible("providers") && (
              <ProvidersModule variant={providersVariant} />
            )}

            {/* ── Agent URLs ── */}
            {agentUrlsVariant !== "off" && isModuleVisible("agentUrls") && (
              <AgentUrlsModule variant={agentUrlsVariant} />
            )}

            {/* ── Gateway Status ── */}
            {gatewayStatusVariant !== "off" && isModuleVisible("gateway") && (
              <GatewayStatusModule variant={gatewayStatusVariant} />
            )}

            {/* ── Workspace Files ── */}
            {workspaceFilesVariant !== "off" && isModuleVisible("workspace") && (
              <WorkspaceFilesModule variant={workspaceFilesVariant} />
            )}

            {/* ── Quick Actions Bar ── */}
            {quickActionsVariant !== "off" && isModuleVisible("quickActions") && (
              <QuickActionsModule variant={quickActionsVariant} />
            )}

            {/* What Can I Do — moved to fixed bottom position */}

            {/* ── Tool Discovery Cards ── */}
            {toolDiscoveryVariant !== "off" && isModuleVisible("toolDiscovery") && (
              <ToolDiscoveryModule variant={toolDiscoveryVariant} />
            )}

            {/* ── Agent Card / Summary Sheet ── */}
            {agentCardVariant !== "off" && isModuleVisible("agentCard") && (
              <AgentCardModule variant={agentCardVariant} agentName={agentName} agentStatus={status} />
            )}

            {/* ── Section: Single Conversation (divider hidden) ── */}

            {/* ── Interaction Patterns ── */}
            {interactionPatternsVariant !== "off" && isModuleVisible("patterns") && (
              <InteractionPatternsModule variant={interactionPatternsVariant} />
            )}

            {/* ── Example Prompts by Capability ── */}
            {examplePromptsVariant !== "off" && isModuleVisible("prompts") && (
              <ExamplePromptsModule variant={examplePromptsVariant} />
            )}

            {/* ── Active Sessions ── */}
            {showActiveSessions && isModuleVisible("sessions") && (
              <SessionsModule />
            )}

            {/* ── Execution Approval Queue ── */}
            {execQueueVariant !== "off" && isModuleVisible("execQueue") && (
              <ExecQueueModule variant={execQueueVariant} />
            )}

            {/* ── Proactive Nudges ── */}
            {nudgesVariant !== "off" && isModuleVisible("nudges") && (
              <NudgesModule variant={nudgesVariant} />
            )}

            {/* ── Section: Group Conversation (divider hidden) ── */}

            {/* ── Channels (Telegram/Slack/Discord) ── */}
            {channelsVariant !== "off" && isModuleVisible("channels") && (
              <ChannelsModule variant={channelsVariant} />
            )}

            {/* ── Sub-agents ── */}
            {showSubAgents && isModuleVisible("subAgents") && (
              <SubAgentsModule variant="v1" />
            )}

            {/* ── Connection Recommendations ── */}
            {connectionRecsVariant !== "off" && isModuleVisible("connectionRecs") && (
              <ConnectionRecsModule variant={connectionRecsVariant} />
            )}

            {/* ── Capability Diff ── */}
            {capabilityDiffVariant !== "off" && isModuleVisible("capDiff") && (
              <CapabilityDiffModule variant={capabilityDiffVariant} />
            )}

            {/* ── Team & Presence (divider hidden) ── */}

            {/* ── Members ── */}
            {membersVariant !== "off" && isModuleVisible("members") && (
              <MembersModule variant={membersVariant} />
            )}

            {/* ── Agent Roster ── */}
            {agentRosterVariant !== "off" && isModuleVisible("agentRoster") && (
              <AgentRosterModule variant={agentRosterVariant} />
            )}

            {/* ── Activity & Awareness (divider hidden) ── */}

            {/* ── Activity Feed ── */}
            {groupActivityFeedVariant !== "off" && isModuleVisible("groupActivityFeed") && (
              <GroupActivityFeedModule variant={groupActivityFeedVariant} />
            )}

            {/* ── Thread Summary ── */}
            {threadSummaryVariant !== "off" && isModuleVisible("threadSummary") && (
              <ThreadSummaryModule variant={threadSummaryVariant} />
            )}

            {/* ── Mentions & Tasks ── */}
            {mentionsTasksVariant !== "off" && isModuleVisible("mentionsTasks") && (
              <MentionsTasksModule variant={mentionsTasksVariant} />
            )}

            {/* ── Shared Work (divider hidden) ── */}

            {/* ── Shared Files ── */}
            {sharedFilesVariant !== "off" && isModuleVisible("sharedFiles") && (
              <SharedFilesModule variant={sharedFilesVariant} />
            )}

            {/* ── Pinned Items ── */}
            {pinnedItemsVariant !== "off" && isModuleVisible("pinnedItems") && (
              <PinnedItemsModule variant={pinnedItemsVariant} />
            )}

            {/* ── Workspace ── */}
            {sharedWorkspaceVariant !== "off" && isModuleVisible("sharedWorkspace") && (
              <SharedWorkspaceModule variant={sharedWorkspaceVariant} />
            )}

            {/* ── Agent Context & Control (divider hidden) ── */}

            {/* ── Agent Focus ── */}
            {agentFocusVariant !== "off" && isModuleVisible("agentFocus") && (
              <AgentFocusModule variant={agentFocusVariant} />
            )}

            {/* ── Group Permissions ── */}
            {groupPermissionsVariant !== "off" && isModuleVisible("groupPermissions") && (
              <GroupPermissionsModule variant={groupPermissionsVariant} />
            )}

            {/* ── Agent Changelog ── */}
            {agentChangelogVariant !== "off" && isModuleVisible("agentChangelog") && (
              <AgentChangelogModule variant={agentChangelogVariant} />
            )}

            {/* ── Coordination (divider hidden) ── */}

            {/* ── Decision Log ── */}
            {decisionLogVariant !== "off" && isModuleVisible("decisionLog") && (
              <DecisionLogModule variant={decisionLogVariant} />
            )}

            {/* ── Handoff ── */}
            {handoffVariant !== "off" && isModuleVisible("handoff") && (
              <HandoffModule variant={handoffVariant} />
            )}

            {/* ── Conversation Graph ── */}
            {conversationGraphVariant !== "off" && isModuleVisible("conversationGraph") && conversationThreads && (
              <div className="relative rounded-lg border border-border overflow-hidden">
                <span className="absolute top-1.5 right-1.5 text-[8px] font-bold tracking-wider text-text-muted/40 bg-surface-low px-1.5 py-0.5 rounded uppercase z-10">mock</span>
                <ConversationGraphModule
                  threads={conversationThreads}
                  selectedThreadId={selectedConversationThreadId}
                  variant={conversationGraphVariant}
                />
              </div>
            )}

          </div>

          {/* ── What Can I Do — slide-up panel + fixed bottom trigger ── */}
          {whatCanIDoVariant !== "off" && isModuleVisible("whatCanIDo") && (
            <WhatCanIDoPanel open={whatCanIDoOpen} onToggle={() => setWhatCanIDoOpen((v) => !v)} />
          )}
          </>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="flex-1 flex flex-col items-center justify-center p-5 gap-4"
            >
              {/* Animated icon */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
              >
                <motion.div
                  animate={{ rotate: [0, 8, -8, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="w-12 h-12 rounded-2xl bg-[#38D39F]/10 flex items-center justify-center relative"
                >
                  <motion.div
                    className="absolute inset-0 rounded-2xl bg-[#38D39F]/5"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <Sparkles className="w-6 h-6 text-[#38D39F] relative z-10" />
                </motion.div>
              </motion.div>

              {/* Text */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
                className="text-center space-y-1"
              >
                <p className="text-sm font-medium text-foreground">No agent selected</p>
                <p className="text-[11px] text-text-muted leading-relaxed max-w-[200px]">
                  Select an agent or create a new one to get started
                </p>
              </motion.div>

              {/* Agent list */}
              {availableAgents.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.35 }}
                  className="w-full space-y-1.5"
                >
                  <p className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider text-center">Available agents</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {availableAgents.map((agent, idx) => {
                      const av = agentAvatar(agent.name);
                      const AvIcon = av.icon;
                      const targetThread = conversationThreads?.find((t) =>
                        t.participants.some((p) => p.id === agent.id),
                      );
                      return (
                        <motion.button
                          key={agent.id}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25, delay: 0.4 + idx * 0.06 }}
                          whileHover={{ x: 4, backgroundColor: "rgba(255,255,255,0.04)" }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => {
                            if (targetThread) onTabChange?.("overview");
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors text-left"
                        >
                          <motion.div
                            whileHover={{ scale: 1.1, rotate: 5 }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: av.bgColor }}
                          >
                            <AvIcon className="w-3.5 h-3.5" style={{ color: av.fgColor }} />
                          </motion.div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium text-foreground truncate">{agent.name}</div>
                            <div className="text-[9px] text-text-muted">
                              {targetThread ? threadKindLabel(targetThread.kind) : "agent"}
                            </div>
                          </div>
                          <motion.div animate={{ x: [0, 3, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 1 + idx * 0.2 }}>
                            <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
                          </motion.div>
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

            </motion.div>
          )}
        </div>
      )}

      {/* ── Activity tab ── */}
      {activeTab === "activity" && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-1">
            {/* Filter chips */}
            <div className="flex flex-wrap gap-1 pb-2">
              {activityTypes.map((t) => (
                <motion.button
                  key={t.value}
                  onClick={() => setActivityFilter(t.value)}
                  whileTap={{ scale: 0.92 }}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${activityFilter === t.value
                      ? "bg-[#38D39F]/15 text-[#38D39F]"
                      : "bg-surface-low text-text-muted hover:text-text-secondary"
                    }`}
                >
                  {t.label}
                </motion.button>
              ))}
            </div>

            {/* Recent Tool Calls */}
            {showRecentToolCalls && activityFilter === "all" && (
              <>
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-1 py-1.5">Recent Tool Calls</div>
                {MOCK_TOOL_CALLS.map((tc, i) => (
                  <motion.div
                    key={tc.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.04 }}
                    className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-low transition-colors"
                  >
                    <motion.div
                      animate={!tc.result ? { rotate: [0, 180, 360] } : {}}
                      transition={!tc.result ? { repeat: Infinity, duration: 2, ease: "linear" } : {}}
                    >
                      <Wrench className="w-3.5 h-3.5 text-[#f0c56c] mt-0.5 shrink-0" />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-foreground">{tc.name}</span>
                        {tc.result ? (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                            <Check className="w-3 h-3 text-[#38D39F]" />
                          </motion.div>
                        ) : (
                          <motion.span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-[#f0c56c]"
                            animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
                            transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut" }}
                          />
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5 truncate font-mono">
                        {tc.args.length > 60 ? tc.args.slice(0, 60) + "..." : tc.args}
                      </div>
                      {tc.result && (
                        <div className="text-[10px] text-text-secondary mt-0.5 truncate">{tc.result}</div>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted whitespace-nowrap mt-0.5">{relativeTime(tc.timestamp)}</span>
                  </motion.div>
                ))}
                <div className="border-t border-border my-2" />
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-1 py-1.5">Activity Log</div>
              </>
            )}

            {/* Activity entries with variants */}
            {filteredActivity.map((entry, i) => {
              const EntryIcon = entry.icon;
              const color = ACTIVITY_TYPE_COLORS[entry.type];

              if (activityVariant === "v1") {
                // Compact timeline — left color bar + icon
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30, delay: i * 0.04 }}
                    className="flex items-start gap-2 pl-2 border-l-2 border-border hover:border-[#38D39F]/50 transition-colors py-1.5"
                  >
                    <motion.div
                      animate={entry.type === "error" ? { x: [-1, 1, -1, 0] } : {}}
                      transition={entry.type === "error" ? { repeat: Infinity, duration: 0.4, repeatDelay: 3 } : {}}
                    >
                      <EntryIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${color}`} />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-foreground">{entry.action}</span>
                      <span className="text-[10px] text-text-muted ml-1.5">{entry.detail}</span>
                    </div>
                    <span className="text-[10px] text-text-muted whitespace-nowrap">{relativeTime(entry.timestamp)}</span>
                  </motion.div>
                );
              }

              if (activityVariant === "v2") {
                // Card style — bordered cards with type badge
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25, delay: i * 0.05 }}
                    className="rounded-lg border border-border px-3 py-2 hover:bg-surface-low/50 transition-colors mb-1"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <motion.div
                          className={`w-6 h-6 rounded-md flex items-center justify-center ${entry.type === "error" ? "bg-[#d05f5f]/15" :
                              entry.type === "tool" || entry.type === "cron" ? "bg-[#f0c56c]/15" :
                                entry.type === "connection" ? "bg-[#4285f4]/15" :
                                  "bg-[#38D39F]/15"
                            }`}
                          animate={entry.type === "error" ? { scale: [1, 1.1, 1] } : {}}
                          transition={entry.type === "error" ? { repeat: Infinity, duration: 2, ease: "easeInOut" } : {}}
                        >
                          <EntryIcon className={`w-3 h-3 ${color}`} />
                        </motion.div>
                        <span className="text-xs font-medium text-foreground">{entry.action}</span>
                      </div>
                      <span className="text-[10px] text-text-muted">{relativeTime(entry.timestamp)}</span>
                    </div>
                    <div className="text-[10px] text-text-muted pl-[30px]">{entry.detail}</div>
                  </motion.div>
                );
              }

              if (activityVariant === "v3") {
                // Minimal — just icon + one-liner, hover expands detail
                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: i * 0.03 }}
                    className="group flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-low transition-colors"
                  >
                    <motion.div
                      whileHover={{ scale: 1.2, rotate: 10 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <EntryIcon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
                    </motion.div>
                    <span className="text-xs text-foreground flex-1 truncate">
                      {entry.action}
                      <span className="text-text-muted ml-1 hidden group-hover:inline"> — {entry.detail}</span>
                    </span>
                    <span className="text-[9px] text-text-muted font-mono">{relativeTime(entry.timestamp)}</span>
                  </motion.div>
                );
              }

              // Default — standard rows with type icons + motion
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut", delay: i * 0.04 }}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-low transition-colors"
                >
                  <motion.div
                    whileHover={{ scale: 1.15 }}
                    animate={entry.type === "error" ? { x: [-1, 1, -1, 0] } : entry.type === "cron" ? { rotate: [0, 15, -15, 0] } : {}}
                    transition={entry.type === "error" ? { repeat: Infinity, duration: 0.3, repeatDelay: 4 } : entry.type === "cron" ? { repeat: Infinity, duration: 1.5, repeatDelay: 3 } : {}}
                  >
                    <EntryIcon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground">{entry.action}</div>
                    <div className="text-xs text-text-muted mt-0.5">{entry.detail}</div>
                  </div>
                  <span className="text-[10px] text-text-muted whitespace-nowrap mt-0.5">{relativeTime(entry.timestamp)}</span>
                </motion.div>
              );
            })}

            {filteredActivity.length === 0 && (
              <div className="text-center py-6 text-text-muted text-xs">No activity matching this filter</div>
            )}
          </div>
        </div>


      )}

      {/* ── Skills tab ── */}
      {activeTab === "skills" && (
        <div className="p-3 space-y-1.5">
          {MOCK_SKILLS.map((skill, i) => {
            const SkillIcon = skill.icon;

            if (skillsVariant === "v1") {
              // Grid cards — 2-col icon-centric cards
              return (
                <motion.div
                  key={skill.id}
                  initial={{ opacity: 0, scale: 0.88 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 460, damping: 22, delay: i * 0.06 }}
                  className={`rounded-xl border p-3 transition-colors cursor-pointer ${skill.enabled
                      ? "border-[#38D39F]/25 bg-[#38D39F]/5 hover:bg-[#38D39F]/10"
                      : "border-border hover:bg-surface-low"
                    }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <motion.div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${skill.enabled ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"
                        }`}
                      animate={skill.enabled ? { scale: [1, 1.08, 1] } : {}}
                      transition={skill.enabled ? { repeat: Infinity, duration: 2.8, ease: "easeInOut", delay: i * 0.4 } : {}}
                    >
                      <SkillIcon className="w-4.5 h-4.5" />
                    </motion.div>
                    {skill.enabled && (
                      <motion.span
                        className="inline-block w-2 h-2 rounded-full bg-[#38D39F]"
                        animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
                        transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut", delay: i * 0.2 }}
                      />
                    )}
                  </div>
                  <div className="text-sm font-medium text-foreground">{skill.name}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{skill.description}</div>
                </motion.div>
              );
            }

            if (skillsVariant === "v2") {
              // Chip/pill — horizontal chips with toggle
              return (
                <motion.div
                  key={skill.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28, delay: i * 0.05 }}
                  whileHover={{ x: 4 }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-full border transition-colors ${skill.enabled
                      ? "border-[#38D39F]/25 bg-[#38D39F]/5"
                      : "border-border hover:bg-surface-low"
                    }`}
                >
                  <motion.div
                    animate={skill.enabled ? { rotate: [0, 5, -5, 0] } : {}}
                    transition={skill.enabled ? { repeat: Infinity, duration: 3, ease: "easeInOut", delay: i * 0.5 } : {}}
                  >
                    <SkillIcon className={`w-4 h-4 shrink-0 ${skill.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                  </motion.div>
                  <span className="text-xs font-medium text-foreground flex-1">{skill.name}</span>
                  {skill.enabled && (
                    <motion.span
                      className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/15 text-[#38D39F] font-medium"
                      animate={{ opacity: [0.7, 1, 0.7] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    >
                      active
                    </motion.span>
                  )}
                  <div className={`w-7 h-[16px] rounded-full flex items-center px-0.5 transition-colors cursor-pointer ${skill.enabled ? "bg-[#38D39F] justify-end" : "bg-[#303030] justify-start"}`}>
                    <motion.div className="w-3 h-3 rounded-full bg-white shadow-sm" layout transition={{ type: "spring", stiffness: 500, damping: 30 }} />
                  </div>
                </motion.div>
              );
            }

            if (skillsVariant === "v3") {
              // Minimal list — icon left, description on hover only
              return (
                <motion.div
                  key={skill.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: i * 0.04 }}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-low transition-colors"
                >
                  <motion.div
                    whileHover={{ scale: 1.2, rotate: 10 }}
                    transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  >
                    <SkillIcon className={`w-3.5 h-3.5 shrink-0 ${skill.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                  </motion.div>
                  <span className="text-xs text-foreground flex-1">
                    {skill.name}
                    <span className="text-text-muted ml-1 hidden group-hover:inline text-[10px]"> — {skill.description}</span>
                  </span>
                  {skill.enabled && (
                    <motion.span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                      animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut", delay: i * 0.15 }}
                    />
                  )}
                </motion.div>
              );
            }

            // Default (off) — current icon + pulsing dot style
            return (
              <motion.div
                key={skill.id}
                initial={{ opacity: 0, x: -28 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: i * 0.06 }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-low transition-colors"
              >
                <motion.div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${skill.enabled ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"
                    }`}
                  animate={skill.enabled ? { scale: [1, 1.12, 1] } : {}}
                  transition={skill.enabled ? { repeat: Infinity, duration: 2.4, ease: "easeInOut", delay: i * 0.3 } : {}}
                >
                  <SkillIcon className="w-4 h-4" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{skill.name}</span>
                    {skill.enabled && (
                      <motion.span
                        className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                        animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
                        transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut", delay: i * 0.2 }}
                      />
                    )}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">{skill.description}</div>
                </div>
                <div className={`w-8 h-[18px] rounded-full flex items-center px-0.5 transition-colors cursor-pointer ${skill.enabled ? "bg-[#38D39F] justify-end" : "bg-[#303030] justify-start"}`}>
                  <motion.div
                    className="w-3.5 h-3.5 rounded-full bg-white shadow-sm"
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Connections tab ── */}
      {activeTab === "connections" && (
        <div className="flex flex-col h-full">
          {showSearchProp && (
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search connections..."
                  className="w-full pl-9 pr-3 py-2 bg-surface-low border border-border rounded-lg text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-[#38D39F]/50" />
              </div>
            </div>
          )}
          <div className="px-3">
            <button onClick={() => setMyConnectionsOpen(!myConnectionsOpen)}
              className="flex items-center gap-1.5 w-full py-2 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:text-foreground transition-colors">
              {myConnectionsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              My Connections <span className="text-text-muted font-normal normal-case">({filteredMy.length})</span>
            </button>
            {myConnectionsOpen && (
              <div className="space-y-0.5 pb-2">
                {filteredMy.map((conn) => (
                  <ConnectionRow key={conn.id} connection={conn} selected={selectedConnection === conn.id} onClick={() => handleConnectionClick(conn)} variant={connectionRowStyle} />
                ))}
                <button className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#38D39F] hover:bg-[#38D39F]/8 rounded-lg transition-colors">
                  <Plus className="w-4 h-4" /> More Connections
                </button>
              </div>
            )}
          </div>
          {showRecommendedProp && (
            <div className="px-3">
              <button onClick={() => setRecommendedOpen(!recommendedOpen)}
                className="flex items-center gap-1.5 w-full py-2 text-xs font-semibold text-text-secondary uppercase tracking-wider hover:text-foreground transition-colors">
                {recommendedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Recommended
              </button>
              {recommendedOpen && (
                <div className="space-y-0.5 pb-2">
                  {filteredRecommended.map((conn) => (
                    <ConnectionRow key={conn.id} connection={conn} selected={selectedConnection === conn.id} onClick={() => handleConnectionClick(conn)} variant={connectionRowStyle} />
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex-1" />
          {showMarketplaceProp && (
            <div className="p-3 border-t border-border">
              <button className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface-low hover:bg-surface-high border border-border rounded-lg text-sm font-medium text-foreground transition-colors">
                <Store className="w-4 h-4" /> Marketplace
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Cron tab ── */}
      {activeTab === "cron" && showCronManager && (
        <div className="p-3 space-y-1">
          {cronJobs.length === 0 && (
            <div className="text-center py-8 text-text-muted">
              {emptyStatesVariant === "v1" ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                    <Timer className="w-8 h-8 mx-auto text-[#38D39F]/50" />
                  </motion.div>
                  <p className="text-sm text-foreground">Schedule your first task</p>
                  <p className="text-[10px] text-text-muted">Try: &quot;Summarize my emails every morning&quot;</p>
                  <motion.button whileTap={{ scale: 0.95 }} className="text-[10px] px-3 py-1 rounded-full bg-[#38D39F]/10 text-[#38D39F] hover:bg-[#38D39F]/20">
                    Create a cron job
                  </motion.button>
                </motion.div>
              ) : emptyStatesVariant === "v2" ? (
                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  className="rounded-xl border border-dashed border-[#38D39F]/30 p-4 space-y-2">
                  <Timer className="w-6 h-6 mx-auto text-[#38D39F]" />
                  <p className="text-xs text-foreground font-medium">No scheduled tasks yet</p>
                  <p className="text-[10px] text-text-muted">Automate your agent to work while you&apos;re away</p>
                </motion.div>
              ) : emptyStatesVariant === "v3" ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-2 py-4">
                  <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                    animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />
                  <span className="text-[10px] text-text-muted">No cron jobs — <span className="text-[#38D39F] cursor-pointer hover:underline">add one</span></span>
                </motion.div>
              ) : (
                <>
                  <Timer className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">No scheduled tasks</p>
                </>
              )}
            </div>
          )}
          {cronJobs.map((cron) => (
            <div key={cron.id} className="rounded-lg border border-border px-3 py-2.5 space-y-1.5 hover:bg-surface-low/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#38D39F] bg-[#38D39F]/10 px-1.5 py-0.5 rounded">{cron.schedule}</span>
                  <span className="text-xs font-medium text-foreground">{cron.description}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleCron(cron.id)}
                    className={`w-7 h-[16px] rounded-full flex items-center px-0.5 transition-colors cursor-pointer ${cron.enabled ? "bg-[#38D39F] justify-end" : "bg-[#303030] justify-start"}`}
                  >
                    <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
                  </button>
                  <button onClick={() => removeCron(cron.id)} className="text-text-muted hover:text-[#d05f5f] transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-text-muted truncate">{cron.prompt}</div>
              <div className="flex gap-3 text-[10px] text-text-muted">
                {cron.lastRun && <span>Last: {relativeTime(cron.lastRun)}</span>}
                {cron.nextRun && cron.enabled && <span>Next: {relativeTime(cron.nextRun)}</span>}
              </div>
            </div>
          ))}
          <button className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#38D39F] hover:bg-[#38D39F]/8 rounded-lg transition-colors mt-2">
            <Plus className="w-4 h-4" /> Add Cron Job
          </button>
        </div>
      )}
    </div>
  );
}

// ── Connection detail pane ──



export function ConnectionDetail({ connection, onClose }: ConnectionDetailProps) {
  if (!connection) return null;
  const Icon = connection.icon;
  const CatIcon = CATEGORY_ICONS[connection.category];

  return (
    <div className="flex flex-col h-full bg-background border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${connection.connected ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{connection.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            {CatIcon && <CatIcon className="w-3 h-3 text-text-muted" />}
            <span className="text-xs text-text-muted">{connection.category}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-foreground transition-colors text-xs">Close</button>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <p className="text-sm text-text-secondary">{connection.description}</p>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connection.connected ? "bg-[#38D39F]" : "bg-text-muted"}`} />
          <span className="text-xs text-text-secondary">{connection.connected ? "Connected" : "Not connected"}</span>
        </div>
        <button className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${connection.connected ? "bg-[#d05f5f]/10 border border-[#d05f5f]/25 text-[#d05f5f] hover:bg-[#d05f5f]/20" : "bg-[#38D39F]/10 border border-[#38D39F]/25 text-[#38D39F] hover:bg-[#38D39F]/20"}`}>
          {connection.connected ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}
