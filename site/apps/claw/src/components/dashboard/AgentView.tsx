"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Store,
  MessageSquare,
  Brain,
  Mail,
  Calendar,
  FileText,
  GitBranch,
  CheckSquare,
  Users,
  Code,
  HardDrive,
  Zap,
  Clock,
  Sparkles,
  Activity,
  Layers,
  Link2,
  Gauge,
  Timer,
  Bot,
  Monitor,
  Terminal,
  Wrench,
  Check,
  Trash2,
  Cpu,
  Globe,
  Play,
  FolderOpen,
  BarChart3,
  Image,
  AlertTriangle,
  Settings,
  Send,
  Eye,
  Shield,
  Trophy,
  Lightbulb,
  Network,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";

// ── Types ──

export type TabId = "overview" | "activity" | "skills" | "connections" | "cron";
export type StyleVariant = "off" | "v1" | "v2" | "v3";

interface Connection {
  id: string;
  name: string;
  icon: LucideIcon;
  category: string;
  connected: boolean;
  description: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: LucideIcon;
}

type ActivityType = "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";

interface ActivityEntry {
  id: string;
  type: ActivityType;
  action: string;
  detail: string;
  timestamp: number;
  icon: LucideIcon;
}

interface AgentStatus {
  state: "RUNNING" | "STOPPED" | "STARTING" | "STOPPING";
  uptime: number;
  cpu: number;
  memory: { used: number; total: number };
  version?: string;
}

interface AgentConfig {
  model: string;
  systemPrompt: string;
  tools: { name: string; enabled: boolean }[];
}

interface AgentSession {
  key: string;
  clientMode: string;
  clientDisplayName: string;
  createdAt: number;
  lastMessageAt: number;
}

interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  description: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
}

interface SubAgent {
  id: string;
  name: string;
  description: string;
  status: string;
}

interface RecentToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  timestamp: number;
}

// ── Category icons ──

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "Communication": MessageSquare,
  "Models": Brain,
  "Calendar & Scheduling": Calendar,
  "Documents & Knowledge": FileText,
  "Productivity / Workspace Suite": Sparkles,
  "Task / Project Management": CheckSquare,
  "CRM / Customer Systems": Users,
  "Dev / Technical Tools": Code,
  "File Storage": HardDrive,
  "Automation & Webhooks": Zap,
};

const SESSION_ICONS: Record<string, LucideIcon> = {
  browser: Monitor,
  cli: Terminal,
  telegram: MessageSquare,
  api: Code,
};

// ── Mock data ──

const MOCK_CONNECTIONS: Connection[] = [
  { id: "telegram", name: "Telegram", icon: MessageSquare, category: "Communication", connected: true, description: "Send and receive messages via Telegram bot" },
  { id: "opus", name: "Model: Opus 4.6", icon: Brain, category: "Models", connected: true, description: "Claude Opus 4.6 language model" },
  { id: "gmail", name: "Gmail", icon: Mail, category: "Communication", connected: true, description: "Read, send, and manage emails" },
  { id: "gcal", name: "Google Calendar", icon: Calendar, category: "Calendar & Scheduling", connected: true, description: "Manage events and scheduling" },
  { id: "crm", name: "CRM", icon: Users, category: "CRM / Customer Systems", connected: false, description: "Customer relationship management" },
  { id: "github", name: "GitHub", icon: GitBranch, category: "Dev / Technical Tools", connected: false, description: "Repositories, issues, and pull requests" },
  { id: "asana", name: "Asana", icon: CheckSquare, category: "Task / Project Management", connected: false, description: "Task and project tracking" },
  { id: "slack", name: "Slack", icon: MessageSquare, category: "Communication", connected: false, description: "Team messaging and channels" },
  { id: "gdrive", name: "Google Drive", icon: HardDrive, category: "File Storage", connected: false, description: "Cloud file storage and sharing" },
  { id: "notion", name: "Notion", icon: FileText, category: "Documents & Knowledge", connected: false, description: "Wiki, docs, and knowledge base" },
  { id: "zapier", name: "Zapier", icon: Zap, category: "Automation & Webhooks", connected: false, description: "Workflow automation and integrations" },
  { id: "linear", name: "Linear", icon: CheckSquare, category: "Task / Project Management", connected: false, description: "Issue tracking for engineering teams" },
];

const MOCK_SKILLS: Skill[] = [
  { id: "web-search", name: "Web Search", description: "Search the internet for information", enabled: true, icon: Globe },
  { id: "code-exec", name: "Code Execution", description: "Run code in a sandboxed environment", enabled: true, icon: Play },
  { id: "file-ops", name: "File Operations", description: "Read, write, and manage files", enabled: true, icon: FolderOpen },
  { id: "data-analysis", name: "Data Analysis", description: "Analyze datasets and generate insights", enabled: false, icon: BarChart3 },
  { id: "image-gen", name: "Image Generation", description: "Create images from text prompts", enabled: false, icon: Image },
];

const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  message: "text-[#38D39F]",
  tool: "text-[#f0c56c]",
  connection: "text-[#4285f4]",
  skill: "text-[#38D39F]",
  cron: "text-[#f0c56c]",
  error: "text-[#d05f5f]",
  system: "text-text-muted",
};

const MOCK_ACTIVITY: ActivityEntry[] = [
  { id: "1", type: "message", action: "Message sent", detail: "Replied to user query about deployment", timestamp: Date.now() - 120000, icon: Send },
  { id: "2", type: "tool", action: "Tool call", detail: "Executed file_read on /src/config.ts", timestamp: Date.now() - 300000, icon: Wrench },
  { id: "3", type: "connection", action: "Connection used", detail: "Fetched emails via Gmail", timestamp: Date.now() - 600000, icon: Link2 },
  { id: "4", type: "skill", action: "Skill invoked", detail: "Ran web search for API docs", timestamp: Date.now() - 900000, icon: Globe },
  { id: "5", type: "cron", action: "Cron executed", detail: "Morning briefing completed", timestamp: Date.now() - 1200000, icon: Timer },
  { id: "6", type: "error", action: "Error", detail: "WebSocket connection dropped (code 1006)", timestamp: Date.now() - 1500000, icon: AlertTriangle },
  { id: "7", type: "system", action: "Config updated", detail: "Model changed to claude-opus-4-6", timestamp: Date.now() - 1800000, icon: Settings },
  { id: "8", type: "message", action: "Message sent", detail: "Summarized meeting notes", timestamp: Date.now() - 2400000, icon: Send },
];

const MOCK_STATUS: AgentStatus = {
  state: "RUNNING",
  uptime: 14400,
  cpu: 23,
  memory: { used: 536870912, total: 2147483648 },
  version: "0.4.2",
};

const MOCK_CONFIG: AgentConfig = {
  model: "claude-opus-4-6",
  systemPrompt: "You are a helpful AI assistant specializing in software engineering. You have access to tools for file operations, web search, code execution, and more. Always be concise and accurate.",
  tools: [
    { name: "file_read", enabled: true },
    { name: "file_write", enabled: true },
    { name: "web_search", enabled: true },
    { name: "code_exec", enabled: true },
    { name: "bash", enabled: true },
    { name: "image_gen", enabled: false },
    { name: "data_analysis", enabled: false },
  ],
};

const MOCK_SESSIONS: AgentSession[] = [
  { key: "sess_1", clientMode: "browser", clientDisplayName: "Dashboard", createdAt: Date.now() - 3600000, lastMessageAt: Date.now() - 120000 },
  { key: "sess_2", clientMode: "cli", clientDisplayName: "hyper-cli v2.1", createdAt: Date.now() - 7200000, lastMessageAt: Date.now() - 600000 },
  { key: "sess_3", clientMode: "telegram", clientDisplayName: "@user_bot", createdAt: Date.now() - 86400000, lastMessageAt: Date.now() - 1800000 },
];

const MOCK_CRONS: CronJob[] = [
  { id: "cron_1", schedule: "0 9 * * *", prompt: "Summarize overnight emails and create a morning briefing", description: "Morning briefing", enabled: true, lastRun: Date.now() - 43200000, nextRun: Date.now() + 43200000 },
  { id: "cron_2", schedule: "*/30 * * * *", prompt: "Check deployment health and report any issues", description: "Health check", enabled: true, lastRun: Date.now() - 900000, nextRun: Date.now() + 900000 },
  { id: "cron_3", schedule: "0 17 * * 5", prompt: "Generate a weekly progress report from completed tasks", description: "Weekly report", enabled: false, lastRun: Date.now() - 604800000 },
];

const MOCK_SUB_AGENTS: SubAgent[] = [
  { id: "sub_1", name: "research-agent", description: "Handles web research and data gathering", status: "RUNNING" },
  { id: "sub_2", name: "code-reviewer", description: "Reviews pull requests and suggests improvements", status: "STOPPED" },
];

const MOCK_TOOL_CALLS: RecentToolCall[] = [
  { id: "tc_1", name: "file_read", args: '{"path": "/src/gateway-client.ts"}', result: "async connect() { ... }", timestamp: Date.now() - 60000 },
  { id: "tc_2", name: "bash", args: '{"command": "npm run typecheck"}', result: "No errors found.", timestamp: Date.now() - 180000 },
  { id: "tc_3", name: "web_search", args: '{"query": "WebSocket reconnection best practices"}', result: "Found 5 results...", timestamp: Date.now() - 300000 },
  { id: "tc_4", name: "file_write", args: '{"path": "/src/hooks/useGatewayChat.ts"}', result: "File updated.", timestamp: Date.now() - 450000 },
  { id: "tc_5", name: "bash", args: '{"command": "git diff --stat"}', timestamp: Date.now() - 600000 },
];

// ── Capability completeness data ──

const CAPABILITY_SEGMENTS = [
  { label: "Model", complete: true, icon: Brain },
  { label: "System prompt", complete: true, icon: FileText },
  { label: "Tools", complete: true, icon: Wrench },
  { label: "Connection", complete: true, icon: Link2 },
  { label: "Cron", complete: true, icon: Timer },
  { label: "Files", complete: false, icon: FolderOpen },
  { label: "Integrations", complete: false, icon: Zap },
  { label: "Monitoring", complete: false, icon: Activity },
];

