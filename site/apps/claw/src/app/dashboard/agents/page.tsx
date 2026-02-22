"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Bot,
  ExternalLink,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  TerminalSquare,
  Trash2,
  X as XIcon,
  Check as CheckIcon,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";
import { AlertDialog } from "@hypercli/shared-ui";

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface Agent {
  id: string;
  name: string;
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
const WS_RETRY_INTERVAL_MS = 15000;
const AGENT_STATE_REFRESH_INTERVAL_MS = 60000;
type ConsoleTab = "logs" | "shell";

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

function buildShellWsUrl(hostname: string): string {
  return `wss://shell-${hostname}/shell`;
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("logs");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [shellStatus, setShellStatus] = useState<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );

  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const shellBoxRef = useRef<HTMLDivElement | null>(null);
  const shellWsRef = useRef<WebSocket | null>(null);
  const shellTerminalRef = useRef<Terminal | null>(null);
  const shellFitAddonRef = useRef<FitAddon | null>(null);
  const shellSessionAgentRef = useRef<string | null>(null);

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

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchAgents();
    }, AGENT_STATE_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchAgents]);

  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );
  const selectedAgentHostname = selectedAgent?.hostname || null;

  const issueAgentAccessToken = useCallback(
    async (agentId: string, hostname: string): Promise<string> => {
      const authToken = await getToken();
      const tokenData = await clawFetch<AgentDesktopTokenResponse>(
        `/agents/${agentId}/token`,
        authToken
      );
      const subdomain = hostname.split(".")[0];
      const cookieDomain =
        (process.env.NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN || "").trim() || ".hyperclaw.app";
      setDesktopAuthCookie(`${subdomain}-token`, tokenData.token, 2, cookieDomain);
      setDesktopAuthCookie(`shell-${subdomain}-token`, tokenData.token, 2, cookieDomain);
      setDesktopAuthCookie("reef_token", tokenData.token, 2, cookieDomain);
      return tokenData.token;
    },
    [getToken]
  );

  const isAgentConnectable = useMemo(() => {
    if (!selectedAgent) return false;
    return ["RUNNING", "PENDING", "STARTING", "STOPPING"].includes(selectedAgent.state);
  }, [selectedAgent]);

  useEffect(() => {
    if (consoleTab !== "logs") {
      setWsStatus("disconnected");
      return;
    }
    if (!selectedAgentId) {
      setWsStatus("disconnected");
      setLogs([]);
      return;
    }
    if (!isAgentConnectable) {
      setWsStatus("disconnected");
      return;
    }

    const agentId = selectedAgentId;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectScheduled = false;

    setLogs([]);

    const scheduleReconnect = () => {
      if (cancelled || reconnectScheduled) return;
      reconnectScheduled = true;
      setWsStatus("connecting");
      reconnectTimer = setTimeout(() => {
        reconnectScheduled = false;
        if (!cancelled) {
          void connect();
        }
      }, WS_RETRY_INTERVAL_MS);
    };

    const connect = async () => {
      try {
        setWsStatus("connecting");
        const token = await getToken();
        if (cancelled) return;

        const stream = await clawFetch<AgentLogsTokenResponse>(
          `/agents/${agentId}/logs/token`,
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
            `${wsBase}/ws/${agentId}` +
            `?ws_token=${encodeURIComponent(stream.ws_token)}` +
            "&container=reef&tail_lines=400";
        }

        ws = new WebSocket(url);

        ws.onopen = () => {
          if (!cancelled) {
            reconnectScheduled = false;
            setWsStatus("connected");
            void fetchAgents();
          }
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
          if (cancelled) return;
          scheduleReconnect();
        };

        ws.onerror = () => {
          if (cancelled) return;
          scheduleReconnect();
        };
      } catch {
        if (!cancelled) {
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [consoleTab, selectedAgentId, isAgentConnectable, getToken, reconnectNonce, fetchAgents]);

  useEffect(() => {
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (consoleTab !== "shell") return;
    if (!shellBoxRef.current) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 3000,
      theme: {
        background: "#0c1016",
        foreground: "#d8dde7",
        cursor: "#d8dde7",
        selectionBackground: "#2a3445",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(shellBoxRef.current);
    fitAddon.fit();
    term.focus();

    const disposable = term.onData((data) => {
      const ws = shellWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(data);
    });

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    shellTerminalRef.current = term;
    shellFitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener("resize", onResize);
      disposable.dispose();
      term.dispose();
      shellTerminalRef.current = null;
      shellFitAddonRef.current = null;
      shellSessionAgentRef.current = null;
    };
  }, [consoleTab]);

  useEffect(() => {
    if (consoleTab !== "shell") {
      setShellStatus("disconnected");
      if (shellWsRef.current) {
        shellWsRef.current.close();
        shellWsRef.current = null;
      }
      return;
    }
    if (!selectedAgentId) {
      setShellStatus("disconnected");
      return;
    }
    if (!isAgentConnectable) {
      setShellStatus("disconnected");
      return;
    }

    const agentId = selectedAgentId;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectScheduled = false;

    const term = shellTerminalRef.current;
    if (term && shellSessionAgentRef.current !== agentId) {
      term.reset();
      term.writeln(`Connected to ${agentId}`);
      term.writeln("");
      shellSessionAgentRef.current = agentId;
    }

    const scheduleReconnect = () => {
      if (cancelled || reconnectScheduled) return;
      reconnectScheduled = true;
      setShellStatus("connecting");
      reconnectTimer = setTimeout(() => {
        reconnectScheduled = false;
        if (!cancelled) {
          void connect();
        }
      }, WS_RETRY_INTERVAL_MS);
    };

    const connect = async () => {
      try {
        setShellStatus("connecting");
        shellTerminalRef.current?.writeln("\r\n[connecting shell...]");
        if (!selectedAgentHostname) {
          scheduleReconnect();
          return;
        }

        await issueAgentAccessToken(agentId, selectedAgentHostname);
        if (cancelled) return;

        const ws = new WebSocket(buildShellWsUrl(selectedAgentHostname));
        shellWsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          reconnectScheduled = false;
          setShellStatus("connected");
          shellFitAddonRef.current?.fit();
          shellTerminalRef.current?.focus();
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          const text = typeof event.data === "string" ? event.data : String(event.data ?? "");
          if (!text) return;
          shellTerminalRef.current?.write(text);
        };

        ws.onclose = () => {
          if (cancelled) return;
          shellTerminalRef.current?.writeln("\r\n[disconnected]");
          scheduleReconnect();
        };

        ws.onerror = () => {
          if (cancelled) return;
          shellTerminalRef.current?.writeln("\r\n[shell websocket error]");
          scheduleReconnect();
        };
      } catch {
        if (!cancelled) scheduleReconnect();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = shellWsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      shellWsRef.current = null;
    };
  }, [consoleTab, selectedAgentId, selectedAgentHostname, isAgentConnectable, reconnectNonce, issueAgentAccessToken]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<Agent>("/agents", token, {
        method: "POST",
        body: JSON.stringify({ start: false }),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (agentId: string) => {
    const name = renameValue.trim().toLowerCase();
    if (!name) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const token = await getToken();
      await clawFetch<Agent>(`/agents/${agentId}`, token, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      setRenamingId(null);
      setRenameValue("");
      await fetchAgents();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setRenameSaving(false);
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

  const handleStart = async (agentId: string) => {
    setStartingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<Agent>(`/agents/${agentId}/start`, token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setStartingId(null);
    }
  };

  const handleStop = async (agentId: string) => {
    setStoppingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<Agent>(`/agents/${agentId}/stop`, token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setStoppingId(null);
    }
  };

  const handleOpenDesktop = async (agent: Agent) => {
    if (!agent.hostname) return;

    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningDesktopId(agent.id);
    setError(null);

    try {
      await issueAgentAccessToken(agent.id, agent.hostname);

      const desktopUrl = new URL(`https://${agent.hostname}`);

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
          Create Agent
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
              <p className="text-sm text-text-muted">Create your first agent, then start it when ready.</p>
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
                    <div className="text-left min-w-0 flex-1">
                      {renamingId === agent.id ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => {
                                setRenameValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                                setRenameError(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleRename(agent.id);
                                if (e.key === "Escape") { setRenamingId(null); setRenameError(null); }
                              }}
                              maxLength={32}
                              autoFocus
                              className={`px-2 py-1 rounded text-sm bg-surface-low border ${
                                renameError ? "border-[#d05f5f]" : "border-border"
                              } text-foreground focus:outline-none focus:border-primary w-36`}
                            />
                            <button
                              onClick={() => void handleRename(agent.id)}
                              disabled={renameSaving || !renameValue.trim()}
                              className="text-primary hover:text-primary/80 disabled:opacity-40"
                            >
                              {renameSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckIcon className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => { setRenamingId(null); setRenameError(null); }}
                              className="text-text-muted hover:text-foreground"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {renameError && (
                            <p className="text-[11px] text-[#d05f5f] mt-1">{renameError}</p>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedAgentId(agent.id)}
                          className="text-left min-w-0 w-full group"
                        >
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-foreground truncate">{agent.name}</p>
                            {agent.state === "STOPPED" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingId(agent.id);
                                  setRenameValue(agent.name);
                                  setRenameError(null);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-foreground transition-opacity"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-text-muted truncate">
                            {agent.hostname || `${agent.name}.hyperclaw.app`}
                          </p>
                        </button>
                      )}
                    </div>

                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${stateClass(agent.state)}`}>
                      {agent.state}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {(agent.state === "STOPPED" || agent.state === "FAILED") && (
                      <button
                        onClick={() => handleStart(agent.id)}
                        disabled={startingId === agent.id}
                        className="px-2.5 py-1.5 rounded text-xs border border-[#3ad8a0]/30 text-[#3ad8a0] hover:bg-[#3ad8a0]/10 disabled:opacity-60 flex items-center gap-1"
                      >
                        {startingId === agent.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        Start
                      </button>
                    )}
                    {(agent.state === "RUNNING" || agent.state === "PENDING" || agent.state === "STARTING") && (
                      <button
                        onClick={() => handleStop(agent.id)}
                        disabled={stoppingId === agent.id}
                        className="px-2.5 py-1.5 rounded text-xs border border-[#e0a85f]/30 text-[#e0a85f] hover:bg-[#e0a85f]/10 disabled:opacity-60 flex items-center gap-1"
                      >
                        {stoppingId === agent.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                        Stop
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`px-2.5 py-1.5 rounded text-xs flex items-center gap-1 ${
                        selectedAgentId === agent.id
                          ? "bg-surface-low text-foreground border border-border"
                          : "btn-secondary"
                      }`}
                    >
                      <TerminalSquare className="w-3.5 h-3.5" />
                      Console
                    </button>
                    {agent.hostname && (agent.state === "RUNNING" || agent.state === "PENDING" || agent.state === "STARTING") && (
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
                      onClick={() => setDeleteConfirmId(agent.id)}
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
              <h2 className="text-lg font-semibold text-foreground">Console</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {selectedAgent ? selectedAgent.name : "Select an agent"}
              </p>
              <div className="mt-3 inline-flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setConsoleTab("logs")}
                  className={`px-3 py-1.5 text-xs ${
                    consoleTab === "logs"
                      ? "bg-surface-low text-foreground"
                      : "bg-transparent text-text-muted hover:text-foreground"
                  }`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setConsoleTab("shell")}
                  className={`px-3 py-1.5 text-xs border-l border-border ${
                    consoleTab === "shell"
                      ? "bg-surface-low text-foreground"
                      : "bg-transparent text-text-muted hover:text-foreground"
                  }`}
                >
                  Shell
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium ${
                  (consoleTab === "logs" ? wsStatus : shellStatus) === "connected"
                    ? "text-primary"
                    : (consoleTab === "logs" ? wsStatus : shellStatus) === "connecting"
                      ? "text-[#f0c56c]"
                      : "text-text-muted"
                }`}
              >
                {consoleTab === "logs" ? wsStatus : shellStatus}
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
          ) : !isAgentConnectable ? (
            <div className="h-[560px] bg-[#0c1016] flex items-center justify-center">
              <div className="text-center">
                <div className={`inline-block text-sm font-medium px-3 py-1 rounded-full mb-3 ${stateClass(selectedAgent.state)}`}>
                  {selectedAgent.state}
                </div>
                <p className="text-[#8b95a6] text-sm">
                  {selectedAgent.state === "STOPPED"
                    ? "Agent is stopped. Start it to view logs and shell."
                    : selectedAgent.state === "FAILED"
                      ? "Agent has failed. Check the error and restart."
                      : "Agent is not running."}
                </p>
              </div>
            </div>
          ) : consoleTab === "logs" ? (
            <div
              ref={logBoxRef}
              className="h-[560px] overflow-auto bg-[#0c1016] text-[#d8dde7] text-xs leading-5 font-mono p-4"
            >
              {wsStatus !== "connected" && (
                <div className="flex items-center gap-2 text-[#8b95a6] mb-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {wsStatus === "connecting"
                      ? "Connecting to websocket..."
                      : "Waiting for websocket connection..."}
                  </span>
                </div>
              )}

              {logs.length === 0 && wsStatus === "connected" && (
                <div className="text-[#8b95a6]">Connected. Waiting for log stream...</div>
              )}

              {logs.map((line, idx) => (
                <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <div className="relative h-[560px] bg-[#0c1016] p-4">
              <div ref={shellBoxRef} className="h-full w-full" />
              {shellStatus !== "connected" && (
                <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 text-xs text-[#8b95a6]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {shellStatus === "connecting"
                      ? "Connecting to shell websocket..."
                      : "Waiting for shell websocket connection..."}
                  </span>
                </div>
              )}
              {shellStatus === "connected" && (
                <div className="pointer-events-none absolute right-4 top-4 text-xs text-[#8b95a6]">
                  Interactive shell active
                </div>
              )}
              <div className="pointer-events-none absolute bottom-4 right-4 text-[11px] text-[#6f7a8d]">
                Type directly in terminal
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        isOpen={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete Agent"
        message={`This will permanently delete the agent${deleteConfirmId ? ` "${agents.find((a) => a.id === deleteConfirmId)?.name || deleteConfirmId.slice(0, 12)}"` : ""}. All associated data will be removed. This action cannot be undone.`}
        type="warning"
        confirmText="Delete"
        cancelText="Cancel"
        showCancel
        onConfirm={async () => {
          if (deleteConfirmId) {
            await handleDelete(deleteConfirmId);
            setDeleteConfirmId(null);
          }
        }}
      />
    </div>
  );
}
