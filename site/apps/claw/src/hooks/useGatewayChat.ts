"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GatewayClient,
  type GatewayChatAttachmentPayload,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/gateway";
import { API_BASE_URL, agentApiFetch } from "@/lib/api";
import { getGatewayToken as getStoredGatewayToken, setGatewayToken as storeGatewayToken, removeAgentState } from "@/lib/agent-store";
import { refreshGatewayToken } from "@/lib/gateway-auth";

export type ChatAttachment = GatewayChatAttachmentPayload;

export interface ChatPendingFile {
  name: string;
  path: string;
  type: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ id?: string; name: string; args: string; result?: string }>;
  mediaUrls?: string[];
  attachments?: ChatAttachment[]; // user-sent images
  files?: ChatPendingFile[]; // user-sent workspace files
  timestamp?: number;
}

export interface WorkspaceFile {
  name: string;
  size: number;
  missing: boolean;
}

interface Agent {
  id: string;
  name: string;
  state: string;
  hostname: string | null;
  openclaw_url?: string | null;
  gatewayToken?: string | null;
}

function maybeDecodeMojibake(text: string): string {
  // Some gateways occasionally emit UTF-8 text decoded as latin1 (e.g. ð, â).
  if (!/[Ãâð]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    if (decoded && decoded !== text) return decoded;
  } catch {
    // Fall back to original text on decoding errors.
  }
  return text;
}

function normalizeChatRole(role: string): ChatMessage["role"] {
  const normalized = role.trim().toLowerCase();
  if (normalized === "user" || normalized === "assistant" || normalized === "system") {
    return normalized;
  }
  return "assistant";
}

/** Detect internal heartbeat poll prompts that should never be shown to users. */
function isHeartbeatMessage(content: string): boolean {
  return content.includes("HEARTBEAT.md");
}

/**
 * Detect and extract clean text from content that was accidentally JSON-stringified.
 * Only extracts from objects that look like chat message shapes (have a `role` field)
 * to avoid stripping intentional JSON content (e.g. AI showing a JSON example).
 * Also handles double-stringified strings and content block arrays.
 */
function sanitizeContent(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    const parsed = JSON.parse(trimmed);
    // Double-stringified: JSON.parse('"hello"') → "hello"
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      // Only extract from objects that look like chat messages (have a role field)
      // to avoid stripping intentional JSON the AI meant to display
      const hasRole = typeof parsed.role === "string";
      if (!hasRole) return raw;
      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.message === "string") return parsed.message;
      // Array of content blocks — join ALL text items
      if (Array.isArray(parsed.content)) {
        const texts = parsed.content
          .filter((b: unknown) => {
            const r = b as Record<string, unknown>;
            return r?.type === "text" && typeof r?.text === "string";
          })
          .map((b: unknown) => (b as Record<string, string>).text);
        if (texts.length > 0) return texts.join("\n");
      }
    }
  } catch {
    // Not valid JSON — return original
  }
  return raw;
}

function formatToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return maybeDecodeMojibake(value);
  try {
    return maybeDecodeMojibake(JSON.stringify(value, null, 2));
  } catch {
    return maybeDecodeMojibake(String(value));
  }
}

function summarizeToolCalls(
  toolCalls: GatewayChatToolCall[],
): ChatMessage["toolCalls"] | undefined {
  if (toolCalls.length === 0) {
    return undefined;
  }
  return toolCalls.map((toolCall) => ({
    ...(toolCall.id ? { id: toolCall.id } : {}),
    name: toolCall.name,
    args: formatToolValue(toolCall.args),
    ...(toolCall.result !== undefined ? { result: formatToolValue(toolCall.result) } : {}),
  }));
}

