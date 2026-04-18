import {
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
  Globe,
  Play,
  FolderOpen,
  BarChart3,
  Image,
  Link2,
  Gauge,
  Timer,
  Monitor,
  Terminal,
  Wrench,
  Send,
  AlertTriangle,
  Settings,
  Activity,
  Eye,
  Shield,
  Trophy,
  Network,
  Cpu,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  Connection,
  Skill,
  ActivityEntry,
  ActivityType,
  AgentStatus,
  AgentConfig,
  AgentSession,
  CronJob,
  SubAgent,
  RecentToolCall,
  ModuleDefinition,
} from "./agentViewTypes";

// ── Category / Session icon maps ──

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
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

export const SESSION_ICONS: Record<string, LucideIcon> = {
  browser: Monitor,
  cli: Terminal,
  telegram: MessageSquare,
  api: Code,
};

export const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  message: "text-[#38D39F]",
  tool: "text-[#f0c56c]",
  connection: "text-[#4285f4]",
  skill: "text-[#38D39F]",
  cron: "text-[#f0c56c]",
  error: "text-[#d05f5f]",
  system: "text-text-muted",
};

// ── Mock data ──

export const MOCK_CONNECTIONS: Connection[] = [
  { id: "telegram", name: "Telegram", icon: MessageSquare, category: "Communication", connected: true, description: "Send and receive messages via Telegram bot" },
  { id: "opus", name: "Model: Opus 4.6", icon: Brain, category: "Models", connected: true, description: "Claude Opus 4.6 language model" },
  { id: "gmail", name: "Gmail", icon: Mail, category: "Communication", connected: true, description: "Read, send, and manage emails" },
  { id: "gcal", name: "Google Calendar", icon: Calendar, category: "Calendar & Scheduling", connected: true, description: "Manage events and scheduling" },
  { id: "crm", name: "CRM", icon: Users, category: "CRM / Customer Systems", connected: false, description: "Customer relationship management" },
  { id: "github", name: "GitHub", icon: GitBranch, category: "Dev / Technical Tools", connected: false, description: "Repositories, issues, and pull requests" },
  { id: "asana", name: "Asana", icon: CheckSquare, category: "Task / Project Management", connected: false, description: "Task and project tracking" },
  { id: "slack", name: "Slack", icon: MessageSquare, category: "Communication", connected: false, description: "Team messaging and channels" },
  { id: "teams", name: "Microsoft Teams", icon: Users, category: "Communication", connected: false, description: "Teams chat, channels, and meetings" },
  { id: "gdrive", name: "Google Drive", icon: HardDrive, category: "File Storage", connected: false, description: "Cloud file storage and sharing" },
  { id: "notion", name: "Notion", icon: FileText, category: "Documents & Knowledge", connected: false, description: "Wiki, docs, and knowledge base" },
  { id: "zapier", name: "Zapier", icon: Zap, category: "Automation & Webhooks", connected: false, description: "Workflow automation and integrations" },
  { id: "linear", name: "Linear", icon: CheckSquare, category: "Task / Project Management", connected: false, description: "Issue tracking for engineering teams" },
];

// Featured integrations — surfaced as branded CTAs at the top of the
// Connections tab. Brand color used for the pill background tint.
// `iconKey` maps to BRAND_ICONS in BrandIcons.tsx (real brand SVGs).
export const FEATURED_INTEGRATIONS: Array<{
  id: string;
  name: string;
  brand: string;
  iconKey: "slack" | "telegram" | "teams";
  description: string;
}> = [
  { id: "slack",    name: "Slack",    brand: "#4A154B", iconKey: "slack",    description: "Team messaging and channels" },
  { id: "teams",    name: "Teams",    brand: "#5059C9", iconKey: "teams",    description: "Microsoft Teams chat and meetings" },
  { id: "telegram", name: "Telegram", brand: "#229ED9", iconKey: "telegram", description: "Send and receive messages via Telegram bot" },
];

