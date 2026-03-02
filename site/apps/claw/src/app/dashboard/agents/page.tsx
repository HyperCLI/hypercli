"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  ExternalLink,
  Loader2,
  MessageSquare,
  Plus,
  Play,
  Square,
  RefreshCw,
  TerminalSquare,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileText,
  Send,
  Settings,
  PanelLeftClose,
  PanelLeft,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";
import { formatCpu, formatMemory } from "@/lib/format";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import { useGatewayChat } from "@/hooks/useGatewayChat";
import { agentAvatar } from "@/lib/avatar";

// ── Types ──

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

interface Agent {
  id: string;
  name: string;
  user_id: string;
  pod_id: string | null;
  pod_name: string | null;
  state: AgentState;
  cpu_millicores: number;
  memory_mib: number;
  hostname: string | null;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  openclaw_url?: string | null;
}

interface AgentBudget {
  max_agents: number;
  total_cpu: number;
  total_memory: number;
  used_agents: number;
  used_cpu: number;
  used_memory: number;
}

interface AgentListResponse {
  items: Agent[];
  budget?: AgentBudget;
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

// ── Constants ──

const MAX_LOG_LINES = 1500;
const WS_RETRY_INTERVAL_MS = 15000;
const AGENT_STATE_REFRESH_INTERVAL_MS = 60000;
const AGENT_TRANSITION_REFRESH_MS = 3000;
type MainTab = "chat" | "logs" | "shell" | "files";

const SIZES = [
  { label: "Small", cpu: 1000, mem: 1024, tag: "1 vCPU · 1 GiB", desc: "Lightweight tasks" },
  { label: "Medium", cpu: 2000, mem: 2048, tag: "2 vCPU · 2 GiB", desc: "Balanced performance" },
  { label: "Large", cpu: 4000, mem: 4096, tag: "4 vCPU · 4 GiB", desc: "Heavy workloads" },
] as const;

// ── Utility functions ──

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

function setDesktopAuthCookie(name: string, value: string, days: number, domain: string): void {
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
    case "RUNNING": return "bg-[#38D39F]/10 text-[#38D39F]";
    case "FAILED": return "bg-[#d05f5f]/10 text-[#d05f5f]";
    case "STOPPED": return "bg-surface-low text-text-muted";
    default: return "bg-[#f0c56c]/15 text-[#f0c56c]";
  }
}

function stateDotColor(state: AgentState): string {
  switch (state) {
    case "RUNNING": return "bg-[#38D39F]";
    case "FAILED": return "bg-[#d05f5f]";
    case "STOPPED": return "bg-text-muted";
    default: return "bg-[#f0c56c]";
  }
}