function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  const normalized = normalizeGatewayChatMessage(message);
  if (!normalized) return null;
  const content = sanitizeContent(maybeDecodeMojibake(normalized.text));
  const thinking = maybeDecodeMojibake(normalized.thinking).trim();
  const toolCalls = summarizeToolCalls(normalized.toolCalls);
  const mediaUrls = normalized.mediaUrls;
  if (!content.trim() && !thinking && (!toolCalls || toolCalls.length === 0) && mediaUrls.length === 0) {
    return null;
  }
  return {
    role: normalizeChatRole(normalized.role),
    content,
    ...(thinking ? { thinking } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
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

function mergeAssistantMessage(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  const mergedContent = incoming.content
    ? (
      incoming.content.startsWith(current.content) || incoming.content.length >= current.content.length
        ? incoming.content
        : `${current.content}${incoming.content}`
    )
    : current.content;
  const mergedThinking = incoming.thinking
    ? (
      current.thinking && (
        incoming.thinking.startsWith(current.thinking) ||
        incoming.thinking.length >= current.thinking.length
      )
        ? incoming.thinking
        : `${current.thinking ?? ""}${incoming.thinking}`
    )
    : current.thinking;
  const mergedMediaUrls = [
    ...(current.mediaUrls ?? []),
    ...((incoming.mediaUrls ?? []).filter((url) => !(current.mediaUrls ?? []).includes(url))),
  ];
  const mergedToolCalls = incoming.toolCalls
    ? mergeToolCalls(current.toolCalls ?? [], incoming.toolCalls)
    : current.toolCalls;
  return {
    ...current,
    content: mergedContent,
    ...(mergedThinking ? { thinking: mergedThinking } : {}),
    ...(mergedToolCalls && mergedToolCalls.length > 0 ? { toolCalls: mergedToolCalls } : {}),
    ...(mergedMediaUrls.length > 0 ? { mediaUrls: mergedMediaUrls } : {}),
    timestamp: incoming.timestamp ?? current.timestamp,
  };
}

function upsertAssistantMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (last?.role === "assistant") {
    return [...prev.slice(0, -1), mergeAssistantMessage(last, incoming)];
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
  if (!name) {
    return null;
  }
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
  if (!result) {
    return null;
  }
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

/**
 * Reusable hook for gateway connection + chat logic.
 * Extracted from the console page for use in the chat-first agents layout.
 */
export function useGatewayChat(
  agent: Agent | null,
  getToken: () => Promise<string>
) {
  const gwRef = useRef<GatewayClient | null>(null);
  const getTokenRef = useRef(getToken);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<OpenClawConfigSchemaResponse | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!agent || agent.state !== "RUNNING" || !agent.hostname) return;

    const url = agent.openclaw_url || `wss://${agent.hostname}`;
    if (!url) {
      setError("No gateway URL available");
      return;
    }

    let cancelled = false;
    let gw: GatewayClient | null = null;

    async function connect() {
      if (cancelled) return;
      setConnecting(true);
      setError(null);
      try {
        const authToken = await Promise.race([
          getTokenRef.current(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Authentication timed out")), 15_000)
          ),
        ]);
        if (cancelled) return;
        let gatewayToken = agent!.gatewayToken ?? getStoredGatewayToken(agent!.id) ?? undefined;
        if (!gatewayToken) {
          try {
            const envResp = await agentApiFetch<{ env: Record<string, string> }>(
              `/deployments/${agent!.id}/env`,
              authToken
            );
            gatewayToken = envResp.env?.OPENCLAW_GATEWAY_TOKEN ?? undefined;
            if (gatewayToken) storeGatewayToken(agent!.id, gatewayToken);
          } catch {
            // Keep the SDK error if the gateway token is still unavailable.
          }
        }
        if (cancelled) return;
        gw = new GatewayClient({
          url,
          gatewayToken,
          deploymentId: agent!.id,
          apiKey: authToken,
          apiBase: API_BASE_URL,
          autoApprovePairing: true,
          onHello: () => {
            if (cancelled) return;
            setConnected(true);
            setConnecting(false);
            setError(null);
          },
          onClose: ({ error: closeError, code, reason }) => {
            if (cancelled) return;
            setConnected(false);
            setConnecting(false);
            if (closeError?.message) {
              setError(closeError.message);
              return;
            }
            if (code !== 1000 && reason) {
              setError(`Disconnected: ${reason}`);
            } else if (code !== 1000) {
              setError("Connection lost. Reconnecting...");
            }
          },
          onGap: ({ expected, received }) => {
            if (cancelled) return;
            setError(`Gateway event gap detected (expected ${expected}, got ${received})`);
          },
          onPairing: (pairing) => {
            if (cancelled || !pairing) return;
            if (pairing.status === "failed" && pairing.error) {
              setError(pairing.error);
              setConnecting(false);
              return;
            }
            setConnecting(true);
            setError(null);
          },
        });
        gwRef.current = gw;

        // Set up event handler for streaming chat
        gw.onEvent((gatewayEvent: GatewayEvent) => {
          if (cancelled) return;
          const event = gatewayEvent.event;
          const payload = gatewayEvent.payload ?? {};

          // HYP-27: process agent tool stream events into ChatMessage toolCalls
          if (event === "agent" && String((payload as Record<string, unknown>).stream || "") === "tool") {
            const data = (payload as Record<string, unknown>).data as Record<string, unknown> | undefined;
            if (data) {
              const phase = data.phase as string;
              const toolName = (data.name as string) || "";
              const toolCallId = data.toolCallId as string | undefined;
              if (phase === "start" && toolName) {
                const args = data.args ? formatToolValue(data.args) : "";
                setMessages((prev) => upsertAssistantMessage(prev, {
                  role: "assistant",
                  content: "",
                  toolCalls: [{ ...(toolCallId ? { id: toolCallId } : {}), name: toolName, args }],
                  timestamp: Date.now(),
                }));
              } else if (phase === "result" && toolName) {
                const meta = (data.meta as string) || "";
                const isError = Boolean(data.isError);
                const resultText = isError ? `Error: ${meta}` : meta;
                if (resultText) {
                  setMessages((prev) => upsertAssistantMessage(prev, {
                    role: "assistant",
                    content: "",
                    toolCalls: [{ ...(toolCallId ? { id: toolCallId } : {}), name: toolName, args: "", result: resultText }],
                    timestamp: Date.now(),
                  }));
                }
              }
            }
          }

          if (event === "chat") {
            const chatPayload = payload as Record<string, unknown>;
            const normalized = normalizeHistoryMessage(chatPayload.message);
            if (normalized?.role === "assistant") {
              setMessages((prev) => upsertAssistantMessage(prev, normalized));
            }

            if (chatPayload.state === "final") {
              setSending(false);
            }
          } else if (event === "chat.content") {
            const text = sanitizeContent(maybeDecodeMojibake((payload.text as string) ?? ""));
            if (!text) return;
            setMessages((prev) => {
              return upsertAssistantMessage(prev, {
                role: "assistant",
                content: text,
                timestamp: Date.now(),
              });
            });
          } else if (event === "chat.thinking") {
            const text = maybeDecodeMojibake((payload.text as string) ?? "");
            if (!text) return;
            setMessages((prev) => {
              return upsertAssistantMessage(prev, {
                role: "assistant",
                content: "",
                thinking: text,
                timestamp: Date.now(),
              });
            });
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
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Error: ${(payload as Record<string, unknown>).message ?? "Unknown error"}`,
                timestamp: Date.now(),
              },
            ]);
          }
        });

        await Promise.race([
          gw.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Gateway connection timed out")), 30_000)
          ),
        ]);
        if (cancelled) { gw.close(); return; }

        setConnected(true);
        setConnecting(false);
        setError(null);

        {
          const [cfgResult, schemaResult] = await Promise.allSettled([
            gw.configGet(),
            gw.configSchema(),
          ]);
          if (!cancelled) {
            if (cfgResult.status === "fulfilled") {
              setConfig(cfgResult.value);
            } else {
              console.error("[useGatewayChat] configGet failed:", cfgResult.reason);
              setConfig({});
            }
            if (schemaResult.status === "fulfilled") {
              // TODO: TEMPORARY — remove after schema inspection
              console.log("[configSchema] full response:", JSON.stringify(schemaResult.value, null, 2));
              setConfigSchema(schemaResult.value);
            } else {
              console.error("[useGatewayChat] configSchema failed:", schemaResult.reason);
            }
          }
        }

        try {
          const history = await gw.chatHistory("main", 200);
          if (!cancelled) {
            const hydrated = history
              .map((message) => normalizeHistoryMessage(message))
              .filter((message): message is ChatMessage => message !== null);
            setMessages(hydrated.length > 0 ? hydrated : []);
          }
        } catch {
          // Chat history is optional for initial render.
        }

        try {
          const agents = await gw.agentsList();
          if (cancelled) return;
          if (agents.length > 0) {
            setGwAgentId(agents[0].id);
          }

          const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
          const filesList = await gw.filesList(agentIdForFiles);
          if (!cancelled) {
            setFiles(filesList);
          }
        } catch {
          // File listing is optional for chat-first views.
        }
      } catch (e: unknown) {
        if (!cancelled) {
          // Close gateway on failure to prevent zombie connections after timeout
          gw?.close();
          gwRef.current = null;
          setError(e instanceof Error ? e.message : String(e));
          setConnecting(false);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      gw?.close();
      gwRef.current?.close();
      gwRef.current = null;
      if (agent?.id) {
        removeAgentState(agent.id);
      }
      setConnected(false);
      setConnecting(false);
      setMessages([]);
      setFiles([]);
      setConfig(null);
      setConfigSchema(null);
      setError(null);
      setSending(false);
      setGwAgentId("main");
      setPendingAttachments([]);
      setPendingFiles([]);
    };
  }, [
    agent?.hostname,
    agent?.id,
    agent?.state,
  ]);

  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);

  const addAttachments = useCallback((files: FileList) => {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        if (!base64) return;
        setPendingAttachments((prev) => [
          ...prev,
          { type: "image", mimeType: file.type, content: base64, fileName: file.name },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const addPendingFiles = useCallback((files: ChatPendingFile[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      const target = prev[index];
      if (target?.fileName) {
        setPendingFiles((currentFiles) => {
          const fileIndex = currentFiles.findIndex(
            (file) => file.type.startsWith("image/") && file.name === target.fileName
          );
          if (fileIndex === -1) return currentFiles;
          return currentFiles.filter((_, i) => i !== fileIndex);
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => {
      const target = prev[index];
      if (target?.type.startsWith("image/")) {
        setPendingAttachments((currentAttachments) => {
          const attachmentIndex = currentAttachments.findIndex(
            (attachment) => attachment.fileName === target.name
          );
          if (attachmentIndex === -1) return currentAttachments;
          return currentAttachments.filter((_, i) => i !== attachmentIndex);
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const sendMessage = useCallback(async (overrideInput?: string) => {
    const gw = gwRef.current;
    const nextInput = typeof overrideInput === "string" ? overrideInput : input;
    const nextAttachments = typeof overrideInput === "string" ? [] : pendingAttachments;
    const nextFiles = typeof overrideInput === "string" ? [] : pendingFiles;
    if (!gw || (!nextInput.trim() && nextAttachments.length === 0 && nextFiles.length === 0) || sending) return;

    const msg = nextInput.trim();
    const attachments = [...nextAttachments];
    const files = [...nextFiles];
    const hiddenFileHeader = files.map((file) => `file: ${file.path}`).join("\n");
    const agentMessage = hiddenFileHeader
      ? msg
        ? `${hiddenFileHeader}\n\n${msg}`
        : `${hiddenFileHeader}\n\n`
      : msg;
    setInput("");
    setPendingAttachments([]);
    setPendingFiles([]);
    setSending(true);

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: Date.now() };
    if (attachments.length > 0) {
      userMsg.attachments = attachments;
    }
    if (files.length > 0) {
      userMsg.files = files;
    }
    setMessages((prev) => [...prev, userMsg]);

    try {
      await gw.sendChat(
        agentMessage || "What's in this image?",
        "main",
        undefined,
        attachments.length > 0 ? attachments : undefined,
      );
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: Date.now(),
        },
      ]);
      setSending(false);
    }
  }, [input, sending, pendingAttachments, pendingFiles]);

  // File operations
  const openFile = useCallback(
    async (name: string): Promise<string> => {
      const gw = gwRef.current;
      if (!gw) throw new Error("Not connected");
      return gw.fileGet(gwAgentId, name);
    },
    [gwAgentId]
  );

  const saveFile = useCallback(
    async (name: string, content: string) => {
      const gw = gwRef.current;
      if (!gw) throw new Error("Not connected");
      await gw.fileSet(gwAgentId, name, content);
    },
    [gwAgentId]
  );

  // Config operations
  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    await gw.configPatch(patch);
  }, []);

  const channelsStatus = useCallback(async (probe = false, timeoutMs?: number) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    return gw.channelsStatus(probe, timeoutMs);
  }, []);

  const webLoginStart = useCallback(async (options?: { force?: boolean; verbose?: boolean; accountId?: string }) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    return gw.webLoginStart(options);
  }, []);

  const webLoginWait = useCallback(async (options?: { timeoutMs?: number; accountId?: string }) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    return gw.webLoginWait(options);
  }, []);

  return {
    messages,
    sendMessage,
    input,
    setInput,
    sending,
    connected,
    connecting,
    error,
    files,
    config,
    configSchema,
    openFile,
    saveFile,
    saveConfig,
    channelsStatus,
    webLoginStart,
    webLoginWait,
    pendingFiles,
    pendingAttachments,
    addPendingFiles,
    addAttachments,
    removePendingFile,
    removeAttachment,
  };
}
