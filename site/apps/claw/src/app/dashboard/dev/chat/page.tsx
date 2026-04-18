"use client";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  Bot,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  Plus,
  Play,
  Pause,
  ChevronDown,
  ChevronRight,
  Wrench,
  Brain,
  Settings,
  Users,
  Zap,
  FolderOpen,
} from "lucide-react";
import {
  ChatMessageBubble,
  ChatThinkingIndicator,
  type FeatureVariant,
  type ThinkingVariant,
  type TimestampVariant,
  type BubblesVariant,
  type NameVariant,
  type AnimationVariant,
  type ThemeVariant,
  type StreamingVariant,
} from "@/components/dashboard/ChatMessage";
import { AgentView, ConnectionDetail, type TabId as AgentTabId } from "@/components/dashboard/AgentView";
import { AgentsChannelsSidebar, MOCK_CONVERSATION_THREADS, MOCK_PARTICIPANTS, type AgentsChannelsSidebarVariant, type Participant } from "@/components/dashboard/AgentsChannelsSidebar";
import { AddParticipantPanel } from "@/components/dashboard/AddParticipantPanel";
import { FilesDrawer } from "@/components/dashboard/files";
import { FilesPanel } from "@/components/dashboard/files-panel";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import { agentAvatar } from "@/lib/avatar";

type InputVariant = FeatureVariant;

// ── Reusable radio group for the control panel ──
function VariantGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">{label}</p>
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 text-xs text-foreground cursor-pointer hover:text-foreground/80">
          <input
            type="radio"
            name={label}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="accent-[#38D39F]"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ── Mock presets ──

const MOCK_MESSAGES: Record<string, ChatMessage> = {
  userSimple: {
    role: "user",
    content: "Can you help me set up a Next.js project with Tailwind CSS?",
    timestamp: Date.now() - 60000,
  },
  assistantSimple: {
    role: "assistant",
    content:
      "Sure! Here's how to set up a Next.js project with Tailwind CSS:\n\n1. Create the project:\n```bash\nnpx create-next-app@latest my-app --tailwind\n```\n\n2. Navigate into it:\n```bash\ncd my-app\n```\n\n3. Start the dev server:\n```bash\nnpm run dev\n```\n\nThat's it! The `--tailwind` flag automatically configures Tailwind CSS for you.",
    timestamp: Date.now() - 55000,
  },
  assistantThinking: {
    role: "assistant",
    content:
      "Based on my analysis, the performance bottleneck is in the `useGatewayChat` hook. The WebSocket reconnection logic creates a new closure on every retry, which accumulates event listeners.",
    thinking:
      "Let me think about what could cause the gateway disconnection issue.\n\nThe user mentioned that the chat disconnects after about 5 minutes. This is a common pattern with WebSocket connections that don't implement proper keep-alive mechanisms.\n\nLooking at the code, I see that the `GatewayClient` has a reconnection mechanism, but it creates a new closure each time. If the cleanup isn't working properly, we could be accumulating event handlers.\n\nI should check:\n1. Whether the cleanup function in the useEffect is being called\n2. Whether the `cancelled` flag is being set correctly\n3. If there's a memory leak from stale closures",
    timestamp: Date.now() - 50000,
  },
  assistantToolCall: {
    role: "assistant",
    content: "I found the issue. The file `gateway-client.ts` has a missing null check on line 142.",
    toolCalls: [
      {
        id: "call_1",
        name: "Read",
        args: '{"file_path": "src/gateway-client.ts", "offset": 130, "limit": 20}',
        result:
          '140: async connect() {\n141:   const ws = new WebSocket(this.url);\n142:   ws.onmessage = (ev) => this.handleMessage(ev.data);\n143:   ws.onerror = (ev) => this.onError?.(ev);\n144: }',
      },
    ],
    timestamp: Date.now() - 45000,
  },
  assistantToolPending: {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call_2",
        name: "Bash",
        args: '{"command": "npm run build"}',
      },
    ],
    timestamp: Date.now() - 40000,
  },
  assistantMultiTool: {
    role: "assistant",
    content: "I've updated both files. Here's a summary of the changes.",
    toolCalls: [
      {
        id: "call_3",
        name: "Edit",
        args: '{"file_path": "src/hooks/useGatewayChat.ts", "old_string": "gw.connect()", "new_string": "await gw.connect()"}',
        result: "File edited successfully.",
      },
      {
        id: "call_4",
        name: "Edit",
        args: '{"file_path": "src/gateway-client.ts", "old_string": "this.ws = ws", "new_string": "this.ws = ws;\\nthis.setupPingInterval()"}',
        result: "File edited successfully.",
      },
      {
        id: "call_5",
        name: "Bash",
        args: '{"command": "npm run typecheck"}',
      },
    ],
    timestamp: Date.now() - 35000,
  },
  systemError: {
    role: "system",
    content: "Error: WebSocket connection closed unexpectedly (code 1006)",
    timestamp: Date.now() - 30000,
  },
  assistantLong: {
    role: "assistant",
    content: `# Architecture Overview

## Gateway Protocol

The gateway uses a WebSocket-based RPC protocol with challenge-response authentication. Here's how it works:

### Connection Flow

1. **Handshake**: Client sends a \`hello\` message with its version and capabilities
2. **Challenge**: Server responds with a cryptographic challenge
3. **Auth**: Client signs the challenge with its gateway token
4. **Ready**: Server confirms and starts sending events

### Event Types

| Event | Description |
|-------|-------------|
| \`chat.content\` | Streaming text delta |
| \`chat.thinking\` | Reasoning/thinking delta |
| \`chat.tool_call\` | Tool invocation |
| \`chat.done\` | Stream complete |
| \`chat.error\` | Error occurred |

### Code Example

\`\`\`typescript
const client = new GatewayClient({
  url: "wss://openclaw-agent.hypercli.com",
  gatewayToken: token,
  onHello: () => console.log("Connected!"),
  onClose: ({ error }) => console.error("Disconnected:", error),
});

await client.connect();
const history = await client.chatHistory("main", 100);
\`\`\`

> **Note**: The gateway automatically handles reconnection with exponential backoff.`,
    thinking: "The user asked about the architecture, so I should give a comprehensive overview covering the gateway protocol, event types, and a code example.",
    timestamp: Date.now() - 25000,
  },
  userWithFiles: {
    role: "user",
    content: "Can you check these files for issues?",
    files: [
      { name: "gateway-client.ts", path: "/src/gateway-client.ts", type: "text/typescript" },
      { name: "useGatewayChat.ts", path: "/src/hooks/useGatewayChat.ts", type: "text/typescript" },
    ],
    timestamp: Date.now() - 20000,
  },
};

// ── Scenario presets ──

type Scenario = { name: string; messages: ChatMessage[]; sending: boolean; connecting: boolean; connected: boolean };

const SCENARIOS: Scenario[] = [
  {
    name: "Empty — Connected",
    messages: [],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Empty — Connecting",
    messages: [],
    sending: false,
    connecting: true,
    connected: false,
  },
  {
    name: "Empty — Disconnected",
    messages: [],
    sending: false,
    connecting: false,
    connected: false,
  },
  {
    name: "Simple conversation",
    messages: [MOCK_MESSAGES.userSimple, MOCK_MESSAGES.assistantSimple],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Thinking + response",
    messages: [
      { role: "user", content: "Why does the chat disconnect after 5 minutes?", timestamp: Date.now() - 52000 },
      MOCK_MESSAGES.assistantThinking,
    ],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Tool call — completed",
    messages: [
      { role: "user", content: "Find the bug in gateway-client.ts", timestamp: Date.now() - 47000 },
      MOCK_MESSAGES.assistantToolCall,
    ],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Tool call — pending (spinner)",
    messages: [
      { role: "user", content: "Run the build", timestamp: Date.now() - 42000 },
      MOCK_MESSAGES.assistantToolPending,
    ],
    sending: true,
    connecting: false,
    connected: true,
  },
  {
    name: "Multi-tool + pending",
    messages: [
      { role: "user", content: "Fix the reconnection bug", timestamp: Date.now() - 37000 },
      MOCK_MESSAGES.assistantMultiTool,
    ],
    sending: true,
    connecting: false,
    connected: true,
  },
  {
    name: "Error message",
    messages: [
      { role: "user", content: "Connect to the agent", timestamp: Date.now() - 32000 },
      MOCK_MESSAGES.systemError,
    ],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Long markdown response",
    messages: [
      { role: "user", content: "Explain the gateway architecture", timestamp: Date.now() - 27000 },
      MOCK_MESSAGES.assistantLong,
    ],
    sending: false,
    connecting: false,
    connected: true,
  },
  {
    name: "Waiting for response (thinking indicator)",
    messages: [
      { role: "user", content: "What's the best way to handle WebSocket reconnection?", timestamp: Date.now() - 5000 },
    ],
    sending: true,
    connecting: false,
    connected: true,
  },
  {
    name: "Full conversation",
    messages: [
      MOCK_MESSAGES.userSimple,
      MOCK_MESSAGES.assistantSimple,
      { role: "user", content: "Why does the chat disconnect after 5 minutes?", timestamp: Date.now() - 52000 },
      MOCK_MESSAGES.assistantThinking,
      { role: "user", content: "Find the bug in gateway-client.ts", timestamp: Date.now() - 47000 },
      MOCK_MESSAGES.assistantToolCall,
      { role: "user", content: "Fix the reconnection bug", timestamp: Date.now() - 37000 },
      MOCK_MESSAGES.assistantMultiTool,
      MOCK_MESSAGES.systemError,
      MOCK_MESSAGES.userWithFiles,
      MOCK_MESSAGES.assistantLong,
    ],
    sending: false,
    connecting: false,
    connected: true,
  },
];

