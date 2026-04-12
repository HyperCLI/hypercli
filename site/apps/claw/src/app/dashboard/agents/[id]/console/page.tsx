"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Download,
  File,
  FolderOpen,
  House,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Settings,
  Trash2,
  Upload,
  X as XIcon,
} from "lucide-react";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { API_BASE_URL, agentApiFetch, getStoredToken } from "@/lib/api";
import { encodePath, extractImagePath } from "@/lib/image-tools";
import { AuthImage } from "@/components/dashboard/ChatMessage";
import { createAgentClient } from "@/lib/agent-client";
import { refreshGatewayToken } from "@/lib/gateway-auth";
import {
  GatewayClient,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/openclaw/gateway";
import { getGatewayToken as getStoredGatewayToken, setGatewayToken as storeGatewayToken, removeAgentState } from "@/lib/agent-store";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface Agent {
  id: string;
  name: string;
  state: string;
  hostname: string | null;
  jwt_token?: string | null;
  openclaw_url?: string | null;
  gatewayToken?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ id?: string; name: string; args: string; result?: string }>;
  timestamp?: number;
}

interface WorkspaceFile {
  name: string;
  size: number;
  missing: boolean;
}

interface S3FileEntry {
  name: string;
  path: string;
  size?: number;
}

interface S3FilesResponse {
  prefix: string;
  directories: S3FileEntry[];
  files: S3FileEntry[];
  truncated: boolean;
}

type Panel = "chat" | "workspace" | "files" | "config";