export const MOCK_SKILLS: Skill[] = [
  { id: "web-search", name: "Web Search", description: "Search the internet for information", enabled: true, icon: Globe },
  { id: "code-exec", name: "Code Execution", description: "Run code in a sandboxed environment", enabled: true, icon: Play },
  { id: "file-ops", name: "File Operations", description: "Read, write, and manage files", enabled: true, icon: FolderOpen },
  { id: "data-analysis", name: "Data Analysis", description: "Analyze datasets and generate insights", enabled: false, icon: BarChart3 },
  { id: "image-gen", name: "Image Generation", description: "Create images from text prompts", enabled: false, icon: Image },
];

export const MOCK_ACTIVITY: ActivityEntry[] = [
  { id: "1", type: "message", action: "Message sent", detail: "Replied to user query about deployment", timestamp: Date.now() - 120000, icon: Send },
  { id: "2", type: "tool", action: "Tool call", detail: "Executed file_read on /src/config.ts", timestamp: Date.now() - 300000, icon: Wrench },
  { id: "3", type: "connection", action: "Connection used", detail: "Fetched emails via Gmail", timestamp: Date.now() - 600000, icon: Link2 },
  { id: "4", type: "skill", action: "Skill invoked", detail: "Ran web search for API docs", timestamp: Date.now() - 900000, icon: Globe },
  { id: "5", type: "cron", action: "Cron executed", detail: "Morning briefing completed", timestamp: Date.now() - 1200000, icon: Timer },
  { id: "6", type: "error", action: "Error", detail: "WebSocket connection dropped (code 1006)", timestamp: Date.now() - 1500000, icon: AlertTriangle },
  { id: "7", type: "system", action: "Config updated", detail: "Model changed to claude-opus-4-6", timestamp: Date.now() - 1800000, icon: Settings },
  { id: "8", type: "message", action: "Message sent", detail: "Summarized meeting notes", timestamp: Date.now() - 2400000, icon: Send },
];

export const MOCK_STATUS: AgentStatus = {
  state: "RUNNING",
  uptime: 14400,
  cpu: 23,
  memory: { used: 536870912, total: 2147483648 },
  version: "0.4.2",
};

