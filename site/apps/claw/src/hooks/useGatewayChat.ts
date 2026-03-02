"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GatewayClient } from "@/gateway-client";
import { clawFetch } from "@/lib/api";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; args: string; result?: string }>;
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

/**
 * Reusable hook for gateway connection + chat logic.
 * Extracted from the console page for use in the chat-first agents layout.
 */
export function useGatewayChat(
  agent: Agent | null,
  getToken: () => Promise<string>
) {
  const gwRef = useRef<GatewayClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configSchema, setConfigSchema] = useState<Record<string, unknown> | null>(null);
  const [gwAgentId, setGwAgentId] = useState("main");

  const connectGateway = useCallback(async () => {
    if (!agent || agent.state !== "RUNNING" || !agent.hostname) return;

    const url = agent.openclaw_url || `wss://openclaw-${agent.hostname}`;
    if (!url) {
      setError("No gateway URL available");
      return;
    }

    try {
      // Set up auth cookies
      const subdomain = agent.hostname.split(".")[0];
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

      if (
        !(
          hasCookie(hostCookie) ||
          hasCookie(shellCookie) ||
          hasCookie(openclawCookie) ||
          hasCookie(reefCookie)
        )
      ) {
        const authToken = await getToken();
        const tokenResp = await clawFetch<{ token: string }>(
          `/agents/${agent.id}/token`,
          authToken
        );
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

      const gw = new GatewayClient({ url });

      // Set up event handler for streaming chat
      gw.onEvent((event, payload) => {
        if (event === "chat.content") {
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

      await gw.connect();
      gwRef.current = gw;
      setConnected(true);
      setError(null);

      // Load agents list to get gateway agent ID
      const agents = await gw.agentsList();
      if (agents.length > 0) {
        setGwAgentId(agents[0].id);
      }

      // Load files
      const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
      const filesList = await gw.filesList(agentIdForFiles);
      setFiles(filesList);

      // Load config + schema
      const [cfg, schema] = await Promise.all([
        gw.configGet(),
        gw.configSchema(),
      ]);
      setConfig(cfg);
      setConfigSchema(schema);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [agent, getToken]);

  useEffect(() => {
    if (agent?.state === "RUNNING" && !connected) {
      connectGateway();
    }
    return () => {
      gwRef.current?.close();
      gwRef.current = null;
      setConnected(false);
    };
    // Only reconnect when agent identity/state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, agent?.state]);

  const sendMessage = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !input.trim() || sending) return;

    const msg = input.trim();
    setInput("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: msg, timestamp: Date.now() },
    ]);

    try {
      await gw.chatSend(msg);
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
  }, [input, sending]);

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
    error,
    files,
    config,
    configSchema,
    openFile,
    saveFile,
    saveConfig,
  };
}