const QUICK_ACTIONS = [
  { label: "Search the web", prompt: "Search the web for...", icon: Globe },
  { label: "Read a file", prompt: "Read the file at...", icon: FolderOpen },
  { label: "Run code", prompt: "Run this code:", icon: Play },
  { label: "Check calendar", prompt: "What's on my calendar today?", icon: Calendar },
  { label: "Summarize emails", prompt: "Summarize my recent emails", icon: Mail },
];

const ONBOARDING_STEPS = [
  { title: "Agent Status", desc: "Monitor your agent's health, CPU, and memory in real time", icon: Gauge },
  { title: "Configuration", desc: "See and tweak your agent's model, tools, and system prompt", icon: Settings },
  { title: "Chat", desc: "Talk to your agent — it can use tools, search, and execute code", icon: MessageSquare },
  { title: "Connections", desc: "Link external services like Telegram, Gmail, and GitHub", icon: Link2 },
];

const MOCK_NUDGES = [
  { id: "n1", text: "Schedule a daily task to keep your agent working while you're away", action: "Set up cron", icon: Timer },
  { id: "n2", text: "Connect Telegram to let your agent message you proactively", action: "Add connection", icon: MessageSquare },
  { id: "n3", text: "Your agent has web_search — try asking it to look something up", action: "Try it", icon: Globe },
];

const MOCK_TOOL_DISCOVERIES = [
  { id: "td1", tool: "web_search", message: "Your agent just used web_search for the first time!", timestamp: Date.now() - 60000 },
  { id: "td2", tool: "bash", message: "Your agent executed a shell command", timestamp: Date.now() - 300000 },
];

const MOCK_CAPABILITY_DIFFS = [
  { id: "cd1", action: "enabled", capability: "web_search", message: "Agent can now search the web", timestamp: Date.now() - 120000 },
  { id: "cd2", action: "connected", capability: "Gmail", message: "Agent can now read and send emails", timestamp: Date.now() - 600000 },
];

// ── Model capabilities ──

const MODEL_CAPABILITIES = [
  { label: "Vision", enabled: true, icon: Eye, desc: "Analyze images and screenshots" },
  { label: "Extended Thinking", enabled: true, icon: Brain, desc: "Multi-step reasoning chains" },
  { label: "Code", enabled: true, icon: Code, desc: "Write, review, and debug code" },
  { label: "Tool Use", enabled: true, icon: Wrench, desc: "Call external tools and APIs" },
  { label: "200k Context", enabled: true, icon: FileText, desc: "Process large documents" },
  { label: "Multilingual", enabled: true, icon: Globe, desc: "Communicate in 50+ languages" },
];

const TOOL_USAGE_STATS = [
  { name: "bash", calls: 42, icon: Terminal },
  { name: "file_read", calls: 67, icon: FolderOpen },
  { name: "file_write", calls: 23, icon: FileText },
  { name: "web_search", calls: 18, icon: Globe },
  { name: "code_exec", calls: 31, icon: Play },
];

const INTERACTION_PATTERNS = [
  { label: "Code review", pct: 34, color: "#38D39F" },
  { label: "Email triage", pct: 28, color: "#4285f4" },
  { label: "Research", pct: 22, color: "#f0c56c" },
  { label: "File ops", pct: 16, color: "#d05f5f" },
];

const EXAMPLE_PROMPTS_BY_CAPABILITY: { capability: string; icon: LucideIcon; prompts: string[] }[] = [
  { capability: "Gmail", icon: Mail, prompts: ["Summarize unread emails from this morning", "Draft a reply to the latest from Sarah"] },
  { capability: "Web Search", icon: Globe, prompts: ["Find the latest Next.js 16 changelog", "Research WebSocket reconnection patterns"] },
  { capability: "Bash", icon: Terminal, prompts: ["Run the test suite and report failures", "Check disk usage on the server"] },
  { capability: "File Ops", icon: FolderOpen, prompts: ["Read the gateway-client.ts and explain the connect flow", "List all TypeScript files in src/"] },
  { capability: "Calendar", icon: Calendar, prompts: ["What meetings do I have tomorrow?", "Block 2 hours for deep work on Friday"] },
];

const AGENT_LIMITS = [
  { label: "Context window", value: "200k tokens", icon: FileText },
  { label: "CPU", value: "2 cores", icon: Cpu },
  { label: "Memory", value: "2 GB", icon: Gauge },
  { label: "Connections", value: "4 active", icon: Link2 },
  { label: "Cron jobs", value: "10 max", icon: Timer },
  { label: "File storage", value: "5 GB", icon: HardDrive },
];

const RECENT_ACHIEVEMENTS = [
  { label: "Messages processed", value: 142, icon: MessageSquare },
  { label: "Tool calls", value: 38, icon: Wrench },
  { label: "Services connected", value: 4, icon: Link2 },
  { label: "Cron runs", value: 12, icon: Timer },
  { label: "Files touched", value: 27, icon: FolderOpen },
];

const PERMISSION_MAP = [
  { scope: "File system", access: "read/write", level: "full", icon: FolderOpen },
  { scope: "Shell", access: "execute", level: "full", icon: Terminal },
  { scope: "Network", access: "outbound", level: "filtered", icon: Network },
  { scope: "Connections", access: "read/write", level: "authorized", icon: Link2 },
  { scope: "Cron", access: "manage", level: "full", icon: Timer },
  { scope: "Config", access: "read/patch", level: "self", icon: Settings },
];

// ── SDK-derived mock data ──

const MOCK_CHANNELS = [
  { id: "telegram", name: "Telegram", status: "connected", account: "@mybot", icon: MessageSquare },
  { id: "slack", name: "Slack", status: "disconnected", account: null, icon: MessageSquare },
  { id: "discord", name: "Discord", status: "disconnected", account: null, icon: MessageSquare },
];

const MOCK_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", models: ["claude-opus-4-6", "claude-sonnet-4-6"], defaultModel: "claude-opus-4-6" },
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini"], defaultModel: null },
];

const MOCK_EXEC_QUEUE = [
  { id: "exec_1", command: "rm -rf /tmp/cache/*", requestedAt: Date.now() - 30000 },
  { id: "exec_2", command: "npm install --save axios", requestedAt: Date.now() - 15000 },
];

const MOCK_AGENT_URLS = [
  { label: "Public URL", url: "https://agent-abc.hypercli.com", icon: Globe },
  { label: "Desktop", url: "https://agent-abc.hypercli.com/desktop", icon: Monitor },
  { label: "Shell", url: "wss://agent-abc.hypercli.com/shell", icon: Terminal },
];

const MOCK_GATEWAY_STATUS = {
  connected: true,
  protocol: 3,
  version: "0.4.2",
  uptime: 14200,
  pendingMessages: 0,
  activeStreams: 1,
};

const MOCK_WORKSPACE_FILES = [
  { name: "openclaw.yaml", type: "file" as const, size: 2048 },
  { name: "system-prompt.md", type: "file" as const, size: 4096 },
  { name: "knowledge/", type: "directory" as const, size: 0 },
  { name: "tools/", type: "directory" as const, size: 0 },
];

const OVERVIEW_MODULE_KEYS = [
  { key: "status", label: "Status Card" },
  { key: "config", label: "Config" },
  { key: "modelCaps", label: "Model Capabilities" },
  { key: "toolUsage", label: "Tool Usage" },
  { key: "patterns", label: "Interaction Patterns" },
  { key: "prompts", label: "Example Prompts" },
  { key: "limits", label: "Limits" },
  { key: "achievements", label: "Achievements" },
  { key: "permissions", label: "Permissions" },
  { key: "channels", label: "Channels" },
  { key: "providers", label: "Providers" },
  { key: "execQueue", label: "Exec Approval" },
  { key: "agentUrls", label: "Endpoints" },
  { key: "gateway", label: "Gateway Status" },
  { key: "workspace", label: "Workspace Files" },
  { key: "sessions", label: "Sessions" },
  { key: "subAgents", label: "Sub-agents" },
  { key: "completeness", label: "Completeness" },
  { key: "quickActions", label: "Quick Actions" },
  { key: "whatCanIDo", label: "What Can I Do?" },
  { key: "toolDiscovery", label: "Tool Discovery" },
  { key: "connectionRecs", label: "Connection Recs" },
  { key: "capDiff", label: "Capability Diff" },
  { key: "nudges", label: "Nudges" },
  { key: "agentCard", label: "Agent Card" },
];

// ── Helpers ──

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ── Component ──