export const MOCK_CONFIG: AgentConfig = {
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

export const MOCK_SESSIONS: AgentSession[] = [
  { key: "sess_1", clientMode: "browser", clientDisplayName: "Dashboard", createdAt: Date.now() - 3600000, lastMessageAt: Date.now() - 120000 },
  { key: "sess_2", clientMode: "cli", clientDisplayName: "hyper-cli v2.1", createdAt: Date.now() - 7200000, lastMessageAt: Date.now() - 600000 },
  { key: "sess_3", clientMode: "telegram", clientDisplayName: "@user_bot", createdAt: Date.now() - 86400000, lastMessageAt: Date.now() - 1800000 },
];

export const MOCK_CRONS: CronJob[] = [
  { id: "cron_1", schedule: "0 9 * * *", prompt: "Summarize overnight emails and create a morning briefing", description: "Morning briefing", enabled: true, lastRun: Date.now() - 43200000, nextRun: Date.now() + 43200000 },
  { id: "cron_2", schedule: "*/30 * * * *", prompt: "Check deployment health and report any issues", description: "Health check", enabled: true, lastRun: Date.now() - 900000, nextRun: Date.now() + 900000 },
  { id: "cron_3", schedule: "0 17 * * 5", prompt: "Generate a weekly progress report from completed tasks", description: "Weekly report", enabled: false, lastRun: Date.now() - 604800000 },
];

export const MOCK_SUB_AGENTS: SubAgent[] = [
  { id: "sub_1", name: "research-agent", description: "Handles web research and data gathering", status: "RUNNING" },
  { id: "sub_2", name: "code-reviewer", description: "Reviews pull requests and suggests improvements", status: "STOPPED" },
];

export const MOCK_TOOL_CALLS: RecentToolCall[] = [
  { id: "tc_1", name: "file_read", args: '{"path": "/src/gateway-client.ts"}', result: "async connect() { ... }", timestamp: Date.now() - 60000 },
  { id: "tc_2", name: "bash", args: '{"command": "npm run typecheck"}', result: "No errors found.", timestamp: Date.now() - 180000 },
  { id: "tc_3", name: "web_search", args: '{"query": "WebSocket reconnection best practices"}', result: "Found 5 results...", timestamp: Date.now() - 300000 },
  { id: "tc_4", name: "file_write", args: '{"path": "/src/hooks/useGatewayChat.ts"}', result: "File updated.", timestamp: Date.now() - 450000 },
  { id: "tc_5", name: "bash", args: '{"command": "git diff --stat"}', timestamp: Date.now() - 600000 },
];

// ── Capability / config data ──

export const CAPABILITY_SEGMENTS = [
  { label: "Model", complete: true, icon: Brain },
  { label: "System prompt", complete: true, icon: FileText },
  { label: "Tools", complete: true, icon: Wrench },
  { label: "Connection", complete: true, icon: Link2 },
  { label: "Cron", complete: true, icon: Timer },
  { label: "Files", complete: false, icon: FolderOpen },
  { label: "Integrations", complete: false, icon: Zap },
  { label: "Monitoring", complete: false, icon: Activity },
];

export const QUICK_ACTIONS = [
  { label: "Search the web", prompt: "Search the web for...", icon: Globe },
  { label: "Read a file", prompt: "Read the file at...", icon: FolderOpen },
  { label: "Run code", prompt: "Run this code:", icon: Play },
  { label: "Check calendar", prompt: "What's on my calendar today?", icon: Calendar },
  { label: "Summarize emails", prompt: "Summarize my recent emails", icon: Mail },
];

export const ONBOARDING_STEPS = [
  { title: "Agent Status", desc: "Monitor your agent's health, CPU, and memory in real time", icon: Gauge },
  { title: "Configuration", desc: "See and tweak your agent's model, tools, and system prompt", icon: Settings },
  { title: "Chat", desc: "Talk to your agent — it can use tools, search, and execute code", icon: MessageSquare },
  { title: "Connections", desc: "Link external services like Telegram, Gmail, and GitHub", icon: Link2 },
];

export const MOCK_NUDGES = [
  { id: "n1", text: "Schedule a daily task to keep your agent working while you're away", action: "Set up cron", icon: Timer },
  { id: "n2", text: "Connect Telegram to let your agent message you proactively", action: "Add connection", icon: MessageSquare },
  { id: "n3", text: "Your agent has web_search — try asking it to look something up", action: "Try it", icon: Globe },
];

export const MOCK_TOOL_DISCOVERIES = [
  { id: "td1", tool: "web_search", message: "Your agent just used web_search for the first time!", timestamp: Date.now() - 60000 },
  { id: "td2", tool: "bash", message: "Your agent executed a shell command", timestamp: Date.now() - 300000 },
];

export const MOCK_CAPABILITY_DIFFS = [
  { id: "cd1", action: "enabled", capability: "web_search", message: "Agent can now search the web", timestamp: Date.now() - 120000 },
  { id: "cd2", action: "connected", capability: "Gmail", message: "Agent can now read and send emails", timestamp: Date.now() - 600000 },
];

export const MODEL_CAPABILITIES = [
  { label: "Vision", enabled: true, icon: Eye, desc: "Analyze images and screenshots" },
  { label: "Extended Thinking", enabled: true, icon: Brain, desc: "Multi-step reasoning chains" },
  { label: "Code", enabled: true, icon: Code, desc: "Write, review, and debug code" },
  { label: "Tool Use", enabled: true, icon: Wrench, desc: "Call external tools and APIs" },
  { label: "200k Context", enabled: true, icon: FileText, desc: "Process large documents" },
  { label: "Multilingual", enabled: true, icon: Globe, desc: "Communicate in 50+ languages" },
];

export const TOOL_USAGE_STATS = [
  { name: "bash", calls: 42, icon: Terminal },
  { name: "file_read", calls: 67, icon: FolderOpen },
  { name: "file_write", calls: 23, icon: FileText },
  { name: "web_search", calls: 18, icon: Globe },
  { name: "code_exec", calls: 31, icon: Play },
];

export const INTERACTION_PATTERNS = [
  { label: "Code review", pct: 34, color: "#38D39F" },
  { label: "Email triage", pct: 28, color: "#4285f4" },
  { label: "Research", pct: 22, color: "#f0c56c" },
  { label: "File ops", pct: 16, color: "#d05f5f" },
];

export const EXAMPLE_PROMPTS_BY_CAPABILITY: { capability: string; icon: LucideIcon; prompts: string[] }[] = [
  { capability: "Gmail", icon: Mail, prompts: ["Summarize unread emails from this morning", "Draft a reply to the latest from Sarah"] },
  { capability: "Web Search", icon: Globe, prompts: ["Find the latest Next.js 16 changelog", "Research WebSocket reconnection patterns"] },
  { capability: "Bash", icon: Terminal, prompts: ["Run the test suite and report failures", "Check disk usage on the server"] },
  { capability: "File Ops", icon: FolderOpen, prompts: ["Read the gateway-client.ts and explain the connect flow", "List all TypeScript files in src/"] },
  { capability: "Calendar", icon: Calendar, prompts: ["What meetings do I have tomorrow?", "Block 2 hours for deep work on Friday"] },
];

export const AGENT_LIMITS = [
  { label: "Context window", value: "200k tokens", icon: FileText },
  { label: "CPU", value: "2 cores", icon: Cpu },
  { label: "Memory", value: "2 GB", icon: Gauge },
  { label: "Connections", value: "4 active", icon: Link2 },
  { label: "Cron jobs", value: "10 max", icon: Timer },
  { label: "File storage", value: "5 GB", icon: HardDrive },
];

export const RECENT_ACHIEVEMENTS = [
  { label: "Messages processed", value: 142, icon: MessageSquare },
  { label: "Tool calls", value: 38, icon: Wrench },
  { label: "Services connected", value: 4, icon: Link2 },
  { label: "Cron runs", value: 12, icon: Timer },
  { label: "Files touched", value: 27, icon: FolderOpen },
];

export const PERMISSION_MAP = [
  { scope: "File system", access: "read/write", level: "full", icon: FolderOpen },
  { scope: "Shell", access: "execute", level: "full", icon: Terminal },
  { scope: "Network", access: "outbound", level: "filtered", icon: Network },
  { scope: "Connections", access: "read/write", level: "authorized", icon: Link2 },
  { scope: "Cron", access: "manage", level: "full", icon: Timer },
  { scope: "Config", access: "read/patch", level: "self", icon: Settings },
];

// ── SDK-derived mock data ──

export const MOCK_CHANNELS = [
  { id: "telegram", name: "Telegram", status: "connected", account: "@mybot", icon: MessageSquare },
  { id: "slack", name: "Slack", status: "disconnected", account: null, icon: MessageSquare },
  { id: "discord", name: "Discord", status: "disconnected", account: null, icon: MessageSquare },
];

export const MOCK_PROVIDERS = [
  { id: "anthropic", name: "Anthropic", models: ["claude-opus-4-6", "claude-sonnet-4-6"], defaultModel: "claude-opus-4-6" },
  { id: "openai", name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini"], defaultModel: null },
];

export const MOCK_EXEC_QUEUE = [
  { id: "exec_1", command: "rm -rf /tmp/cache/*", requestedAt: Date.now() - 30000 },
  { id: "exec_2", command: "npm install --save axios", requestedAt: Date.now() - 15000 },
];

export const MOCK_AGENT_URLS = [
  { label: "Public URL", url: "https://agent-abc.hypercli.com", icon: Globe },
  { label: "Desktop", url: "https://agent-abc.hypercli.com/desktop", icon: Monitor },
  { label: "Shell", url: "wss://agent-abc.hypercli.com/shell", icon: Terminal },
];

export const MOCK_GATEWAY_STATUS = {
  connected: true,
  protocol: 3,
  version: "0.4.2",
  uptime: 14200,
  pendingMessages: 0,
  activeStreams: 1,
};

export const MOCK_WORKSPACE_FILES = [
  { name: "openclaw.yaml", type: "file" as const, size: 2048 },
  { name: "system-prompt.md", type: "file" as const, size: 4096 },
  { name: "knowledge/", type: "directory" as const, size: 0 },
  { name: "tools/", type: "directory" as const, size: 0 },
];

// ── Group Conversation mock data ──

export const MOCK_CHANNEL_MEMBERS = [
  { id: "u1", name: "Francisco", role: "owner" as const, online: true, avatar: "F" },
  { id: "u2", name: "Myo", role: "contributor" as const, online: true, avatar: "M" },
  { id: "u3", name: "Damian", role: "contributor" as const, online: false, avatar: "D" },
  { id: "u4", name: "Sam", role: "viewer" as const, online: true, avatar: "S" },
];

export const MOCK_AGENT_ROSTER = [
  { id: "a1", name: "research-bot", model: "Opus 4.6", status: "working" as const, task: "Analyzing Q4 report" },
  { id: "a2", name: "code-bot", model: "Sonnet 4.6", status: "idle" as const, task: null },
  { id: "a3", name: "data-bot", model: "Haiku 4.5", status: "waiting" as const, task: "Waiting for dataset approval" },
];

export const MOCK_GROUP_ACTIVITY_FEED = [
  { id: "gf1", type: "agent" as const, actor: "research-bot", action: "Started analyzing Q4 report", ts: Date.now() - 120000 },
  { id: "gf2", type: "user" as const, actor: "Francisco", action: "Uploaded quarterly-data.csv", ts: Date.now() - 300000 },
  { id: "gf3", type: "system" as const, actor: "System", action: "code-bot connected to GitHub", ts: Date.now() - 600000 },
  { id: "gf4", type: "agent" as const, actor: "data-bot", action: "Cleaned 3 anomalies in batch", ts: Date.now() - 900000 },
  { id: "gf5", type: "user" as const, actor: "Myo", action: "Changed agent mode to 'execute'", ts: Date.now() - 1200000 },
];

export const MOCK_THREAD_SUMMARIES = [
  { id: "ts1", title: "Q4 data anomalies", summary: "3 anomalies found in revenue batch — agent recommends manual review", messages: 12, active: true },
  { id: "ts2", title: "API migration plan", summary: "Schema validated, ready for staging deploy pending approval", messages: 28, active: true },
  { id: "ts3", title: "Deploy checklist", summary: "All health checks passing, production deploy completed", messages: 8, active: false },
];

export const MOCK_MENTIONS_TASKS = [
  { id: "mt1", type: "task" as const, text: "Review anomalies in Q4 batch", assignee: "Francisco", done: false, ts: Date.now() - 300000 },
  { id: "mt2", type: "mention" as const, text: "@Myo can you approve the staging deploy?", assignee: "Myo", done: false, ts: Date.now() - 600000 },
  { id: "mt3", type: "task" as const, text: "Update API docs after migration", assignee: "Damian", done: true, ts: Date.now() - 3600000 },
];

export const MOCK_SHARED_FILES = [
  { id: "sf1", name: "quarterly-data.csv", uploader: "Francisco", size: 245760, ts: Date.now() - 300000 },
  { id: "sf2", name: "analysis-report.md", uploader: "research-bot", size: 8192, ts: Date.now() - 120000 },
  { id: "sf3", name: "migration-plan.ts", uploader: "code-bot", size: 4096, ts: Date.now() - 900000 },
];

export const MOCK_PINNED_ITEMS = [
  { id: "pi1", type: "decision" as const, text: "Use streaming migration instead of big-bang", author: "Francisco", ts: Date.now() - 7200000 },
  { id: "pi2", type: "message" as const, text: "Agent must get 2-person approval before any prod deploy", author: "Myo", ts: Date.now() - 14400000 },
  { id: "pi3", type: "artifact" as const, text: "API v2 endpoint spec", author: "code-bot", ts: Date.now() - 21600000 },
];

export const MOCK_WORKSPACE_OUTPUTS = [
  { id: "wo1", title: "Migration Plan", type: "table" as const, rows: 12, updatedBy: "code-bot", ts: Date.now() - 600000 },
  { id: "wo2", title: "Q4 Analysis Summary", type: "document" as const, rows: 0, updatedBy: "research-bot", ts: Date.now() - 120000 },
  { id: "wo3", title: "Deploy Runbook", type: "checklist" as const, rows: 8, updatedBy: "data-bot", ts: Date.now() - 1800000 },
];

export const MOCK_AGENT_FOCUS = {
  mode: "execute" as const,
  activeTools: ["file_read", "web_search", "code_edit", "bash"],
  instructions: "Focus on Q4 data analysis. Do not modify production configs without approval.",
  context: ["quarterly-data.csv", "analysis-report.md"],
};

export const MOCK_GROUP_PERMISSIONS = [
  { id: "gp1", name: "Francisco", role: "admin" as const, canInstruct: true, canApprove: true },
  { id: "gp2", name: "Myo", role: "operator" as const, canInstruct: true, canApprove: true },
  { id: "gp3", name: "Damian", role: "contributor" as const, canInstruct: true, canApprove: false },
  { id: "gp4", name: "Sam", role: "viewer" as const, canInstruct: false, canApprove: false },
];

export const MOCK_AGENT_CHANGELOG = [
  { id: "ac1", action: "Mode changed to 'execute'", by: "Myo", ts: Date.now() - 1200000 },
  { id: "ac2", action: "Connected GitHub integration", by: "Francisco", ts: Date.now() - 3600000 },
  { id: "ac3", action: "Updated system instructions", by: "Francisco", ts: Date.now() - 7200000 },
  { id: "ac4", action: "Added data-bot to channel", by: "Myo", ts: Date.now() - 14400000 },
];

export const MOCK_DECISION_LOG = [
  { id: "dl1", decision: "Use streaming migration approach", rationale: "Less risk, easier rollback", decidedBy: "Francisco", ts: Date.now() - 7200000, status: "active" as const },
  { id: "dl2", decision: "Require 2-person approval for prod deploys", rationale: "Compliance requirement", decidedBy: "Myo", ts: Date.now() - 14400000, status: "active" as const },
  { id: "dl3", decision: "Defer v3 API until next quarter", rationale: "Team bandwidth", decidedBy: "Francisco", ts: Date.now() - 86400000, status: "superseded" as const },
];

export const MOCK_HANDOFF = {
  lastUpdated: Date.now() - 1800000,
  updatedBy: "Francisco",
  inProgress: [
    { task: "Q4 data analysis", owner: "research-bot", status: "Running — 3 anomalies found, pending review" },
    { task: "API migration", owner: "code-bot", status: "Schema validated, waiting for staging approval" },
  ],
  needsAttention: [
    { task: "Review data anomalies", priority: "high" as const, note: "3 flagged items in Q4 batch need human review" },
    { task: "Approve staging deploy", priority: "medium" as const, note: "Blocked on Myo's approval" },
  ],
};

// ── Module definitions ──

export const OVERVIEW_MODULE_KEYS: ModuleDefinition[] = [
  // ── General (always available) ──
  // Design doc §2.1 — Overview modules on by default: Agent Card, Active Sessions,
  // Workspace Files, What Can I Do?, Example Prompts. Config Quick-View is
  // conditional per §11 and stays off until metrics/identity wiring lands.
  { key: "completeness", label: "Agent Readiness", section: "general", tier: "basic" },
  { key: "status", label: "Status Card", section: "general", tier: "basic" },
  { key: "config", label: "Config", section: "general", tier: "basic" },
  { key: "modelCaps", label: "Model Capabilities", section: "general", tier: "advanced" },
  { key: "toolUsage", label: "Tool Usage", section: "general", tier: "advanced" },
  { key: "limits", label: "Limits", section: "general", tier: "advanced" },
  { key: "achievements", label: "Achievements", section: "general", tier: "advanced" },
  { key: "permissions", label: "Permissions", section: "general", tier: "advanced" },
  { key: "providers", label: "Providers", section: "general", tier: "advanced" },
  { key: "agentUrls", label: "Endpoints", section: "general", tier: "advanced" },
  { key: "gateway", label: "Gateway Status", section: "general", tier: "advanced" },
  { key: "workspace", label: "Workspace Files", section: "general", tier: "basic", defaultVisible: true },
  { key: "quickActions", label: "Quick Actions", section: "general", tier: "basic" },
  { key: "whatCanIDo", label: "What Can I Do?", section: "general", tier: "basic", defaultVisible: true },
  { key: "toolDiscovery", label: "Tool Discovery", section: "general", tier: "basic" },
  { key: "agentCard", label: "Agent Card", section: "general", tier: "basic", defaultVisible: true },
  // ── Single Conversation (user-agent, agent-agent) ──
  { key: "patterns", label: "Interaction Patterns", section: "single-conversation", contextFilter: ["user-agent", "agent-agent"], tier: "basic" },
  { key: "prompts", label: "Example Prompts", section: "single-conversation", contextFilter: ["user-agent", "agent-agent"], tier: "basic", defaultVisible: true },
  { key: "sessions", label: "Sessions", section: "single-conversation", contextFilter: ["user-agent", "agent-agent"], tier: "basic", defaultVisible: true },
  { key: "execQueue", label: "Exec Approval", section: "single-conversation", contextFilter: ["user-agent", "agent-agent"], tier: "advanced" },
  { key: "nudges", label: "Nudges", section: "single-conversation", contextFilter: ["user-agent", "agent-agent"], tier: "basic" },
  // ── Group Conversation ──
  { key: "channels", label: "Channels", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "subAgents", label: "Sub-agents", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "connectionRecs", label: "Connection Recs", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "capDiff", label: "Capability Diff", section: "group-conversation", contextFilter: ["group"], tier: "advanced" },
  { key: "members", label: "Members", section: "group-conversation", contextFilter: ["group"], tier: "basic", defaultVisible: true },
  { key: "agentRoster", label: "Agent Roster", section: "group-conversation", contextFilter: ["group"], tier: "basic", defaultVisible: true },
  { key: "groupActivityFeed", label: "Activity Feed", section: "group-conversation", contextFilter: ["group"], tier: "basic", defaultVisible: true },
  { key: "threadSummary", label: "Thread Summary", section: "group-conversation", contextFilter: ["group"], tier: "basic", defaultVisible: true },
  { key: "mentionsTasks", label: "Mentions & Tasks", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "sharedFiles", label: "Shared Files", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "pinnedItems", label: "Pinned Items", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "sharedWorkspace", label: "Workspace", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "agentFocus", label: "Agent Focus", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "groupPermissions", label: "Group Permissions", section: "group-conversation", contextFilter: ["group"], tier: "advanced" },
  { key: "agentChangelog", label: "Agent Changelog", section: "group-conversation", contextFilter: ["group"], tier: "basic" },
  { key: "decisionLog", label: "Decision Log", section: "group-conversation", contextFilter: ["group"], tier: "advanced" },
  { key: "handoff", label: "Handoff", section: "group-conversation", contextFilter: ["group"], tier: "advanced" },
  { key: "conversationGraph", label: "Conversation Graph", section: "group-conversation", contextFilter: ["group"], tier: "advanced" },
];

// ── Handoff presets ──

export const HANDOFF_IP_PRESETS = [
  { task: "Q4 data analysis", subtitle: "research-bot · 3 anomalies found" },
  { task: "API migration", subtitle: "code-bot · Waiting for staging approval" },
  { task: "Deploy to staging", subtitle: "deploy-bot · Building image" },
  { task: "Security audit", subtitle: "security-bot · Scanning deps" },
];

export const HANDOFF_NA_PRESETS = [
  { task: "Review data anomalies", subtitle: "3 flagged items need review" },
  { task: "Approve staging deploy", subtitle: "Blocked on Myo's approval" },
  { task: "Rotate gateway tokens", subtitle: "Expiring in 24h" },
  { task: "Review PR #847", subtitle: "Revenue parsing fix" },
];
