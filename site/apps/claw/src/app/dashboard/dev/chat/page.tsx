"use client";

import React, { useCallback, useRef, useState, useEffect } from "react";
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
  Zap,
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
import type { ChatMessage } from "@/hooks/useGatewayChat";

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
  const [devTab, setDevTab] = useState<"chat" | "agent-view">("chat");

  // ── Agent View toggles ──
  const [showAgentView, setShowAgentView] = useState(true);
  const [agentViewTab, setAgentViewTab] = useState<AgentTabId>("connections");
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
  const [completenessRingVariant, setCompletenessRingVariant] = useState<FeatureVariant>("off");
  const [quickActionsVariant, setQuickActionsVariant] = useState<FeatureVariant>("off");
  const [emptyStatesVariant, setEmptyStatesVariant] = useState<FeatureVariant>("off");
  const [toolDiscoveryVariant, setToolDiscoveryVariant] = useState<FeatureVariant>("off");
  const [connectionRecsVariant, setConnectionRecsVariant] = useState<FeatureVariant>("off");
  const [capabilityDiffVariant, setCapabilityDiffVariant] = useState<FeatureVariant>("off");
  const [agentCardVariant, setAgentCardVariant] = useState<FeatureVariant>("off");
  const [nudgesVariant, setNudgesVariant] = useState<FeatureVariant>("off");
  const [onboardingVariant, setOnboardingVariant] = useState<FeatureVariant>("off");
  const [whatCanIDoVariant, setWhatCanIDoVariant] = useState<FeatureVariant>("off");
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

  // ── Feature variants ──
  const [thinkingVariant, setThinkingVariant] = useState<ThinkingVariant>("off");
  const [timestampVariant, setTimestampVariant] = useState<TimestampVariant>("off");
  const [bubblesVariant, setBubblesVariant] = useState<BubblesVariant>("off");
  const [nameVariant, setNameVariant] = useState<NameVariant>("off");
  const [animationVariant, setAnimationVariant] = useState<AnimationVariant>("off");
  const [inputVariant, setInputVariant] = useState<InputVariant>("off");
  const [themeVariant, setThemeVariant] = useState<ThemeVariant>("off");
  const [streamingVariant, setStreamingVariant] = useState<StreamingVariant>("off");

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
    <div className="flex h-[calc(100dvh-7.5rem)] gap-4 overflow-hidden">
      {/* ── Control Panel ── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-border min-h-0">
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
            {(["overview", "activity", "skills", "connections", "cron"] as const).map((tab) => (
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
        </>)}

        </div>
      </div>

      {/* ── Chat Panel (mirrors agents page layout) ── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Header bar */}
        <div className="flex-shrink-0 flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-surface-low flex items-center justify-center text-lg">
              <Bot className="w-5 h-5 text-[#38D39F]" />
            </div>
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
                connected ? "bg-[#38D39F]" : connecting ? "bg-[#f0c56c] animate-pulse" : "bg-text-muted"
              }`}
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">mock-agent-dev</p>
            <p className="text-xs text-text-muted">
              {connected ? "Connected" : connecting ? "Connecting to gateway..." : "Disconnected"}
            </p>
          </div>
        </div>

        {/* Messages area */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              {connecting ? (
                <>
                  <Loader2 className="w-8 h-8 mb-2 animate-spin" />
                  <p className="text-sm">Connecting to gateway...</p>
                  <p className="text-xs mt-1 text-text-muted/60">Retrying every 5s</p>
                </>
              ) : connected ? (
                <>
                  <MessageSquare className="w-8 h-8 mb-2" />
                  <p className="text-sm">Send a message to start chatting with your agent</p>
                </>
              ) : (
                <>
                  <MessageSquare className="w-8 h-8 mb-2" />
                  <p className="text-sm">Start the agent to begin chatting</p>
                </>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessageBubble
              key={i}
              message={msg}
              timestampVariant={timestampVariant}
              bubblesVariant={bubblesVariant}
              nameVariant={nameVariant}
              animationVariant={animationVariant}
              themeVariant={themeVariant}
              streamingVariant={streamingVariant}
              isStreaming={sending && i === messages.length - 1 && msg.role === "assistant"}
              agentName="mock-agent-dev"
            />
          ))}

          {sending && messages[messages.length - 1]?.role !== "assistant" && (
            <ChatThinkingIndicator variant={thinkingVariant} />
          )}

          <div ref={chatEndRef} />
        </div>

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
                placeholder={connected ? "Message mock-agent-dev..." : "Waiting for gateway..."}
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
                placeholder={connected ? "Ask mock-agent-dev anything..." : "Waiting for gateway..."}
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
            agentName="mock-agent-dev"
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
          />
        )}
      </div>
      )}
    </div>
  );
}
