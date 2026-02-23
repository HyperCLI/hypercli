"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  ArrowLeft,
  Bot,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  X as XIcon,
  Check as CheckIcon,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";
import { AlertDialog } from "@hypercli/shared-ui";
import { GatewayClient } from "@/gateway-client";

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

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  size_formatted?: string;
  last_modified?: string;
}

interface FileListResponse {
  prefix: string;
  directories: FileEntry[];
  files: FileEntry[];
  truncated: boolean;
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
type ConsoleTab = "logs" | "shell" | "files" | "chat";

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
  const router = useRouter();
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
  const [showUploadNotice, setShowUploadNotice] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<FileList | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("logs");

  // Gateway state
  const gwRef = useRef<GatewayClient | null>(null);
  const [gwConnected, setGwConnected] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);
  const [gwFiles, setGwFiles] = useState<Array<{ name: string; size: number; missing: boolean }>>([]);
  const [gwSelectedFile, setGwSelectedFile] = useState<string | null>(null);
  const [gwFileContent, setGwFileContent] = useState("");
  const [gwFileDirty, setGwFileDirty] = useState(false);
  const [gwFileSaving, setGwFileSaving] = useState(false);
  const [gwConfigJson, setGwConfigJson] = useState("");
  const [gwConfigDirty, setGwConfigDirty] = useState(false);
  const [gwAgentId, setGwAgentId] = useState("main");
  const [gwChatMessages, setGwChatMessages] = useState<Array<{ role: string; content: string; thinking?: string }>>([]);
  const [gwChatInput, setGwChatInput] = useState("");
  const [gwChatSending, setGwChatSending] = useState(false);
  const gwChatEndRef = useRef<HTMLDivElement | null>(null);

  // File browser state
  const [filePath, setFilePath] = useState("");
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  // Gateway connection
  const connectGateway = useCallback(async (agent: Agent) => {
    // Cleanup previous
    gwRef.current?.close();
    setGwConnected(false);
    setGwError(null);
    setGwFiles([]);
    setGwSelectedFile(null);
    setGwConfigJson("");
    setGwConfigDirty(false);

    if (agent.state !== "RUNNING" || !agent.hostname) return;

    try {
      const authToken = await getToken();
      const tokenData = await clawFetch<{ token: string }>(`/agents/${agent.id}/token`, authToken);
      const url = `wss://openclaw-${agent.hostname}`;

      const gw = new GatewayClient({ url, token: tokenData.token });

      gw.onEvent((event, payload) => {
        const p = payload as any;
        if (event === "chat") {
          const state = p.state; // "streaming", "thinking", "final", "error"
          const msg = p.message;
          if (msg?.role === "assistant") {
            const text = Array.isArray(msg.content)
              ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
              : (typeof msg.content === "string" ? msg.content : "");
            const thinking = Array.isArray(msg.content)
              ? msg.content.filter((c: any) => c.type === "thinking").map((c: any) => c.thinking ?? c.text ?? "").join("")
              : undefined;

            if (state === "streaming" || state === "thinking") {
              // Replace last assistant message (streaming update)
              setGwChatMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { role: "assistant", content: text, thinking: thinking || last.thinking }];
                }
                return [...prev, { role: "assistant", content: text, thinking }];
              });
            } else if (state === "final") {
              // Final message — replace or append
              setGwChatMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [...prev.slice(0, -1), { role: "assistant", content: text, thinking }];
                }
                return [...prev, { role: "assistant", content: text, thinking }];
              });
              setGwChatSending(false);
            } else if (state === "error") {
              setGwChatMessages(prev => [...prev, { role: "system", content: `Error: ${text || p.error || "unknown"}` }]);
              setGwChatSending(false);
            }
          }
        } else if (event === "chat.content") {
          // Legacy format fallback
          setGwChatMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, content: last.content + (p.text ?? "") }];
            }
            return [...prev, { role: "assistant", content: p.text ?? "" }];
          });
        } else if (event === "chat.done") {
          setGwChatSending(false);
        } else if (event === "chat.error") {
          setGwChatSending(false);
        }
      });

      await gw.connect();
      gwRef.current = gw;
      setGwConnected(true);

      // Load agents to get gateway agent ID
      const agents = await gw.agentsList();
      const aid = agents.length > 0 ? agents[0].id : "main";
      setGwAgentId(aid);

      // Load chat history
      try {
        const history = await gw.chatHistory("main", 50);
        const msgs = history.map((m: any) => {
          const text = Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
            : (typeof m.content === "string" ? m.content : "");
          return { role: m.role ?? "assistant", content: text };
        }).filter((m: any) => m.content);
        setGwChatMessages(msgs);
      } catch (e) {
        // No history yet, that's fine
      }

      // Load workspace files
      const files = await gw.filesList(aid);
      setGwFiles(files);

      // Load config
      const cfg = await gw.configGet();
      setGwConfigJson(JSON.stringify(cfg, null, 2));
    } catch (e: any) {
      setGwError(e.message);
    }
  }, [getToken]);

  // Gateway connection effect moved below selectedAgent declaration

  // Gateway handlers
  const handleGwFileOpen = useCallback(async (name: string) => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const content = await gw.fileGet(gwAgentId, name);
      setGwSelectedFile(name);
      setGwFileContent(content);
      setGwFileDirty(false);
    } catch (e: any) {
      setGwSelectedFile(name);
      setGwFileContent(`Error: ${e.message}`);
    }
  }, [gwAgentId]);

  const handleGwFileSave = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !gwSelectedFile) return;
    setGwFileSaving(true);
    try {
      await gw.fileSet(gwAgentId, gwSelectedFile, gwFileContent);
      setGwFileDirty(false);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setGwFileSaving(false);
    }
  }, [gwAgentId, gwSelectedFile, gwFileContent]);

  const handleGwConfigSave = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const patch = JSON.parse(gwConfigJson);
      await gw.configPatch(patch);
      setGwConfigDirty(false);
    } catch (e: any) {
      alert(`Config save failed: ${e.message}`);
    }
  }, [gwConfigJson]);

  const handleGwChatSend = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !gwChatInput.trim() || gwChatSending) return;
    const msg = gwChatInput.trim();
    setGwChatInput("");
    setGwChatSending(true);
    setGwChatMessages(prev => [...prev, { role: "user", content: msg }]);
    try {
      await gw.chatSend(msg);
    } catch (e: any) {
      setGwChatMessages(prev => [...prev, { role: "system", content: `Error: ${e.message}` }]);
      setGwChatSending(false);
    }
  }, [gwChatInput, gwChatSending]);

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

  // Connect gateway when agent is RUNNING (with delay + retry)
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let initialDelay: ReturnType<typeof setTimeout>;

    const tryConnect = async (attempt = 0) => {
      if (cancelled || !selectedAgent || selectedAgent.state !== "RUNNING") return;
      try {
        await connectGateway(selectedAgent);
      } catch {
        if (!cancelled && attempt < 5) {
          const delay = Math.min(3000 * Math.pow(2, attempt), 20000);
          retryTimer = setTimeout(() => tryConnect(attempt + 1), delay);
        }
      }
    };

    if (selectedAgent?.state === "RUNNING") {
      // Small delay to let pod settle, then connect independently of logs WS
      initialDelay = setTimeout(() => tryConnect(), 2000);
    } else {
      gwRef.current?.close();
      setGwConnected(false);
    }
    return () => { cancelled = true; clearTimeout(retryTimer); clearTimeout(initialDelay); gwRef.current?.close(); };
  }, [selectedAgentId, selectedAgent?.state]);

  // Auto-scroll chat
  useEffect(() => {
    gwChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gwChatMessages]);

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

  // --- File browser ---
  const fetchFiles = useCallback(async (agentId: string, prefix: string) => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (prefix) params.set("prefix", prefix);
      const data = await clawFetch<FileListResponse>(
        `/agents/${agentId}/files?${params.toString()}`,
        token,
      );
      const entries: FileEntry[] = [
        ...data.directories,
        ...data.files,
      ];
      setFileEntries(entries);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Failed to load files");
      setFileEntries([]);
    } finally {
      setFilesLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (consoleTab === "files" && selectedAgentId) {
      void fetchFiles(selectedAgentId, filePath);
    }
  }, [consoleTab, selectedAgentId, filePath, fetchFiles]);

  const handleFileDownload = async (agentId: string, path: string) => {
    try {
      const token = await getToken();
      const data = await clawFetch<{ url: string }>(
        `/agents/${agentId}/files/download/${path}`,
        token,
      );
      window.open(data.url, "_blank");
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleFileUpload = async (agentId: string, files: FileList) => {
    setUploading(true);
    setFilesError(null);
    try {
      const token = await getToken();
      for (const file of Array.from(files)) {
        const uploadPath = filePath + file.name;
        const resp = await fetch(
          `${CLAW_API_BASE}/agents/${agentId}/files/upload/${uploadPath}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          },
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || `Upload failed (${resp.status})`);
        }
      }
      void fetchFiles(agentId, filePath);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFileDelete = async (agentId: string, path: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const token = await getToken();
      await clawFetch(`/agents/${agentId}/files/delete/${path}`, token, {
        method: "DELETE",
      });
      void fetchFiles(agentId, filePath);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Delete failed");
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

      <div className="grid lg:grid-cols-[280px_1fr_320px] gap-4">
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
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`p-4 transition-colors cursor-pointer ${
                    selectedAgentId === agent.id ? "bg-surface-low/70" : "hover:bg-surface-low/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-left min-w-0 flex-1">
                      {renamingId === agent.id ? (
                        <div onClick={(e) => e.stopPropagation()}>
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
                        <div className="text-left min-w-0 w-full group">
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
                          <p className="text-[10px] text-text-muted/60 truncate font-mono mt-0.5">
                            {agent.id}
                          </p>
                        </div>
                      )}
                    </div>

                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${stateClass(agent.state)}`}>
                      {agent.state}
                    </span>
                  </div>

                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
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
                    {agent.hostname && agent.state === "RUNNING" && (
                      <button
                        onClick={() => router.push(`/dashboard/agents/${agent.id}/console`)}
                        className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Console
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
                <button
                  onClick={() => { setConsoleTab("files"); setFilePath(""); }}
                  className={`px-3 py-1.5 text-xs border-l border-border ${
                    consoleTab === "files"
                      ? "bg-surface-low text-foreground"
                      : "bg-transparent text-text-muted hover:text-foreground"
                  }`}
                >
                  Files
                </button>
                <button
                  onClick={() => setConsoleTab("chat")}
                  className={`px-3 py-1.5 text-xs border-l border-border ${
                    consoleTab === "chat"
                      ? "bg-surface-low text-foreground"
                      : "bg-transparent text-text-muted hover:text-foreground"
                  }`}
                >
                  💬 Chat
                </button>
                {/* Workspace + Config are in the right panel */}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {consoleTab === "files" ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0 && selectedAgentId) {
                        setPendingUploadFiles(e.target.files);
                        setShowUploadNotice(true);
                        e.target.value = "";
                      }
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!selectedAgent || uploading}
                    className="text-xs text-text-muted hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-1"
                  >
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Upload
                  </button>
                  <button
                    onClick={() => selectedAgentId && void fetchFiles(selectedAgentId, filePath)}
                    disabled={!selectedAgent}
                    className="text-xs text-text-muted hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>

          {!selectedAgent ? (
            <div className="p-8 text-center text-text-muted">Select an agent to view logs.</div>
          ) : consoleTab === "files" ? (
            <div className="h-[560px] overflow-auto bg-[#0c1016] text-[#d8dde7] text-xs font-mono">
              {/* Breadcrumb */}
              <div className="sticky top-0 bg-[#0c1016] border-b border-[#1a2030] px-4 py-2 flex items-center gap-2 text-[#8b95a6]">
                <span className="text-text-muted">/</span>
                {filePath && (
                  <>
                    <button
                      onClick={() => {
                        const parts = filePath.replace(/\/$/, "").split("/");
                        parts.pop();
                        setFilePath(parts.length ? parts.join("/") + "/" : "");
                      }}
                      className="hover:text-foreground flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    {filePath.split("/").filter(Boolean).map((part, i, arr) => (
                      <span key={i}>
                        <button
                          onClick={() => setFilePath(arr.slice(0, i + 1).join("/") + "/")}
                          className="hover:text-foreground"
                        >
                          {part}
                        </button>
                        {i < arr.length - 1 && <span className="mx-1">/</span>}
                      </span>
                    ))}
                  </>
                )}
              </div>

              {filesError && (
                <div className="px-4 py-2 text-[#d05f5f] text-xs">{filesError}</div>
              )}

              {filesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-4 h-4 animate-spin text-[#8b95a6]" />
                </div>
              ) : fileEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8b95a6]">
                  <FolderOpen className="w-8 h-8 mb-3 opacity-40" />
                  <p>No files yet</p>
                  <p className="text-[10px] mt-1">Upload files to get started</p>
                </div>
              ) : (
                <div>
                  {fileEntries.map((entry) => (
                    <div
                      key={entry.path}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-[#141a24] group border-b border-[#1a2030]/50"
                    >
                      {entry.type === "directory" ? (
                        <button
                          onClick={() => setFilePath(entry.path)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#f0c56c] flex-shrink-0" />
                          <span className="truncate">{entry.name}/</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <File className="w-3.5 h-3.5 text-[#8b95a6] flex-shrink-0" />
                          <span className="truncate">{entry.name}</span>
                          <span className="text-[#6f7a8d] flex-shrink-0 ml-auto mr-2">
                            {entry.size_formatted}
                          </span>
                        </div>
                      )}
                      {entry.type === "file" && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={() => void handleFileDownload(selectedAgentId!, entry.path)}
                            className="p-1 hover:text-primary"
                            title="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void handleFileDelete(selectedAgentId!, entry.path, entry.name)}
                            className="p-1 hover:text-[#d05f5f]"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Sync notice */}
              <div className="sticky bottom-0 bg-[#0c1016] border-t border-[#1a2030] px-4 py-2 text-[10px] text-[#6f7a8d]">
                Uploaded files are synced on agent restart
              </div>
            </div>
          ) : !isAgentConnectable ? (
            <div className="h-[560px] bg-[#0c1016] flex items-center justify-center">
              <div className="text-center">
                <div className={`inline-block text-sm font-medium px-3 py-1 rounded-full mb-3 ${stateClass(selectedAgent.state)}`}>
                  {selectedAgent.state}
                </div>
                <p className="text-[#8b95a6] text-sm">
                  {selectedAgent.state === "STOPPED"
                    ? "Agent is stopped. Start it to view logs and shell, or use the Files tab to browse storage."
                    : selectedAgent.state === "FAILED"
                      ? "Agent has failed. Check the error and restart, or use the Files tab to browse storage."
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
          ) : consoleTab === "shell" ? (
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
          ) : consoleTab === "chat" ? (
            <div className="h-[560px] flex flex-col bg-[#0c1016]">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {gwChatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-[#6f7a8d]">
                    <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">Chat with your agent via Gateway</p>
                    {!gwConnected && <p className="text-xs mt-1 text-[#d05f5f]">{gwError || "Gateway not connected"}</p>}
                  </div>
                )}
                {gwChatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                      msg.role === "user"
                        ? "bg-primary/20 text-foreground"
                        : msg.role === "system"
                          ? "bg-[#d05f5f]/10 text-[#d05f5f]"
                          : "bg-surface-low text-[#d8dde7]"
                    }`}>
                      {msg.thinking && (
                        <details className="mb-1">
                          <summary className="text-[10px] text-[#6f7a8d] cursor-pointer">💭 Thinking...</summary>
                          <pre className="text-[10px] text-[#6f7a8d] whitespace-pre-wrap mt-1">{msg.thinking}</pre>
                        </details>
                      )}
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                {gwChatSending && (
                  <div className="flex justify-start">
                    <div className="bg-surface-low rounded-lg px-3 py-2">
                      <Loader2 className="w-3 h-3 animate-spin text-[#6f7a8d]" />
                    </div>
                  </div>
                )}
                <div ref={gwChatEndRef} />
              </div>
              <div className="border-t border-[#1a2030] p-3 flex gap-2">
                <input
                  type="text"
                  value={gwChatInput}
                  onChange={(e) => setGwChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleGwChatSend(); } }}
                  placeholder={gwConnected ? "Type a message..." : "Gateway not connected"}
                  disabled={!gwConnected || gwChatSending}
                  className="flex-1 bg-[#141a24] border border-[#1a2030] rounded px-3 py-2 text-xs text-[#d8dde7] placeholder-[#6f7a8d] focus:outline-none focus:border-primary disabled:opacity-50"
                />
                <button
                  onClick={() => void handleGwChatSend()}
                  disabled={!gwConnected || gwChatSending || !gwChatInput.trim()}
                  className="bg-primary hover:bg-primary/80 disabled:opacity-40 text-white px-3 py-2 rounded text-xs transition-colors"
                >
                  Send
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right Panel — Agent Settings */}
        <div className="glass-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Agent Settings
            </h3>
            {selectedAgent && (
              <p className="text-xs text-text-muted mt-0.5 font-mono truncate">{selectedAgent.name}</p>
            )}
          </div>

          {!selectedAgent ? (
            <div className="p-4 text-xs text-text-muted">Select an agent</div>
          ) : (
            <div className="overflow-y-auto max-h-[600px] divide-y divide-border/50">
              {/* Identity */}
              <div className="p-4">
                <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Identity</h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-text-muted uppercase">Name</label>
                    <p className="text-sm text-foreground font-mono">{selectedAgent.name}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted uppercase">State</label>
                    <p className={`text-sm font-medium ${stateClass(selectedAgent.state)}`}>{selectedAgent.state}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted uppercase">Hostname</label>
                    <p className="text-xs text-text-muted font-mono truncate">{selectedAgent.hostname || '-'}</p>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="p-4">
                <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Actions</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedAgent.hostname && selectedAgent.state === "RUNNING" && (
                    <a
                      href={`https://${selectedAgent.hostname}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Desktop
                    </a>
                  )}
                </div>
              </div>

              {/* Gateway Workspace Files */}
              {selectedAgent.state === "RUNNING" && gwConnected && (
                <div className="p-4">
                  <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Workspace Files</h4>
                  {gwSelectedFile ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <button onClick={() => setGwSelectedFile(null)} className="text-xs text-text-muted hover:text-foreground flex items-center gap-1">
                          <ArrowLeft className="w-3 h-3" /> Back
                        </button>
                        <button
                          onClick={handleGwFileSave}
                          disabled={!gwFileDirty || gwFileSaving}
                          className="text-xs bg-primary text-white px-2 py-1 rounded disabled:opacity-40 flex items-center gap-1"
                        >
                          {gwFileSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Save
                        </button>
                      </div>
                      <p className="text-xs font-mono text-foreground mb-1">{gwSelectedFile}</p>
                      {gwFileDirty && <span className="text-[10px] text-[#f0c56c]">● unsaved</span>}
                      <textarea
                        value={gwFileContent}
                        onChange={(e) => { setGwFileContent(e.target.value); setGwFileDirty(true); }}
                        className="w-full h-48 bg-[#0c1016] text-[#d8dde7] text-xs font-mono p-2 rounded border border-border resize-none focus:outline-none focus:border-primary mt-1"
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {gwFiles.length === 0 && <p className="text-xs text-text-muted">No files</p>}
                      {gwFiles.map((f) => (
                        <button
                          key={f.name}
                          onClick={() => handleGwFileOpen(f.name)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-left hover:bg-surface-low/50 transition-colors"
                        >
                          <File className={`w-3 h-3 flex-shrink-0 ${f.missing ? 'text-[#d05f5f]' : 'text-text-muted'}`} />
                          <span className="text-xs text-foreground font-mono truncate flex-1">{f.name}</span>
                          <span className="text-[10px] text-text-muted">{(f.size / 1024).toFixed(1)}K</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Gateway Config */}
              {selectedAgent.state === "RUNNING" && gwConnected && (
                <div className="p-4">
                  <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Gateway Config</h4>
                  <textarea
                    value={gwConfigJson}
                    onChange={(e) => { setGwConfigJson(e.target.value); setGwConfigDirty(true); }}
                    className="w-full h-32 bg-[#0c1016] text-[#d8dde7] text-xs font-mono p-2 rounded border border-border resize-none focus:outline-none focus:border-primary"
                    spellCheck={false}
                  />
                  <button
                    onClick={handleGwConfigSave}
                    disabled={!gwConfigDirty}
                    className="mt-2 text-xs bg-primary text-white px-3 py-1.5 rounded disabled:opacity-40 w-full"
                  >
                    Apply & Restart
                  </button>
                </div>
              )}

              {/* Gateway Status */}
              {selectedAgent.state === "RUNNING" && (
                <div className="p-4">
                  <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Gateway</h4>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${gwConnected ? 'bg-primary' : 'bg-text-muted'}`} />
                    <span className="text-xs text-text-muted">{gwConnected ? 'Connected' : gwError || 'Disconnected'}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        isOpen={showUploadNotice}
        onClose={() => { setShowUploadNotice(false); setPendingUploadFiles(null); }}
        title="Upload Files"
        message="Uploaded files won't be available to the agent until it's restarted. The agent syncs files from storage on boot."
        type="info"
        confirmText="Upload"
        cancelText="Cancel"
        showCancel
        onConfirm={async () => {
          setShowUploadNotice(false);
          if (pendingUploadFiles && selectedAgentId) {
            await handleFileUpload(selectedAgentId, pendingUploadFiles);
          }
          setPendingUploadFiles(null);
        }}
      />

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
