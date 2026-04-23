"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GatewayClient,
  type GatewayChatAttachmentPayload,
  type GatewayEvent,
  type GatewayChatToolCall,
  type OpenClawConfigSchemaResponse,
  normalizeGatewayChatMessage,
} from "@hypercli.com/sdk/openclaw/gateway";
import { OpenClawAgent } from "@hypercli.com/sdk/agents";
import { createAgentClient } from "@/lib/agent-client";

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

/** Detect internal heartbeat poll prompts/replies that should never be shown to users. */
function isHeartbeatMessage(content: string): boolean {
  return content.includes("HEARTBEAT.md") || content.includes("HEARTBEAT_OK");
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
  const content = maybeDecodeMojibake(normalized.text);
  if (isHeartbeatMessage(content)) return null;
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
  // Cumulative vs delta detection: only treat as cumulative when the incoming
  // text actually contains the current text as a prefix. The previous
  // length-based heuristic broke delta streams whenever a single chunk was
  // longer than the accumulated text, silently dropping prior content.
  const mergedContent = incoming.content
    ? (
      current.content && incoming.content.startsWith(current.content)
        ? incoming.content
        : `${current.content ?? ""}${incoming.content}`
    )
    : current.content;
  const mergedThinking = incoming.thinking
    ? (
      current.thinking && incoming.thinking.startsWith(current.thinking)
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
  getToken: () => Promise<string>,
  enabled: boolean = true,
) {
  const gwRef = useRef<GatewayClient | null>(null);
  const getTokenRef = useRef(getToken);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingInput, setPendingInput] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [hasChatTimeoutOccurred, setHasChatTimeoutOccurred] = useState(false);
  const [hasChatErrorOccured, setHasChatErrorOccured] = useState(false);

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<OpenClawConfigSchemaResponse | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [cronJobs, setCronJobs] = useState<Array<Record<string, unknown>>>([]);
  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [activityFeed, setActivityFeed] = useState<Array<{
    id: string;
    type: "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";
    action: string;
    detail: string;
    timestamp: number;
  }>>([]);

  type ActivityKind = "message" | "tool" | "connection" | "skill" | "cron" | "error" | "system";
  const appendActivity = useCallback((entry: { type: ActivityKind; action: string; detail?: string; id?: string; timestamp?: number }) => {
    setActivityFeed((prev) => {
      const next = [...prev, {
        type: entry.type,
        action: entry.action,
        detail: entry.detail ?? "",
        id: entry.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: entry.timestamp ?? Date.now(),
      }];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!enabled || !agent || agent.state !== "RUNNING") return;

    let cancelled = false;
    let gw: GatewayClient | null = null;

    async function connect() {
      if (cancelled) return;
      setConnecting(true);
      setError(null);
      try {
        const authToken = await getTokenRef.current();
        if (cancelled) return;

        const deployment = await createAgentClient(authToken).get(agent!.id);
        if (cancelled) return;
        if (!(deployment instanceof OpenClawAgent)) {
          throw new Error("Selected deployment does not expose an OpenClaw gateway");
        }

        gw = await deployment.connect({
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
            setConnecting(true);
            if (closeError?.message) {
              setError(closeError.message);
              return;
            }
            if (code !== 1000 && reason) {
              setError(`Disconnected: ${reason}`);
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
            const text = maybeDecodeMojibake((payload.text as string) ?? "");
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
            // Pull a fresh session list as a safety net in case the gateway
            // didn't push a `sessions.updated` event.
            void (async () => {
              try {
                const list = await gw?.sessionsList();
                if (!cancelled && list) setSessions(list as Array<Record<string, unknown>>);
              } catch {
                // optional
              }
            })();
          } else if (event === "sessions.updated") {
            const list = (payload as Record<string, unknown>).sessions;
            if (Array.isArray(list)) {
              setSessions(list as Array<Record<string, unknown>>);
            }
          } else if (event === "chat.error") {
            setSending(false);
            setHasChatErrorOccured(true);
            setMessages((prev) => [
              ...prev,
              {
                role: "system",
                content: `Error: ${(payload as Record<string, unknown>).message ?? "Unknown error"}`,
                timestamp: Date.now(),
              },
            ]);
          }

          // Server-driven activity events → feed (hoisted appendActivity)
          const isActivityKind = (v: unknown): v is ActivityKind =>
            v === "message" || v === "tool" || v === "connection" || v === "skill" || v === "cron" || v === "error" || v === "system";
          if (event === "chat.tool_call") {
            const tc = normalizeLiveToolCall(payload as Record<string, unknown>);
            if (tc) appendActivity({ type: "tool", action: tc.name, detail: tc.args || "" });
          } else if (event === "chat.tool_result") {
            const tc = normalizeLiveToolResult(payload as Record<string, unknown>);
            if (tc?.result) appendActivity({ type: "tool", action: `${tc.name} → result`, detail: tc.result });
          } else if (event === "chat.done") {
            appendActivity({ type: "message", action: "Assistant response complete" });
          } else if (event === "chat.error") {
            appendActivity({ type: "error", action: "Error", detail: String((payload as Record<string, unknown>).message ?? "Unknown error") });
          } else if (event === "activity.log") {
            const entry = payload as Record<string, unknown>;
            const kind = isActivityKind(entry.type) ? entry.type : "system";
            appendActivity({
              type: kind,
              action: typeof entry.action === "string" ? entry.action : "Activity",
              detail: typeof entry.detail === "string" ? entry.detail : "",
              id: typeof entry.id === "string" ? entry.id : undefined,
              timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
            });
          } else if (event === "sessions.updated") {
            const sessionsList = (payload as Record<string, unknown>).sessions;
            const count = Array.isArray(sessionsList) ? sessionsList.length : 0;
            appendActivity({ type: "system", action: "Sessions updated", detail: `${count} active` });
          }
        });

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

        // Load sessions / cron / models in parallel — all optional
        {
          const [sessionsRes, cronRes, modelsRes] = await Promise.allSettled([
            gw.sessionsList(),
            gw.cronList(),
            gw.modelsList(),
          ]);
          if (!cancelled) {
            if (sessionsRes.status === "fulfilled") setSessions(sessionsRes.value as Array<Record<string, unknown>>);
            if (cronRes.status === "fulfilled") setCronJobs(cronRes.value as Array<Record<string, unknown>>);
            if (modelsRes.status === "fulfilled") setModels(modelsRes.value as Array<Record<string, unknown>>);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
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
      setSessions([]);
      setCronJobs([]);
      setModels([]);
      setActivityFeed([]);
    };
  }, [
    enabled,
    agent?.hostname,
    agent?.id,
    agent?.state,
  ]);

  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatPendingFile[]>([]);

  const addPendingMessage = (message: string) => {
    setPendingInput((prev) => [...prev, message]);
  };

  useEffect(() => {
    if (!sending && pendingInput.length > 0) {
      const nextMessage = pendingInput[0];

      // Remove the first message from the queue
      setPendingInput((prev) => prev.slice(1));

      // Send it
      sendMessage(nextMessage);
    }
  }, [sending, pendingInput]);

  // useEffect calls for detecting chat-timeout
  useEffect(() => {
    if (!sending) return;

    // reset timeout when a new send starts
    setHasChatTimeoutOccurred(false);

    let timeoutId: NodeJS.Timeout;

    const scheduleTimeout = () => {
      clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        setHasChatTimeoutOccurred(true);
      }, 5 * 60 * 1000); // 5 minutes
    };

    // run once initially
    scheduleTimeout();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [sending]);

  // second useEffect hook for resetting chat timeout timer based on last message changes
  useEffect(() => {
    if (!sending) return;

    // every time messages update, reset timeout
    setHasChatTimeoutOccurred(false);

    const timeoutId = setTimeout(() => {
      setHasChatTimeoutOccurred(true);
    }, 5 * 60 * 1000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [messages, sending]);

  

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
    setHasChatTimeoutOccurred(false);
    setHasChatErrorOccured(false);

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: Date.now() };
    if (attachments.length > 0) {
      userMsg.attachments = attachments;
    }
    if (files.length > 0) {
      userMsg.files = files;
    }
    setMessages((prev) => [...prev, userMsg]);

    const preview = msg.slice(0, 80);
    appendActivity({
      type: "message",
      action: "User message sent",
      detail: preview + (attachments.length > 0 ? ` · ${attachments.length} image${attachments.length === 1 ? "" : "s"}` : ""),
    });

    try {
      await gw.sendChat(
        agentMessage || "What's in this image?",
        "main",
        undefined,
        attachments.length > 0 ? attachments : undefined,
      );
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${errMsg}`,
          timestamp: Date.now(),
        },
      ]);
      appendActivity({ type: "error", action: "Send failed", detail: errMsg });
      setSending(false);
    }
  }, [input, sending, pendingAttachments, pendingFiles, appendActivity]);

  const retryMessage = useCallback(() => {
    if (!messages.length) return;

    // find last user message from the end
    const lastUserMessage = [...messages]
        .reverse()
        .find((msg) => msg.role === "user" && msg.content?.trim());

      if (!lastUserMessage) return;

      // reset timeout/error state if needed (optional but recommended)
      setHasChatTimeoutOccurred(false);
      setHasChatErrorOccured(false);

      sendMessage(lastUserMessage.content);
  }, [messages]);

  // File operations
  const openFile = useCallback(
    async (name: string): Promise<string> => {
      const gw = gwRef.current;
      if (!gw) throw new Error("Not connected");
      const content = await gw.fileGet(gwAgentId, name);
      appendActivity({ type: "tool", action: "file_read", detail: name });
      return content;
    },
    [gwAgentId, appendActivity]
  );

  const saveFile = useCallback(
    async (name: string, content: string) => {
      const gw = gwRef.current;
      if (!gw) throw new Error("Not connected");
      await gw.fileSet(gwAgentId, name, content);
      appendActivity({ type: "tool", action: "file_write", detail: `${name} · ${content.length.toLocaleString()} chars` });
    },
    [gwAgentId, appendActivity]
  );

  // Config operations
  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    await gw.configPatch(patch);
    const keys = Object.keys(patch);
    appendActivity({
      type: "system",
      action: "Config updated",
      detail: keys.length > 0 ? keys.slice(0, 3).join(", ") + (keys.length > 3 ? `, +${keys.length - 3}` : "") : "",
    });
  }, [appendActivity]);

  const channelsStatus = useCallback(async (probe = false, timeoutMs?: number) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    return gw.channelsStatus(probe, timeoutMs);
  }, []);

  // Sessions / Cron / Models — Phase 4 wiring

  const refreshSessions = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const list = await gw.sessionsList();
      setSessions(list as Array<Record<string, unknown>>);
    } catch {
      // optional
    }
  }, []);

  const refreshCron = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const list = await gw.cronList();
      setCronJobs(list as Array<Record<string, unknown>>);
    } catch {
      // optional
    }
  }, []);

  const addCron = useCallback(async (job: Record<string, unknown>) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    await gw.cronAdd(job);
    await refreshCron();
    const schedule = typeof job.schedule === "string" ? job.schedule : "";
    const description = typeof job.description === "string" ? job.description : "";
    appendActivity({
      type: "cron",
      action: "Cron added",
      detail: [description, schedule].filter(Boolean).join(" · "),
    });
  }, [refreshCron, appendActivity]);

  const removeCron = useCallback(async (jobId: string) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    await gw.cronRemove(jobId);
    await refreshCron();
    appendActivity({ type: "cron", action: "Cron removed", detail: jobId });
  }, [refreshCron, appendActivity]);

  const runCron = useCallback(async (jobId: string) => {
    const gw = gwRef.current;
    if (!gw) throw new Error("Not connected");
    appendActivity({ type: "cron", action: "Cron run", detail: jobId });
    return gw.cronRun(jobId);
  }, [appendActivity]);

  return {
    messages,
    sendMessage,
    retryMessage,
    input,
    setInput,
    pendingInput,
    addPendingMessage,
    sending,
    hasChatTimeoutOccurred,
    hasChatErrorOccured,
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
    pendingFiles,
    pendingAttachments,
    addPendingFiles,
    addAttachments,
    removePendingFile,
    removeAttachment,
    sessions,
    cronJobs,
    models,
    activityFeed,
    refreshSessions,
    refreshCron,
    addCron,
    removeCron,
    runCron,
  };
}
