"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayClient } from "@/gateway-client";
import { clawFetch } from "@/lib/api";

export interface ChatAttachment {
  type: string;
  mimeType: string;
  content: string; // base64
  fileName?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; args: string; result?: string }>;
  mediaUrls?: string[];
  attachments?: ChatAttachment[]; // user-sent images
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
}

function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") return null;
  const entry = message as Record<string, unknown>;
  const rawRole = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  const role: ChatMessage["role"] =
    rawRole === "user" || rawRole === "assistant" || rawRole === "system"
      ? rawRole
      : "assistant";
  const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : Date.now();

  const extractContent = (): string => {
    if (typeof entry.text === "string") return maybeDecodeMojibake(entry.text);
    if (typeof entry.content === "string") return maybeDecodeMojibake(entry.content);
    if (!Array.isArray(entry.content)) return "";
    const parts = entry.content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const part = item as Record<string, unknown>;
        if (part.type !== "text") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("");
    return maybeDecodeMojibake(parts);
  };

  const content = extractContent();
  if (!content.trim()) return null;

  let thinking: string | undefined;
  if (Array.isArray(entry.content)) {
    const thinkingParts = entry.content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const part = item as Record<string, unknown>;
        if (part.type !== "thinking") return "";
        return typeof part.thinking === "string" ? part.thinking : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (thinkingParts) {
      thinking = maybeDecodeMojibake(thinkingParts);
    }
  }

  // Extract media URLs from message
  const mediaUrls: string[] = [];
  if (Array.isArray(entry.content)) {
    for (const item of entry.content) {
      if (!item || typeof item !== "object") continue;
      const part = item as Record<string, unknown>;
      // Handle image content blocks (base64 inline or URL)
      if (part.type === "image") {
        if (typeof part.source === "object" && part.source) {
          const source = part.source as Record<string, unknown>;
          if (source.type === "url" && typeof source.url === "string") {
            mediaUrls.push(source.url);
          } else if (source.type === "base64" && typeof source.data === "string") {
            const mime = (source.media_type as string) || "image/png";
            mediaUrls.push(`data:${mime};base64,${source.data}`);
          }
        }
      }
    }
  }
  // Also check top-level mediaUrl/mediaUrls
  if (typeof entry.mediaUrl === "string") mediaUrls.push(entry.mediaUrl);
  if (Array.isArray(entry.mediaUrls)) {
    for (const u of entry.mediaUrls) {
      if (typeof u === "string") mediaUrls.push(u);
    }
  }

  return {
    role,
    content,
    ...(thinking ? { thinking } : {}),
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    timestamp,
  };
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

