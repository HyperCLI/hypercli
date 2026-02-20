"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface Agent {
  id: string;
  user_id: string;
  pod_id: string;
  pod_name: string;
  state: AgentState;
  hostname: string | null;
  jwt_token?: string | null;
  jwt_expires_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AgentListResponse {
  items: Agent[];
}

interface AgentLogsTokenResponse {
  agent_id: string;
  ws_token: string;
  expires_at: string;
  ws_url?: string;
}

interface AgentDesktopTokenResponse {
  agent_id: string;
  pod_id: string;
  token: string;
  expires_at: string | null;
}

interface LogEvent {
  event?: string;
  log?: string;
  detail?: string;
  status?: number;
}

const MAX_LOG_LINES = 1500;

function formatWhen(ts: string | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function wsBaseFromApiBase(apiBase: string): string {
  const base = apiBase.trim().replace(/\/+$/, "");
  const withoutApiSuffix = base.endsWith("/api") ? base.slice(0, -4) : base;

  if (withoutApiSuffix) {
    if (withoutApiSuffix.startsWith("https://")) return `wss://${withoutApiSuffix.slice(8)}`;
    if (withoutApiSuffix.startsWith("http://")) return `ws://${withoutApiSuffix.slice(7)}`;
    return withoutApiSuffix;
  }

  if (typeof window === "undefined") return "";
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${window.location.host}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function setDesktopAuthCookie(
  name: string,
  value: string,
  days: number,
  domain: string
): void {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = date.toUTCString();
  const securePart = window.location.protocol === "https:" ? "; secure" : "";
  const domainPart = domain ? `; domain=${domain}` : "";
  const encodedValue = encodeURIComponent(value);
  document.cookie = `${name}=${encodedValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
}

function stateClass(state: AgentState): string {
  switch (state) {
    case "RUNNING":
      return "bg-[#38D39F]/10 text-primary";
    case "FAILED":
      return "bg-[#d05f5f]/10 text-[#d05f5f]";
    case "STOPPED":
      return "bg-surface-low text-text-muted";
    default:
      return "bg-[#f0c56c]/15 text-[#f0c56c]";
  }
}

export default function AgentsPage() {
  const { getToken } = useClawAuth();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );
  const [logs, setLogs] = useState<string[]>([]);

  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await clawFetch<AgentListResponse>("/agents", token);
      const items = data.items || [];
      setAgents(items);
      if (!selectedAgentId && items.length > 0) {
        setSelectedAgentId(items[0].id);
      }
      if (selectedAgentId && !items.find((item) => item.id === selectedAgentId)) {
        setSelectedAgentId(items[0]?.id || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [getToken, selectedAgentId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    if (!selectedAgent) {
      setWsStatus("disconnected");
      setLogs([]);
      return;
    }

    let ws: WebSocket | null = null;
    let cancelled = false;

    setLogs([]);

    const connect = async () => {
      try {
        setWsStatus("connecting");
        const token = await getToken();
        if (cancelled) return;

        const stream = await clawFetch<AgentLogsTokenResponse>(
          `/agents/${selectedAgent.id}/logs/token`,
          token,
          { method: "POST" }
        );

        const explicitWsUrl = (stream.ws_url || "").trim();
        const configuredWsBase = trimTrailingSlash((process.env.NEXT_PUBLIC_WS_URL || "").trim());
        const derivedWsBase = trimTrailingSlash(wsBaseFromApiBase(CLAW_API_BASE));

        let url = "";
        if (explicitWsUrl) {
          const sep = explicitWsUrl.includes("?") ? "&" : "?";
          url =
            `${explicitWsUrl}${sep}ws_token=${encodeURIComponent(stream.ws_token)}` +
            "&container=reef&tail_lines=400";
        } else {
          const wsBase = configuredWsBase || derivedWsBase;
          if (!wsBase) {
            throw new Error("WebSocket base URL is not configured");
          }
          url =
            `${wsBase}/ws/${selectedAgent.id}` +
            `?ws_token=${encodeURIComponent(stream.ws_token)}` +
            "&container=reef&tail_lines=400";
        }

        ws = new WebSocket(url);

        ws.onopen = () => {
          if (!cancelled) setWsStatus("connected");
        };

        ws.onmessage = (event) => {
          if (cancelled) return;

          try {
            const msg = JSON.parse(event.data as string) as LogEvent;
            if (msg.event === "log" && msg.log) {
              setLogs((prev) => {
                const next = [...prev, msg.log as string];
                return next.length > MAX_LOG_LINES
                  ? next.slice(next.length - MAX_LOG_LINES)
                  : next;
              });
              return;
            }

            if (msg.event === "error") {
              const line = `[stream-error] ${msg.status || ""} ${msg.detail || "unknown"}`.trim();
              setLogs((prev) => [...prev, line]);
            }
          } catch {
            setLogs((prev) => {
              const next = [...prev, String(event.data ?? "")];
              return next.length > MAX_LOG_LINES
                ? next.slice(next.length - MAX_LOG_LINES)
                : next;
            });
          }
        };

        ws.onclose = () => {
          if (!cancelled) setWsStatus("disconnected");
        };

        ws.onerror = () => {
          if (!cancelled) {
            setWsStatus("disconnected");
            setLogs((prev) => [...prev, "[stream-error] websocket connection failed"]);
          }
        };
      } catch (err) {
        if (!cancelled) {
          setWsStatus("disconnected");
          setLogs([
            `[stream-error] ${err instanceof Error ? err.message : "failed to connect"}`,
          ]);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [selectedAgent, getToken, reconnectNonce]);

  useEffect(() => {
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<Agent>("/agents", token, {
        method: "POST",
        body: JSON.stringify({ config: {} }),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    setDeletingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<{ ok: boolean; id: string }>(`/agents/${agentId}`, token, {
        method: "DELETE",
      });
      if (selectedAgentId === agentId) {
        setSelectedAgentId(null);
      }
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenDesktop = async (agent: Agent) => {
    if (!agent.hostname) return;

    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningDesktopId(agent.id);
    setError(null);

    try {
      const token = await getToken();
      const tokenData = await clawFetch<AgentDesktopTokenResponse>(
        `/agents/${agent.id}/token`,
        token
      );

      const desktopUrl = new URL(`https://${agent.hostname}`);
      const subdomain = agent.hostname.split(".")[0];
      const cookieName = `${subdomain}-token`;
      const cookieDomain =
        (process.env.NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN || "").trim() || ".hyperclaw.app";

      setDesktopAuthCookie(cookieName, tokenData.token, 2, cookieDomain);
      setDesktopAuthCookie("reef_token", tokenData.token, 2, cookieDomain);

      if (popup) {
        popup.location.href = desktopUrl.toString();
      } else {
        const fallback = window.open(desktopUrl.toString(), "_blank");
        if (fallback) fallback.opener = null;
      }
    } catch (err) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : "Failed to open desktop");
    } finally {
      setOpeningDesktopId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-foreground">Agents</h1>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Launch Agent
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-[1.1fr_1.3fr] gap-6">
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Your Agents</h2>
            <button
              onClick={fetchAgents}
              className="text-xs text-text-muted hover:text-foreground transition-colors"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-text-muted">Loading...</div>
          ) : agents.length === 0 ? (
            <div className="p-8 text-center">
              <Bot className="w-8 h-8 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary mb-1">No active agents</p>
              <p className="text-sm text-text-muted">Launch your first reef agent to start.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={`p-4 transition-colors ${
                    selectedAgentId === agent.id ? "bg-surface-low/70" : "hover:bg-surface-low/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setSelectedAgentId(agent.id)}
                      className="text-left min-w-0"
                    >
                      <p className="text-sm font-semibold text-foreground truncate">{agent.pod_name}</p>
                      <p className="text-xs text-text-muted truncate">{agent.hostname || "pending hostname"}</p>
                      <p className="text-xs text-text-muted mt-1">Updated: {formatWhen(agent.updated_at)}</p>
                    </button>

                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${stateClass(agent.state)}`}>
                      {agent.state}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setSelectedAgentId(agent.id)}
                      className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1"
                    >
                      <TerminalSquare className="w-3.5 h-3.5" />
                      Console
                    </button>
                    {agent.hostname && (
                      <button
                        onClick={() => handleOpenDesktop(agent)}
                        disabled={openingDesktopId === agent.id}
                        className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1 disabled:opacity-60"
                      >
                        {openingDesktopId === agent.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        Desktop
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(agent.id)}
                      disabled={deletingId === agent.id}
                      className="px-2.5 py-1.5 rounded text-xs border border-[#d05f5f]/30 text-[#d05f5f] hover:bg-[#d05f5f]/10 disabled:opacity-60 flex items-center gap-1"
                    >
                      {deletingId === agent.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Console Logs</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {selectedAgent ? selectedAgent.pod_name : "Select an agent"}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium ${
                  wsStatus === "connected"
                    ? "text-primary"
                    : wsStatus === "connecting"
                      ? "text-[#f0c56c]"
                      : "text-text-muted"
                }`}
              >
                {wsStatus}
              </span>
              <button
                onClick={() => setReconnectNonce((n) => n + 1)}
                disabled={!selectedAgent}
                className="text-xs text-text-muted hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reconnect
              </button>
            </div>
          </div>

          {!selectedAgent ? (
            <div className="p-8 text-center text-text-muted">Select an agent to view logs.</div>
          ) : (
            <div
              ref={logBoxRef}
              className="h-[560px] overflow-auto bg-[#0c1016] text-[#d8dde7] text-xs leading-5 font-mono p-4"
            >
              {logs.length === 0 ? (
                <div className="text-[#8b95a6]">Waiting for log stream...</div>
              ) : (
                logs.map((line, idx) => (
                  <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