// ── Mock group conversation messages ──

interface GroupMessage extends ChatMessage {
  senderId: string;
  senderName: string;
}

const MOCK_GROUP_MESSAGES: GroupMessage[] = [
  { role: "user", content: "Let's review the Q4 data. @research-bot can you pull the latest?", senderId: "user-1", senderName: "You", timestamp: Date.now() - 600000 },
  { role: "assistant", content: "Pulling Q4 dataset now. I can see 3 anomalies in the revenue batch that need attention. Two are in the APAC region and one in EMEA.", senderId: "agent-research", senderName: "research-bot", timestamp: Date.now() - 540000 },
  { role: "assistant", content: "I can cross-reference those against the API ingestion logs. Give me a moment.", senderId: "agent-data", senderName: "data-bot", timestamp: Date.now() - 480000 },
  { role: "user", content: "Good idea. Flag anything that deviates more than 2 standard deviations from the rolling average.", senderId: "user-1", senderName: "You", timestamp: Date.now() - 420000 },
  {
    role: "assistant",
    content: "Found 2 entries exceeding the threshold:\n\n| Entry | Region | Deviation | Date |\n|-------|--------|-----------|------|\n| #4821 | APAC | +3.2σ | Mar 15 |\n| #4837 | EMEA | +2.8σ | Mar 18 |\n\nBoth correlate with the ingestion pipeline deploy on March 15.",
    senderId: "agent-research",
    senderName: "research-bot",
    thinking: "Looking at the Q4 data, I need to compute standard deviations for each region's revenue entries. The rolling average window is 30 days. Let me check entries that fall outside 2σ...\n\nAPAC entry #4821: value 142,000 vs rolling avg 98,500 (σ=13,600) → 3.2σ deviation\nEMEA entry #4837: value 89,200 vs rolling avg 67,100 (σ=7,900) → 2.8σ deviation\n\nBoth occurred after the March 15 deploy — likely a pipeline bug.",
    timestamp: Date.now() - 360000,
  },
  { role: "assistant", content: "Confirmed — those 2 entries correlate with a schema change in the ingestion pipeline deployed on March 15. The `revenue_amount` field was briefly parsed as cents instead of dollars.", senderId: "agent-data", senderName: "data-bot", timestamp: Date.now() - 300000 },
  { role: "system", content: "code-bot joined the conversation", senderId: "system", senderName: "System", timestamp: Date.now() - 240000 },
  { role: "assistant", content: "I can see the commit that caused this — `a]c3f29` in the ingestion service. I can prepare a fix and a backfill script for the affected entries. Want me to proceed?", senderId: "agent-code", senderName: "code-bot", timestamp: Date.now() - 180000 },
  { role: "user", content: "Yes, prepare the fix but don't deploy yet. We need Myo to approve before pushing to production.", senderId: "user-1", senderName: "You", timestamp: Date.now() - 120000 },
  {
    role: "assistant",
    content: "Fix ready in PR #847. The backfill script will correct 2 entries. Waiting for approval before deploy.",
    senderId: "agent-code",
    senderName: "code-bot",
    toolCalls: [
      { id: "tc1", name: "Edit", args: '{"file_path": "src/ingestion/parser.ts", "old_string": "parseFloat(raw)", "new_string": "parseFloat(raw) * 100"}', result: "File edited successfully." },
      { id: "tc2", name: "Bash", args: '{"command": "git commit -m \\"Fix revenue parsing: cents→dollars\\""}', result: "Created commit a8f2c1d." },
    ],
    timestamp: Date.now() - 60000,
  },
];

// ── Streaming simulation ──

const STREAMING_TEXT =
  "I'll help you debug that issue. Let me take a look at the gateway client code to understand the reconnection logic.\n\nThe problem seems to be in the `connect()` method where the WebSocket cleanup isn't properly handling the `cancelled` flag. When the component unmounts during an active connection attempt, the cleanup runs but the `onHello` callback can still fire because the WebSocket handshake was already in progress.\n\nHere's the fix:\n\n```typescript\nonHello: () => {\n  if (cancelled) return; // Add this guard\n  setConnected(true);\n  setConnecting(false);\n}\n```\n\nThis ensures we don't update state after the effect has been cleaned up.";

// ── Dev page ──