function extractChatText(payload: Record<string, unknown>): string {
  if (typeof payload.text === "string") {
    return maybeDecodeMojibake(payload.text);
  }

  const message =
    payload.message && typeof payload.message === "object"
      ? (payload.message as Record<string, unknown>)
      : null;
  if (!message) return "";

  if (typeof message.content === "string") {
    return maybeDecodeMojibake(message.content);
  }

  if (!Array.isArray(message.content)) return "";
  const parts = message.content
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const segment = entry as Record<string, unknown>;
      if (segment.type !== "text") return "";
      return typeof segment.text === "string" ? segment.text : "";
    })
    .filter(Boolean)
    .join("");

  return maybeDecodeMojibake(parts);
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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<Record<string, unknown> | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!agent || agent.state !== "RUNNING" || !agent.hostname) return;

    const url = agent.openclaw_url || `wss://openclaw-${agent.hostname}`;
    if (!url) {
      setError("No gateway URL available");
      return;
    }

    let cancelled = false;
    let gw: GatewayClient | null = null;
    const RECONNECT_INTERVAL = 5000;

    async function connect() {
      if (cancelled) return;
      setConnecting(true);
      setError(null);
      try {
        // Set up auth cookies
        const subdomain = agent!.hostname!.split(".")[0];
        const hostCookie = `${subdomain}-token`;
        const shellCookie = `shell-${subdomain}-token`;
        const openclawCookie = `openclaw-${subdomain}-token`;
        const reefCookie = "reef_token";
        const hasCookie = (name: string) =>
          document.cookie
            .split(";")
            .some((entry) =>
              entry.trim().startsWith(`${encodeURIComponent(name)}=`)
            );
        const configuredCookieDomain = (
          process.env.NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN || ""
        ).trim();
        const normalizedDomain = configuredCookieDomain.replace(/^\./, "");
        const currentHost =
          typeof window !== "undefined" ? window.location.hostname : "";
        const canUseCrossDomainCookie =
          normalizedDomain &&
          (currentHost === normalizedDomain ||
            currentHost.endsWith(`.${normalizedDomain}`));
        const cookieDomain = canUseCrossDomainCookie
          ? configuredCookieDomain || `.${normalizedDomain}`
          : "";

        if (!hasCookie(hostCookie)) {
          const authToken = await getTokenRef.current();
          if (cancelled) return;
          const tokenResp = await clawFetch<{ token: string }>(
            `/deployments/${agent!.id}/token`,
            authToken
          );
          if (cancelled) return;
          const tokenValue = encodeURIComponent(tokenResp.token);
          const securePart =
            window.location.protocol === "https:" ? "; secure" : "";
          const domainPart = cookieDomain ? `; domain=${cookieDomain}` : "";
          const expires = new Date(
            Date.now() + 12 * 60 * 60 * 1000
          ).toUTCString();

          document.cookie = `${hostCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
          document.cookie = `${shellCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
          document.cookie = `${openclawCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
          document.cookie = `${reefCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
        }

        if (cancelled) return;
        const gatewayTokenResp = await clawFetch<{ gateway_token: string }>(
          `/deployments/${agent!.id}/gateway-token`,
          await getTokenRef.current()
        );
        const gatewayToken = gatewayTokenResp.gateway_token;
        if (cancelled) return;
        gw = new GatewayClient({ url, gatewayToken });

        // Set up event handler for streaming chat
        gw.onEvent((event, payload) => {
          if (cancelled) return;

          if (event === "chat") {
            const chatPayload = payload as Record<string, unknown>;
            const nextText = extractChatText(chatPayload);
            const message =
              chatPayload.message && typeof chatPayload.message === "object"
                ? (chatPayload.message as Record<string, unknown>)
                : null;
            const role = typeof message?.role === "string" ? message.role : "assistant";
            const timestamp =
              typeof message?.timestamp === "number" ? message.timestamp : Date.now();

            // Extract media URLs from the message payload
            const eventMediaUrls: string[] = [];
            if (message) {
              if (typeof message.mediaUrl === "string") eventMediaUrls.push(message.mediaUrl);
              if (Array.isArray(message.mediaUrls)) {
                for (const u of message.mediaUrls) {
                  if (typeof u === "string") eventMediaUrls.push(u);
                }
              }
            }

            if (role === "assistant" && (nextText || eventMediaUrls.length > 0)) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  const merged =
                    nextText.startsWith(last.content) || nextText.length >= last.content.length
                      ? nextText
                      : `${last.content}${nextText}`;
                  const mergedMedia = [
                    ...(last.mediaUrls ?? []),
                    ...eventMediaUrls.filter((u) => !(last.mediaUrls ?? []).includes(u)),
                  ];
                  return [...prev.slice(0, -1), {
                    ...last,
                    content: merged,
                    timestamp,
                    ...(mergedMedia.length > 0 ? { mediaUrls: mergedMedia } : {}),
                  }];
                }
                return [...prev, {
                  role: "assistant" as const,
                  content: nextText,
                  timestamp,
                  ...(eventMediaUrls.length > 0 ? { mediaUrls: eventMediaUrls } : {}),
                }];
              });
            }

            if (chatPayload.state === "final") {
              setSending(false);
            }
          } else if (event === "chat.content") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: last.content + ((payload.text as string) ?? "") },
                ];
              }
              return [
                ...prev,
                {
                  role: "assistant",
                  content: (payload.text as string) ?? "",
                  timestamp: Date.now(),
                },
              ];
            });
          } else if (event === "chat.thinking") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    thinking:
                      (last.thinking ?? "") + ((payload.text as string) ?? ""),
                  },
                ];
              }
              return [
                ...prev,
                {
                  role: "assistant",
                  content: "",
                  thinking: (payload.text as string) ?? "",
                  timestamp: Date.now(),
                },
              ];
            });
          } else if (event === "chat.tool_call") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                const tc = {
                  name: (payload as Record<string, unknown>).name as string ?? "?",
                  args: JSON.stringify(payload),
                };
                return [
                  ...prev.slice(0, -1),
                  { ...last, toolCalls: [...(last.toolCalls ?? []), tc] },
                ];
              }
              return prev;
            });
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

        // Set up auto-reconnect on disconnect
        gw.onDisconnect = () => {
          if (cancelled) return;
          setConnected(false);
          setConnecting(true);
          gwRef.current = null;
          // Schedule reconnect
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelled) connect();
          }, RECONNECT_INTERVAL);
        };

        await gw.connect();
        if (cancelled) { gw.close(); return; }

        gwRef.current = gw;
        setConnected(true);
        setConnecting(false);
        setError(null);

        // Hydrate chat with existing session messages
        const history = await gw.chatHistory("main", 200);
        if (cancelled) return;
        const hydrated = history
          .map((message) => normalizeHistoryMessage(message))
          .filter((message): message is ChatMessage => message !== null);
        setMessages(hydrated.length > 0 ? hydrated : []);

        // Load agents list to get gateway agent ID
        const agents = await gw.agentsList();
        if (cancelled) return;
        if (agents.length > 0) {
          setGwAgentId(agents[0].id);
        }

        // Load files
        const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
        const filesList = await gw.filesList(agentIdForFiles);
        if (cancelled) return;
        setFiles(filesList);

        // Load config + schema
        const [cfg, schemaResp] = await Promise.all([
          gw.configGet(),
          gw.configSchema(),
        ]);
        if (cancelled) return;
        const schema = (
          schemaResp &&
          typeof schemaResp === "object" &&
          "schema" in schemaResp &&
          schemaResp.schema &&
          typeof schemaResp.schema === "object"
        )
          ? (schemaResp.schema as Record<string, unknown>)
          : (schemaResp as Record<string, unknown>);
        setConfig(cfg);
        setConfigSchema(schema);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setConnecting(false);
          // Schedule reconnect on error
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelled) connect();
          }, RECONNECT_INTERVAL);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
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
    };
  }, [
    agent?.hostname,
    agent?.id,
    agent?.state,
  ]);

  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);

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

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const sendMessage = useCallback(async (overrideInput?: string) => {
    const gw = gwRef.current;
    const nextInput = typeof overrideInput === "string" ? overrideInput : input;
    const nextAttachments = typeof overrideInput === "string" ? [] : pendingAttachments;
    if (!gw || (!nextInput.trim() && nextAttachments.length === 0) || sending) return;

    const msg = nextInput.trim();
    const attachments = [...nextAttachments];
    setInput("");
    setPendingAttachments([]);
    setSending(true);

    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: Date.now() };
    if (attachments.length > 0) {
      userMsg.attachments = attachments;
    }
    setMessages((prev) => [...prev, userMsg]);

    try {
      await gw.chatSend(msg || "What's in this image?", undefined, undefined, attachments.length > 0 ? attachments : undefined);
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
  }, [input, sending, pendingAttachments]);

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
    pendingAttachments,
    addAttachments,
    removeAttachment,
  };
}
