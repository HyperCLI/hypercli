"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  Bot,
  ExternalLink,
  Loader2,
  Plus,
  Play,
  Square,
  RefreshCw,
  TerminalSquare,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";
import { formatCpu, formatMemory } from "@/lib/format";

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

const MAX_LOG_LINES = 1500;
const WS_RETRY_INTERVAL_MS = 15000;
const AGENT_STATE_REFRESH_INTERVAL_MS = 60000;
type ConsoleTab = "logs" | "shell";

const SIZES = [
  { label: "Small", cpu: 1000, mem: 1024, tag: "1 vCPU · 1 GiB" },
  { label: "Medium", cpu: 2000, mem: 2048, tag: "2 vCPU · 2 GiB" },
  { label: "Large", cpu: 4000, mem: 4096, tag: "4 vCPU · 4 GiB" },
] as const;

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
  name: string, value: string, days: number, domain: string
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

function BudgetBar({ label, used, total, format }: { label: string; used: number; total: number; format?: (n: number) => string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const fmt = format || String;
  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{fmt(used)} / {fmt(total)}</span>
      </div>
      <div className="h-2 rounded-full bg-surface-low overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-[#d05f5f]' : pct > 70 ? 'bg-[#f0c56c]' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { getToken } = useClawAuth();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("agent");
  const [selectedSize, setSelectedSize] = useState(1); // index into SIZES
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customCpu, setCustomCpu] = useState("2000");
  const [customMem, setCustomMem] = useState("2048");
  const [startImmediately, setStartImmediately] = useState(true);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("logs");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [logs, setLogs] = useState<string[]>([]);
  const [shellStatus, setShellStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

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
  useEffect(() => {
    const timer = setInterval(() => { void fetchAgents(); }, AGENT_STATE_REFRESH_INTERVAL_MS);
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
    if (consoleTab !== "logs") { setWsStatus("disconnected"); return; }
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
  }, [consoleTab, selectedAgentId, getToken, reconnectNonce, fetchAgents]);

  useEffect(() => { if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight; }, [logs]);

  // ── Shell terminal setup ──
  useEffect(() => {
    if (consoleTab !== "shell") return;
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
    fitAddon.fit();
    term.focus();
    const disposable = term.onData((data) => { const ws = shellWsRef.current; if (ws?.readyState === WebSocket.OPEN) ws.send(data); });
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

  // ── Shell WebSocket ──
  useEffect(() => {
    if (consoleTab !== "shell") {
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
        ws.onopen = () => { if (!cancelled) { reconnectScheduled = false; setShellStatus("connected"); shellFitAddonRef.current?.fit(); shellTerminalRef.current?.focus(); } };
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
  }, [consoleTab, selectedAgentId, selectedAgentHostname, reconnectNonce, issueAgentAccessToken]);

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

  const remainingCpu = budget ? budget.total_cpu - budget.used_cpu : 0;
  const remainingMem = budget ? budget.total_memory - budget.used_memory : 0;
  const remainingAgents = budget ? budget.max_agents - budget.used_agents : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-foreground">Agents</h1>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>

      {/* Budget bars */}
      {budget && (
        <div className="glass-card p-4 mb-6 flex flex-wrap gap-6">
          <BudgetBar label="Agents" used={budget.used_agents} total={budget.max_agents} />
          <BudgetBar label="CPU" used={budget.used_cpu} total={budget.total_cpu} format={(n) => formatCpu(n)} />
          <BudgetBar label="Memory" used={budget.used_memory} total={budget.total_memory} format={(n) => formatMemory(n)} />
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
          {error}
        </div>
      )}

      {/* Create Agent Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateDialog(false)}>
          <div className="glass-card p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
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
              className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm mb-4 focus:outline-none focus:border-primary"
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
                    <input value={customCpu} onChange={(e) => setCustomCpu(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Memory (MiB)</label>
                    <input value={customMem} onChange={(e) => setCustomMem(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-primary" />
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
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1.1fr_1.3fr] gap-6">
        {/* Agent list */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Your Agents</h2>
            <button onClick={fetchAgents} className="text-xs text-text-muted hover:text-foreground transition-colors">
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-text-muted">Loading...</div>
          ) : agents.length === 0 ? (
            <div className="p-8 text-center">
              <Bot className="w-8 h-8 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary mb-1">No agents yet</p>
              <p className="text-sm text-text-muted">Create your first agent to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {agents.map((agent) => {
                const isRunning = agent.state === "RUNNING";
                const isStopped = agent.state === "STOPPED" || agent.state === "FAILED";
                const isTransitioning = agent.state === "PENDING" || agent.state === "STARTING" || agent.state === "STOPPING";

                return (
                  <div
                    key={agent.id}
                    className={`p-4 transition-colors ${selectedAgentId === agent.id ? "bg-surface-low/70" : "hover:bg-surface-low/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => setSelectedAgentId(agent.id)} className="text-left min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{agent.name || agent.pod_name || agent.id}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          {formatCpu(agent.cpu_millicores)} · {formatMemory(agent.memory_mib)}
                        </p>
                        {agent.last_error && agent.state === "FAILED" && (
                          <p className="text-xs text-[#d05f5f] mt-1 truncate">{agent.last_error}</p>
                        )}
                      </button>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${stateClass(agent.state)}`}>
                        {agent.state}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      {isStopped && (
                        <button
                          onClick={() => handleStart(agent.id)}
                          disabled={startingId === agent.id}
                          className="px-2.5 py-1.5 rounded text-xs border border-[#38D39F]/30 text-primary hover:bg-[#38D39F]/10 disabled:opacity-60 flex items-center gap-1"
                        >
                          {startingId === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          Start
                        </button>
                      )}
                      {(isRunning || isTransitioning) && agent.state !== "STOPPING" && (
                        <button
                          onClick={() => handleStop(agent.id)}
                          disabled={stoppingId === agent.id}
                          className="px-2.5 py-1.5 rounded text-xs border border-[#f0c56c]/30 text-[#f0c56c] hover:bg-[#f0c56c]/10 disabled:opacity-60 flex items-center gap-1"
                        >
                          {stoppingId === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                          Stop
                        </button>
                      )}
                      {isRunning && (
                        <button
                          onClick={() => setSelectedAgentId(agent.id)}
                          className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1"
                        >
                          <TerminalSquare className="w-3.5 h-3.5" />
                          Console
                        </button>
                      )}
                      {isRunning && agent.hostname && (
                        <button
                          onClick={() => handleOpenDesktop(agent)}
                          disabled={openingDesktopId === agent.id}
                          className="btn-secondary px-2.5 py-1.5 rounded text-xs flex items-center gap-1 disabled:opacity-60"
                        >
                          {openingDesktopId === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                          Desktop
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(agent.id)}
                        disabled={deletingId === agent.id}
                        className="px-2.5 py-1.5 rounded text-xs border border-[#d05f5f]/30 text-[#d05f5f] hover:bg-[#d05f5f]/10 disabled:opacity-60 flex items-center gap-1"
                      >
                        {deletingId === agent.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Console panel */}
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Console</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {selectedAgent ? (selectedAgent.name || selectedAgent.pod_name) : "Select an agent"}
              </p>
              <div className="mt-3 inline-flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setConsoleTab("logs")}
                  className={`px-3 py-1.5 text-xs ${consoleTab === "logs" ? "bg-surface-low text-foreground" : "bg-transparent text-text-muted hover:text-foreground"}`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setConsoleTab("shell")}
                  className={`px-3 py-1.5 text-xs border-l border-border ${consoleTab === "shell" ? "bg-surface-low text-foreground" : "bg-transparent text-text-muted hover:text-foreground"}`}
                >
                  Shell
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium ${(consoleTab === "logs" ? wsStatus : shellStatus) === "connected" ? "text-primary" : (consoleTab === "logs" ? wsStatus : shellStatus) === "connecting" ? "text-[#f0c56c]" : "text-text-muted"}`}>
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
          ) : consoleTab === "logs" ? (
            <div ref={logBoxRef} className="h-[560px] overflow-auto bg-[#0c1016] text-[#d8dde7] text-xs leading-5 font-mono p-4">
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
          ) : (
            <div className="relative h-[560px] bg-[#0c1016] p-4">
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
              <div className="pointer-events-none absolute bottom-4 right-4 text-[11px] text-[#6f7a8d]">Type directly in terminal</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