export default function DevChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(true);
  const [streamingActive, setStreamingActive] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<any>(null);
  const [devTab, setDevTab] = useState<"chat" | "agent-view" | "files">("chat");
  const [controlPanelOpen, setControlPanelOpen] = useState(false);

  // ── Agent View toggles ──
  const [showAgentView, setShowAgentView] = useState(true);
  const [agentViewTab, setAgentViewTab] = useState<AgentTabId>("overview");
  const [showMarketplace, setShowMarketplace] = useState(true);
  const [showRecommended, setShowRecommended] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
  const [connectionRowStyle, setConnectionRowStyle] = useState<FeatureVariant>("off");
  const [tabBarStyle, setTabBarStyle] = useState<FeatureVariant>("off");
  const [detailStyle, setDetailStyle] = useState<FeatureVariant>("off");
  const [showStatusCard, setShowStatusCard] = useState(true);
  const [showConfigQuickView, setShowConfigQuickView] = useState(true);
  const [showActiveSessions, setShowActiveSessions] = useState(true);
  const [showCronManager, setShowCronManager] = useState(true);
  const [showRecentToolCalls, setShowRecentToolCalls] = useState(true);
  const [showSubAgents, setShowSubAgents] = useState(true);
  const [skillsVariant, setSkillsVariant] = useState<FeatureVariant>("off");
  const [activityVariant, setActivityVariant] = useState<FeatureVariant>("off");
  const [completenessRingVariant, setCompletenessRingVariant] = useState<FeatureVariant>("v1");
  const [quickActionsVariant, setQuickActionsVariant] = useState<FeatureVariant>("off");
  const [emptyStatesVariant, setEmptyStatesVariant] = useState<FeatureVariant>("off");
  const [toolDiscoveryVariant, setToolDiscoveryVariant] = useState<FeatureVariant>("off");
  const [connectionRecsVariant, setConnectionRecsVariant] = useState<FeatureVariant>("off");
  const [capabilityDiffVariant, setCapabilityDiffVariant] = useState<FeatureVariant>("off");
  const [agentCardVariant, setAgentCardVariant] = useState<FeatureVariant>("v1");
  const [nudgesVariant, setNudgesVariant] = useState<FeatureVariant>("off");
  const [onboardingVariant, setOnboardingVariant] = useState<FeatureVariant>("off");
  const [whatCanIDoVariant, setWhatCanIDoVariant] = useState<FeatureVariant>("v1");
  const [modelCapsVariant, setModelCapsVariant] = useState<FeatureVariant>("off");
  const [toolUsageVariant, setToolUsageVariant] = useState<FeatureVariant>("off");
  const [interactionPatternsVariant, setInteractionPatternsVariant] = useState<FeatureVariant>("off");
  const [examplePromptsVariant, setExamplePromptsVariant] = useState<FeatureVariant>("off");
  const [limitsVariant, setLimitsVariant] = useState<FeatureVariant>("off");
  const [achievementsVariant, setAchievementsVariant] = useState<FeatureVariant>("off");
  const [permissionsVariant, setPermissionsVariant] = useState<FeatureVariant>("off");
  const [channelsVariant, setChannelsVariant] = useState<FeatureVariant>("off");
  const [providersVariant, setProvidersVariant] = useState<FeatureVariant>("off");
  const [execQueueVariant, setExecQueueVariant] = useState<FeatureVariant>("off");
  const [agentUrlsVariant, setAgentUrlsVariant] = useState<FeatureVariant>("off");
  const [gatewayStatusVariant, setGatewayStatusVariant] = useState<FeatureVariant>("off");
  const [workspaceFilesVariant, setWorkspaceFilesVariant] = useState<FeatureVariant>("off");

  // ── Group conversation modules ──
  const [membersVariant, setMembersVariant] = useState<FeatureVariant>("v1");
  const [agentRosterVariant, setAgentRosterVariant] = useState<FeatureVariant>("v1");
  const [groupActivityFeedVariant, setGroupActivityFeedVariant] = useState<FeatureVariant>("v1");
  const [threadSummaryVariant, setThreadSummaryVariant] = useState<FeatureVariant>("v1");
  const [mentionsTasksVariant, setMentionsTasksVariant] = useState<FeatureVariant>("off");
  const [sharedFilesVariant, setSharedFilesVariant] = useState<FeatureVariant>("off");
  const [pinnedItemsVariant, setPinnedItemsVariant] = useState<FeatureVariant>("off");
  const [sharedWorkspaceVariant, setSharedWorkspaceVariant] = useState<FeatureVariant>("off");
  const [agentFocusVariant, setAgentFocusVariant] = useState<FeatureVariant>("off");
  const [groupPermissionsVariant, setGroupPermissionsVariant] = useState<FeatureVariant>("off");
  const [agentChangelogVariant, setAgentChangelogVariant] = useState<FeatureVariant>("off");
  const [decisionLogVariant, setDecisionLogVariant] = useState<FeatureVariant>("off");
  const [handoffVariant, setHandoffVariant] = useState<FeatureVariant>("off");
  const [conversationGraphVariant, setConversationGraphVariant] = useState<FeatureVariant>("off");

  // ── Feature variants ──
  const [thinkingVariant, setThinkingVariant] = useState<ThinkingVariant>("off");
  const [timestampVariant, setTimestampVariant] = useState<TimestampVariant>("off");
  const [bubblesVariant, setBubblesVariant] = useState<BubblesVariant>("off");
  const [nameVariant, setNameVariant] = useState<NameVariant>("off");
  const [animationVariant, setAnimationVariant] = useState<AnimationVariant>("off");
  const [inputVariant, setInputVariant] = useState<InputVariant>("off");
  const [themeVariant, setThemeVariant] = useState<ThemeVariant>("off");
  const [streamingVariant, setStreamingVariant] = useState<StreamingVariant>("off");

  // ── Conversations Sidebar ──
  const [conversationsSidebarVariant, setAgentsChannelsSidebarVariant] = useState<AgentsChannelsSidebarVariant | "off">("v3");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<typeof MOCK_CONVERSATION_THREADS>([]);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);
  const [mockFiles, setMockFiles] = useState<{ name: string; path: string; type: "file" | "directory"; size?: number }[]>([]);
  const [mockFileContents, setMockFileContents] = useState<Record<string, string>>({});
  const [filesVariant, setFilesVariant] = useState<"drawer" | "panel">("drawer");

  const groupThreadIds = useMemo(
    () => new Set(threads.filter((t) => t.kind === "group" || t.kind === "agent-agent").map((t) => t.id)),
    [threads],
  );

  const selectedThread = useMemo(
    () => selectedThreadId ? threads.find((t) => t.id === selectedThreadId) ?? null : null,
    [threads, selectedThreadId],
  );

  const activeAgentName = useMemo(() => {
    if (!selectedThread) return null;
    const agents = selectedThread.participants.filter((p) => p.type === "agent");
    if (agents.length === 0) return null;
    if (agents.length === 1) return agents[0].name;
    return agents.map((a) => a.name).join(", ");
  }, [selectedThread]);

  const handleAddParticipant = useCallback((participant: Participant) => {
    if (!selectedThreadId) return;
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== selectedThreadId) return t;
        if (t.participants.some((p) => p.id === participant.id)) return t;
        const newParticipants = [...t.participants, participant];
        const agentCount = newParticipants.filter((p) => p.type === "agent").length;
        const userCount = newParticipants.filter((p) => p.type === "user").length;
        const newKind = agentCount >= 2 || userCount >= 2 ? "group" as const
          : agentCount === 1 && userCount === 0 ? "agent-agent" as const
          : "user-agent" as const;
        return {
          ...t,
          participants: newParticipants,
          kind: newKind,
        };
      }),
    );
  }, [selectedThreadId]);

  const handleNewThread = useCallback(() => {
    const id = `t-new-${Date.now()}`;
    const newThread: typeof threads[number] = {
      id,
      sessionKey: `session-${id}`,
      participants: [{ id: "user-1", name: "You", type: "user" }],
      kind: "user-agent",
      lastMessage: "",
      lastMessageBy: "user-1",
      lastMessageAt: Date.now(),
      messageCount: 0,
      unreadCount: 0,
      isActive: true,
    };
    setThreads((prev) => [newThread, ...prev]);
    setSelectedThreadId(id);
    setAddParticipantOpen(true);
  }, []);

  const handleStartAgentChat = useCallback((agent: Participant) => {
    const id = `t-new-${Date.now()}`;
    const newThread: typeof threads[number] = {
      id,
      sessionKey: `session-${id}`,
      participants: [{ id: "user-1", name: "You", type: "user" }, agent],
      kind: "user-agent",
      lastMessage: "",
      lastMessageBy: "user-1",
      lastMessageAt: Date.now(),
      messageCount: 0,
      unreadCount: 0,
      isActive: true,
    };
    setThreads((prev) => [newThread, ...prev]);
    setSelectedThreadId(id);
  }, []);

  const handleCreateChannel = useCallback((name: string, agents: Participant[], users: Participant[]) => {
    const id = `t-ch-${Date.now()}`;
    const allParticipants: Participant[] = [
      { id: "user-1", name: "You", type: "user" },
      ...agents,
      ...users.filter((u) => u.id !== "user-1"),
    ];
    const newThread: typeof threads[number] = {
      id,
      sessionKey: `session-${id}`,
      participants: allParticipants,
      kind: "group",
      title: name,
      lastMessage: "",
      lastMessageBy: "user-1",
      lastMessageAt: Date.now(),
      messageCount: 0,
      unreadCount: 0,
      isActive: true,
    };
    setThreads((prev) => [newThread, ...prev]);
    setSelectedThreadId(id);
  }, []);

  const handleRenameThread = useCallback((threadId: string, title: string) => {
    setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, title } : t));
  }, []);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleDeleteThread = useCallback((threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;

    const hasAgents = thread.participants.some((p) => p.type === "agent");
    if (hasAgents) {
      // Needs confirmation
      setPendingDeleteId(threadId);
    } else {
      // Solo thread — delete immediately
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (selectedThreadId === threadId) setSelectedThreadId(null);
    }
  }, [threads, selectedThreadId]);

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    setThreads((prev) => prev.filter((t) => t.id !== pendingDeleteId));
    if (selectedThreadId === pendingDeleteId) setSelectedThreadId(null);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedThreadId]);

  const applyPreset = useCallback((v: FeatureVariant) => {
    setThinkingVariant(v);
    setTimestampVariant(v);
    setBubblesVariant(v);
    setNameVariant(v);
    setAnimationVariant(v);
    setInputVariant(v);
    setThemeVariant(v);
    setStreamingVariant(v);
  }, []);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Cleanup streaming on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    };
  }, []);

  const loadScenario = useCallback((scenario: Scenario) => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setStreamingActive(false);
    setMessages(scenario.messages.map((m) => ({ ...m })));
    setSending(scenario.sending);
    setConnecting(scenario.connecting);
    setConnected(scenario.connected);
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, { ...msg, timestamp: Date.now() }]);
  }, []);

  const clearMessages = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setStreamingActive(false);
    setMessages([]);
    setSending(false);
  }, []);

  const handleSend = useCallback(() => {
    if (!input.trim() || !connected || sending) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // Auto-reply after a short delay
    setSending(true);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `You said: "${userMsg.content}"\n\nThis is a mock response. Use the control panel to inject specific message types.`,
          timestamp: Date.now(),
        },
      ]);
      setSending(false);
    }, 1500);
  }, [input, connected, sending]);

  const simulateStreaming = useCallback(() => {
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
      setStreamingActive(false);
      setSending(false);
      return;
    }

    // Add user message
    setMessages((prev) => [
      ...prev,
      { role: "user", content: "Can you debug the gateway reconnection issue?", timestamp: Date.now() },
    ]);
    setSending(true);
    setStreamingActive(true);

    let charIndex = 0;
    const thinkingText = "Let me analyze the gateway reconnection logic and identify where the issue might be occurring...";
    let thinkingDone = false;
    let toolCallAdded = false;
    let toolResultAdded = false;

    streamIntervalRef.current = setInterval(() => {
      // Phase 1: Thinking (first ~90 chars)
      if (!thinkingDone) {
        charIndex += 3;
        const chunk = thinkingText.slice(0, charIndex);
        setMessages((prev) => {
          const withoutLast = prev[prev.length - 1]?.role === "assistant" ? prev.slice(0, -1) : prev;
          return [
            ...withoutLast,
            { role: "assistant", content: "", thinking: chunk, timestamp: Date.now() },
          ];
        });
        if (charIndex >= thinkingText.length) {
          thinkingDone = true;
          charIndex = 0;
        }
        return;
      }

      // Phase 2: Tool call (pending)
      if (!toolCallAdded) {
        toolCallAdded = true;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role !== "assistant") return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              toolCalls: [
                { id: "stream_call_1", name: "Read", args: '{"file_path": "src/gateway-client.ts"}' },
              ],
            },
          ];
        });
        return;
      }

      // Phase 3: Tool result
      if (!toolResultAdded) {
        toolResultAdded = true;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role !== "assistant") return prev;
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              toolCalls: [
                {
                  id: "stream_call_1",
                  name: "Read",
                  args: '{"file_path": "src/gateway-client.ts"}',
                  result: "async connect() {\n  const ws = new WebSocket(this.url);\n  // missing null check here\n}",
                },
              ],
            },
          ];
        });
        return;
      }

      // Phase 4: Content streaming
      charIndex += 4;
      const contentChunk = STREAMING_TEXT.slice(0, charIndex);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role !== "assistant") return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, content: contentChunk },
        ];
      });

      if (charIndex >= STREAMING_TEXT.length) {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
        setStreamingActive(false);
        setSending(false);
      }
    }, 50);
  }, []);

  // Block render in production
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        <p>Dev route — not available in production.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] overflow-hidden relative">
      {/* ── Floating Control Panel Toggle ── */}
      <button
        onClick={() => setControlPanelOpen((v) => !v)}
        className={`fixed top-20 left-4 z-50 w-9 h-9 rounded-full flex items-center justify-center transition-all shadow-lg ${
          controlPanelOpen
            ? "bg-[#38D39F] text-[#0a0a0b]"
            : "bg-[#1a1a1c] border border-border text-text-muted hover:text-foreground hover:border-border-strong"
        }`}
        title="Toggle variant controls"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* ── Floating Control Panel ── */}
      {controlPanelOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setControlPanelOpen(false)} />
          {/* Panel */}
          <div className="fixed top-16 left-4 z-50 w-80 max-h-[calc(100dvh-6rem)] flex flex-col rounded-xl border border-border bg-[#111113] shadow-2xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => setDevTab("chat")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              devTab === "chat"
                ? "text-foreground border-b-2 border-[#38D39F]"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setDevTab("agent-view")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              devTab === "agent-view"
                ? "text-foreground border-b-2 border-[#38D39F]"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Agent View
          </button>
          <button
            onClick={() => setDevTab("files")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              devTab === "files"
                ? "text-foreground border-b-2 border-[#38D39F]"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Files
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {devTab === "chat" && (<>

        {/* Connection state toggles */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Connection State</h3>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={connected}
              onChange={(e) => {
                setConnected(e.target.checked);
                if (e.target.checked) setConnecting(false);
              }}
              className="accent-[#38D39F]"
            />
            Connected
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={connecting}
              onChange={(e) => {
                setConnecting(e.target.checked);
                if (e.target.checked) setConnected(false);
              }}
              className="accent-[#f0c56c]"
            />
            Connecting
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={sending}
              onChange={(e) => setSending(e.target.checked)}
              className="accent-[#f0c56c]"
            />
            Sending (thinking indicator)
          </label>
        </div>

        {/* Scenarios */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Scenarios</h3>
          <div className="space-y-1">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.name}
                onClick={() => loadScenario(scenario)}
                className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-surface-low text-text-secondary hover:text-foreground transition-colors"
              >
                {scenario.name}
              </button>
            ))}
          </div>
        </div>

        {/* Add individual messages */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Add Message</h3>
          <div className="grid grid-cols-1 gap-1">
            <button
              onClick={() => addMessage(MOCK_MESSAGES.userSimple)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-high text-foreground hover:bg-surface-high/80 transition-colors text-left"
            >
              + User message
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantSimple)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (simple)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantThinking)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (with thinking)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantToolCall)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (tool call done)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantToolPending)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (tool call pending)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantMultiTool)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (multi-tool)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.assistantLong)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-low text-foreground hover:bg-surface-low/80 transition-colors text-left"
            >
              + Assistant (long markdown)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.userWithFiles)}
              className="text-xs px-2 py-1.5 rounded-md bg-surface-high text-foreground hover:bg-surface-high/80 transition-colors text-left"
            >
              + User (with files)
            </button>
            <button
              onClick={() => addMessage(MOCK_MESSAGES.systemError)}
              className="text-xs px-2 py-1.5 rounded-md bg-[#d05f5f]/10 text-[#d05f5f] hover:bg-[#d05f5f]/20 transition-colors text-left"
            >
              + System error
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Actions</h3>
          <button
            onClick={simulateStreaming}
            className={`w-full text-xs px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
              streamingActive
                ? "bg-[#d05f5f]/10 text-[#d05f5f] hover:bg-[#d05f5f]/20"
                : "bg-[#38D39F]/10 text-[#38D39F] hover:bg-[#38D39F]/20"
            }`}
          >
            <Zap className="w-3 h-3" />
            {streamingActive ? "Stop streaming" : "Simulate streaming"}
          </button>
          <button
            onClick={clearMessages}
            className="w-full text-xs px-2 py-1.5 rounded-md bg-surface-low text-text-muted hover:text-[#d05f5f] hover:bg-[#d05f5f]/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear all messages
          </button>
        </div>

        {/* Presets — sets all features at once */}
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Presets</p>
          <p className="text-[10px] text-text-muted">Sets every feature to the same alternative</p>
          <div className="grid grid-cols-2 gap-1">
            {(["off", "v1", "v2", "v3"] as const).map((v) => (
              <button
                key={v}
                onClick={() => applyPreset(v)}
                className={`text-xs px-2 py-1.5 rounded-md border transition-colors ${
                  thinkingVariant === v && timestampVariant === v && bubblesVariant === v && nameVariant === v && animationVariant === v && inputVariant === v && themeVariant === v && streamingVariant === v
                    ? "border-[#38D39F] bg-[#38D39F]/10 text-[#38D39F]"
                    : "border-border text-text-muted hover:text-foreground hover:border-border-strong"
                }`}
              >
                {v === "off" ? "Default" : `Alt ${v.slice(1)}`}
              </button>
            ))}
          </div>
        </div>

        {/* Feature variants */}
        <div className="space-y-4 pt-1 border-t border-border">
          <VariantGroup
            label="Thinking indicator"
            value={thinkingVariant}
            onChange={setThinkingVariant}
            options={[
              { value: "off", label: "Off — bouncing dots" },
              { value: "v1", label: "Alt 1 — shimmer bar" },
              { value: "v2", label: "Alt 2 — blinking pill" },
              { value: "v3", label: "Alt 3 — gradient sparkle" },
            ]}
          />
          <VariantGroup
            label="Timestamps"
            value={timestampVariant}
            onChange={setTimestampVariant}
            options={[
              { value: "off", label: "Off — hover only" },
              { value: "v1", label: "Alt 1 — always visible" },
              { value: "v2", label: "Alt 2 — inside bubble" },
              { value: "v3", label: "Alt 3 — relative time" },
            ]}
          />
          <VariantGroup
            label="Bubbles"
            value={bubblesVariant}
            onChange={setBubblesVariant}
            options={[
              { value: "off", label: "Off — default" },
              { value: "v1", label: "Alt 1 — flat assistant" },
              { value: "v2", label: "Alt 2 — pill user" },
              { value: "v3", label: "Alt 3 — bordered user" },
            ]}
          />
          <VariantGroup
            label="Agent name"
            value={nameVariant}
            onChange={setNameVariant}
            options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — monogram above" },
              { value: "v2", label: "Alt 2 — avatar left" },
              { value: "v3", label: "Alt 3 — sparkle above" },
            ]}
          />
          <VariantGroup
            label="Animations"
            value={animationVariant}
            onChange={setAnimationVariant}
            options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — fade + lift" },
              { value: "v2", label: "Alt 2 — slide from side" },
              { value: "v3", label: "Alt 3 — scale pop" },
            ]}
          />
          <VariantGroup
            label="Input box"
            value={inputVariant}
            onChange={setInputVariant}
            options={[
              { value: "off", label: "Off — single line" },
              { value: "v1", label: "Alt 1 — auto-grow" },
              { value: "v2", label: "Alt 2 — pill + inner send" },
              { value: "v3", label: "Alt 3 — borderless" },
            ]}
          />
          <VariantGroup
            label="Streaming"
            value={streamingVariant}
            onChange={setStreamingVariant}
            options={[
              { value: "off", label: "Off — no indicator" },
              { value: "v1", label: "Alt 1 — blinking cursor" },
              { value: "v2", label: "Alt 2 — pulsing dot" },
              { value: "v3", label: "Alt 3 — shimmer sweep" },
            ]}
          />
          <VariantGroup
            label="Theme"
            value={themeVariant}
            onChange={setThemeVariant}
            options={[
              { value: "off", label: "Off — default palette" },
              { value: "v1", label: "Alt 1 — Warm (amber user / green agent)" },
              { value: "v2", label: "Alt 2 — Contrast (green user / dark agent)" },
              { value: "v3", label: "Alt 3 — Vivid (amber user / blue agent)" },
            ]}
          />
        </div>

        {/* Layout */}
        <div className="space-y-4 pt-1 border-t border-border">
          <p className="text-[11px] font-semibold text-[#f0c56c] uppercase tracking-wider">Layout</p>
          <VariantGroup
            label="Conversations Sidebar"
            value={conversationsSidebarVariant}
            onChange={setAgentsChannelsSidebarVariant}
            options={[
              { value: "off", label: "Off — hidden" },
              { value: "v1", label: "Alt 1 — flat list" },
              { value: "v2", label: "Alt 2 — grouped by agent" },
              { value: "v3", label: "Alt 3 — handoff + list" },
              { value: "v3.1", label: "Alt 3.1 — handoff + rename" },
            ]}
          />
        </div>

        {/* Stats */}
        <div className="pt-2 border-t border-border text-xs text-text-muted space-y-1">
          <p>Messages: {messages.length}</p>
          <p>Status: {connected ? "Connected" : connecting ? "Connecting..." : "Disconnected"}</p>
          <p>Sending: {sending ? "Yes" : "No"}</p>
        </div>

        </>)}

        {devTab === "agent-view" && (<>
          {/* Panel visibility */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Panel</h3>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showAgentView}
                onChange={(e) => setShowAgentView(e.target.checked)}
                className="accent-[#38D39F]"
              />
              Show Agent View panel
            </label>
          </div>

          {/* Default tab */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Default Tab</h3>
            {(["overview", "activity", "connections", "cron"] as const).map((tab) => (
              <label key={tab} className="flex items-center gap-2 text-xs text-foreground cursor-pointer hover:text-foreground/80">
                <input
                  type="radio"
                  name="agentViewTab"
                  checked={agentViewTab === tab}
                  onChange={() => setAgentViewTab(tab)}
                  className="accent-[#38D39F]"
                />
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </label>
            ))}
          </div>

          {/* Feature toggles */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Features</h3>
            {([
              ["showStatusCard", "Status Card", showStatusCard, setShowStatusCard] as const,
              ["showConfigQuickView", "Config Quick-View", showConfigQuickView, setShowConfigQuickView] as const,
              ["showActiveSessions", "Active Sessions", showActiveSessions, setShowActiveSessions] as const,
              ["showCronManager", "Cron Manager", showCronManager, setShowCronManager] as const,
              ["showRecentToolCalls", "Recent Tool Calls", showRecentToolCalls, setShowRecentToolCalls] as const,
              ["showSubAgents", "Sub-agents", showSubAgents, setShowSubAgents] as const,
            ]).map(([key, label, value, setter]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="accent-[#38D39F]"
                />
                {label}
              </label>
            ))}
          </div>

          {/* Connections tab features */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Connections Features</h3>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showSearch}
                onChange={(e) => setShowSearch(e.target.checked)}
                className="accent-[#38D39F]"
              />
              Search bar
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showRecommended}
                onChange={(e) => setShowRecommended(e.target.checked)}
                className="accent-[#38D39F]"
              />
              Recommended section
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showMarketplace}
                onChange={(e) => setShowMarketplace(e.target.checked)}
                className="accent-[#38D39F]"
              />
              Marketplace button
            </label>
          </div>

          {/* Style proposals */}
          <div className="space-y-4 pt-1 border-t border-border">
            <VariantGroup
              label="Connection rows"
              value={connectionRowStyle}
              onChange={setConnectionRowStyle}
              options={[
                { value: "off", label: "Default — icon + label" },
                { value: "v1", label: "Alt 1 — compact list" },
                { value: "v2", label: "Alt 2 — card with description" },
                { value: "v3", label: "Alt 3 — badge style" },
              ]}
            />
            <VariantGroup
              label="Tab style"
              value={tabBarStyle}
              onChange={setTabBarStyle}
              options={[
                { value: "off", label: "Default — underline" },
                { value: "v1", label: "Alt 1 — pill tabs" },
                { value: "v2", label: "Alt 2 — segmented control" },
                { value: "v3", label: "Alt 3 — icon tabs" },
              ]}
            />
            <VariantGroup
              label="Skills"
              value={skillsVariant}
              onChange={setSkillsVariant}
              options={[
                { value: "off", label: "Default — rows + pulse" },
                { value: "v1", label: "Alt 1 — cards" },
                { value: "v2", label: "Alt 2 — pill chips" },
                { value: "v3", label: "Alt 3 — minimal hover" },
              ]}
            />
            <VariantGroup
              label="Activity log"
              value={activityVariant}
              onChange={setActivityVariant}
              options={[
                { value: "off", label: "Default — typed rows" },
                { value: "v1", label: "Alt 1 — timeline" },
                { value: "v2", label: "Alt 2 — cards" },
                { value: "v3", label: "Alt 3 — minimal" },
              ]}
            />
            <VariantGroup
              label="Detail pane"
              value={detailStyle}
              onChange={setDetailStyle}
              options={[
                { value: "off", label: "Default — inline swap" },
                { value: "v1", label: "Alt 1 — slide-over" },
                { value: "v2", label: "Alt 2 — modal" },
                { value: "v3", label: "Alt 3 — expand in-place" },
              ]}
            />
          </div>

          {/* UX Discovery features */}
          <div className="space-y-4 pt-1 border-t border-border">
            <p className="text-[11px] font-semibold text-[#38D39F] uppercase tracking-wider">UX Discovery</p>
            <VariantGroup label="Onboarding tour" value={onboardingVariant} onChange={setOnboardingVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — step banner" },
              { value: "v2", label: "Alt 2 — full card" },
              { value: "v3", label: "Alt 3 — floating tooltip" },
            ]} />
            <VariantGroup label="Completeness ring" value={completenessRingVariant} onChange={setCompletenessRingVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — circular ring" },
              { value: "v2", label: "Alt 2 — progress bar" },
              { value: "v3", label: "Alt 3 — checklist" },
            ]} />
            <VariantGroup label="Quick actions" value={quickActionsVariant} onChange={setQuickActionsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — scroll chips" },
              { value: "v2", label: "Alt 2 — icon grid" },
              { value: "v3", label: "Alt 3 — suggestion cards" },
            ]} />
            <VariantGroup label="What can I do?" value={whatCanIDoVariant} onChange={setWhatCanIDoVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — CTA button" },
              { value: "v2", label: "Alt 2 — dashed card" },
              { value: "v3", label: "Alt 3 — inline hint" },
            ]} />
            <VariantGroup label="Empty states" value={emptyStatesVariant} onChange={setEmptyStatesVariant} options={[
              { value: "off", label: "Off — plain text" },
              { value: "v1", label: "Alt 1 — animated CTA" },
              { value: "v2", label: "Alt 2 — dashed card" },
              { value: "v3", label: "Alt 3 — inline pulse" },
            ]} />
            <VariantGroup label="Tool discovery" value={toolDiscoveryVariant} onChange={setToolDiscoveryVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — highlight card" },
              { value: "v2", label: "Alt 2 — inline pill" },
              { value: "v3", label: "Alt 3 — toast" },
            ]} />
            <VariantGroup label="Connection recs" value={connectionRecsVariant} onChange={setConnectionRecsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — suggestion box" },
              { value: "v2", label: "Alt 2 — row cards" },
              { value: "v3", label: "Alt 3 — inline banner" },
            ]} />
            <VariantGroup label="Capability diff" value={capabilityDiffVariant} onChange={setCapabilityDiffVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — change card" },
              { value: "v2", label: "Alt 2 — dot + text" },
              { value: "v3", label: "Alt 3 — pill badges" },
            ]} />
            <VariantGroup label="Nudges" value={nudgesVariant} onChange={setNudgesVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — tip cards" },
              { value: "v2", label: "Alt 2 — pill banners" },
              { value: "v3", label: "Alt 3 — minimal dots" },
            ]} />
            <VariantGroup label="Agent card" value={agentCardVariant} onChange={setAgentCardVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — full summary" },
              { value: "v2", label: "Alt 2 — stats grid" },
              { value: "v3", label: "Alt 3 — compact inline" },
            ]} />
          </div>

          {/* Agent Capabilities */}
          <div className="space-y-4 pt-1 border-t border-border">
            <p className="text-[11px] font-semibold text-[#f0c56c] uppercase tracking-wider">Capabilities</p>
            <VariantGroup label="Model capabilities" value={modelCapsVariant} onChange={setModelCapsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — grid cards" },
              { value: "v2", label: "Alt 2 — chip row" },
              { value: "v3", label: "Alt 3 — compact list" },
            ]} />
            <VariantGroup label="Tool usage" value={toolUsageVariant} onChange={setToolUsageVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — bar chart" },
              { value: "v2", label: "Alt 2 — vertical bars" },
              { value: "v3", label: "Alt 3 — inline counts" },
            ]} />
            <VariantGroup label="Interaction patterns" value={interactionPatternsVariant} onChange={setInteractionPatternsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — progress bars" },
              { value: "v2", label: "Alt 2 — donut ring" },
              { value: "v3", label: "Alt 3 — stacked bar" },
            ]} />
            <VariantGroup label="Example prompts" value={examplePromptsVariant} onChange={setExamplePromptsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — grouped" },
              { value: "v2", label: "Alt 2 — card list" },
              { value: "v3", label: "Alt 3 — random hints" },
            ]} />
            <VariantGroup label="Limits" value={limitsVariant} onChange={setLimitsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — icon grid" },
              { value: "v2", label: "Alt 2 — chip row" },
              { value: "v3", label: "Alt 3 — compact list" },
            ]} />
            <VariantGroup label="Achievements" value={achievementsVariant} onChange={setAchievementsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — stats grid" },
              { value: "v2", label: "Alt 2 — horizontal scroll" },
              { value: "v3", label: "Alt 3 — single line" },
            ]} />
            <VariantGroup label="Permissions" value={permissionsVariant} onChange={setPermissionsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — table rows" },
              { value: "v2", label: "Alt 2 — icon badges" },
              { value: "v3", label: "Alt 3 — dot list" },
            ]} />
          </div>

          {/* SDK Features */}
          <div className="space-y-4 pt-1 border-t border-border">
            <p className="text-[11px] font-semibold text-[#4285f4] uppercase tracking-wider">SDK / Gateway</p>
            <VariantGroup label="Channels" value={channelsVariant} onChange={setChannelsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — row list" },
              { value: "v2", label: "Alt 2 — card grid" },
              { value: "v3", label: "Alt 3 — chip badges" },
            ]} />
            <VariantGroup label="Model providers" value={providersVariant} onChange={setProvidersVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — grouped cards" },
              { value: "v2", label: "Alt 2 — flat model list" },
              { value: "v3", label: "Alt 3 — chip row" },
            ]} />
            <VariantGroup label="Exec approval" value={execQueueVariant} onChange={setExecQueueVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — command cards" },
              { value: "v2", label: "Alt 2 — inline approve" },
              { value: "v3", label: "Alt 3 — minimal count" },
            ]} />
            <VariantGroup label="Agent URLs" value={agentUrlsVariant} onChange={setAgentUrlsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — detailed rows" },
              { value: "v2", label: "Alt 2 — pill links" },
              { value: "v3", label: "Alt 3 — key-value" },
            ]} />
            <VariantGroup label="Gateway status" value={gatewayStatusVariant} onChange={setGatewayStatusVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — stats grid" },
              { value: "v2", label: "Alt 2 — inline stats" },
              { value: "v3", label: "Alt 3 — one-liner" },
            ]} />
            <VariantGroup label="Workspace files" value={workspaceFilesVariant} onChange={setWorkspaceFilesVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — file list" },
              { value: "v2", label: "Alt 2 — chip badges" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
          </div>

          {/* Group Conversation Modules */}
          <div className="space-y-4 pt-1 border-t border-border">
            <p className="text-[11px] font-semibold text-[#d05f5f] uppercase tracking-wider">Group Conversation</p>
            <VariantGroup label="Members" value={membersVariant} onChange={setMembersVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — list rows" },
              { value: "v2", label: "Alt 2 — avatar grid" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
            <VariantGroup label="Agent Roster" value={agentRosterVariant} onChange={setAgentRosterVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — full rows" },
              { value: "v2", label: "Alt 2 — card grid" },
              { value: "v3", label: "Alt 3 — chip row" },
            ]} />
            <VariantGroup label="Activity Feed" value={groupActivityFeedVariant} onChange={setGroupActivityFeedVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — timeline" },
              { value: "v2", label: "Alt 2 — icon rows" },
              { value: "v3", label: "Alt 3 — grouped" },
            ]} />
            <VariantGroup label="Thread Summary" value={threadSummaryVariant} onChange={setThreadSummaryVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — cards" },
              { value: "v2", label: "Alt 2 — list rows" },
              { value: "v3", label: "Alt 3 — numbered" },
            ]} />
            <VariantGroup label="Mentions & Tasks" value={mentionsTasksVariant} onChange={setMentionsTasksVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — task list" },
              { value: "v2", label: "Alt 2 — by assignee" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
            <VariantGroup label="Shared Files" value={sharedFilesVariant} onChange={setSharedFilesVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — file rows" },
              { value: "v2", label: "Alt 2 — card grid" },
              { value: "v3", label: "Alt 3 — chip badges" },
            ]} />
            <VariantGroup label="Pinned Items" value={pinnedItemsVariant} onChange={setPinnedItemsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — cards" },
              { value: "v2", label: "Alt 2 — list rows" },
              { value: "v3", label: "Alt 3 — numbered" },
            ]} />
            <VariantGroup label="Workspace" value={sharedWorkspaceVariant} onChange={setSharedWorkspaceVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — cards" },
              { value: "v2", label: "Alt 2 — icon grid" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
            <VariantGroup label="Agent Focus" value={agentFocusVariant} onChange={setAgentFocusVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — full layout" },
              { value: "v2", label: "Alt 2 — compact card" },
              { value: "v3", label: "Alt 3 — one-liner" },
            ]} />
            <VariantGroup label="Group Permissions" value={groupPermissionsVariant} onChange={setGroupPermissionsVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — table rows" },
              { value: "v2", label: "Alt 2 — by role" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
            <VariantGroup label="Agent Changelog" value={agentChangelogVariant} onChange={setAgentChangelogVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — timeline" },
              { value: "v2", label: "Alt 2 — commit list" },
              { value: "v3", label: "Alt 3 — compact" },
            ]} />
            <VariantGroup label="Decision Log" value={decisionLogVariant} onChange={setDecisionLogVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — cards" },
              { value: "v2", label: "Alt 2 — list rows" },
              { value: "v3", label: "Alt 3 — numbered" },
            ]} />
            <VariantGroup label="Handoff" value={handoffVariant} onChange={setHandoffVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — sections" },
              { value: "v2", label: "Alt 2 — bullet card" },
              { value: "v3", label: "Alt 3 — summary" },
            ]} />
            <VariantGroup label="Conversation Graph" value={conversationGraphVariant} onChange={setConversationGraphVariant} options={[
              { value: "off", label: "Off" },
              { value: "v1", label: "Alt 1 — full graph" },
              { value: "v2", label: "Alt 2 — compact" },
              { value: "v3", label: "Alt 3 — nodes only" },
            ]} />
          </div>
        </>)}

        {devTab === "files" && (<>
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider">Component</h3>
            <div className="flex gap-1.5">
              {(["drawer", "panel"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setFilesVariant(v)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors capitalize ${
                    filesVariant === v
                      ? "bg-[#38D39F]/10 border-[#38D39F]/30 text-[#38D39F]"
                      : "border-border text-text-muted hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-text-muted">
              {filesVariant === "drawer" ? "Right-side overlay drawer" : "Bottom split panel within chat area"}
            </p>

            <a
              href="/dashboard/dev/chat/files"
              target="_blank"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-border hover:bg-surface-low transition-colors text-[11px] font-medium text-foreground"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open full-page file browser
            </a>

            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider pt-2">Mock Files</h3>
            <p className="text-[10px] text-text-muted">Add mock files to test the Files {filesVariant}. Click the Files button in the chat header to open it.</p>

            {/* Quick-add presets */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-text-secondary">Quick add</p>
              {[
                { name: "src/index.ts", size: 1240, content: 'import { main } from "./app";\n\nmain();' },
                { name: "src/app.ts", size: 3420, content: 'export function main() {\n  console.log("Hello from agent");\n}' },
                { name: "src/utils/helpers.ts", size: 890, content: 'export function formatDate(d: Date) {\n  return d.toISOString();\n}' },
                { name: "package.json", size: 520, content: '{\n  "name": "agent-workspace",\n  "version": "1.0.0",\n  "main": "src/index.ts"\n}' },
                { name: "README.md", size: 280, content: '# Agent Workspace\n\nThis is the agent workspace.' },
                { name: ".env", size: 64, content: 'API_KEY=sk-test-123\nDEBUG=true' },
                { name: "config/settings.yaml", size: 340, content: 'model: claude-opus-4-6\nmax_tokens: 4096\ntemperature: 0.7' },
                { name: "data/output.json", size: 15200, content: '{"results": [{"id": 1, "status": "ok"}]}' },
                { name: "logs/agent.log", size: 8900, content: '[2026-04-10 08:00:00] INFO  Agent started\n[2026-04-10 08:00:01] INFO  Connected to gateway' },
              ].map((preset) => {
                const exists = mockFiles.some((f) => f.path === preset.name);
                return (
                  <button
                    key={preset.name}
                    disabled={exists}
                    onClick={() => {
                      const segments = preset.name.split("/");
                      // Add parent directories
                      const newDirs: typeof mockFiles = [];
                      for (let i = 1; i < segments.length; i++) {
                        const dirPath = segments.slice(0, i).join("/");
                        if (!mockFiles.some((f) => f.path === dirPath) && !newDirs.some((d) => d.path === dirPath)) {
                          newDirs.push({ name: segments[i - 1], path: dirPath, type: "directory" });
                        }
                      }
                      setMockFiles((prev) => [
                        ...prev,
                        ...newDirs,
                        { name: segments[segments.length - 1], path: preset.name, type: "file", size: preset.size },
                      ]);
                      setMockFileContents((prev) => ({ ...prev, [preset.name]: preset.content }));
                    }}
                    className={`flex items-center justify-between w-full px-2 py-1.5 rounded-md text-left text-[11px] transition-colors ${
                      exists
                        ? "text-text-muted/40 cursor-not-allowed"
                        : "text-foreground hover:bg-surface-low"
                    }`}
                  >
                    <span className="truncate">{preset.name}</span>
                    <span className="text-[9px] text-text-muted flex-shrink-0 ml-2">
                      {exists ? "added" : `${(preset.size / 1024).toFixed(1)} KB`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Add all button */}
            <button
              onClick={() => {
                const presets = [
                  { name: "src", path: "src", type: "directory" as const },
                  { name: "config", path: "config", type: "directory" as const },
                  { name: "data", path: "data", type: "directory" as const },
                  { name: "logs", path: "logs", type: "directory" as const },
                  { name: "utils", path: "src/utils", type: "directory" as const },
                  { name: "index.ts", path: "src/index.ts", type: "file" as const, size: 1240 },
                  { name: "app.ts", path: "src/app.ts", type: "file" as const, size: 3420 },
                  { name: "helpers.ts", path: "src/utils/helpers.ts", type: "file" as const, size: 890 },
                  { name: "package.json", path: "package.json", type: "file" as const, size: 520 },
                  { name: "README.md", path: "README.md", type: "file" as const, size: 280 },
                  { name: ".env", path: ".env", type: "file" as const, size: 64 },
                  { name: "settings.yaml", path: "config/settings.yaml", type: "file" as const, size: 340 },
                  { name: "output.json", path: "data/output.json", type: "file" as const, size: 15200 },
                  { name: "agent.log", path: "logs/agent.log", type: "file" as const, size: 8900 },
                ];
                setMockFiles(presets);
                setMockFileContents({
                  "src/index.ts": 'import { main } from "./app";\n\nmain();',
                  "src/app.ts": 'export function main() {\n  console.log("Hello from agent");\n}',
                  "src/utils/helpers.ts": 'export function formatDate(d: Date) {\n  return d.toISOString();\n}',
                  "package.json": '{\n  "name": "agent-workspace",\n  "version": "1.0.0",\n  "main": "src/index.ts"\n}',
                  "README.md": '# Agent Workspace\n\nThis is the agent workspace.',
                  ".env": 'API_KEY=sk-test-123\nDEBUG=true',
                  "config/settings.yaml": 'model: claude-opus-4-6\nmax_tokens: 4096\ntemperature: 0.7',
                  "data/output.json": '{"results": [{"id": 1, "status": "ok"}]}',
                  "logs/agent.log": '[2026-04-10 08:00:00] INFO  Agent started\n[2026-04-10 08:00:01] INFO  Connected to gateway',
                });
              }}
              className="w-full px-3 py-2 rounded-lg bg-[#38D39F]/10 border border-[#38D39F]/20 hover:border-[#38D39F]/40 text-[11px] font-medium text-[#38D39F] transition-colors"
            >
              Add all presets
            </button>

            {/* Clear button */}
            {mockFiles.length > 0 && (
              <button
                onClick={() => { setMockFiles([]); setMockFileContents({}); }}
                className="w-full px-3 py-2 rounded-lg border border-border hover:bg-surface-low text-[11px] font-medium text-text-muted hover:text-foreground transition-colors"
              >
                Clear all ({mockFiles.length} items)
              </button>
            )}

            {/* Current files list */}
            {mockFiles.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-text-secondary">Current files ({mockFiles.filter((f) => f.type === "file").length} files, {mockFiles.filter((f) => f.type === "directory").length} dirs)</p>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {mockFiles.filter((f) => f.type === "file").map((f) => (
                    <div key={f.path} className="flex items-center justify-between px-2 py-1 rounded text-[10px]">
                      <span className="text-foreground truncate">{f.path}</span>
                      <button
                        onClick={() => {
                          setMockFiles((prev) => prev.filter((p) => p.path !== f.path));
                          setMockFileContents((prev) => { const next = { ...prev }; delete next[f.path]; return next; });
                        }}
                        className="text-text-muted hover:text-[#d05f5f] transition-colors flex-shrink-0 ml-2"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>)}

        </div>
          </div>
        </>
      )}

      {/* ── Conversations Sidebar ── */}
      {conversationsSidebarVariant !== "off" && (
        <AgentsChannelsSidebar
          variant={conversationsSidebarVariant}
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelectThread={setSelectedThreadId}
          onNewThread={handleNewThread}
          onStartAgentChat={handleStartAgentChat}
          onCreateChannel={handleCreateChannel}
          onDeleteThread={handleDeleteThread}
          onRenameThread={handleRenameThread}
        />
      )}

      {/* ── Chat Panel (mirrors agents page layout) ── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Header bar */}
        <div className="flex-shrink-0 flex items-center gap-3 border-b border-border px-4 py-3">
          {/* Dynamic avatar based on conversation */}
          {(() => {
            if (!selectedThread) {
              // Default — single bot icon
              return (
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-surface-low flex items-center justify-center">
                    <Bot className="w-5 h-5 text-[#38D39F]" />
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${connected ? "bg-[#38D39F]" : connecting ? "bg-[#f0c56c] animate-pulse" : "bg-text-muted"}`} />
                </div>
              );
            }

            const agents = selectedThread.participants.filter((p) => p.type === "agent");
            const isGroup = selectedThread.participants.length > 2 || selectedThread.kind === "group";

            if (agents.length === 0) {
              // New conversation with no agents yet
              return (
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-surface-low flex items-center justify-center">
                    <Users className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              );
            }

            if (!isGroup && agents.length === 1) {
              // 1:1 — single agent avatar
              const av = agentAvatar(agents[0].name);
              const Icon = av.icon;
              return (
                <div className="relative">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: av.bgColor }}>
                    <Icon className="w-4 h-4" style={{ color: av.fgColor }} />
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${selectedThread.isActive ? "bg-[#38D39F]" : "bg-text-muted"}`} />
                </div>
              );
            }

            // Group — stacked avatars (max 3)
            const shown = agents.slice(0, 3);
            return (
              <div className="relative flex items-center" style={{ width: 8 + shown.length * 22 }}>
                {shown.map((agent, i) => {
                  const av = agentAvatar(agent.name);
                  const Icon = av.icon;
                  return (
                    <div
                      key={agent.id}
                      className="rounded-full flex items-center justify-center border-2 border-background"
                      style={{
                        width: 28,
                        height: 28,
                        backgroundColor: av.bgColor,
                        marginLeft: i > 0 ? -8 : 0,
                        zIndex: shown.length - i,
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: av.fgColor }} />
                    </div>
                  );
                })}
                {agents.length > 3 && (
                  <div
                    className="w-[28px] h-[28px] rounded-full bg-surface-low flex items-center justify-center border-2 border-background text-[10px] font-medium text-text-muted"
                    style={{ marginLeft: -8, zIndex: 0 }}
                  >
                    +{agents.length - 3}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {selectedThread
                ? (selectedThread.title ?? activeAgentName ?? "New conversation")
                : "Select or create an agent"}
            </p>
            <p className="text-xs text-text-muted">
              {!selectedThread
                ? "Pick an agent from the sidebar or create a new one"
                : selectedThread && groupThreadIds.has(selectedThread.id)
                ? `Group · ${selectedThread.participants.length} participants`
                : connected ? "Connected" : connecting ? "Connecting to gateway..." : "Disconnected"}
            </p>
          </div>

          {/* Center — Files button */}
          <button
            onClick={() => setFilesDrawerOpen((v) => !v)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filesDrawerOpen
                ? "bg-[#38D39F]/15 border-[#38D39F]/30 text-[#38D39F]"
                : "border-border text-text-muted hover:text-foreground hover:border-text-muted/30 hover:bg-surface-low"
            }`}
            title="Files"
          >
            <FolderOpen className="w-4 h-4" />
            <span>Files</span>
            {mockFiles.filter((f) => f.type === "file").length > 0 && (
              <span className={`text-[9px] tabular-nums px-1.5 py-0.5 rounded-full ${
                filesDrawerOpen
                  ? "bg-[#38D39F]/20 text-[#38D39F]"
                  : "bg-surface-low text-text-muted"
              }`}>
                {mockFiles.filter((f) => f.type === "file").length}
              </span>
            )}
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            {/* Add participant button */}
            {selectedThread && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setAddParticipantOpen((v) => !v); }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                    addParticipantOpen
                      ? "bg-[#38D39F] text-[#0a0a0b]"
                      : "text-text-muted hover:text-foreground hover:bg-surface-low"
                  }`}
                  title="Add participant"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {addParticipantOpen && (
                  <AddParticipantPanel
                    currentParticipants={selectedThread.participants}
                    allParticipants={MOCK_PARTICIPANTS}
                    onAdd={handleAddParticipant}
                    onClose={() => setAddParticipantOpen(false)}
                    isGroup={selectedThread.kind === "group" || selectedThread.participants.length > 2}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Empty state: new conversation with only "You" */}
          {selectedThread && selectedThread.participants.length <= 1 && selectedThread.messageCount === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <Users className="w-10 h-10 mb-3 text-text-muted/40" />
              <p className="text-sm font-medium text-foreground mb-1">New conversation</p>
              <p className="text-xs text-text-muted text-center max-w-[220px]">
                Add agents or team members to start collaborating.
              </p>
              <button
                onClick={() => setAddParticipantOpen(true)}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#38D39F]/10 text-[#38D39F] text-xs font-medium hover:bg-[#38D39F]/20 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add participants
              </button>
            </div>
          )}

          {/* Empty state: no thread selected */}
          {!selectedThread && (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              <MessageSquare className="w-8 h-8 opacity-30" />
              <p className="text-sm font-medium text-foreground">No Agent or Channel selected</p>
              <p className="text-xs text-text-muted text-center max-w-[220px]">
                Select an agent or channel to get started
              </p>
            </div>
          )}

          {/* Empty state: thread selected but no messages */}
          {selectedThread && messages.length === 0 && (selectedThread.participants.length > 1 && !groupThreadIds.has(selectedThread.id)) && (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              {connecting ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <p className="text-sm">Connecting to gateway...</p>
                  <p className="text-xs text-text-muted/60">Retrying every 5s</p>
                </>
              ) : connected ? (
                <>
                  <MessageSquare className="w-8 h-8 opacity-30" />
                  <p className="text-sm font-medium text-foreground">Start a conversation</p>
                  <p className="text-xs text-text-muted text-center max-w-[220px]">
                    Send a message to start chatting with {activeAgentName ?? "your agent"}
                  </p>
                </>
              ) : (
                <>
                  <Bot className="w-8 h-8 opacity-30" />
                  <p className="text-sm font-medium text-foreground">Agent offline</p>
                  <p className="text-xs text-text-muted text-center max-w-[220px]">
                    Start {activeAgentName ?? "the agent"} to begin chatting
                  </p>
                </>
              )}
            </div>
          )}

          {(() => {
            const isGroupThread = selectedThreadId !== null && groupThreadIds.has(selectedThreadId);
            const displayMessages: (ChatMessage & { senderId?: string; senderName?: string })[] =
              isGroupThread ? MOCK_GROUP_MESSAGES : messages;
            const effectiveNameVariant = isGroupThread && nameVariant === "off" ? "v2" as const : nameVariant;

            return displayMessages.map((msg, i) => (
              <ChatMessageBubble
                key={`${selectedThreadId ?? "default"}-${i}`}
                message={msg}
                timestampVariant={timestampVariant}
                bubblesVariant={bubblesVariant}
                nameVariant={effectiveNameVariant}
                animationVariant={animationVariant}
                themeVariant={themeVariant}
                streamingVariant={streamingVariant}
                isStreaming={!isGroupThread && sending && i === displayMessages.length - 1 && msg.role === "assistant"}
                agentName={isGroupThread ? undefined : (activeAgentName ?? "Agent")}
                senderName={(msg as GroupMessage).senderName}
                isGroupChat={isGroupThread}
              />
            ));
          })()}

          {sending && messages[messages.length - 1]?.role !== "assistant" && (
            <ChatThinkingIndicator variant={thinkingVariant} />
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Files Panel (bottom split) */}
        {filesVariant === "panel" && (
          <FilesPanel
            open={filesDrawerOpen}
            onClose={() => setFilesDrawerOpen(false)}
            connected={connected}
            files={mockFiles.length > 0 ? mockFiles : undefined}
            callbacks={mockFiles.length > 0 ? {
              onListFiles: async () => ({
                prefix: "",
                directories: mockFiles.filter((f) => f.type === "directory"),
                files: mockFiles.filter((f) => f.type === "file"),
              }),
              onGetFile: async (path: string) => mockFileContents[path] ?? "",
              onSetFile: async (path: string, content: string) => {
                setMockFileContents((prev) => ({ ...prev, [path]: content }));
              },
              onDeleteFile: async (path: string) => {
                setMockFiles((prev) => prev.filter((f) => f.path !== path));
                setMockFileContents((prev) => { const next = { ...prev }; delete next[path]; return next; });
              },
              onUploadFile: async (path: string, content: string) => {
                const name = path.split("/").pop() ?? path;
                setMockFiles((prev) => [...prev, { name, path, type: "file", size: content.length }]);
                setMockFileContents((prev) => ({ ...prev, [path]: content }));
              },
            } : undefined}
          />
        )}

        {/* Input area */}
        <div className="flex-shrink-0 border-t border-border p-3 z-10">
          {inputVariant === "v2" ? (
            /* Alt 2 — pill shape, send button pinned inside bottom-right */
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
                placeholder={connected ? `Message ${activeAgentName ?? "agent"}...` : "Waiting for gateway..."}
                disabled={!connected || sending}
                className="w-full resize-none bg-[#2f2f2f] border border-border rounded-3xl pl-5 pr-12 py-3 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50 overflow-hidden"
              />
              <button
                onClick={handleSend}
                disabled={!connected || sending || !input.trim()}
                className="absolute right-2 bottom-2 w-8 h-8 btn-primary rounded-full disabled:opacity-40 flex items-center justify-center"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : inputVariant === "v3" ? (
            /* Alt 3 — minimal, bottom-border only, full width */
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
                placeholder={connected ? `Ask ${activeAgentName ?? "agent"} anything...` : "Waiting for gateway..."}
                disabled={!connected || sending}
                className="flex-1 min-w-0 resize-none bg-transparent border-0 border-b border-border rounded-none px-1 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-[#38D39F] disabled:opacity-50 overflow-hidden transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={!connected || sending || !input.trim()}
                className="flex-shrink-0 btn-primary px-3 py-2 rounded-full disabled:opacity-50 flex items-center justify-center mb-0.5"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          ) : inputVariant === "v1" ? (
            /* Alt 1 — auto-growing textarea, rounded-xl, focus ring */
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
                placeholder={connected ? "Type a message... (Shift+Enter for newline)" : "Waiting for gateway..."}
                disabled={!connected || sending}
                className="flex-1 min-w-0 resize-none bg-surface-low border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#38D39F]/40 focus:border-[#38D39F]/60 disabled:opacity-50 overflow-hidden transition-all"
              />
              <button
                onClick={handleSend}
                disabled={!connected || sending || !input.trim()}
                className="flex-shrink-0 btn-primary px-3 py-3 rounded-xl disabled:opacity-50 flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          ) : (
            /* Off — original single-line input */
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={connected ? "Type a message..." : "Waiting for gateway..."}
                disabled={!connected || sending}
                className="flex-1 min-w-0 bg-surface-low border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!connected || sending || !input.trim()}
                className="flex-shrink-0 btn-primary px-3 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Agent View Panel (right) ── */}
      {showAgentView && (
      <div className="w-80 flex-shrink-0 flex flex-col min-h-0">
        {selectedConnection ? (
          <ConnectionDetail
            connection={selectedConnection}
            onClose={() => setSelectedConnection(null)}
          />
        ) : (
          <AgentView
            agentName={activeAgentName ?? "Agent"}
            onConnectionSelect={(conn) => setSelectedConnection(conn)}
            activeTab={agentViewTab}
            onTabChange={setAgentViewTab}
            showSearch={showSearch}
            showRecommended={showRecommended}
            showMarketplace={showMarketplace}
            connectionRowStyle={connectionRowStyle}
            tabBarStyle={tabBarStyle}
            showStatusCard={showStatusCard}
            showConfigQuickView={showConfigQuickView}
            showActiveSessions={showActiveSessions}
            showCronManager={showCronManager}
            showRecentToolCalls={showRecentToolCalls}
            showSubAgents={showSubAgents}
            skillsVariant={skillsVariant}
            activityVariant={activityVariant}
            completenessRingVariant={completenessRingVariant}
            quickActionsVariant={quickActionsVariant}
            emptyStatesVariant={emptyStatesVariant}
            toolDiscoveryVariant={toolDiscoveryVariant}
            connectionRecsVariant={connectionRecsVariant}
            capabilityDiffVariant={capabilityDiffVariant}
            agentCardVariant={agentCardVariant}
            nudgesVariant={nudgesVariant}
            onboardingVariant={onboardingVariant}
            whatCanIDoVariant={whatCanIDoVariant}
            modelCapsVariant={modelCapsVariant}
            toolUsageVariant={toolUsageVariant}
            interactionPatternsVariant={interactionPatternsVariant}
            examplePromptsVariant={examplePromptsVariant}
            limitsVariant={limitsVariant}
            achievementsVariant={achievementsVariant}
            permissionsVariant={permissionsVariant}
            channelsVariant={channelsVariant}
            providersVariant={providersVariant}
            execQueueVariant={execQueueVariant}
            agentUrlsVariant={agentUrlsVariant}
            gatewayStatusVariant={gatewayStatusVariant}
            workspaceFilesVariant={workspaceFilesVariant}
            membersVariant={membersVariant}
            agentRosterVariant={agentRosterVariant}
            groupActivityFeedVariant={groupActivityFeedVariant}
            threadSummaryVariant={threadSummaryVariant}
            mentionsTasksVariant={mentionsTasksVariant}
            sharedFilesVariant={sharedFilesVariant}
            pinnedItemsVariant={pinnedItemsVariant}
            sharedWorkspaceVariant={sharedWorkspaceVariant}
            agentFocusVariant={agentFocusVariant}
            groupPermissionsVariant={groupPermissionsVariant}
            agentChangelogVariant={agentChangelogVariant}
            decisionLogVariant={decisionLogVariant}
            handoffVariant={handoffVariant}
            conversationGraphVariant={conversationGraphVariant}
            conversationThreads={threads}
            selectedConversationThreadId={selectedThreadId}
          />
        )}
      </div>
      )}

      {/* ── Files Drawer (right-side overlay) ── */}
      {filesVariant === "drawer" && (
        <FilesDrawer
          open={filesDrawerOpen}
          onClose={() => setFilesDrawerOpen(false)}
          connected={connected}
          files={mockFiles.length > 0 ? mockFiles : undefined}
          callbacks={mockFiles.length > 0 ? {
            onListFiles: async () => ({
              prefix: "",
              directories: mockFiles.filter((f) => f.type === "directory"),
              files: mockFiles.filter((f) => f.type === "file"),
            }),
            onGetFile: async (path: string) => mockFileContents[path] ?? "",
            onSetFile: async (path: string, content: string) => {
              setMockFileContents((prev) => ({ ...prev, [path]: content }));
            },
            onDeleteFile: async (path: string) => {
              setMockFiles((prev) => prev.filter((f) => f.path !== path));
              setMockFileContents((prev) => { const next = { ...prev }; delete next[path]; return next; });
            },
            onUploadFile: async (path: string, content: string) => {
              const name = path.split("/").pop() ?? path;
              setMockFiles((prev) => [...prev, { name, path, type: "file", size: content.length }]);
              setMockFileContents((prev) => ({ ...prev, [path]: content }));
            },
          } : undefined}
        />
      )}

      {/* ── Delete Confirmation Dialog ── */}
      {pendingDeleteId && (() => {
        const thread = threads.find((t) => t.id === pendingDeleteId);
        const agentNames = thread?.participants.filter((p) => p.type === "agent").map((p) => p.name) ?? [];
        return (
          <>
            <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setPendingDeleteId(null)} />
            <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 rounded-xl border border-border bg-[#111113] shadow-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#d05f5f]/10 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-[#d05f5f]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Delete conversation?</p>
                  <p className="text-[11px] text-text-muted">This will disconnect {agentNames.length} agent{agentNames.length !== 1 ? "s" : ""}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {agentNames.map((name) => {
                  const av = agentAvatar(name);
                  const Icon = av.icon;
                  return (
                    <span key={name} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${av.bgColor}`, color: av.fgColor }}>
                      <Icon className="w-3 h-3" />{name}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setPendingDeleteId(null)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-border text-xs text-foreground hover:bg-surface-low transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-[#d05f5f] text-white text-xs font-medium hover:bg-[#c04f4f] transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