function downloadBrowserFile(content: BlobPart | Uint8Array, filename: string, mimeType = "application/octet-stream") {
  const blobContent =
    content instanceof Uint8Array
      ? new Uint8Array(content)
      : content;
  const url = URL.createObjectURL(new Blob([blobContent], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFileSize(size?: number): string {
  if (size === undefined || Number.isNaN(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolCalls(
  toolCalls: GatewayChatToolCall[],
): ChatMessage["toolCalls"] | undefined {
  if (toolCalls.length === 0) return undefined;
  return toolCalls.map((toolCall) => ({
    ...(toolCall.id ? { id: toolCall.id } : {}),
    name: toolCall.name,
    args: formatToolValue(toolCall.args),
    ...(toolCall.result !== undefined ? { result: formatToolValue(toolCall.result) } : {}),
  }));
}

function normalizeStructuredAssistantMessage(message: unknown): ChatMessage | null {
  const normalized = normalizeGatewayChatMessage(message);
  if (!normalized) return null;
  const role = typeof normalized.role === "string" ? normalized.role.trim().toLowerCase() : "assistant";
  if (role !== "assistant") {
    return null;
  }
  const toolCalls = summarizeToolCalls(normalized.toolCalls);
  if (!normalized.text.trim() && !normalized.thinking.trim() && (!toolCalls || toolCalls.length === 0)) {
    return null;
  }
  return {
    role: "assistant",
    content: normalized.text,
    ...(normalized.thinking.trim() ? { thinking: normalized.thinking } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    timestamp: normalized.timestamp ?? Date.now(),
  };
}

function mergeToolCalls(
  current: NonNullable<ChatMessage["toolCalls"]>,
  incoming: NonNullable<ChatMessage["toolCalls"]>,
): NonNullable<ChatMessage["toolCalls"]> {
  const next = [...current];
  for (const toolCall of incoming) {
    let index = -1;
    for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
      const entry = next[cursor];
      if (toolCall.id && entry.id && entry.id === toolCall.id) {
        index = cursor;
        break;
      }
      if (toolCall.result !== undefined) {
        if (entry.name === toolCall.name && entry.result == null) {
          index = cursor;
          break;
        }
        continue;
      }
      if (entry.name === toolCall.name && entry.args === toolCall.args) {
        index = cursor;
        break;
      }
    }
    if (index >= 0) {
      next[index] = {
        ...next[index],
        ...(toolCall.id ? { id: toolCall.id } : {}),
        ...(toolCall.args ? { args: toolCall.args } : {}),
        ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
      };
      continue;
    }
    next.push(toolCall);
  }
  return next;
}

function upsertAssistantMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant") {
    const mergedContent = incoming.content
      ? (
        incoming.content.startsWith(last.content) || incoming.content.length >= last.content.length
          ? incoming.content
          : `${last.content}${incoming.content}`
      )
      : last.content;
    const mergedThinking = incoming.thinking
      ? (
        last.thinking && (
          incoming.thinking.startsWith(last.thinking) ||
          incoming.thinking.length >= last.thinking.length
        )
          ? incoming.thinking
          : `${last.thinking ?? ""}${incoming.thinking}`
      )
      : last.thinking;
    const mergedToolCalls = incoming.toolCalls
      ? mergeToolCalls(last.toolCalls ?? [], incoming.toolCalls)
      : last.toolCalls;
    return [...prev.slice(0, -1), {
      ...last,
      content: mergedContent,
      ...(mergedThinking ? { thinking: mergedThinking } : {}),
      ...(mergedToolCalls && mergedToolCalls.length > 0 ? { toolCalls: mergedToolCalls } : {}),
      timestamp: incoming.timestamp ?? last.timestamp,
    }];
  }
  return [...prev, incoming];
}

function normalizeLiveToolCall(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.toolName === "string" && payload.toolName.trim()) ||
    (typeof payload.tool_name === "string" && payload.tool_name.trim());
  if (!name) return null;
  return {
    ...(typeof payload.toolCallId === "string" && payload.toolCallId.trim()
      ? { id: payload.toolCallId.trim() }
      : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
  };
}

function normalizeLiveToolResult(
  payload: Record<string, unknown>,
): NonNullable<ChatMessage["toolCalls"]>[number] | null {
  const result = formatToolValue(payload.result ?? payload.content ?? payload.text ?? payload.partialResult);
  if (!result) return null;
  const name =
    (typeof payload.name === "string" && payload.name.trim()) ||
    (typeof payload.toolName === "string" && payload.toolName.trim()) ||
    (typeof payload.tool_name === "string" && payload.tool_name.trim()) ||
    "tool";
  return {
    ...(typeof payload.toolCallId === "string" && payload.toolCallId.trim()
      ? { id: payload.toolCallId.trim() }
      : {}),
    name,
    args: formatToolValue(payload.args ?? payload.arguments),
    result,
  };
}

// -----------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------

export default function AgentConsolePage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;
  const { getToken } = useAgentAuth();

  // Agent state
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gateway
  const gwRef = useRef<GatewayClient | null>(null);
  const [gwConnected, setGwConnected] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Files
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Config
  const [configSchema, setConfigSchema] = useState<OpenClawConfigSchemaResponse | null>(null);
  const [config, setConfig] = useState<any>(null);

  // Panel state
  const [activePanel, setActivePanel] = useState<Panel>("chat");
  const [gwAgentId, setGwAgentId] = useState<string>("main");

  // -----------------------------------------------------------------------
  // Fetch agent details
  // -----------------------------------------------------------------------

  const fetchAgent = useCallback(async () => {
    try {
      const token = await getToken();
      const resp = await agentApiFetch<Agent>(`/deployments/${agentId}`, token);
      setAgent(resp);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  // -----------------------------------------------------------------------
  // Gateway connection
  // -----------------------------------------------------------------------

  const connectGateway = useCallback(async () => {
    if (!agent || agent.state !== "RUNNING" || !agent.hostname || gwRef.current) return;

    const url = agent.openclaw_url || `wss://${agent.hostname}`;
    if (!url) {
      setGwError("No gateway URL available");
      return;
    }

    try {
      const authToken = await getToken();

      let gatewayToken = agent.gatewayToken ?? getStoredGatewayToken(agent.id) ?? undefined;
      if (!gatewayToken) {
        try {
          const envResp = await agentApiFetch<{ env: Record<string, string> }>(
            `/deployments/${agent.id}/env`,
            authToken
          );
          gatewayToken = envResp.env?.OPENCLAW_GATEWAY_TOKEN ?? undefined;
          if (gatewayToken) storeGatewayToken(agent.id, gatewayToken);
        } catch {
          // Keep the real SDK error if the gateway token is still unavailable.
        }
      }

      const gw = new GatewayClient({
        url,
        gatewayToken,
        deploymentId: agent.id,
        apiKey: authToken,
        apiBase: API_BASE_URL,
        autoApprovePairing: true,
        onHello: () => {
          setGwConnected(true);
          setGwError(null);
        },
        onClose: ({ error: closeError, code, reason }) => {
          setGwConnected(false);
          if (code !== 1000) {
            void (async () => {
              try {
                const freshAuthToken = await getToken();
                const freshGatewayToken = await refreshGatewayToken(agent.id, freshAuthToken);
                if (freshGatewayToken) {
                  gw.setGatewayToken(freshGatewayToken);
                }
              } catch {
                // Keep reconnecting with the last known token if refresh fails.
              }
            })();
          }
          if (closeError?.message) {
            setGwError(closeError.message);
            return;
          }
          if (code !== 1000 && reason) {
            setGwError(`Disconnected: ${reason}`);
          }
        },
        onGap: ({ expected, received }) => {
          setGwError(`Gateway event gap detected (expected ${expected}, got ${received})`);
        },
        onPairing: (pairing) => {
          if (!pairing) return;
          if (pairing.status === "failed" && pairing.error) {
            setGwError(pairing.error);
            return;
          }
          setGwError("Authorizing this browser...");
        },
      });

      // Set up event handler for streaming chat
      gw.onEvent((gatewayEvent: GatewayEvent) => {
        const event = gatewayEvent.event;
        const payload = gatewayEvent.payload ?? {};
        if (event === "chat") {
          const normalized = normalizeStructuredAssistantMessage(
            (payload as Record<string, unknown>).message,
          );
          if (normalized) {
            setMessages((prev) => upsertAssistantMessage(prev, normalized));
          }
          if ((payload as Record<string, unknown>).state === "final") {
            setSending(false);
          }
        } else if (event === "chat.content") {
          const text = typeof payload.text === "string" ? payload.text : "";
          if (!text) return;
          setMessages((prev) => upsertAssistantMessage(prev, {
            role: "assistant",
            content: text,
            timestamp: Date.now(),
          }));
        } else if (event === "chat.thinking") {
          const text = typeof payload.text === "string" ? payload.text : "";
          if (!text) return;
          setMessages((prev) => upsertAssistantMessage(prev, {
            role: "assistant",
            content: "",
            thinking: text,
            timestamp: Date.now(),
          }));
        } else if (event === "chat.tool_call") {
          const toolCall = normalizeLiveToolCall(payload as Record<string, unknown>);
          if (!toolCall) return;
          setMessages((prev) => upsertAssistantMessage(prev, {
            role: "assistant",
            content: "",
            toolCalls: [toolCall],
            timestamp: Date.now(),
          }));
        } else if (event === "chat.tool_result") {
          const toolResult = normalizeLiveToolResult(payload as Record<string, unknown>);
          if (!toolResult) return;
          setMessages((prev) => upsertAssistantMessage(prev, {
            role: "assistant",
            content: "",
            toolCalls: [toolResult],
            timestamp: Date.now(),
          }));
        } else if (event === "chat.done") {
          setSending(false);
        } else if (event === "chat.error") {
          setSending(false);
          setMessages((prev) => [...prev, { role: "system", content: `Error: ${(payload as any).message ?? "Unknown error"}`, timestamp: Date.now() }]);
        }
      });

      await gw.connect();
      gwRef.current = gw;
      setGwConnected(true);
      setGwError(null);

      try {
        const [cfg, schema] = await Promise.all([
          gw.configGet(),
          gw.configSchema(),
        ]);
        setConfig(cfg);
        setConfigSchema(schema);
      } catch {
        // Keep the console usable even if config endpoints are temporarily unavailable.
      }

      try {
        const agents = await gw.agentsList();
        if (agents.length > 0) {
          setGwAgentId(agents[0].id);
        }

        const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
        const filesList = await gw.filesList(agentIdForFiles);
        setFiles(filesList);
      } catch {
        // File listing is non-critical for initial console render.
      }

    } catch (e: any) {
      setGwError(e.message);
    }
  }, [agent, agentId, getToken]);

  useEffect(() => {
    if (agent?.state === "RUNNING" && !gwRef.current) {
      connectGateway();
    }
    return () => {
      gwRef.current?.close();
      gwRef.current = null;
      if (agent?.id) removeAgentState(agent.id);
    };
  }, [agent?.state, connectGateway]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -----------------------------------------------------------------------
  // Chat handlers
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !input.trim() || sending) return;

    const msg = input.trim();
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: Date.now() }]);

    try {
      await gw.sendChat(msg);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${e.message}`, timestamp: Date.now() }]);
      setSending(false);
    }
  }, [input, sending]);

  // -----------------------------------------------------------------------
  // File handlers
  // -----------------------------------------------------------------------

  const openFile = useCallback(async (name: string) => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const content = await gw.fileGet(gwAgentId, name);
      setSelectedFile(name);
      setFileContent(content);
      setFileDirty(false);
    } catch (e: any) {
      setSelectedFile(name);
      setFileContent(`Error loading file: ${e.message}`);
    }
  }, [gwAgentId]);

  const saveFile = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !selectedFile) return;
    setSavingFile(true);
    try {
      await gw.fileSet(gwAgentId, selectedFile, fileContent);
      setFileDirty(false);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSavingFile(false);
    }
  }, [gwAgentId, selectedFile, fileContent]);

  // -----------------------------------------------------------------------
  // Config handlers
  // -----------------------------------------------------------------------

  const [configJson, setConfigJson] = useState("");
  const [configDirty, setConfigDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setConfigJson(JSON.stringify(config, null, 2));
    }
  }, [config]);

  const saveConfig = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const patch = JSON.parse(configJson);
      await gw.configPatch(patch);
      setConfigDirty(false);
    } catch (e: any) {
      alert(`Config save failed: ${e.message}`);
    }
  }, [configJson]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[#d05f5f]">{error || "Agent not found"}</p>
        <button onClick={() => router.push("/agents")} className="text-text-secondary hover:underline">
          &larr; Back to agents
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background">
        <button onClick={() => router.push("/agents")} className="text-text-muted hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Bot className="w-5 h-5 text-text-secondary" />
        <span className="font-mono text-sm text-foreground">{agent.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${
          agent.state === "RUNNING" ? "bg-[#38D39F]/10 text-primary" :
          agent.state === "STOPPED" ? "bg-surface-low text-text-muted" :
          "bg-[#f0c56c]/15 text-[#f0c56c]"
        }`}>
          {agent.state}
        </span>
        {gwConnected && <span className="text-xs text-primary">Gateway</span>}
        {gwError && <span className="text-xs text-[#d05f5f]">{gwError}</span>}

        <div className="flex-1" />

        {/* Panel tabs */}
        <div className="flex gap-1">
          {(["chat", "workspace", "files", "config"] as Panel[]).map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${
                activePanel === p ? "bg-surface-low text-foreground" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {p === "chat" && <MessageSquare className="w-3.5 h-3.5" />}
              {p === "workspace" && <FolderOpen className="w-3.5 h-3.5" />}
              {p === "files" && <FolderOpen className="w-3.5 h-3.5" />}
              {p === "config" && <Settings className="w-3.5 h-3.5" />}
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {activePanel === "chat" && (
          <ChatPanel
            messages={messages}
            input={input}
            sending={sending}
            connected={gwConnected}
            onInputChange={setInput}
            onSend={sendMessage}
            chatEndRef={chatEndRef}
            agentId={agentId}
          />
        )}

        {activePanel === "workspace" && (
          <WorkspacePanel
            files={files}
            selectedFile={selectedFile}
            fileContent={fileContent}
            fileDirty={fileDirty}
            savingFile={savingFile}
            onOpenFile={openFile}
            onContentChange={(c) => { setFileContent(c); setFileDirty(true); }}
            onSave={saveFile}
            onClose={() => setSelectedFile(null)}
          />
        )}

        {activePanel === "files" && (
          <S3FilesPanel
            agentId={agentId}
            getToken={getToken}
            active={activePanel === "files"}
          />
        )}

        {activePanel === "config" && (
          <ConfigPanel
            config={configJson}
            schema={configSchema}
            dirty={configDirty}
            onChange={(c) => { setConfigJson(c); setConfigDirty(true); }}
            onSave={saveConfig}
          />
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Chat Panel
// -----------------------------------------------------------------------

function ChatPanel({
  messages,
  input,
  sending,
  connected,
  onInputChange,
  onSend,
  chatEndRef,
  agentId,
}: {
  messages: ChatMessage[];
  input: string;
  sending: boolean;
  connected: boolean;
  onInputChange: (v: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  agentId: string;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-sm">Send a message to start chatting with your agent</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === "user"
                ? "bg-surface-high text-foreground"
                : msg.role === "system"
                  ? "bg-[#d05f5f]/10 text-[#d05f5f] border border-[#d05f5f]/20"
                  : "bg-surface-low text-foreground"
            }`}>
              {msg.thinking && (
                <details className="mb-2">
                  <summary className="text-xs text-text-muted cursor-pointer">Thinking...</summary>
                  <pre className="text-xs text-text-muted whitespace-pre-wrap mt-1">{msg.thinking}</pre>
                </details>
              )}
              {msg.toolCalls?.map((tc, j) => {
                const imagePath = extractImagePath(tc);
                const imageUrl = imagePath
                  ? `${API_BASE_URL}/deployments/${agentId}/files/${encodePath(imagePath)}`
                  : null;
                return (
                  <div key={j} className="mb-2 text-xs bg-background/50 rounded p-2 font-mono">
                    <span className="text-[#f0c56c]">{tc.name}</span>
                    {tc.result && <pre className="text-text-muted mt-1">{tc.result}</pre>}
                    {imageUrl && (
                      <div className="mt-2">
                        <AuthImage
                          src={imageUrl}
                          alt={imagePath?.split("/").pop() || "generated image"}
                          className="max-w-[320px] max-h-[320px] rounded-md object-contain"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-surface-low rounded-lg px-4 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            placeholder={connected ? "Type a message..." : "Waiting for gateway connection..."}
            disabled={!connected || sending}
            className="flex-1 bg-surface-low border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-medium disabled:opacity-50"
          />
          <button
            onClick={onSend}
            disabled={!connected || sending || !input.trim()}
            className="btn-primary px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Workspace Panel
// -----------------------------------------------------------------------

function WorkspacePanel({
  files,
  selectedFile,
  fileContent,
  fileDirty,
  savingFile,
  onOpenFile,
  onContentChange,
  onSave,
  onClose,
}: {
  files: WorkspaceFile[];
  selectedFile: string | null;
  fileContent: string;
  fileDirty: boolean;
  savingFile: boolean;
  onOpenFile: (name: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  if (selectedFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <button onClick={onClose} className="text-text-muted hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <File className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-mono text-foreground">{selectedFile}</span>
          {fileDirty && <span className="text-xs text-[#f0c56c]">unsaved</span>}
          <div className="flex-1" />
          <button
            onClick={onSave}
            disabled={!fileDirty || savingFile}
            className="flex items-center gap-1 text-xs btn-primary disabled:opacity-50 px-3 py-1 rounded transition-colors"
          >
            {savingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
        <textarea
          value={fileContent}
          onChange={(e) => onContentChange(e.target.value)}
          className="flex-1 bg-background text-foreground font-mono text-sm p-4 resize-none focus:outline-none"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Workspace Files</h3>
      {files.length === 0 && <p className="text-sm text-text-muted">No files</p>}
      {files.map((f) => (
        <button
          key={f.name}
          onClick={() => onOpenFile(f.name)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded hover:bg-surface-low transition-colors text-left"
        >
          <File className={`w-4 h-4 ${f.missing ? "text-[#d05f5f]" : "text-text-muted"}`} />
          <span className="text-sm text-foreground font-mono flex-1">{f.name}</span>
          <span className="text-xs text-text-muted">{(f.size / 1024).toFixed(1)}KB</span>
          <ChevronRight className="w-3 h-3 text-text-muted" />
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// S3 Files Panel
// -----------------------------------------------------------------------

function isHiddenEntry(name: string): boolean {
  return name.startsWith(".");
}

function describeFileBrowserError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (message.startsWith("Path is a directory:")) {
    return "Cannot download a directory. Open it in the file browser instead.";
  }
  return message;
}

function S3FilesPanel({
  agentId,
  getToken,
  active,
}: {
  agentId: string;
  getToken: () => Promise<string>;
  active: boolean;
}) {
  const [prefix, setPrefix] = useState("");
  const [directories, setDirectories] = useState<S3FileEntry[]>([]);
  const [files, setFiles] = useState<S3FileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadFiles = useCallback(async (targetPrefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const entries = await createAgentClient(token).filesList(agentId, targetPrefix);
      setPrefix(targetPrefix);
      setDirectories(entries.filter((entry) => entry?.type === "directory"));
      setFiles(entries.filter((entry) => entry?.type !== "directory"));
      setTruncated(false);
    } catch (e: any) {
      setError(e.message || "Failed to load files");
      setDirectories([]);
      setFiles([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => {
    if (!active) return;
    void loadFiles(prefix);
  }, [active, prefix, loadFiles]);

  const goToPrefix = useCallback((nextPrefix: string) => {
    setPrefix(nextPrefix);
  }, []);

  const uploadFiles = useCallback(async (uploadList: FileList) => {
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      for (const file of Array.from(uploadList)) {
        const uploadPath = `${prefix}${file.name}`;
        await agentClient.fileWriteBytes(agentId, uploadPath, await file.arrayBuffer());
      }
      await loadFiles(prefix);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [agentId, getToken, loadFiles, prefix]);

  const downloadFile = useCallback(async (path: string) => {
    setError(null);
    try {
      const token = await getToken();
      const content = await createAgentClient(token).fileReadBytes(agentId, path);
      downloadBrowserFile(content, path.split("/").filter(Boolean).pop() || "download");
    } catch (e: any) {
      setError(describeFileBrowserError(e, "Download failed"));
    }
  }, [agentId, getToken]);

  const deleteFile = useCallback(async (path: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setError(null);
    try {
      const token = await getToken();
      await createAgentClient(token).fileDelete(agentId, path);
      await loadFiles(prefix);
    } catch (e: any) {
      setError(e.message || "Delete failed");
    }
  }, [agentId, getToken, loadFiles, prefix]);

  const pathParts = prefix.split("/").filter(Boolean);
  const hiddenDirectoryCount = directories.filter((dir) => isHiddenEntry(dir.name)).length;
  const hiddenFileCount = files.filter((file) => isHiddenEntry(file.name)).length;
  const hiddenEntryCount = hiddenDirectoryCount + hiddenFileCount;

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files?.length) {
      void uploadFiles(e.dataTransfer.files);
    }
  }, [uploadFiles]);

  return (
    <div
      className="flex flex-col h-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-zinc-900/80 border-2 border-dashed border-blue-500 rounded flex items-center justify-center pointer-events-none">
          <div className="text-blue-400 text-sm font-medium flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Drop files to upload
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void uploadFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 px-3 py-1 rounded transition-colors"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload
        </button>
        <button
          onClick={() => void loadFiles(prefix)}
          disabled={loading}
          className="flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 px-3 py-1 rounded transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        {hiddenEntryCount > 0 && (
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500">
            {hiddenEntryCount} hidden
          </span>
        )}
        <div className="flex-1" />
        <p className="text-xs text-zinc-500">
          {uploading ? "Uploading..." : "Drag & drop files or click Upload"}
        </p>
      </div>

      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400 font-mono flex items-center gap-1 overflow-x-auto">
        <button
          onClick={() => goToPrefix("")}
          className="flex items-center gap-1 whitespace-nowrap hover:text-white"
          title="/home/node"
        >
          <House className="h-3.5 w-3.5" />
        </button>
        {pathParts.map((part, idx) => {
          const partPrefix = `${pathParts.slice(0, idx + 1).join("/")}/`;
          return (
            <span key={partPrefix} className="flex items-center gap-1 whitespace-nowrap">
              <span>/</span>
              <button onClick={() => goToPrefix(partPrefix)} className="hover:text-white">{part}</button>
            </span>
          );
        })}
      </div>

      {error && <div className="px-4 py-2 text-xs text-red-400 border-b border-zinc-800">{error}</div>}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="p-2">
            {directories.map((dir) => {
              const nextPrefix = dir.path || `${prefix}${dir.name.replace(/\/?$/, "/")}`;
              return (
                <button
                  key={`dir-${dir.path || dir.name}`}
                  onClick={() => goToPrefix(nextPrefix)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-zinc-800 text-left ${
                    isHiddenEntry(dir.name) ? "opacity-80" : ""
                  }`}
                >
                  <FolderOpen className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-zinc-200 font-mono flex-1">{dir.name}</span>
                  {isHiddenEntry(dir.name) && (
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                      hidden
                    </span>
                  )}
                </button>
              );
            })}

            {files.map((file) => (
              <div
                key={`file-${file.path}`}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-zinc-800 ${
                  isHiddenEntry(file.name) ? "opacity-80" : ""
                }`}
              >
                <File className="w-4 h-4 text-zinc-500" />
                <span className="text-sm text-zinc-200 font-mono flex-1">{file.name}</span>
                {isHiddenEntry(file.name) && (
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    hidden
                  </span>
                )}
                <span className="text-xs text-zinc-500 w-24 text-right">{formatFileSize(file.size)}</span>
                <button
                  onClick={() => void downloadFile(file.path)}
                  className="text-zinc-400 hover:text-white p-1"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void deleteFile(file.path, file.name)}
                  className="text-zinc-400 hover:text-red-400 p-1"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {directories.length === 0 && files.length === 0 && (
              <div className="p-8 text-center text-sm text-zinc-500">
                No files in this directory.
              </div>
            )}

            {hiddenEntryCount > 0 && directories.length + files.length === hiddenEntryCount && (
              <div className="px-2 py-3 text-center text-xs text-zinc-500">
                This directory currently only contains hidden entries.
              </div>
            )}

            {truncated && (
              <div className="px-2 py-2 text-xs text-yellow-400">
                Listing is truncated. Narrow your prefix to see more files.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Config Panel
// -----------------------------------------------------------------------

function ConfigPanel({
  config,
  schema,
  dirty,
  onChange,
  onSave,
}: {
  config: string;
  schema: any;
  dirty: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Settings className="w-4 h-4 text-text-muted" />
        <span className="text-sm font-semibold text-foreground">Gateway Configuration</span>
        {dirty && <span className="text-xs text-[#f0c56c]">unsaved</span>}
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={!dirty}
          className="flex items-center gap-1 text-xs btn-primary disabled:opacity-50 px-3 py-1 rounded transition-colors"
        >
          <Save className="w-3 h-3" />
          Apply & Restart
        </button>
      </div>

      {schema?.uiHints && (
        <div className="px-4 py-2 border-b border-border/50 bg-surface-low/50">
          <p className="text-xs text-text-muted">
            Edit the JSON config below. Changes are merged with the existing config and trigger a gateway restart.
          </p>
        </div>
      )}

      <textarea
        value={config}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-background text-foreground font-mono text-sm p-4 resize-none focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
