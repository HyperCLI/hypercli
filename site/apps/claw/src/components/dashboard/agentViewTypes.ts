import type { LucideIcon } from "lucide-react";
import type { ConversationThread } from "./AgentsChannelsSidebar";

// ── Core types ──

export type TabId = "overview" | "activity" | "connections" | "cron";
export type StyleVariant = "off" | "v1" | "v2" | "v3";
export type ActivityType = "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";
export type ModuleTier = "basic" | "advanced";

// ── Data interfaces ──

export interface Connection {
  id: string;
  name: string;
  icon: LucideIcon;
  category: string;
  connected: boolean;
  description: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: LucideIcon;
}

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  action: string;
  detail: string;
  timestamp: number;
  icon: LucideIcon;
}

export interface AgentStatus {
  state: "RUNNING" | "STOPPED" | "STARTING" | "STOPPING";
  uptime: number;
  cpu: number;
  memory: { used: number; total: number };
  version?: string;
}

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  tools: { name: string; enabled: boolean }[];
}

export interface AgentSession {
  key: string;
  clientMode: string;
  clientDisplayName: string;
  createdAt: number;
  lastMessageAt: number;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  description: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

export interface SubAgent {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface RecentToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  timestamp: number;
}

export interface ModuleDefinition {
  key: string;
  label: string;
  section: "general" | "single-conversation" | "group-conversation";
  /** Which conversation kinds this module is relevant to. Empty/undefined = always available. */
  contextFilter?: ConversationThread["kind"][];
  tier: ModuleTier;
  /** Show by default when context matches (auto-unhide on conversation switch). */
  defaultVisible?: boolean;
}

// ── Component props ──

export interface AgentViewProps {
  agentName?: string;
  onConnectionSelect?: (connection: Connection) => void;
  className?: string;
  activeTab?: TabId;
  onTabChange?: (tab: TabId) => void;
  showSearch?: boolean;
  showRecommended?: boolean;
  showMarketplace?: boolean;
  connectionRowStyle?: StyleVariant;
  tabBarStyle?: StyleVariant;
  showStatusCard?: boolean;
  showConfigQuickView?: boolean;
  showActiveSessions?: boolean;
  showCronManager?: boolean;
  showRecentToolCalls?: boolean;
  showSubAgents?: boolean;
  skillsVariant?: StyleVariant;
  activityVariant?: StyleVariant;
  completenessRingVariant?: StyleVariant;
  quickActionsVariant?: StyleVariant;
  emptyStatesVariant?: StyleVariant;
  toolDiscoveryVariant?: StyleVariant;
  connectionRecsVariant?: StyleVariant;
  capabilityDiffVariant?: StyleVariant;
  agentCardVariant?: StyleVariant;
  nudgesVariant?: StyleVariant;
  onboardingVariant?: StyleVariant;
  whatCanIDoVariant?: StyleVariant;
  modelCapsVariant?: StyleVariant;
  toolUsageVariant?: StyleVariant;
  interactionPatternsVariant?: StyleVariant;
  examplePromptsVariant?: StyleVariant;
  limitsVariant?: StyleVariant;
  achievementsVariant?: StyleVariant;
  permissionsVariant?: StyleVariant;
  channelsVariant?: StyleVariant;
  providersVariant?: StyleVariant;
  execQueueVariant?: StyleVariant;
  agentUrlsVariant?: StyleVariant;
  gatewayStatusVariant?: StyleVariant;
  workspaceFilesVariant?: StyleVariant;
  membersVariant?: StyleVariant;
  agentRosterVariant?: StyleVariant;
  groupActivityFeedVariant?: StyleVariant;
  threadSummaryVariant?: StyleVariant;
  mentionsTasksVariant?: StyleVariant;
  sharedFilesVariant?: StyleVariant;
  pinnedItemsVariant?: StyleVariant;
  sharedWorkspaceVariant?: StyleVariant;
  agentFocusVariant?: StyleVariant;
  groupPermissionsVariant?: StyleVariant;
  agentChangelogVariant?: StyleVariant;
  decisionLogVariant?: StyleVariant;
  handoffVariant?: StyleVariant;
  conversationGraphVariant?: StyleVariant;
  conversationThreads?: ConversationThread[];
  selectedConversationThreadId?: string | null;
  agentStatus?: AgentStatus | null;
  agentConfig?: AgentConfig | null;
  agentSessions?: AgentSession[] | null;
  agentConnections?: Connection[] | null;
  activityEntries?: ActivityEntry[] | null;
  recentToolCalls?: RecentToolCall[] | null;
  agentCronJobs?: CronJob[] | null;
  agentWorkspaceFiles?: Array<{ name: string; type: "file" | "directory"; size: number }> | null;
  /** Insert a suggested prompt into the chat input. Wired to ExamplePromptsModule + WhatCanIDoPanel. */
  onPromptClick?: (prompt: string) => void;
  /** Delete a cron job. */
  onCronRemove?: (jobId: string) => void;
  /** Open the "create cron" dialog. */
  onCronAdd?: () => void;
  /** Open the integrations Directory modal (Connections tab CTA). */
  onMarketplaceClick?: () => void;
  /** Start the agent (AgentCardModule). */
  onAgentStart?: () => void;
  /** Stop the agent (AgentCardModule). */
  onAgentStop?: () => void;
  /** Loading flag for start. */
  agentStarting?: boolean;
  /** Loading flag for stop. */
  agentStopping?: boolean;
  /** When true, the start button is disabled (e.g. tier capacity exhausted). */
  agentStartBlocked?: boolean;
  /** Tooltip text for the disabled-start state. */
  agentStartBlockedReason?: string;
  /** Open the full file browser drawer (Workspace Files module CTA). */
  onOpenFiles?: () => void;
}

export interface ConnectionDetailProps {
  connection: Connection | null;
  onClose: () => void;
}