function BudgetBar({ label, used, total, format }: { label: string; used: number; total: number; format?: (n: number) => string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const fmt = format || String;
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{fmt(used)} / {fmt(total)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-low overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-[#d05f5f]' : pct > 70 ? 'bg-[#f0c56c]' : 'bg-foreground'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ──

export default function AgentsPage() {
  const { getToken } = useClawAuth();

  // Agent data
  const [agents, setAgents] = useState<Agent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("agent");
  const [selectedSize, setSelectedSize] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customCpu, setCustomCpu] = useState("2000");
  const [customMem, setCustomMem] = useState("2048");
  const [startImmediately, setStartImmediately] = useState(true);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  // Logs
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  // Shell
  const [shellStatus, setShellStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const shellBoxRef = useRef<HTMLDivElement | null>(null);
  const shellWsRef = useRef<WebSocket | null>(null);
  const shellTerminalRef = useRef<Terminal | null>(null);
  const shellFitAddonRef = useRef<FitAddon | null>(null);
  const shellSessionAgentRef = useRef<string | null>(null);

  // Files panel
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Hatching animation state tracking
  const prevStatesRef = useRef<Map<string, AgentState>>(new Map());
  const [burstAgentId, setBurstAgentId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch agents ──
  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await clawFetch<AgentListResponse>("/agents", token);
      const items = data.items || [];
      setAgents(items);
      setBudget(data.budget || null);
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

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // Fast polling during transitions
  const hasTransitioning = agents.some(a => ["PENDING", "STARTING", "STOPPING"].includes(a.state));
  useEffect(() => {
    const ms = hasTransitioning ? AGENT_TRANSITION_REFRESH_MS : AGENT_STATE_REFRESH_INTERVAL_MS;
    const timer = setInterval(() => { void fetchAgents(); }, ms);
    return () => clearInterval(timer);
  }, [fetchAgents, hasTransitioning]);

  // Detect STARTING→RUNNING for burst
  useEffect(() => {
    const prev = prevStatesRef.current;
    for (const agent of agents) {
      const prevState = prev.get(agent.id);
      if (prevState && (prevState === "STARTING" || prevState === "PENDING") && agent.state === "RUNNING") {
        setBurstAgentId(agent.id);
      }
    }
    const next = new Map<string, AgentState>();
    for (const agent of agents) next.set(agent.id, agent.state);
    prevStatesRef.current = next;
  }, [agents]);

  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );
  const selectedAgentHostname = selectedAgent?.hostname || null;
  const isSelectedTransitioning = selectedAgent && ["PENDING", "STARTING"].includes(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";

  // ── Gateway Chat hook ──
  const chat = useGatewayChat(
    selectedAgent && isSelectedRunning ? selectedAgent : null,
    getToken
  );

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  // ── Auth token for desktop / shell ──
  const issueAgentAccessToken = useCallback(
    async (agentId: string, hostname: string): Promise<string> => {
      const authToken = await getToken();
      const tokenData = await clawFetch<AgentDesktopTokenResponse>(`/agents/${agentId}/token`, authToken);
      const subdomain = hostname.split(".")[0];
      const cookieDomain = (process.env.NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN || "").trim() || ".hyperclaw.app";
      setDesktopAuthCookie(`${subdomain}-token`, tokenData.token, 2, cookieDomain);
      setDesktopAuthCookie(`shell-${subdomain}-token`, tokenData.token, 2, cookieDomain);
      setDesktopAuthCookie("reef_token", tokenData.token, 2, cookieDomain);
      return tokenData.token;
    },
    [getToken]
  );

  // ── Logs WebSocket ──
  useEffect(() => {
    if (mainTab !== "logs") { setWsStatus("disconnected"); return; }
    if (!selectedAgentId) { setWsStatus("disconnected"); setLogs([]); return; }
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
      reconnectTimer = setTimeout(() => { reconnectScheduled = false; if (!cancelled) void connect(); }, WS_RETRY_INTERVAL_MS);
    };
    const connect = async () => {
      try {
        setWsStatus("connecting");
        const token = await getToken();
        if (cancelled) return;
        const stream = await clawFetch<AgentLogsTokenResponse>(`/agents/${agentId}/logs/token`, token, { method: "POST" });
        const explicitWsUrl = (stream.ws_url || "").trim();
        const configuredWsBase = trimTrailingSlash((process.env.NEXT_PUBLIC_WS_URL || "").trim());
        const derivedWsBase = trimTrailingSlash(wsBaseFromApiBase(CLAW_API_BASE));
        let url = "";
        if (explicitWsUrl) {
          const sep = explicitWsUrl.includes("?") ? "&" : "?";
          url = `${explicitWsUrl}${sep}ws_token=${encodeURIComponent(stream.ws_token)}&container=reef&tail_lines=400`;
        } else {
          const wsBase = configuredWsBase || derivedWsBase;
          if (!wsBase) throw new Error("WebSocket base URL is not configured");
          url = `${wsBase}/ws/${agentId}?ws_token=${encodeURIComponent(stream.ws_token)}&container=reef&tail_lines=400`;
        }
        ws = new WebSocket(url);
        ws.onopen = () => { if (!cancelled) { reconnectScheduled = false; setWsStatus("connected"); void fetchAgents(); } };
        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(event.data as string) as LogEvent;
            if (msg.event === "log" && msg.log) {
              setLogs((prev) => { const next = [...prev, msg.log as string]; return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next; });
              return;
            }
            if (msg.event === "error") {
              const line = `[stream-error] ${msg.status || ""} ${msg.detail || "unknown"}`.trim();
              setLogs((prev) => [...prev, line]);
            }
          } catch {
            setLogs((prev) => { const next = [...prev, String(event.data ?? "")]; return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next; });
          }
        };
        ws.onclose = () => { if (!cancelled) scheduleReconnect(); };
        ws.onerror = () => { if (!cancelled) scheduleReconnect(); };
      } catch { if (!cancelled) scheduleReconnect(); }
    };
    void connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    };
  }, [mainTab, selectedAgentId, getToken, reconnectNonce, fetchAgents]);

  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);

  // ── Shell terminal setup (Phase 4 fix: requestAnimationFrame + resize events) ──
  useEffect(() => {
    if (mainTab !== "shell") return;
    if (!shellBoxRef.current) return;
    const term = new Terminal({
      convertEol: false, cursorBlink: true, cursorStyle: "bar",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 12, lineHeight: 1.45, scrollback: 3000,
      theme: { background: "#0c1016", foreground: "#d8dde7", cursor: "#d8dde7", selectionBackground: "#2a3445" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(shellBoxRef.current);
    // Phase 4B: Ensure proper fit timing
    requestAnimationFrame(() => {
      fitAddon.fit();
      term.focus();
    });
    const disposable = term.onData((data) => { const ws = shellWsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(data); });
    // Phase 4A: Send resize events over WebSocket
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      const ws = shellWsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);
    shellTerminalRef.current = term;
    shellFitAddonRef.current = fitAddon;
    return () => {
      window.removeEventListener("resize", onResize);
      resizeDisposable.dispose();
      disposable.dispose();
      term.dispose();
      shellTerminalRef.current = null;
      shellFitAddonRef.current = null;
      shellSessionAgentRef.current = null;
    };
  }, [mainTab]);

  // ── Shell WebSocket ──
  useEffect(() => {
    if (mainTab !== "shell") {
      setShellStatus("disconnected");
      if (shellWsRef.current) { shellWsRef.current.close(); shellWsRef.current = null; }
      return;
    }
    if (!selectedAgentId) { setShellStatus("disconnected"); return; }
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
      reconnectTimer = setTimeout(() => { reconnectScheduled = false; if (!cancelled) void connect(); }, WS_RETRY_INTERVAL_MS);
    };
    const connect = async () => {
      try {
        setShellStatus("connecting");
        shellTerminalRef.current?.writeln("\r\n[connecting shell...]");
        if (!selectedAgentHostname) { scheduleReconnect(); return; }
        await issueAgentAccessToken(agentId, selectedAgentHostname);
        if (cancelled) return;
        const ws = new WebSocket(buildShellWsUrl(selectedAgentHostname));
        shellWsRef.current = ws;
        ws.onopen = () => {
          if (!cancelled) {
            reconnectScheduled = false;
            setShellStatus("connected");
            shellFitAddonRef.current?.fit();
            shellTerminalRef.current?.focus();
            // Phase 4A: Send initial size after WebSocket connects
            const dims = shellFitAddonRef.current?.proposeDimensions();
            if (dims) {
              ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
            }
          }
        };
        ws.onmessage = (event) => { if (!cancelled) { const text = typeof event.data === "string" ? event.data : String(event.data ?? ""); if (text) shellTerminalRef.current?.write(text); } };
        ws.onclose = () => { if (!cancelled) { shellTerminalRef.current?.writeln("\r\n[disconnected]"); scheduleReconnect(); } };
        ws.onerror = () => { if (!cancelled) { shellTerminalRef.current?.writeln("\r\n[shell websocket error]"); scheduleReconnect(); } };
      } catch { if (!cancelled) scheduleReconnect(); }
    };
    void connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = shellWsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
      shellWsRef.current = null;
    };
  }, [mainTab, selectedAgentId, selectedAgentHostname, reconnectNonce, issueAgentAccessToken]);

  // ── Actions ──
  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const cpu = showAdvanced ? Number(customCpu) : SIZES[selectedSize].cpu;
      const mem = showAdvanced ? Number(customMem) : SIZES[selectedSize].mem;
      await clawFetch<Agent>("/agents", token, {
        method: "POST",
        body: JSON.stringify({
          name: newName || "agent",
          cpu_millicores: cpu,
          memory_mib: mem,
          start: startImmediately,
          config: {},
        }),
      });
      setShowCreateDialog(false);
      setNewName("agent");
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (agentId: string) => {
    setStartingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<unknown>(`/agents/${agentId}/start`, token, { method: "POST" });
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
      await clawFetch<unknown>(`/agents/${agentId}/stop`, token, { method: "POST" });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setStoppingId(null);
    }
  };

  const handleDelete = async (agentId: string) => {
    if (!confirm(`Delete agent "${agents.find(a => a.id === agentId)?.name || agentId}"? This cannot be undone.`)) return;
    setDeletingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await clawFetch<{ ok: boolean; id: string }>(`/agents/${agentId}`, token, { method: "DELETE" });
      if (selectedAgentId === agentId) setSelectedAgentId(null);
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
      await issueAgentAccessToken(agent.id, agent.hostname);
      const desktopUrl = new URL(`https://${agent.hostname}`);
      if (popup) { popup.location.href = desktopUrl.toString(); } else {
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

  // File handlers using gateway
  const handleOpenFile = async (name: string) => {
    try {
      const content = await chat.openFile(name);
      setSelectedFile(name);
      setFileContent(content);
      setFileDirty(false);
    } catch (e: unknown) {
      setSelectedFile(name);
      setFileContent(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    try {
      await chat.saveFile(selectedFile, fileContent);
      setFileDirty(false);
    } catch (e: unknown) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingFile(false);
    }
  };

  const handleSendChat = () => {
    chat.sendMessage();
  };

  const remainingCpu = budget ? budget.total_cpu - budget.used_cpu : 0;
  const remainingMem = budget ? budget.total_memory - budget.used_memory : 0;
  const remainingAgents = budget ? budget.max_agents - budget.used_agents : 0;

  // ── Render ──

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-8">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="text-text-muted hover:text-foreground transition-colors lg:block hidden"
          >
            {sidebarCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
          <h1 className="text-xl font-bold text-foreground">Agents</h1>
        </div>
        <div className="flex items-center gap-3">
          {budget && (
            <div className="hidden md:flex gap-4 mr-3">
              <BudgetBar label="Agents" used={budget.used_agents} total={budget.max_agents} />
              <BudgetBar label="CPU" used={budget.used_cpu} total={budget.total_cpu} format={formatCpu} />
              <BudgetBar label="Memory" used={budget.used_memory} total={budget.total_memory} format={formatMemory} />
            </div>
          )}
          <button
            onClick={() => setShowCreateDialog(true)}
            className="btn-primary px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Agent</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f] flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-2 hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Agent Dialog */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreateDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="glass-card p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Create Agent</h2>
                <button onClick={() => setShowCreateDialog(false)} className="text-text-muted hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>

              {budget && (
                <p className="text-xs text-text-muted mb-4">
                  Budget remaining: {remainingAgents} agent{remainingAgents !== 1 ? 's' : ''} · {formatCpu(remainingCpu)} · {formatMemory(remainingMem)}
                </p>
              )}

              <label className="block text-sm text-text-secondary mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm mb-4 focus:outline-none focus:border-border-strong"
                placeholder="agent"
              />

              {!showAdvanced ? (
                <>
                  <label className="block text-sm text-text-secondary mb-2">Size</label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {SIZES.map((s, i) => (
                      <button
                        key={s.label}
                        onClick={() => setSelectedSize(i)}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          selectedSize === i
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-surface-low text-text-secondary hover:border-text-muted"
                        }`}
                      >
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="text-xs text-text-muted mt-0.5">{s.tag}</div>
                        <div className="text-[10px] text-text-muted mt-0.5">{s.desc}</div>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowAdvanced(true)} className="text-xs text-text-muted hover:text-foreground flex items-center gap-1 mb-4">
                    <ChevronDown className="w-3 h-3" /> Custom resources
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-text-secondary">Custom Resources</label>
                    <button onClick={() => setShowAdvanced(false)} className="text-xs text-text-muted hover:text-foreground flex items-center gap-1">
                      <ChevronUp className="w-3 h-3" /> Presets
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">CPU (millicores)</label>
                      <input value={customCpu} onChange={(e) => setCustomCpu(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Memory (MiB)</label>
                      <input value={customMem} onChange={(e) => setCustomMem(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong" />
                    </div>
                  </div>
                </>
              )}

              <label className="flex items-center gap-2 text-sm text-text-secondary mb-5 cursor-pointer">
                <input type="checkbox" checked={startImmediately} onChange={(e) => setStartImmediately(e.target.checked)} className="rounded border-border" />
                Start immediately
              </label>

              <button onClick={handleCreate} disabled={creating} className="w-full btn-primary py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Agent
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main layout: Sidebar + Panel */}
      <div className="flex h-[calc(100vh-8rem)]">
        {/* ── Agent Sidebar ── */}
        <div className={`border-r border-border bg-background flex-shrink-0 transition-all duration-200 ${
          sidebarCollapsed ? "w-0 overflow-hidden lg:w-16" : "w-full lg:w-[280px]"
        } ${mobileShowChat ? "hidden lg:flex" : "flex"} flex-col`}>

          {/* Sidebar header */}
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            {!sidebarCollapsed && <span className="text-xs text-text-muted font-medium uppercase tracking-wider">Agents</span>}
            <button onClick={fetchAgents} className="text-text-muted hover:text-foreground transition-colors p-1">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Agent list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-text-muted text-sm">Loading...</div>
            ) : agents.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-surface-low flex items-center justify-center mx-auto mb-4">
                  <Bot className="w-8 h-8 text-text-muted" />
                </div>
                <p className="text-text-secondary text-sm mb-1">No agents yet</p>
                <p className="text-xs text-text-muted mb-4">Deploy a persistent Linux container with AI capabilities</p>
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Create Your First Agent
                </button>
              </div>
            ) : (
              <div>
                {agents.map((agent) => {
                  const isSelected = selectedAgentId === agent.id;
                  const isRunning = agent.state === "RUNNING";
                  const isTransitioning = ["PENDING", "STARTING", "STOPPING"].includes(agent.state);
                  const avatar = agentAvatar(agent.name || agent.id);
                  const AvatarIcon = avatar.icon;

                  if (sidebarCollapsed) {
                    // Collapsed: just avatar + dot
                    return (
                      <button
                        key={agent.id}
                        onClick={() => { setSelectedAgentId(agent.id); setMobileShowChat(true); }}
                        className={`w-full p-3 flex flex-col items-center gap-1 transition-colors ${
                          isSelected ? "bg-surface-low" : "hover:bg-surface-low/50"
                        }`}
                        title={agent.name}
                      >
                        <div className="relative">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: avatar.bgColor }}
                          >
                            <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${stateDotColor(agent.state)} ${isTransitioning ? "animate-pulse" : ""}`} />
                        </div>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={agent.id}
                      onClick={() => { setSelectedAgentId(agent.id); setMobileShowChat(true); }}
                      className={`w-full p-3 flex items-start gap-3 text-left transition-colors ${
                        isSelected ? "bg-surface-low" : "hover:bg-surface-low/50"
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: avatar.bgColor }}
                        >
                          <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${stateDotColor(agent.state)} ${isTransitioning ? "animate-pulse" : ""}`} />
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{agent.name || agent.pod_name || agent.id}</p>
                          <motion.span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${stateClass(agent.state)}`}
                            animate={isTransitioning ? { opacity: [0.6, 1, 0.6] } : { opacity: 1 }}
                            transition={isTransitioning ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : {}}
                          >
                            {agent.state}
                          </motion.span>
                        </div>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatCpu(agent.cpu_millicores)} · {formatMemory(agent.memory_mib)}
                        </p>
                        {agent.last_error && agent.state === "FAILED" && (
                          <p className="text-xs text-[#d05f5f] mt-0.5 truncate">{agent.last_error}</p>
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* New Agent button at bottom of list */}
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className={`w-full p-3 flex items-center gap-3 text-text-muted hover:text-foreground hover:bg-surface-low/50 transition-colors ${sidebarCollapsed ? "justify-center" : ""}`}
                >
                  <div className="w-9 h-9 rounded-full border border-dashed border-border flex items-center justify-center">
                    <Plus className="w-4 h-4" />
                  </div>
                  {!sidebarCollapsed && <span className="text-sm">New Agent</span>}
                </button>
              </div>
            )}
          </div>

          {/* Budget bars in sidebar footer (when expanded) */}
          {budget && !sidebarCollapsed && (
            <div className="px-3 py-3 border-t border-border flex flex-col gap-2 md:hidden">
              <BudgetBar label="Agents" used={budget.used_agents} total={budget.max_agents} />
              <BudgetBar label="CPU" used={budget.used_cpu} total={budget.total_cpu} format={formatCpu} />
              <BudgetBar label="Memory" used={budget.used_memory} total={budget.total_memory} format={formatMemory} />
            </div>
          )}
        </div>

        {/* ── Main Panel ── */}
        <div className={`flex-1 flex flex-col min-w-0 ${!mobileShowChat ? "hidden lg:flex" : "flex"}`}>
          {!selectedAgent ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Bot className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">Select an agent to get started</p>
              </div>
            </div>
          ) : (
            <>
              {/* Agent header + tabs */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                {/* Mobile back button */}
                <button
                  onClick={() => setMobileShowChat(false)}
                  className="lg:hidden text-text-muted hover:text-foreground"
                >
                  <PanelLeft className="w-5 h-5" />
                </button>

                {/* Agent name + status */}
                <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                  {(() => {
                    const avatar = agentAvatar(selectedAgent.name || selectedAgent.id);
                    const AvatarIcon = avatar.icon;
                    return (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: avatar.bgColor }}>
                        <AvatarIcon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                      </div>
                    );
                  })()}
                  <span className="text-sm font-semibold text-foreground truncate">{selectedAgent.name || selectedAgent.pod_name}</span>
                  {chat.connected && <span className="text-[10px] text-[#38D39F]">Gateway</span>}
                </div>

                {/* Tabs */}
                <div className="flex-1 flex items-center justify-center">
                  <div className="inline-flex rounded-lg border border-border overflow-hidden">
                    {(["chat", "logs", "shell", "files"] as MainTab[]).map((tab) => {
                      const icons = { chat: MessageSquare, logs: TerminalSquare, shell: TerminalSquare, files: FileText };
                      const Icon = icons[tab];
                      return (
                        <button
                          key={tab}
                          onClick={() => setMainTab(tab)}
                          className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                            mainTab === tab
                              ? "bg-surface-low text-foreground"
                              : "bg-transparent text-text-muted hover:text-foreground"
                          } ${tab !== "chat" ? "border-l border-border" : ""}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(mainTab === "logs" || mainTab === "shell") && (
                    <span className={`text-xs font-medium ${
                      (mainTab === "logs" ? wsStatus : shellStatus) === "connected" ? "text-[#38D39F]" :
                      (mainTab === "logs" ? wsStatus : shellStatus) === "connecting" ? "text-[#f0c56c]" : "text-text-muted"
                    }`}>
                      {mainTab === "logs" ? wsStatus : shellStatus}
                    </span>
                  )}

                  {/* Agent actions dropdown */}
                  <div className="flex items-center gap-1">
                    {selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED" ? (
                      <button
                        onClick={() => handleStart(selectedAgent.id)}
                        disabled={startingId === selectedAgent.id}
                        className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                      >
                        {startingId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Start
                      </button>
                    ) : isSelectedRunning || isSelectedTransitioning ? (
                      selectedAgent.state !== "STOPPING" && (
                        <button
                          onClick={() => handleStop(selectedAgent.id)}
                          disabled={stoppingId === selectedAgent.id}
                          className="px-2 py-1 rounded text-xs border border-[#f0c56c]/30 text-[#f0c56c] hover:bg-[#f0c56c]/10 disabled:opacity-60 flex items-center gap-1"
                        >
                          {stoppingId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                          Stop
                        </button>
                      )
                    ) : null}

                    {isSelectedRunning && selectedAgent.hostname && (
                      <button
                        onClick={() => handleOpenDesktop(selectedAgent)}
                        disabled={openingDesktopId === selectedAgent.id}
                        className="px-2 py-1 rounded text-xs border border-border text-text-secondary hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                      >
                        {openingDesktopId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                        Desktop
                      </button>
                    )}

                    {(mainTab === "logs" || mainTab === "shell") && (
                      <button
                        onClick={() => setReconnectNonce((n) => n + 1)}
                        className="p-1 text-text-muted hover:text-foreground transition-colors"
                        title="Reconnect"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(selectedAgent.id)}
                      disabled={deletingId === selectedAgent.id}
                      className="p-1 text-text-muted hover:text-[#d05f5f] transition-colors"
                      title="Delete agent"
                    >
                      {deletingId === selectedAgent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-hidden">
                {/* Hatching animation for transitioning agents */}
                {(isSelectedTransitioning || burstAgentId === selectedAgent.id) ? (
                  <div className="h-full flex items-center justify-center">
                    <AgentHatchAnimation
                      state={selectedAgent.state === "RUNNING" ? "RUNNING" : selectedAgent.state as "PENDING" | "STARTING"}
                      onBurstComplete={() => setBurstAgentId(null)}
                    />
                  </div>
                ) : mainTab === "chat" ? (
                  /* ── Chat Tab ── */
                  <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {chat.messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-text-muted">
                          <MessageSquare className="w-8 h-8 mb-2" />
                          <p className="text-sm">
                            {chat.connected
                              ? "Send a message to start chatting with your agent"
                              : isSelectedRunning
                                ? "Connecting to gateway..."
                                : "Start the agent to begin chatting"
                            }
                          </p>
                        </div>
                      )}

                      {chat.messages.map((msg, i) => (
                        <ChatMessageBubble key={i} message={msg} />
                      ))}

                      {chat.sending && chat.messages[chat.messages.length - 1]?.role !== "assistant" && (
                        <ChatThinkingIndicator />
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat input */}
                    <div className="border-t border-border p-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={chat.input}
                          onChange={(e) => chat.setInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                          placeholder={chat.connected ? "Type a message..." : "Waiting for gateway connection..."}
                          disabled={!chat.connected || chat.sending}
                          className="flex-1 bg-surface-low border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50"
                        />
                        <button
                          onClick={handleSendChat}
                          disabled={!chat.connected || chat.sending || !chat.input.trim()}
                          className="btn-primary px-3 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : mainTab === "logs" ? (
                  /* ── Logs Tab ── */
                  <div ref={logBoxRef} className="h-full overflow-auto bg-[#0c1016] text-[#d8dde7] text-xs leading-5 font-mono p-4">
                    {wsStatus !== "connected" && (
                      <div className="flex items-center gap-2 text-[#8b95a6] mb-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{wsStatus === "connecting" ? "Connecting to websocket..." : "Waiting for websocket connection..."}</span>
                      </div>
                    )}
                    {logs.length === 0 && wsStatus === "connected" && (
                      <div className="text-[#8b95a6]">Connected. Waiting for log stream...</div>
                    )}
                    {logs.map((line, idx) => (
                      <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">{line}</div>
                    ))}
                  </div>
                ) : mainTab === "shell" ? (
                  /* ── Shell Tab ── */
                  <div className="relative h-full bg-[#0c1016] p-4">
                    <div ref={shellBoxRef} className="h-full w-full" />
                    {shellStatus !== "connected" && (
                      <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 text-xs text-[#8b95a6]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{shellStatus === "connecting" ? "Connecting to shell websocket..." : "Waiting for shell websocket connection..."}</span>
                      </div>
                    )}
                    {shellStatus === "connected" && (
                      <div className="pointer-events-none absolute right-4 top-4 text-xs text-[#8b95a6]">Interactive shell active</div>
                    )}
                  </div>
                ) : mainTab === "files" ? (
                  /* ── Files Tab ── */
                  <div className="h-full flex flex-col">
                    {selectedFile ? (
                      <>
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
                          <button onClick={() => setSelectedFile(null)} className="text-text-muted hover:text-foreground">
                            <PanelLeft className="w-4 h-4" />
                          </button>
                          <FileText className="w-4 h-4 text-text-muted" />
                          <span className="text-sm font-mono text-foreground">{selectedFile}</span>
                          {fileDirty && <span className="text-xs text-[#f0c56c]">unsaved</span>}
                          <div className="flex-1" />
                          <button
                            onClick={handleSaveFile}
                            disabled={!fileDirty || savingFile}
                            className="btn-primary px-3 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-50"
                          >
                            {savingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                            Save
                          </button>
                        </div>
                        <textarea
                          value={fileContent}
                          onChange={(e) => { setFileContent(e.target.value); setFileDirty(true); }}
                          className="flex-1 bg-[#0c1016] text-[#d8dde7] font-mono text-sm p-4 resize-none focus:outline-none"
                          spellCheck={false}
                        />
                      </>
                    ) : (
                      <div className="p-4 space-y-1">
                        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Workspace Files</h3>
                        {!chat.connected ? (
                          <p className="text-sm text-text-muted">Connect to gateway to view files.</p>
                        ) : chat.files.length === 0 ? (
                          <p className="text-sm text-text-muted">No files</p>
                        ) : (
                          chat.files.map((f) => (
                            <button
                              key={f.name}
                              onClick={() => handleOpenFile(f.name)}
                              className="flex items-center gap-2 w-full px-3 py-2 rounded hover:bg-surface-low transition-colors text-left"
                            >
                              <FileText className={`w-4 h-4 ${f.missing ? "text-[#d05f5f]" : "text-text-muted"}`} />
                              <span className="text-sm text-foreground font-mono flex-1">{f.name}</span>
                              <span className="text-xs text-text-muted">{(f.size / 1024).toFixed(1)}KB</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