interface AgentViewProps {
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
  skillsVariant?: StyleVariant;
  activityVariant?: StyleVariant;
  // UX discovery features
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
  showStatusCard?: boolean;
  showConfigQuickView?: boolean;
  showActiveSessions?: boolean;
  showCronManager?: boolean;
  showRecentToolCalls?: boolean;
  showSubAgents?: boolean;
  agentStatus?: AgentStatus | null;
}

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
  showStatusCard = true,
  showConfigQuickView = true,
  showActiveSessions = true,
  showCronManager = true,
  showRecentToolCalls = true,
  showSubAgents = true,
  agentStatus: agentStatusProp,
}: AgentViewProps) {
  const status = agentStatusProp ?? MOCK_STATUS;
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
  const [subAgentsOpen, setSubAgentsOpen] = useState(true);
  const [cronJobs, setCronJobs] = useState(MOCK_CRONS);
  const [configTools, setConfigTools] = useState(MOCK_CONFIG.tools);
  const [activityFilter, setActivityFilter] = useState<ActivityType | "all">("all");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
  const [dismissedDiscoveries, setDismissedDiscoveries] = useState<Set<string>>(new Set());
  const [showAgentCard, setShowAgentCard] = useState(false);
  const [overviewMenuOpen, setOverviewMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Internal module visibility (allows user to hide sections from the overview menu)
  const [hiddenModules, setHiddenModules] = useState<Set<string>>(() => new Set(OVERVIEW_MODULE_KEYS.map((m) => m.key)));

  const toggleModule = useCallback((key: string) => {
    setHiddenModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isModuleVisible = useCallback((key: string) => !hiddenModules.has(key), [hiddenModules]);

  const showAllModules = useCallback(() => setHiddenModules(new Set()), []);
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

  const toggleTool = useCallback((name: string) => {
    setConfigTools((prev) => prev.map((t) => t.name === name ? { ...t, enabled: !t.enabled } : t));
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
    if (tabBarStyle === "v1") {
      return (
        <div className="flex gap-1 p-2 flex-shrink-0 flex-wrap">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => handleTabChange(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${activeTab === tab.id ? "bg-[#38D39F]/15 text-[#38D39F]" : "text-text-muted hover:text-text-secondary hover:bg-surface-low"}`}
            >{tab.label}</button>
          ))}
        </div>
      );
    }
    if (tabBarStyle === "v2") {
      return (
        <div className="p-2 flex-shrink-0">
          <div className="flex bg-surface-low rounded-lg p-0.5">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => handleTabChange(tab.id)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${activeTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-text-muted hover:text-text-secondary"}`}
              >{tab.label}</button>
            ))}
          </div>
        </div>
      );
    }
    if (tabBarStyle === "v3") {
      return (
        <div className="flex border-b border-border flex-shrink-0">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button key={tab.id} onClick={() => handleTabChange(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 px-1 py-2 text-[9px] font-medium transition-colors ${activeTab === tab.id ? "text-[#38D39F] border-b-2 border-[#38D39F]" : "text-text-muted hover:text-text-secondary"}`}
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
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => handleTabChange(tab.id)}
            className={`flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors ${activeTab === tab.id ? "text-foreground border-b-2 border-[#38D39F]" : "text-text-muted hover:text-text-secondary"}`}
          >{tab.label}</button>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-background border border-border rounded-xl overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center">
        <div className="flex-1 min-w-0">{renderTabBar()}</div>
        {activeTab === "overview" && (
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
                  {OVERVIEW_MODULE_KEYS.map((mod) => (
                    <button
                      key={mod.key}
                      onClick={() => toggleModule(mod.key)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-surface-low transition-colors"
                    >
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                        isModuleVisible(mod.key) ? "bg-[#38D39F] border-[#38D39F]" : "border-text-muted"
                      }`}>
                        {isModuleVisible(mod.key) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className={`text-[11px] ${isModuleVisible(mod.key) ? "text-foreground" : "text-text-muted"}`}>{mod.label}</span>
                    </button>
                  ))}
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

      <div className="flex-1 overflow-y-auto">

        {/* ── Overview tab ── */}
        {activeTab === "overview" && (
          <div className="p-3 space-y-3">

            {/* ── Completeness Ring ── */}
            {completenessRingVariant !== "off" && isModuleVisible("completeness") && (() => {
              const complete = CAPABILITY_SEGMENTS.filter((s) => s.complete).length;
              const total = CAPABILITY_SEGMENTS.length;
              const pct = (complete / total) * 100;

              if (completenessRingVariant === "v1") {
                // v1: Circular ring with segments
                return (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0">
                        <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                          <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2" className="text-surface-high" />
                          <motion.circle cx="18" cy="18" r="15.9" fill="none" stroke="#38D39F" strokeWidth="2.5" strokeLinecap="round"
                            strokeDasharray="100" initial={{ strokeDashoffset: 100 }} animate={{ strokeDashoffset: 100 - pct }}
                            transition={{ duration: 1.2, ease: "easeOut" }} />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-foreground">{complete}/{total}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground mb-1">Agent Readiness</div>
                        <div className="flex flex-wrap gap-1">
                          {CAPABILITY_SEGMENTS.map((seg, idx) => {
                            const SegIcon = seg.icon;
                            return (
                              <motion.div key={idx} whileHover={{ scale: 1.15 }} title={seg.label}
                                className={`w-5 h-5 rounded flex items-center justify-center ${seg.complete ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                                <SegIcon className="w-3 h-3" />
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              }
              if (completenessRingVariant === "v2") {
                // v2: Horizontal progress bar with labels
                return (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">Readiness</span>
                      <span className="text-[10px] font-mono text-[#38D39F]">{complete}/{total}</span>
                    </div>
                    <div className="h-2 bg-surface-high rounded-full overflow-hidden">
                      <motion.div className="h-full bg-[#38D39F] rounded-full" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }} />
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {CAPABILITY_SEGMENTS.map((seg, idx) => {
                        const SegIcon = seg.icon;
                        return (
                          <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
                            className={`flex flex-col items-center gap-0.5 py-1 rounded text-center ${seg.complete ? "text-[#38D39F]" : "text-text-muted"}`}>
                            <SegIcon className="w-3 h-3" />
                            <span className="text-[8px] leading-tight">{seg.label}</span>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              }
              // v3: Checklist style
              return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-border p-3 space-y-1.5">
                  <div className="text-xs font-medium text-foreground mb-1">Setup Checklist — {complete}/{total}</div>
                  {CAPABILITY_SEGMENTS.map((seg, idx) => {
                    const SegIcon = seg.icon;
                    return (
                      <motion.div key={idx} initial={{ x: -12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.04 }}
                        className="flex items-center gap-2 py-0.5">
                        <motion.div animate={seg.complete ? {} : { opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 2 }}>
                          {seg.complete ? <Check className="w-3 h-3 text-[#38D39F]" /> : <div className="w-3 h-3 rounded-full border border-text-muted" />}
                        </motion.div>
                        <SegIcon className={`w-3 h-3 ${seg.complete ? "text-[#38D39F]" : "text-text-muted"}`} />
                        <span className={`text-[11px] ${seg.complete ? "text-foreground" : "text-text-muted"}`}>{seg.label}</span>
                      </motion.div>
                    );
                  })}
                </motion.div>
              );
            })()}

            {/* Status Card */}
            {showStatusCard && isModuleVisible("status") && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="rounded-lg border border-border bg-surface-low p-3 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                    >
                      <Bot className="w-4 h-4 text-[#38D39F]" />
                    </motion.div>
                    <span className="text-sm font-medium text-foreground">{agentName}</span>
                  </div>
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 20, delay: 0.15 }}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      status.state === "RUNNING" ? "bg-[#38D39F]/15 text-[#38D39F]"
                      : status.state === "STOPPED" ? "bg-[#d05f5f]/15 text-[#d05f5f]"
                      : "bg-[#f0c56c]/15 text-[#f0c56c]"
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <motion.span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          status.state === "RUNNING" ? "bg-[#38D39F]" : status.state === "STOPPED" ? "bg-[#d05f5f]" : "bg-[#f0c56c]"
                        }`}
                        animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.6, 1, 0.6] }}
                        transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                      />
                      {status.state}
                    </span>
                  </motion.span>
                </div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-center gap-4 text-[10px] text-text-muted"
                >
                  <span className="flex items-center gap-1">
                    <motion.div animate={{ rotate: [0, 360] }} transition={{ repeat: Infinity, duration: 8, ease: "linear" }}>
                      <Clock className="w-3 h-3" />
                    </motion.div>
                    {formatUptime(status.uptime)}
                  </span>
                  {status.version && <span>v{status.version}</span>}
                </motion.div>

                {/* CPU gauge */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted flex items-center gap-1">
                      <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}>
                        <Cpu className="w-3 h-3" />
                      </motion.div>
                      CPU
                    </span>
                    <span className="text-foreground font-mono">{status.cpu}%</span>
                  </div>
                  <div className="h-1.5 bg-background rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[#38D39F] rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${status.cpu}%` }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
                    />
                  </div>
                </div>

                {/* Memory gauge */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-text-muted">Memory</span>
                    <span className="text-foreground font-mono">{formatBytes(status.memory.used)} / {formatBytes(status.memory.total)}</span>
                  </div>
                  <div className="h-1.5 bg-background rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[#38D39F] rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(status.memory.used / status.memory.total) * 100}%` }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.45 }}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {/* Config Quick-View */}
            {showConfigQuickView && isModuleVisible("config") && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.08 }}
                className="rounded-lg border border-border p-3 space-y-2.5"
              >
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Config</div>

                <motion.div
                  className="flex items-center gap-2"
                  initial={{ x: -12, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                >
                  <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
                    <Brain className="w-3.5 h-3.5 text-[#38D39F]" />
                  </motion.div>
                  <span className="text-xs font-mono text-foreground">{MOCK_CONFIG.model}</span>
                </motion.div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                  <div className="text-[10px] text-text-muted mb-1">System prompt</div>
                  <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">
                    {MOCK_CONFIG.systemPrompt}
                  </p>
                </motion.div>

                <div>
                  <div className="text-[10px] text-text-muted mb-1.5">Tools</div>
                  <div className="flex flex-wrap gap-1">
                    {configTools.map((tool, idx) => (
                      <motion.button
                        key={tool.name}
                        onClick={() => toggleTool(tool.name)}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.25 + idx * 0.04, type: "spring", stiffness: 500, damping: 25 }}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                          tool.enabled
                            ? "bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25"
                            : "bg-surface-high text-text-muted hover:text-text-secondary"
                        }`}
                      >
                        {tool.name}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── 1. Model Capabilities ── */}
            {modelCapsVariant !== "off" && isModuleVisible("modelCaps") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.12 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ repeat: Infinity, duration: 4 }}>
                    <Sparkles className="w-3.5 h-3.5 text-[#38D39F]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Model Capabilities</span>
                </div>
                {modelCapsVariant === "v1" ? (
                  // v1: Grid of capability badges
                  <div className="grid grid-cols-2 gap-1.5">
                    {MODEL_CAPABILITIES.map((cap, idx) => {
                      const CapIcon = cap.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.15 + idx * 0.05, type: "spring", stiffness: 460, damping: 22 }}
                          whileHover={{ y: -2 }}
                          className={`rounded-lg p-2 border ${cap.enabled ? "border-[#38D39F]/20 bg-[#38D39F]/5" : "border-border"}`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <motion.div animate={cap.enabled ? { scale: [1, 1.1, 1] } : {}} transition={{ repeat: Infinity, duration: 3, delay: idx * 0.4 }}>
                              <CapIcon className={`w-3 h-3 ${cap.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                            </motion.div>
                            <span className="text-[10px] font-medium text-foreground">{cap.label}</span>
                          </div>
                          <p className="text-[9px] text-text-muted leading-tight">{cap.desc}</p>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : modelCapsVariant === "v2" ? (
                  // v2: Horizontal chip row
                  <div className="flex flex-wrap gap-1">
                    {MODEL_CAPABILITIES.map((cap, idx) => {
                      const CapIcon = cap.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.12 + idx * 0.04 }} whileHover={{ scale: 1.05 }}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${cap.enabled ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                          <CapIcon className="w-3 h-3" />
                          {cap.label}
                          {cap.enabled && <motion.span className="w-1 h-1 rounded-full bg-[#38D39F]"
                            animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: idx * 0.15 }} />}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  // v3: Compact list
                  <div className="space-y-0.5">
                    {MODEL_CAPABILITIES.map((cap, idx) => {
                      const CapIcon = cap.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                          className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                          <CapIcon className={`w-3 h-3 ${cap.enabled ? "text-[#38D39F]" : "text-text-muted"}`} />
                          <span className="text-[10px] text-foreground">{cap.label}</span>
                          <span className="text-[9px] text-text-muted hidden group-hover:inline ml-auto">{cap.desc}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── 2. Tool Usage Heatmap ── */}
            {toolUsageVariant !== "off" && isModuleVisible("toolUsage") && (() => {
              const maxCalls = Math.max(...TOOL_USAGE_STATS.map((t) => t.calls));
              return (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.14 }}
                  className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Tool Usage</div>
                  {toolUsageVariant === "v1" ? (
                    // v1: Horizontal bars
                    <div className="space-y-2">
                      {TOOL_USAGE_STATS.map((tool, idx) => {
                        const ToolIcon = tool.icon;
                        return (
                          <motion.div key={tool.name} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.06 }}>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className="flex items-center gap-1.5 text-foreground">
                                <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ repeat: Infinity, duration: 4, delay: idx * 0.6 }}>
                                  <ToolIcon className="w-3 h-3 text-[#38D39F]" />
                                </motion.div>
                                <span className="font-mono">{tool.name}</span>
                              </span>
                              <span className="text-text-muted font-mono">{tool.calls}</span>
                            </div>
                            <div className="h-1.5 bg-background rounded-full overflow-hidden">
                              <motion.div className="h-full bg-[#38D39F] rounded-full" initial={{ width: 0 }}
                                animate={{ width: `${(tool.calls / maxCalls) * 100}%` }}
                                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + idx * 0.08 }} />
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : toolUsageVariant === "v2" ? (
                    // v2: Mini vertical bar chart
                    <div className="flex items-end gap-2 h-16 px-1">
                      {TOOL_USAGE_STATS.map((tool, idx) => {
                        const ToolIcon = tool.icon;
                        const h = (tool.calls / maxCalls) * 100;
                        return (
                          <motion.div key={tool.name} className="flex-1 flex flex-col items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.08 }}>
                            <span className="text-[9px] font-mono text-text-muted">{tool.calls}</span>
                            <motion.div className="w-full rounded-t bg-[#38D39F] min-h-[2px]" initial={{ height: 0 }} animate={{ height: `${h}%` }}
                              transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 + idx * 0.08 }} />
                            <motion.div whileHover={{ scale: 1.2 }}><ToolIcon className="w-3 h-3 text-text-muted" /></motion.div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    // v3: Inline counts
                    <div className="flex flex-wrap gap-1.5">
                      {TOOL_USAGE_STATS.map((tool, idx) => {
                        const ToolIcon = tool.icon;
                        return (
                          <motion.div key={tool.name} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: idx * 0.04, type: "spring" }} whileHover={{ scale: 1.06 }}
                            className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-low text-[10px]">
                            <ToolIcon className="w-3 h-3 text-[#38D39F]" />
                            <span className="font-mono text-foreground">{tool.name}</span>
                            <span className="font-mono text-[#38D39F] font-medium">{tool.calls}</span>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              );
            })()}

            {/* ── 3. Interaction Patterns ── */}
            {interactionPatternsVariant !== "off" && isModuleVisible("patterns") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.16 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">What your agent does</div>
                {interactionPatternsVariant === "v1" ? (
                  // v1: Stacked progress bars
                  <div className="space-y-2">
                    {INTERACTION_PATTERNS.map((pat, idx) => (
                      <motion.div key={pat.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.06 }}>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="text-foreground">{pat.label}</span>
                          <span className="font-mono" style={{ color: pat.color }}>{pat.pct}%</span>
                        </div>
                        <div className="h-1.5 bg-background rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full" style={{ backgroundColor: pat.color }} initial={{ width: 0 }}
                            animate={{ width: `${pat.pct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + idx * 0.08 }} />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : interactionPatternsVariant === "v2" ? (
                  // v2: Donut-style segmented ring
                  <div className="flex items-center gap-3">
                    <div className="relative w-16 h-16 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                        {INTERACTION_PATTERNS.reduce<{ offset: number; elements: React.ReactNode[] }>((acc, pat, idx) => {
                          const el = (
                            <motion.circle key={idx} cx="18" cy="18" r="15.9" fill="none" stroke={pat.color} strokeWidth="3"
                              strokeDasharray={`${pat.pct} ${100 - pat.pct}`} strokeDashoffset={-acc.offset}
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 + idx * 0.15 }} />
                          );
                          return { offset: acc.offset + pat.pct, elements: [...acc.elements, el] };
                        }, { offset: 0, elements: [] }).elements}
                      </svg>
                    </div>
                    <div className="flex-1 space-y-1">
                      {INTERACTION_PATTERNS.map((pat, idx) => (
                        <motion.div key={idx} initial={{ x: -8, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 + idx * 0.06 }}
                          className="flex items-center gap-1.5 text-[10px]">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pat.color }} />
                          <span className="text-foreground">{pat.label}</span>
                          <span className="text-text-muted ml-auto font-mono">{pat.pct}%</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ) : (
                  // v3: Horizontal stacked bar
                  <div>
                    <div className="flex h-3 rounded-full overflow-hidden mb-2">
                      {INTERACTION_PATTERNS.map((pat, idx) => (
                        <motion.div key={idx} style={{ backgroundColor: pat.color }} initial={{ width: 0 }}
                          animate={{ width: `${pat.pct}%` }} transition={{ duration: 0.5, ease: "easeOut", delay: 0.15 + idx * 0.1 }}
                          className="h-full first:rounded-l-full last:rounded-r-full" />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {INTERACTION_PATTERNS.map((pat) => (
                        <span key={pat.label} className="flex items-center gap-1 text-[9px] text-text-muted">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pat.color }} />{pat.label} {pat.pct}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── 4. Example Prompts by Capability ── */}
            {examplePromptsVariant !== "off" && isModuleVisible("prompts") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.18 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                    <Lightbulb className="w-3.5 h-3.5 text-[#f0c56c]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Try These</span>
                </div>
                {examplePromptsVariant === "v1" ? (
                  // v1: Grouped by capability
                  <div className="space-y-2.5">
                    {EXAMPLE_PROMPTS_BY_CAPABILITY.slice(0, 3).map((group, gIdx) => {
                      const GIcon = group.icon;
                      return (
                        <motion.div key={gIdx} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + gIdx * 0.08 }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <GIcon className="w-3 h-3 text-[#38D39F]" />
                            <span className="text-[10px] font-medium text-foreground">{group.capability}</span>
                          </div>
                          {group.prompts.map((p, pIdx) => (
                            <motion.button key={pIdx} whileHover={{ x: 3 }} whileTap={{ scale: 0.97 }}
                              className="block w-full text-left text-[10px] text-text-muted hover:text-foreground pl-5 py-0.5 transition-colors">
                              &quot;{p}&quot;
                            </motion.button>
                          ))}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : examplePromptsVariant === "v2" ? (
                  // v2: Flat card list, one prompt each
                  <div className="space-y-1">
                    {EXAMPLE_PROMPTS_BY_CAPABILITY.map((group, idx) => {
                      const GIcon = group.icon;
                      return (
                        <motion.button key={idx} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.12 + idx * 0.05 }}
                          whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border hover:border-[#38D39F]/25 hover:bg-[#38D39F]/5 transition-colors text-left">
                          <div className="w-6 h-6 rounded-md bg-[#38D39F]/10 flex items-center justify-center shrink-0">
                            <GIcon className="w-3 h-3 text-[#38D39F]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-foreground font-medium">{group.capability}</div>
                            <div className="text-[9px] text-text-muted truncate">&quot;{group.prompts[0]}&quot;</div>
                          </div>
                          <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
                        </motion.button>
                      );
                    })}
                  </div>
                ) : (
                  // v3: Random prompt carousel (just show 3 random prompts)
                  <div className="space-y-1">
                    {EXAMPLE_PROMPTS_BY_CAPABILITY.slice(0, 3).map((group, idx) => (
                      <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-low transition-colors">
                        <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#f0c56c]"
                          animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: idx * 0.2 }} />
                        <span className="text-[10px] text-text-muted">&quot;{group.prompts[0]}&quot;</span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── 5. Limits & Boundaries ── */}
            {limitsVariant !== "off" && isModuleVisible("limits") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.2 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Limits</div>
                {limitsVariant === "v1" ? (
                  // v1: 2-col grid with icons
                  <div className="grid grid-cols-2 gap-1.5">
                    {AGENT_LIMITS.map((lim, idx) => {
                      const LimIcon = lim.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.15 + idx * 0.04, type: "spring" }}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-low">
                          <LimIcon className="w-3 h-3 text-text-muted shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[9px] text-text-muted">{lim.label}</div>
                            <div className="text-[10px] text-foreground font-mono font-medium">{lim.value}</div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : limitsVariant === "v2" ? (
                  // v2: Single row chips
                  <div className="flex flex-wrap gap-1">
                    {AGENT_LIMITS.map((lim, idx) => (
                      <motion.span key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}
                        className="text-[9px] px-2 py-0.5 rounded-full bg-surface-low text-text-muted font-mono">
                        {lim.label}: <span className="text-foreground">{lim.value}</span>
                      </motion.span>
                    ))}
                  </div>
                ) : (
                  // v3: Compact vertical list
                  <div className="space-y-0.5">
                    {AGENT_LIMITS.map((lim, idx) => {
                      const LimIcon = lim.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                          className="flex items-center justify-between px-1.5 py-0.5 text-[10px]">
                          <span className="flex items-center gap-1.5 text-text-muted"><LimIcon className="w-3 h-3" />{lim.label}</span>
                          <span className="font-mono text-foreground">{lim.value}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── 6. Recent Achievements ── */}
            {achievementsVariant !== "off" && isModuleVisible("achievements") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.22 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
                    <Trophy className="w-3.5 h-3.5 text-[#f0c56c]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">This Week</span>
                </div>
                {achievementsVariant === "v1" ? (
                  // v1: Stats grid with animated counters
                  <div className="grid grid-cols-3 gap-1.5">
                    {RECENT_ACHIEVEMENTS.slice(0, 6).map((ach, idx) => {
                      const AchIcon = ach.icon;
                      return (
                        <motion.div key={idx} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: 0.15 + idx * 0.06, type: "spring", stiffness: 500, damping: 22 }}
                          className="flex flex-col items-center py-2 rounded-lg bg-surface-low">
                          <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 3, delay: idx * 0.5 }}>
                            <AchIcon className="w-4 h-4 text-[#38D39F] mb-1" />
                          </motion.div>
                          <motion.span className="text-sm font-bold text-foreground"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + idx * 0.08 }}>
                            {ach.value}
                          </motion.span>
                          <span className="text-[8px] text-text-muted text-center leading-tight mt-0.5">{ach.label}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : achievementsVariant === "v2" ? (
                  // v2: Horizontal scroll numbers
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {RECENT_ACHIEVEMENTS.map((ach, idx) => {
                      const AchIcon = ach.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.06 }}
                          className="flex items-center gap-1.5 shrink-0">
                          <AchIcon className="w-3 h-3 text-[#38D39F]" />
                          <span className="text-xs font-bold text-foreground">{ach.value}</span>
                          <span className="text-[9px] text-text-muted">{ach.label}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  // v3: Single line summary
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                    {RECENT_ACHIEVEMENTS.map((ach, idx) => (
                      <span key={idx} className="text-text-muted">
                        <span className="text-foreground font-bold">{ach.value}</span> {ach.label}
                        {idx < RECENT_ACHIEVEMENTS.length - 1 && <span className="ml-2">·</span>}
                      </span>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── 7. Permission Map ── */}
            {permissionsVariant !== "off" && isModuleVisible("permissions") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.24 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.5 }}>
                    <Shield className="w-3.5 h-3.5 text-[#38D39F]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Permissions</span>
                </div>
                {permissionsVariant === "v1" ? (
                  // v1: Table-style rows
                  <div className="space-y-0.5">
                    <div className="grid grid-cols-3 gap-1 text-[9px] text-text-muted uppercase px-1.5 pb-1 border-b border-border">
                      <span>Scope</span><span>Access</span><span>Level</span>
                    </div>
                    {PERMISSION_MAP.map((perm, idx) => {
                      const PermIcon = perm.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + idx * 0.04 }}
                          className="grid grid-cols-3 gap-1 text-[10px] px-1.5 py-1 rounded hover:bg-surface-low transition-colors items-center">
                          <span className="flex items-center gap-1 text-foreground"><PermIcon className="w-3 h-3 text-text-muted" />{perm.scope}</span>
                          <span className="text-text-muted font-mono">{perm.access}</span>
                          <span className={`font-mono ${perm.level === "full" ? "text-[#38D39F]" : perm.level === "filtered" ? "text-[#f0c56c]" : "text-text-secondary"}`}>
                            {perm.level}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : permissionsVariant === "v2" ? (
                  // v2: Icon badges with level colors
                  <div className="flex flex-wrap gap-1.5">
                    {PERMISSION_MAP.map((perm, idx) => {
                      const PermIcon = perm.icon;
                      const levelColor = perm.level === "full" ? "border-[#38D39F]/25 bg-[#38D39F]/5" : perm.level === "filtered" ? "border-[#f0c56c]/25 bg-[#f0c56c]/5" : "border-border";
                      return (
                        <motion.div key={idx} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          transition={{ delay: idx * 0.05, type: "spring" }} whileHover={{ scale: 1.05 }}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${levelColor}`} title={`${perm.scope}: ${perm.access} (${perm.level})`}>
                          <PermIcon className="w-3 h-3 text-text-muted" />
                          <span className="text-[10px] text-foreground">{perm.scope}</span>
                          <motion.span className={`w-1.5 h-1.5 rounded-full ${perm.level === "full" ? "bg-[#38D39F]" : perm.level === "filtered" ? "bg-[#f0c56c]" : "bg-text-muted"}`}
                            animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.2, delay: idx * 0.2 }} />
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  // v3: Compact rows with color dots
                  <div className="space-y-0.5">
                    {PERMISSION_MAP.map((perm, idx) => {
                      const PermIcon = perm.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                          className="flex items-center gap-2 px-1.5 py-0.5 text-[10px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${perm.level === "full" ? "bg-[#38D39F]" : perm.level === "filtered" ? "bg-[#f0c56c]" : "bg-text-muted"}`} />
                          <PermIcon className="w-3 h-3 text-text-muted" />
                          <span className="text-foreground">{perm.scope}</span>
                          <span className="text-text-muted ml-auto font-mono">{perm.access}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Channels (Telegram/Slack/Discord) ── */}
            {channelsVariant !== "off" && isModuleVisible("channels") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.26 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Channels</div>
                {channelsVariant === "v1" ? (
                  <div className="space-y-1.5">
                    {MOCK_CHANNELS.map((ch, idx) => {
                      const ChIcon = ch.icon;
                      return (
                        <motion.div key={ch.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.15 + idx * 0.06 }}
                          whileHover={{ x: 3 }}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors">
                          <motion.div animate={ch.status === "connected" ? { scale: [1, 1.1, 1] } : {}} transition={{ repeat: Infinity, duration: 2.5, delay: idx * 0.4 }}>
                            <ChIcon className={`w-4 h-4 ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`} />
                          </motion.div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-foreground">{ch.name}</div>
                            {ch.account && <div className="text-[10px] text-text-muted">{ch.account}</div>}
                          </div>
                          <motion.div className={`w-1.5 h-1.5 rounded-full ${ch.status === "connected" ? "bg-[#38D39F]" : "bg-text-muted"}`}
                            animate={ch.status === "connected" ? { scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] } : {}}
                            transition={{ repeat: Infinity, duration: 1.2, delay: idx * 0.3 }} />
                          {ch.status !== "connected" && (
                            <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] text-[#38D39F] hover:underline">Connect</motion.button>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ) : channelsVariant === "v2" ? (
                  <div className="flex gap-1.5">
                    {MOCK_CHANNELS.map((ch, idx) => {
                      const ChIcon = ch.icon;
                      return (
                        <motion.div key={ch.id} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.06, type: "spring" }}
                          whileHover={{ y: -2 }}
                          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border ${ch.status === "connected" ? "border-[#38D39F]/20 bg-[#38D39F]/5" : "border-border"}`}>
                          <ChIcon className={`w-4 h-4 ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`} />
                          <span className="text-[9px] text-foreground">{ch.name}</span>
                          <span className={`text-[8px] ${ch.status === "connected" ? "text-[#38D39F]" : "text-text-muted"}`}>{ch.status}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {MOCK_CHANNELS.map((ch, idx) => (
                      <motion.span key={ch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.04 }}
                        className={`text-[10px] px-2 py-0.5 rounded-full ${ch.status === "connected" ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                        {ch.name} {ch.status === "connected" ? "✓" : "—"}
                      </motion.span>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Model Providers ── */}
            {providersVariant !== "off" && isModuleVisible("providers") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.28 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Model Providers</div>
                {providersVariant === "v1" ? (
                  <div className="space-y-2">
                    {MOCK_PROVIDERS.map((prov, idx) => (
                      <motion.div key={prov.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + idx * 0.08 }}
                        className="rounded-lg border border-border px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">{prov.name}</span>
                          <span className="text-[9px] text-text-muted">{prov.models.length} models</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {prov.models.map((m) => (
                            <motion.span key={m} whileHover={{ scale: 1.05 }}
                              className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${m === prov.defaultModel ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
                              {m}{m === prov.defaultModel && " ★"}
                            </motion.span>
                          ))}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : providersVariant === "v2" ? (
                  <div className="space-y-1">
                    {MOCK_PROVIDERS.flatMap((prov) => prov.models.map((m) => ({ model: m, provider: prov.name, isDefault: m === prov.defaultModel }))).map((item, idx) => (
                      <motion.div key={item.model} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.04 }}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-low transition-colors text-[10px]">
                        <motion.div animate={item.isDefault ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity, duration: 2.5 }}>
                          <Brain className={`w-3 h-3 ${item.isDefault ? "text-[#38D39F]" : "text-text-muted"}`} />
                        </motion.div>
                        <span className="font-mono text-foreground">{item.model}</span>
                        <span className="text-text-muted ml-auto">{item.provider}</span>
                        {item.isDefault && <motion.span className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                          animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />}
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {MOCK_PROVIDERS.flatMap((p) => p.models).map((m, idx) => (
                      <motion.span key={m} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.04 }}
                        className="text-[9px] px-2 py-0.5 rounded-full bg-surface-low font-mono text-text-muted">{m}</motion.span>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Execution Approval Queue ── */}
            {execQueueVariant !== "off" && isModuleVisible("execQueue") && MOCK_EXEC_QUEUE.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.3 }}
                className="rounded-lg border border-[#f0c56c]/25 bg-[#f0c56c]/5 p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                    <Shield className="w-3.5 h-3.5 text-[#f0c56c]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-[#f0c56c] uppercase tracking-wider">Pending Approval</span>
                  <motion.span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0c56c]/20 text-[#f0c56c] font-bold"
                    animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                    {MOCK_EXEC_QUEUE.length}
                  </motion.span>
                </div>
                {execQueueVariant === "v1" ? (
                  <div className="space-y-1.5">
                    {MOCK_EXEC_QUEUE.map((exec, idx) => (
                      <motion.div key={exec.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.15 + idx * 0.08 }}
                        className="rounded-md border border-[#f0c56c]/20 bg-background/50 px-2.5 py-2 space-y-1.5">
                        <code className="text-[10px] font-mono text-foreground block truncate">{exec.command}</code>
                        <div className="flex items-center gap-1.5">
                          <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] px-2 py-0.5 rounded bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25 font-medium">Approve</motion.button>
                          <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] px-2 py-0.5 rounded bg-[#d05f5f]/15 text-[#d05f5f] hover:bg-[#d05f5f]/25 font-medium">Deny</motion.button>
                          <span className="text-[9px] text-text-muted ml-auto">{relativeTime(exec.requestedAt)}</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : execQueueVariant === "v2" ? (
                  <div className="space-y-1">
                    {MOCK_EXEC_QUEUE.map((exec, idx) => (
                      <motion.div key={exec.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.06 }}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-background/50 transition-colors">
                        <Terminal className="w-3 h-3 text-[#f0c56c] shrink-0" />
                        <code className="text-[10px] font-mono text-foreground flex-1 truncate">{exec.command}</code>
                        <motion.button whileTap={{ scale: 0.85 }} className="text-[10px] text-[#38D39F]">✓</motion.button>
                        <motion.button whileTap={{ scale: 0.85 }} className="text-[10px] text-[#d05f5f]">✕</motion.button>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px]">
                    <motion.span className="w-1.5 h-1.5 rounded-full bg-[#f0c56c]"
                      animate={{ scale: [0.75, 1.35, 0.75] }} transition={{ repeat: Infinity, duration: 1 }} />
                    <span className="text-text-muted">{MOCK_EXEC_QUEUE.length} commands awaiting approval</span>
                    <motion.button whileTap={{ scale: 0.9 }} className="text-[#f0c56c] font-medium ml-auto hover:underline">Review</motion.button>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Agent URLs ── */}
            {agentUrlsVariant !== "off" && isModuleVisible("agentUrls") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.32 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Endpoints</div>
                {agentUrlsVariant === "v1" ? (
                  <div className="space-y-1">
                    {MOCK_AGENT_URLS.map((u, idx) => {
                      const UIcon = u.icon;
                      return (
                        <motion.a key={idx} href="#" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + idx * 0.06 }}
                          whileHover={{ x: 3 }}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-low transition-colors">
                          <UIcon className="w-3.5 h-3.5 text-[#38D39F]" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-foreground">{u.label}</div>
                            <div className="text-[9px] text-text-muted truncate font-mono">{u.url}</div>
                          </div>
                        </motion.a>
                      );
                    })}
                  </div>
                ) : agentUrlsVariant === "v2" ? (
                  <div className="flex flex-wrap gap-1">
                    {MOCK_AGENT_URLS.map((u, idx) => {
                      const UIcon = u.icon;
                      return (
                        <motion.a key={idx} href="#" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.05 }}
                          whileHover={{ scale: 1.05 }}
                          className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-low text-[10px] text-foreground hover:bg-surface-high transition-colors">
                          <UIcon className="w-3 h-3 text-[#38D39F]" />{u.label}
                        </motion.a>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {MOCK_AGENT_URLS.map((u, idx) => (
                      <motion.div key={idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                        className="flex items-center gap-2 px-1.5 py-0.5 text-[10px]">
                        <span className="text-text-muted">{u.label}:</span>
                        <span className="font-mono text-[#38D39F] truncate">{u.url}</span>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Gateway Status ── */}
            {gatewayStatusVariant !== "off" && isModuleVisible("gateway") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.34 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                    <Network className="w-3.5 h-3.5 text-[#38D39F]" />
                  </motion.div>
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Gateway</span>
                  <motion.span className="w-1.5 h-1.5 rounded-full bg-[#38D39F] ml-auto"
                    animate={{ scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />
                </div>
                {gatewayStatusVariant === "v1" ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "Protocol", value: `v${MOCK_GATEWAY_STATUS.protocol}` },
                      { label: "Version", value: MOCK_GATEWAY_STATUS.version },
                      { label: "Uptime", value: formatUptime(MOCK_GATEWAY_STATUS.uptime) },
                      { label: "Streams", value: String(MOCK_GATEWAY_STATUS.activeStreams) },
                    ].map((item, idx) => (
                      <motion.div key={idx} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 + idx * 0.04 }}
                        className="px-2 py-1.5 rounded-md bg-surface-low text-center">
                        <div className="text-[9px] text-text-muted">{item.label}</div>
                        <div className="text-[10px] text-foreground font-mono font-medium">{item.value}</div>
                      </motion.div>
                    ))}
                  </div>
                ) : gatewayStatusVariant === "v2" ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                    <span className="text-text-muted">Protocol <span className="text-foreground font-mono">v{MOCK_GATEWAY_STATUS.protocol}</span></span>
                    <span className="text-text-muted">Version <span className="text-foreground font-mono">{MOCK_GATEWAY_STATUS.version}</span></span>
                    <span className="text-text-muted">Uptime <span className="text-foreground font-mono">{formatUptime(MOCK_GATEWAY_STATUS.uptime)}</span></span>
                    <span className="text-text-muted">Streams <span className="text-foreground font-mono">{MOCK_GATEWAY_STATUS.activeStreams}</span></span>
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-[10px] font-mono text-text-muted">
                    gw v{MOCK_GATEWAY_STATUS.protocol} · {MOCK_GATEWAY_STATUS.version} · {formatUptime(MOCK_GATEWAY_STATUS.uptime)} · {MOCK_GATEWAY_STATUS.activeStreams} stream{MOCK_GATEWAY_STATUS.activeStreams !== 1 ? "s" : ""}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── Workspace Files ── */}
            {workspaceFilesVariant !== "off" && isModuleVisible("workspace") && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.36 }}
                className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Workspace</div>
                {workspaceFilesVariant === "v1" ? (
                  <div className="space-y-0.5">
                    {MOCK_WORKSPACE_FILES.map((f, idx) => (
                      <motion.div key={f.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 + idx * 0.04 }}
                        whileHover={{ x: 3 }}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-low transition-colors text-[10px]">
                        <motion.div whileHover={{ scale: 1.15 }}>
                          {f.type === "directory" ? <FolderOpen className="w-3 h-3 text-[#f0c56c]" /> : <FileText className="w-3 h-3 text-text-muted" />}
                        </motion.div>
                        <span className="font-mono text-foreground">{f.name}</span>
                        {f.size > 0 && <span className="text-text-muted ml-auto">{formatBytes(f.size)}</span>}
                      </motion.div>
                    ))}
                  </div>
                ) : workspaceFilesVariant === "v2" ? (
                  <div className="flex flex-wrap gap-1">
                    {MOCK_WORKSPACE_FILES.map((f, idx) => (
                      <motion.span key={f.name} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.04 }}
                        whileHover={{ scale: 1.05 }}
                        className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono ${f.type === "directory" ? "bg-[#f0c56c]/10 text-[#f0c56c]" : "bg-surface-low text-text-muted"}`}>
                        {f.type === "directory" ? <FolderOpen className="w-3 h-3" /> : <FileText className="w-3 h-3" />}{f.name}
                      </motion.span>
                    ))}
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[10px] font-mono text-text-muted">
                    {MOCK_WORKSPACE_FILES.filter((f) => f.type === "file").length} files · {MOCK_WORKSPACE_FILES.filter((f) => f.type === "directory").length} dirs
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Active Sessions */}
            {showActiveSessions && isModuleVisible("sessions") && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.16 }}
                className="rounded-lg border border-border p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Sessions</span>
                  <motion.span
                    className="text-[10px] text-text-muted flex items-center gap-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <motion.span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                      animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1, ease: "easeInOut" }}
                    />
                    {MOCK_SESSIONS.length} active
                  </motion.span>
                </div>
                <div className="space-y-1">
                  {MOCK_SESSIONS.map((sess, idx) => {
                    const SessIcon = SESSION_ICONS[sess.clientMode] || Monitor;
                    return (
                      <motion.div
                        key={sess.key}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 28, delay: 0.22 + idx * 0.06 }}
                        whileHover={{ x: 3 }}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-low transition-colors"
                      >
                        <motion.div
                          animate={{ rotate: [0, 5, -5, 0] }}
                          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: idx * 0.8 }}
                        >
                          <SessIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground truncate">{sess.clientDisplayName}</div>
                          <div className="text-[10px] text-text-muted">{sess.clientMode}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-text-muted">{relativeTime(sess.lastMessageAt)}</span>
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                            animate={{ scale: [0.8, 1.3, 0.8], opacity: [0.5, 1, 0.5] }}
                            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: idx * 0.25 }}
                          />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Sub-agents */}
            {showSubAgents && isModuleVisible("subAgents") && MOCK_SUB_AGENTS.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28, delay: 0.24 }}
                className="rounded-lg border border-border p-3 space-y-2"
              >
                <motion.button
                  onClick={() => setSubAgentsOpen(!subAgentsOpen)}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-1.5 w-full text-xs font-semibold text-text-secondary uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  <motion.div animate={{ rotate: subAgentsOpen ? 0 : -90 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </motion.div>
                  Sub-agents
                  <span className="text-text-muted font-normal normal-case">({MOCK_SUB_AGENTS.length})</span>
                </motion.button>
                {subAgentsOpen && (
                  <div className="space-y-1">
                    {MOCK_SUB_AGENTS.map((sa, idx) => (
                      <motion.div
                        key={sa.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 28, delay: idx * 0.06 }}
                        whileHover={{ x: 3 }}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-low transition-colors"
                      >
                        <motion.div
                          animate={sa.status === "RUNNING" ? { scale: [1, 1.1, 1] } : {}}
                          transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut", delay: idx * 0.4 }}
                        >
                          <Bot className={`w-3.5 h-3.5 shrink-0 ${sa.status === "RUNNING" ? "text-[#38D39F]" : "text-text-muted"}`} />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground truncate">{sa.name}</div>
                          <div className="text-[10px] text-text-muted">{sa.description}</div>
                        </div>
                        <motion.div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${sa.status === "RUNNING" ? "bg-[#38D39F]" : "bg-text-muted"}`}
                          animate={sa.status === "RUNNING" ? { scale: [0.8, 1.4, 0.8], opacity: [0.5, 1, 0.5] } : {}}
                          transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut", delay: idx * 0.3 }}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Quick Actions Bar ── */}
            {quickActionsVariant !== "off" && isModuleVisible("quickActions") && (() => {
              if (quickActionsVariant === "v1") {
                // v1: Horizontal scroll chips
                return (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Quick Actions</div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {QUICK_ACTIONS.map((qa, idx) => {
                        const QaIcon = qa.icon;
                        return (
                          <motion.button key={idx} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.06 }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#38D39F]/8 text-[#38D39F] text-[10px] font-medium whitespace-nowrap hover:bg-[#38D39F]/15 transition-colors shrink-0">
                            <QaIcon className="w-3 h-3" /> {qa.label}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              if (quickActionsVariant === "v2") {
                // v2: Grid of icon cards
                return (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Try asking</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {QUICK_ACTIONS.slice(0, 6).map((qa, idx) => {
                        const QaIcon = qa.icon;
                        return (
                          <motion.button key={idx} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }}
                            initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.05 }}
                            className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg hover:bg-surface-low transition-colors">
                            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 3, delay: idx * 0.4 }}>
                              <QaIcon className="w-4 h-4 text-[#38D39F]" />
                            </motion.div>
                            <span className="text-[9px] text-text-muted text-center leading-tight">{qa.label}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              // v3: Stacked suggestion cards
              return (
                <div className="space-y-1">
                  {QUICK_ACTIONS.slice(0, 3).map((qa, idx) => {
                    const QaIcon = qa.icon;
                    return (
                      <motion.button key={idx} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.08 }}
                        whileHover={{ x: 4 }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border border-border hover:border-[#38D39F]/25 hover:bg-[#38D39F]/5 transition-colors text-left">
                        <QaIcon className="w-4 h-4 text-[#38D39F] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground">{qa.label}</div>
                          <div className="text-[10px] text-text-muted truncate">{qa.prompt}</div>
                        </div>
                        <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
                      </motion.button>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── What Can I Do chip ── */}
            {whatCanIDoVariant !== "off" && isModuleVisible("whatCanIDo") && (() => {
              if (whatCanIDoVariant === "v1") {
                return (
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#38D39F]/8 border border-[#38D39F]/20 hover:bg-[#38D39F]/15 transition-colors">
                    <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
                      <Sparkles className="w-4 h-4 text-[#38D39F]" />
                    </motion.div>
                    <span className="text-xs font-medium text-[#38D39F]">&quot;What can you do?&quot;</span>
                  </motion.button>
                );
              }
              if (whatCanIDoVariant === "v2") {
                return (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-dashed border-[#38D39F]/30 p-2.5 text-center">
                    <motion.div animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                      <MessageSquare className="w-5 h-5 text-[#38D39F] mx-auto mb-1" />
                    </motion.div>
                    <span className="text-[10px] text-text-muted">Ask your agent: </span>
                    <span className="text-[10px] text-[#38D39F] font-medium">&quot;What can you do?&quot;</span>
                  </motion.div>
                );
              }
              // v3: Inline subtle link
              return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-1.5 py-1.5">
                  <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                    animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />
                  <span className="text-[10px] text-text-muted">Try asking: <span className="text-[#38D39F] cursor-pointer hover:underline">&quot;What can you do?&quot;</span></span>
                </motion.div>
              );
            })()}

            {/* ── Tool Discovery Cards ── */}
            {toolDiscoveryVariant !== "off" && isModuleVisible("toolDiscovery") && MOCK_TOOL_DISCOVERIES.filter((d) => !dismissedDiscoveries.has(d.id)).length > 0 && (
              <div className="space-y-1.5">
                {MOCK_TOOL_DISCOVERIES.filter((d) => !dismissedDiscoveries.has(d.id)).map((disc, idx) => {
                  if (toolDiscoveryVariant === "v1") {
                    return (
                      <motion.div key={disc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}
                        className="rounded-lg bg-[#f0c56c]/8 border border-[#f0c56c]/20 px-3 py-2 flex items-start gap-2">
                        <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ repeat: Infinity, duration: 2 }}>
                          <Sparkles className="w-3.5 h-3.5 text-[#f0c56c] mt-0.5 shrink-0" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground">{disc.message}</div>
                          <div className="text-[10px] text-text-muted mt-0.5">See all tools →</div>
                        </div>
                        <button onClick={() => setDismissedDiscoveries((prev) => new Set(prev).add(disc.id))} className="text-text-muted hover:text-foreground text-[10px]">✕</button>
                      </motion.div>
                    );
                  }
                  if (toolDiscoveryVariant === "v2") {
                    return (
                      <motion.div key={disc.id} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f0c56c]/10 border border-[#f0c56c]/15">
                        <Wrench className="w-3 h-3 text-[#f0c56c]" />
                        <span className="text-[10px] text-foreground flex-1 truncate">{disc.message}</span>
                        <button onClick={() => setDismissedDiscoveries((prev) => new Set(prev).add(disc.id))} className="text-text-muted hover:text-foreground text-[10px]">✕</button>
                      </motion.div>
                    );
                  }
                  // v3: Toast style bottom-aligned
                  return (
                    <motion.div key={disc.id} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                      className="rounded-md bg-[#1a1a1c] border border-[#f0c56c]/20 shadow-lg px-3 py-2 flex items-center gap-2">
                      <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <Zap className="w-3.5 h-3.5 text-[#f0c56c]" />
                      </motion.div>
                      <span className="text-[10px] text-foreground flex-1">{disc.message}</span>
                      <button onClick={() => setDismissedDiscoveries((prev) => new Set(prev).add(disc.id))} className="text-text-muted hover:text-foreground text-[10px]">✕</button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* ── Connection Recommendations ── */}
            {connectionRecsVariant !== "off" && isModuleVisible("connectionRecs") && (() => {
              const recs = [
                { name: "Gmail", reason: "Your agent mentions email often", icon: Mail },
                { name: "GitHub", reason: "Detected code-related tasks", icon: GitBranch },
              ];
              if (connectionRecsVariant === "v1") {
                return (
                  <div className="rounded-lg border border-[#4285f4]/20 bg-[#4285f4]/5 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                        <Sparkles className="w-3.5 h-3.5 text-[#4285f4]" />
                      </motion.div>
                      <span className="text-xs font-medium text-foreground">Suggested Connections</span>
                    </div>
                    {recs.map((r, idx) => {
                      const RecIcon = r.icon;
                      return (
                        <motion.div key={idx} initial={{ x: -12, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.1 }}
                          className="flex items-center gap-2.5 py-1">
                          <RecIcon className="w-3.5 h-3.5 text-[#4285f4]" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-foreground">{r.name}</span>
                            <span className="text-[10px] text-text-muted ml-1">— {r.reason}</span>
                          </div>
                          <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] px-2 py-0.5 rounded-full bg-[#4285f4]/15 text-[#4285f4] hover:bg-[#4285f4]/25">Connect</motion.button>
                        </motion.div>
                      );
                    })}
                  </div>
                );
              }
              if (connectionRecsVariant === "v2") {
                return (
                  <div className="space-y-1">
                    {recs.map((r, idx) => {
                      const RecIcon = r.icon;
                      return (
                        <motion.div key={idx} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.08 }}
                          className="rounded-lg border border-border px-3 py-2 flex items-center gap-2 hover:border-[#4285f4]/25 transition-colors">
                          <div className="w-7 h-7 rounded-lg bg-[#4285f4]/10 flex items-center justify-center"><RecIcon className="w-3.5 h-3.5 text-[#4285f4]" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-foreground">{r.name}</div>
                            <div className="text-[10px] text-text-muted">{r.reason}</div>
                          </div>
                          <Plus className="w-3.5 h-3.5 text-[#4285f4]" />
                        </motion.div>
                      );
                    })}
                  </div>
                );
              }
              // v3: Inline banner
              return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#4285f4]/5 border border-[#4285f4]/15">
                  <Link2 className="w-3.5 h-3.5 text-[#4285f4] shrink-0" />
                  <span className="text-[10px] text-text-muted flex-1">
                    Connect <span className="text-[#4285f4] font-medium">{recs.map((r) => r.name).join(", ")}</span> based on your agent&apos;s activity
                  </span>
                  <motion.button whileTap={{ scale: 0.9 }} className="text-[10px] text-[#4285f4] font-medium hover:underline shrink-0">Add</motion.button>
                </motion.div>
              );
            })()}

            {/* ── Capability Diff ── */}
            {capabilityDiffVariant !== "off" && isModuleVisible("capDiff") && MOCK_CAPABILITY_DIFFS.length > 0 && (
              <div className="space-y-1">
                {MOCK_CAPABILITY_DIFFS.map((diff, idx) => {
                  const isAdd = diff.action === "enabled" || diff.action === "connected";
                  if (capabilityDiffVariant === "v1") {
                    return (
                      <motion.div key={diff.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.08 }}
                        className={`rounded-lg px-3 py-2 border flex items-center gap-2 ${isAdd ? "bg-[#38D39F]/5 border-[#38D39F]/20" : "bg-[#d05f5f]/5 border-[#d05f5f]/20"}`}>
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
                          {isAdd ? <Check className="w-3.5 h-3.5 text-[#38D39F]" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#d05f5f]" />}
                        </motion.div>
                        <span className="text-xs text-foreground flex-1">{diff.message}</span>
                        <span className="text-[10px] text-text-muted">{relativeTime(diff.timestamp)}</span>
                      </motion.div>
                    );
                  }
                  if (capabilityDiffVariant === "v2") {
                    return (
                      <motion.div key={diff.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 px-2 py-1">
                        <motion.span className={`inline-block w-1.5 h-1.5 rounded-full ${isAdd ? "bg-[#38D39F]" : "bg-[#d05f5f]"}`}
                          animate={{ scale: [0.75, 1.35, 0.75] }} transition={{ repeat: Infinity, duration: 1 }} />
                        <span className="text-[10px] text-text-muted">{diff.message}</span>
                      </motion.div>
                    );
                  }
                  // v3: Pill badge
                  return (
                    <motion.div key={diff.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium mr-1 ${isAdd ? "bg-[#38D39F]/10 text-[#38D39F]" : "bg-[#d05f5f]/10 text-[#d05f5f]"}`}>
                      {isAdd ? <Plus className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
                      {diff.capability}
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* ── Proactive Nudges ── */}
            {nudgesVariant !== "off" && isModuleVisible("nudges") && MOCK_NUDGES.filter((n) => !dismissedNudges.has(n.id)).length > 0 && (
              <div className="space-y-1.5">
                {MOCK_NUDGES.filter((n) => !dismissedNudges.has(n.id)).map((nudge, idx) => {
                  const NudgeIcon = nudge.icon;
                  if (nudgesVariant === "v1") {
                    return (
                      <motion.div key={nudge.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}
                        className="rounded-lg bg-surface-low border border-border px-3 py-2 flex items-start gap-2">
                        <motion.div animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2, delay: idx * 0.3 }}>
                          <NudgeIcon className="w-3.5 h-3.5 text-[#38D39F] mt-0.5 shrink-0" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-foreground">{nudge.text}</div>
                          <button className="text-[10px] text-[#38D39F] mt-0.5 hover:underline">{nudge.action} →</button>
                        </div>
                        <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))} className="text-text-muted hover:text-foreground text-[10px] mt-0.5">✕</button>
                      </motion.div>
                    );
                  }
                  if (nudgesVariant === "v2") {
                    return (
                      <motion.div key={nudge.id} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: idx * 0.08 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#38D39F]/5 border border-[#38D39F]/15">
                        <NudgeIcon className="w-3 h-3 text-[#38D39F]" />
                        <span className="text-[10px] text-foreground flex-1 truncate">{nudge.text}</span>
                        <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))} className="text-text-muted hover:text-foreground text-[10px]">✕</button>
                      </motion.div>
                    );
                  }
                  // v3: Minimal line
                  return (
                    <motion.div key={nudge.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.05 }}
                      className="flex items-center gap-2 px-2 py-1 group">
                      <motion.span className="inline-block w-1.5 h-1.5 rounded-full bg-[#38D39F]"
                        animate={{ scale: [0.75, 1.35, 0.75], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} />
                      <span className="text-[10px] text-text-muted flex-1">{nudge.text}</span>
                      <button onClick={() => setDismissedNudges((prev) => new Set(prev).add(nudge.id))}
                        className="text-text-muted hover:text-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* ── Agent Card / Summary Sheet ── */}
            {agentCardVariant !== "off" && isModuleVisible("agentCard") && (
              <>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowAgentCard(!showAgentCard)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border hover:bg-surface-low transition-colors text-xs text-text-muted hover:text-foreground">
                  <Bot className="w-3 h-3" /> {showAgentCard ? "Hide" : "Show"} Agent Card
                </motion.button>
                {showAgentCard && (() => {
                  const enabledTools = configTools.filter((t) => t.enabled).map((t) => t.name);
                  const connectedCount = MOCK_CONNECTIONS.filter((c) => c.connected).length;
                  if (agentCardVariant === "v1") {
                    return (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                        className="rounded-xl border border-border bg-surface-low p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 3 }}
                            className="w-10 h-10 rounded-xl bg-[#38D39F]/15 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-[#38D39F]" />
                          </motion.div>
                          <div>
                            <div className="text-sm font-semibold text-foreground">{agentName}</div>
                            <div className="text-[10px] text-text-muted">{MOCK_CONFIG.model} · v{status.version}</div>
                          </div>
                        </div>
                        <p className="text-[10px] text-text-muted line-clamp-2">{MOCK_CONFIG.systemPrompt}</p>
                        <div className="flex flex-wrap gap-1">
                          {enabledTools.map((t) => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/10 text-[#38D39F]">{t}</span>
                          ))}
                        </div>
                        <div className="flex gap-4 text-[10px] text-text-muted">
                          <span>{connectedCount} connections</span>
                          <span>{MOCK_SESSIONS.length} sessions</span>
                          <span>{formatUptime(status.uptime)} uptime</span>
                        </div>
                      </motion.div>
                    );
                  }
                  if (agentCardVariant === "v2") {
                    return (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        className="rounded-lg border border-[#38D39F]/20 bg-gradient-to-br from-[#38D39F]/5 to-transparent p-3 space-y-2">
                        <div className="text-xs font-medium text-foreground">{agentName}</div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[
                            { label: "Tools", value: enabledTools.length },
                            { label: "Links", value: connectedCount },
                            { label: "Sessions", value: MOCK_SESSIONS.length },
                          ].map((stat, idx) => (
                            <motion.div key={idx} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: idx * 0.1, type: "spring" }}
                              className="py-1.5 rounded-md bg-background/50">
                              <div className="text-sm font-bold text-[#38D39F]">{stat.value}</div>
                              <div className="text-[9px] text-text-muted">{stat.label}</div>
                            </motion.div>
                          ))}
                        </div>
                      </motion.div>
                    );
                  }
                  // v3: Compact inline
                  return (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="rounded-md border border-border px-3 py-2 flex items-center gap-3 text-[10px] text-text-muted">
                      <Bot className="w-4 h-4 text-[#38D39F] shrink-0" />
                      <span className="text-foreground font-medium">{agentName}</span>
                      <span>·</span><span>{MOCK_CONFIG.model}</span>
                      <span>·</span><span>{enabledTools.length} tools</span>
                      <span>·</span><span>{connectedCount} connected</span>
                    </motion.div>
                  );
                })()}
              </>
            )}

          </div>
        )}

        {/* ── Activity tab ── */}
        {activeTab === "activity" && (
          <div className="p-3 space-y-1">
            {/* Filter chips */}
            <div className="flex flex-wrap gap-1 pb-2">
              {activityTypes.map((t) => (
                <motion.button
                  key={t.value}
                  onClick={() => setActivityFilter(t.value)}
                  whileTap={{ scale: 0.92 }}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                    activityFilter === t.value
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
                          className={`w-6 h-6 rounded-md flex items-center justify-center ${
                            entry.type === "error" ? "bg-[#d05f5f]/15" :
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
                    className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                      skill.enabled
                        ? "border-[#38D39F]/25 bg-[#38D39F]/5 hover:bg-[#38D39F]/10"
                        : "border-border hover:bg-surface-low"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <motion.div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                          skill.enabled ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"
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
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-full border transition-colors ${
                      skill.enabled
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
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      skill.enabled ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"
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
    </div>
  );
}

// ── Connection row with style variants ──

function ConnectionRow({ connection, selected, onClick, variant = "off" }: { connection: Connection; selected: boolean; onClick: () => void; variant?: StyleVariant }) {
  const Icon = connection.icon;

  if (variant === "v1") {
    return (
      <button onClick={onClick} className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors ${selected ? "bg-[#38D39F]/10 text-[#38D39F]" : "hover:bg-surface-low text-foreground"}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs truncate flex-1">{connection.name}</span>
        {connection.connected && <div className="w-1.5 h-1.5 rounded-full bg-[#38D39F] shrink-0" />}
      </button>
    );
  }
  if (variant === "v2") {
    return (
      <button onClick={onClick} className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors border ${selected ? "bg-[#38D39F]/8 border-[#38D39F]/25" : "hover:bg-surface-low border-border"}`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${connection.connected ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{connection.name}</div>
            <div className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{connection.description}</div>
          </div>
          {connection.connected && <div className="w-2 h-2 rounded-full bg-[#38D39F] shrink-0" />}
        </div>
      </button>
    );
  }
  if (variant === "v3") {
    return (
      <button onClick={onClick} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-left transition-colors border ${selected ? "bg-[#38D39F]/10 border-[#38D39F]/30 text-[#38D39F]" : connection.connected ? "bg-surface-low border-[#38D39F]/20 text-foreground hover:bg-surface-high" : "bg-surface-low border-border text-text-muted hover:text-foreground hover:bg-surface-high"}`}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs font-medium">{connection.name}</span>
        {connection.connected && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#38D39F]/15 text-[#38D39F] font-medium">on</span>}
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors ${selected ? "bg-[#38D39F]/10 border border-[#38D39F]/25" : "hover:bg-surface-low border border-transparent"}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${connection.connected ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-high text-text-muted"}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{connection.name}</div>
        <div className="text-[10px] text-text-muted truncate">{connection.category}</div>
      </div>
      {connection.connected && <div className="w-2 h-2 rounded-full bg-[#38D39F] shrink-0" />}
    </button>
  );
}

// ── Connection detail pane ──

interface ConnectionDetailProps { connection: Connection | null; onClose: () => void }

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
