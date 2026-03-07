"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
  MessageSquare,
  Plus,
  Play,
  Square,
  RefreshCw,
  TerminalSquare,
  Trash2,
  FileText,
  Send,
  Settings,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeft,
  Upload,
  Paperclip,
  Mic,
  MicOff,
  X,
  Pause,
  ImageIcon,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useClawAuth } from "@/hooks/useClawAuth";
import { CLAW_API_BASE, clawFetch } from "@/lib/api";
import { formatCpu, formatMemory } from "@/lib/format";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import { useGatewayChat } from "@/hooks/useGatewayChat";
import { agentAvatar } from "@/lib/avatar";
import { AgentCreationWizard } from "@/components/dashboard/AgentCreationWizard";
import { useDashboardMobileAgentMenu, type AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";

// ── Types ──

type AgentState = "PENDING" | "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";
type JsonObject = Record<string, unknown>;

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
  jwt: string;
  expires_at: string;
  ws_url?: string;
}

interface AgentDesktopTokenResponse {
  agent_id: string;
  pod_id: string;
  token: string;
  expires_at: string | null;
}

interface AgentShellTokenResponse {
  agent_id: string;
  jwt: string;
  expires_at: string;
  ws_url: string;
}

interface LogEvent {
  event?: string;
  log?: string;
  detail?: string;
  status?: number;
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

// ── Constants ──

const MAX_LOG_LINES = 1500;
const WS_RETRY_INTERVAL_MS = 15000;
const AGENT_STATE_REFRESH_INTERVAL_MS = 60000;
const AGENT_TRANSITION_REFRESH_MS = 3000;
type MainTab = AgentMainTab;

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

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function formatFileSize(size?: number): string {
  if (size === undefined || Number.isNaN(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function extractVoicePathFromMessage(content: string): string | null {
  const absoluteMatch = content.match(/\/home\/ubuntu\/workspace\/voice-[\w.-]+\.webm\b/i);
  if (absoluteMatch?.[0]) return absoluteMatch[0];
  const fileMatch = content.match(/\bvoice-[\w.-]+\.webm\b/i);
  if (!fileMatch?.[0]) return null;
  return `/home/ubuntu/workspace/${fileMatch[0]}`;
}

// Shell now routes through backend WebSocket via lagoon → K8s exec

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

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function deepCloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

function getPathValue(root: JsonObject, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    const obj = asObject(cursor);
    if (!obj) return undefined;
    cursor = obj[key];
  }
  return cursor;
}

function setPathValue(root: JsonObject, path: string[], value: unknown): JsonObject {
  if (path.length === 0) return root;
  const next = deepCloneJsonObject(root);
  let cursor: JsonObject = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const child = asObject(cursor[key]);
    if (!child) cursor[key] = {};
    cursor = asObject(cursor[key]) as JsonObject;
  }
  cursor[path[path.length - 1]] = value;
  return next;
}

function normalizeSchemaNode(schema: JsonObject): JsonObject {
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  const union = [...oneOf, ...anyOf];
  if (union.length === 0) return schema;
  const primary = union.find((entry) => {
    const obj = asObject(entry);
    if (!obj) return false;
    const t = obj.type;
    if (typeof t === "string") return t !== "null";
    if (Array.isArray(t)) return t.some((v) => v !== "null");
    return true;
  });
  return asObject(primary) ?? schema;
}

function S3FilesPanel({
  agentId,
  getToken,
}: {
  agentId: string;
  getToken: () => Promise<string>;
}) {
  const [prefix, setPrefix] = useState("");
  const [directories, setDirectories] = useState<S3FileEntry[]>([]);
  const [files, setFiles] = useState<S3FileEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadFiles = useCallback(async (targetPrefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (targetPrefix) params.set("prefix", targetPrefix);
      const endpoint = `/agents/${agentId}/files${params.toString() ? `?${params.toString()}` : ""}`;
      const data = await clawFetch<S3FilesResponse>(endpoint, token);
      setPrefix(data.prefix || targetPrefix);
      setDirectories(data.directories || []);
      setFiles(data.files || []);
      setTruncated(Boolean(data.truncated));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load files");
      setDirectories([]);
      setFiles([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => {
    void loadFiles(prefix);
  }, [loadFiles, prefix]);

  const goToPrefix = useCallback((nextPrefix: string) => {
    setPrefix(nextPrefix);
  }, []);

  const uploadFiles = useCallback(async (uploadList: FileList) => {
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      for (const file of Array.from(uploadList)) {
        const uploadPath = `${prefix}${file.name}`;
        const res = await fetch(`${CLAW_API_BASE}/agents/${agentId}/files/upload/${encodePath(uploadPath)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Upload failed (${res.status})`);
        }
      }
      await loadFiles(prefix);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [agentId, getToken, loadFiles, prefix]);

  const downloadFile = useCallback(async (path: string) => {
    setError(null);
    try {
      const token = await getToken();
      const data = await clawFetch<{ url: string }>(`/agents/${agentId}/files/download/${encodePath(path)}`, token);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }, [agentId, getToken]);

  const deleteFile = useCallback(async (path: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setError(null);
    try {
      const token = await getToken();
      await clawFetch(`/agents/${agentId}/files/delete/${encodePath(path)}`, token, {
        method: "DELETE",
      });
      await loadFiles(prefix);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [agentId, getToken, loadFiles, prefix]);

  const pathParts = prefix.split("/").filter(Boolean);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
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
          className="px-3 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-50 flex items-center gap-1"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Upload
        </button>
        <button
          onClick={() => void loadFiles(prefix)}
          disabled={loading}
          className="px-3 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-50 flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <div className="flex-1" />
        <p className="text-xs text-text-muted">Uploaded files sync to workspace on agent restart.</p>
      </div>

      <div className="px-4 py-2 border-b border-border bg-surface-low text-xs text-text-muted font-mono flex items-center gap-1 overflow-x-auto">
        <button onClick={() => goToPrefix("")} className="hover:text-foreground">/</button>
        {pathParts.map((part, idx) => {
          const partPrefix = `${pathParts.slice(0, idx + 1).join("/")}/`;
          return (
            <span key={partPrefix} className="flex items-center gap-1">
              <span>/</span>
              <button onClick={() => goToPrefix(partPrefix)} className="hover:text-foreground whitespace-nowrap">{part}</button>
            </span>
          );
        })}
      </div>

      {error && <div className="px-4 py-2 text-xs text-[#d05f5f] border-b border-border">{error}</div>}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="p-2">
            {directories.map((dir) => {
              const nextPrefix = dir.path || `${prefix}${dir.name.replace(/\/?$/, "/")}`;
              return (
                <button
                  key={`dir-${dir.path || dir.name}`}
                  onClick={() => goToPrefix(nextPrefix)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-low text-left"
                >
                  <FolderOpen className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-foreground font-mono flex-1">{dir.name}</span>
                </button>
              );
            })}

            {files.map((file) => (
              <div
                key={`file-${file.path}`}
                className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-low"
              >
                <FileText className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-foreground font-mono flex-1">{file.name}</span>
                <span className="text-xs text-text-muted w-24 text-right">{formatFileSize(file.size)}</span>
                <button
                  onClick={() => void downloadFile(file.path)}
                  className="text-text-muted hover:text-foreground p-1"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void deleteFile(file.path, file.name)}
                  className="text-text-muted hover:text-[#d05f5f] p-1"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {directories.length === 0 && files.length === 0 && (
              <div className="p-8 text-center text-sm text-text-muted">
                No files in this directory.
              </div>
            )}

            {truncated && (
              <div className="px-2 py-2 text-xs text-[#f0c56c]">
                Listing is truncated. Narrow your prefix to see more files.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ──

export default function AgentsPage() {
  const { getToken } = useClawAuth();
  const { setAgentMenu } = useDashboardMobileAgentMenu();

  // Agent data
  const [agents, setAgents] = useState<Agent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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

  // Settings tab state
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [openclawDraft, setOpenclawDraft] = useState<JsonObject | null>(null);
  const [openclawSaving, setOpenclawSaving] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);
  const [openclawSuccess, setOpenclawSuccess] = useState<string | null>(null);
  const [activeOpenclawSection, setActiveOpenclawSection] = useState<string | null>(null);

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

  // Sync settings fields when selected agent changes
  useEffect(() => {
    if (selectedAgent) {
      setSettingsName(selectedAgent.name || "");
      setSettingsDesc(""); // No description field in Agent type yet
    }
  }, [selectedAgentId]);

  // ── Gateway Chat hook ──
  const chat = useGatewayChat(
    selectedAgent && isSelectedRunning ? selectedAgent : null,
    getToken
  );

  const openclawSchemaRoot = useMemo(() => {
    const raw = asObject(chat.configSchema);
    const wrapped = asObject(raw?.schema);
    return wrapped ?? raw;
  }, [chat.configSchema]);
  const openclawSchemaProperties = useMemo(
    () => asObject(openclawSchemaRoot?.properties ?? null),
    [openclawSchemaRoot]
  );

  const openclawSections = useMemo(
    () => Object.entries(openclawSchemaProperties ?? {}),
    [openclawSchemaProperties]
  );

  useEffect(() => {
    const cfg = asObject(chat.config);
    setOpenclawDraft(cfg ? deepCloneJsonObject(cfg) : null);
    setOpenclawError(null);
    setOpenclawSuccess(null);
  }, [selectedAgentId, chat.config]);

  useEffect(() => {
    if (!activeOpenclawSection && openclawSections.length > 0) {
      setActiveOpenclawSection(openclawSections[0][0]);
    }
    if (activeOpenclawSection && !openclawSections.find(([k]) => k === activeOpenclawSection)) {
      setActiveOpenclawSection(openclawSections[0]?.[0] ?? null);
    }
  }, [openclawSections, activeOpenclawSection]);

  const updateOpenclawPath = useCallback((path: string[], value: unknown) => {
    setOpenclawDraft((prev) => {
      const base = prev ? deepCloneJsonObject(prev) : {};
      return setPathValue(base, path, value);
    });
  }, []);

  const saveOpenclawPatch = useCallback(async (patch: JsonObject, successText: string) => {
    setOpenclawSaving(true);
    setOpenclawError(null);
    setOpenclawSuccess(null);
    try {
      await chat.saveConfig(patch);
      setOpenclawSuccess(successText);
    } catch (err) {
      setOpenclawError(err instanceof Error ? err.message : "Failed to save OpenClaw config");
    } finally {
      setOpenclawSaving(false);
    }
  }, [chat]);

  const saveOpenclawSection = useCallback(async (sectionKey: string) => {
    if (!openclawDraft) return;
    await saveOpenclawPatch({ [sectionKey]: openclawDraft[sectionKey] }, `Saved section: ${sectionKey}`);
  }, [openclawDraft, saveOpenclawPatch]);

  const saveAllOpenclaw = useCallback(async () => {
    if (!openclawDraft) return;
    await saveOpenclawPatch(openclawDraft, "Saved all OpenClaw settings");
  }, [openclawDraft, saveOpenclawPatch]);

  const renderOpenclawField = useCallback((schemaRaw: unknown, path: string[], depth = 0) => {
    const schema = normalizeSchemaNode(asObject(schemaRaw) ?? {});
    const title = typeof schema.title === "string" ? schema.title : humanizeKey(path[path.length - 1] || "setting");
    const description = typeof schema.description === "string" ? schema.description : "";
    const typeRaw = schema.type;
    const type = Array.isArray(typeRaw)
      ? (typeRaw.find((entry) => entry !== "null") as string | undefined)
      : (typeof typeRaw === "string" ? typeRaw : undefined);
    const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
    const currentValue = openclawDraft ? getPathValue(openclawDraft, path) : undefined;
    const key = path.join(".");

    const properties = asObject(schema.properties);
    if ((type === "object" || properties) && properties) {
      const entries = Object.entries(properties);
      if (entries.length === 0) return null;
      return (
        <div key={key} className={depth > 0 ? "rounded-lg border border-border p-3 space-y-3" : "space-y-3"}>
          {depth > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          )}
          {entries.map(([childKey, childSchema]) => renderOpenclawField(childSchema, [...path, childKey], depth + 1))}
        </div>
      );
    }

    const onJsonValueChange = (raw: string) => {
      try {
        updateOpenclawPath(path, JSON.parse(raw));
        setOpenclawError(null);
      } catch {
        setOpenclawError(`Invalid JSON at ${path.join(".")}`);
      }
    };

    return (
      <div key={key} className="space-y-1">
        <label className="block text-sm text-text-secondary">{title}</label>
        {description && <p className="text-xs text-text-muted">{description}</p>}
        {enumValues.length > 0 ? (
          <select
            value={currentValue == null ? "" : String(currentValue)}
            onChange={(e) => updateOpenclawPath(path, e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          >
            <option value="">(unset)</option>
            {enumValues.map((value) => (
              <option key={`${key}-enum-${String(value)}`} value={String(value)}>
                {String(value)}
              </option>
            ))}
          </select>
        ) : type === "boolean" ? (
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={Boolean(currentValue)}
              onChange={(e) => updateOpenclawPath(path, e.target.checked)}
              className="rounded border-border bg-surface-low"
            />
            Enabled
          </label>
        ) : type === "number" || type === "integer" ? (
          <input
            type="number"
            value={typeof currentValue === "number" ? String(currentValue) : ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (!raw) {
                updateOpenclawPath(path, null);
                return;
              }
              const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
              if (!Number.isNaN(parsed)) updateOpenclawPath(path, parsed);
            }}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        ) : type === "array" || type === "object" ? (
          <textarea
            value={typeof currentValue === "undefined" ? "" : JSON.stringify(currentValue, null, 2)}
            onChange={(e) => onJsonValueChange(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong"
          />
        ) : (
          <input
            type="text"
            value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
            onChange={(e) => updateOpenclawPath(path, e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        )}
      </div>
    );
  }, [openclawDraft, updateOpenclawPath]);

  // Auto-scroll chat — only when user is near bottom (not scrolled up reading)
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    // Consider "near bottom" if within 100px of the end
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    const count = chat.messages.length;
    if (count !== lastMsgCountRef.current) {
      lastMsgCountRef.current = count;
      // Always scroll on new message (user sent or agent started replying)
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    } else if (isNearBottomRef.current) {
      // Streaming update — only scroll if already near bottom
      requestAnimationFrame(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    }
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
          url = `${explicitWsUrl}${sep}jwt=${encodeURIComponent(stream.jwt)}&container=reef&tail_lines=400`;
        } else {
          const wsBase = configuredWsBase || derivedWsBase;
          if (!wsBase) throw new Error("WebSocket base URL is not configured");
          url = `${wsBase}/ws/${agentId}?jwt=${encodeURIComponent(stream.jwt)}&container=reef&tail_lines=400`;
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
        ws.send(`\x1b[8;${rows};${cols}t`);
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
        const authToken = await getToken();
        if (cancelled) return;
        const shellToken = await clawFetch<AgentShellTokenResponse>(`/agents/${agentId}/shell/token`, authToken, { method: "POST" });
        if (cancelled) return;
        const ws = new WebSocket(`${shellToken.ws_url}?jwt=${encodeURIComponent(shellToken.jwt)}`);
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
              ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
            }
          }
        };
        ws.onmessage = (event) => { if (!cancelled) { const text = typeof event.data === "string" ? event.data : String(event.data ?? ""); if (text) shellTerminalRef.current?.write(text); } };
        ws.onclose = () => { if (!cancelled) { setShellStatus("disconnected"); scheduleReconnect(); } };
        ws.onerror = () => { if (!cancelled) { setShellStatus("disconnected"); scheduleReconnect(); } };
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
  }, [mainTab, selectedAgentId, reconnectNonce, getToken]);

  // ── Actions ──

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

  // Audio recording
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioPreviewDuration, setAudioPreviewDuration] = useState(0);
  const [audioPreviewPlaying, setAudioPreviewPlaying] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelAnimRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analyser for volume visualization
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Volume level animation loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(avg / 128, 1)); // normalize to 0-1
        levelAnimRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      setRecordingDuration(0);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(levelAnimRef.current);
        audioCtx.close();
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        setAudioLevel(0);
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      // Mic permission denied
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  const discardAudio = useCallback(() => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioPreviewDuration(0);
    setAudioPreviewPlaying(false);
    setRecordingDuration(0);
  }, [audioUrl]);

  useEffect(() => {
    if (!audioUrl) return;
    const previewAudio = new Audio(audioUrl);
    previewAudio.preload = "metadata";
    const syncDuration = () => {
      if (Number.isFinite(previewAudio.duration) && previewAudio.duration > 0) {
        setAudioPreviewDuration(Math.round(previewAudio.duration));
      }
    };
    const onPlay = () => setAudioPreviewPlaying(true);
    const onPause = () => setAudioPreviewPlaying(false);
    previewAudio.addEventListener("loadedmetadata", syncDuration);
    previewAudio.addEventListener("durationchange", syncDuration);
    previewAudio.addEventListener("play", onPlay);
    previewAudio.addEventListener("pause", onPause);
    previewAudio.addEventListener("ended", onPause);
    audioPreviewRef.current = previewAudio;
    return () => {
      previewAudio.pause();
      previewAudio.removeEventListener("loadedmetadata", syncDuration);
      previewAudio.removeEventListener("durationchange", syncDuration);
      previewAudio.removeEventListener("play", onPlay);
      previewAudio.removeEventListener("pause", onPause);
      previewAudio.removeEventListener("ended", onPause);
      previewAudio.src = "";
      audioPreviewRef.current = null;
      setAudioPreviewPlaying(false);
    };
  }, [audioUrl]);

  const toggleAudioPreviewPlayback = useCallback(() => {
    const previewAudio = audioPreviewRef.current;
    if (!previewAudio) return;
    if (previewAudio.paused) {
      void previewAudio.play();
      return;
    }
    previewAudio.pause();
  }, []);

  const sendAudio = useCallback(async () => {
    if (!audioBlob || !selectedAgent || sendingAudio || !chat.connected) return;
    setSendingAudio(true);
    try {
      const token = await getToken();
      const timestamp = Date.now();
      const filename = `voice-${timestamp}.webm`;
      const uploadPath = `workspace/${filename}`;
      const agentPath = `/home/ubuntu/${uploadPath}`;
      const voiceMessage = `Voice message: ${agentPath}`;
      // Upload audio to agent's filesystem
      const res = await fetch(`${CLAW_API_BASE}/agents/${selectedAgent.id}/files/upload/${encodePath(uploadPath)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/webm" },
        body: audioBlob,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Upload failed: ${res.status}`);
      }
      // Keep input state in sync and send in one action.
      chat.setInput(voiceMessage);
      await chat.sendMessage(voiceMessage);
      discardAudio();
    } catch (e) {
      console.error("Audio upload failed:", e);
      setError(e instanceof Error ? e.message : "Audio upload failed");
    } finally {
      setSendingAudio(false);
    }
  }, [audioBlob, chat, discardAudio, selectedAgent, getToken, sendingAudio]);

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const handleSendChat = () => {
    chat.sendMessage();
  };

  useEffect(() => {
    if (!selectedAgent) {
      setAgentMenu(null);
      return;
    }
    setAgentMenu({
      selectedAgentId: selectedAgent.id,
      activeTab: mainTab,
      onSelectTab: (tab) => {
        setMainTab(tab);
        setMobileShowChat(true);
      },
      onDelete: () => { void handleDelete(selectedAgent.id); },
      deleting: deletingId === selectedAgent.id,
    });
    return () => setAgentMenu(null);
  }, [selectedAgent, mainTab, deletingId, setAgentMenu]);

  // ── Render ──

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-8 h-[calc(100dvh-3.5rem)] md:h-auto md:min-h-0 flex flex-col overflow-hidden">
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

      <AgentCreationWizard
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={() => { setShowCreateDialog(false); fetchAgents(); }}
        budget={budget}
      />

      {/* Main layout: Sidebar + Panel */}
      <div className="flex flex-1 min-h-0 md:h-[calc(100dvh-7rem)] md:flex-none">
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
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 min-w-0">
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
                  {chat.connected && (
                    <>
                      <span className="hidden md:inline text-[10px] text-[#38D39F]">Gateway</span>
                      <span className="md:hidden w-2 h-2 rounded-full bg-[#38D39F]" />
                    </>
                  )}
                  {!chat.connected && chat.connecting && (
                    <>
                      <span className="hidden md:inline text-[10px] text-[#38D39F] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Connecting
                      </span>
                      <Loader2 className="md:hidden w-3 h-3 animate-spin text-[#38D39F]" />
                    </>
                  )}
                </div>

                {/* Tabs */}
                <div className="hidden md:flex flex-1 min-w-0 items-center justify-center overflow-x-auto">
                  <div className="inline-flex min-w-max rounded-lg border border-border overflow-hidden">
                    {(["chat", "logs", "shell", "files", "workspace", "openclaw", "settings"] as MainTab[]).map((tab) => {
                      const icons = {
                        chat: MessageSquare,
                        logs: TerminalSquare,
                        shell: TerminalSquare,
                        workspace: FolderOpen,
                        files: HardDrive,
                        openclaw: SlidersHorizontal,
                        settings: Settings,
                      };
                      const labels: Record<MainTab, string> = {
                        chat: "Chat",
                        logs: "Logs",
                        shell: "Shell",
                        workspace: "Workspace",
                        files: "Files",
                        openclaw: "OpenClaw",
                        settings: "Settings",
                      };
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
                          <span className="hidden md:inline">{labels[tab]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="md:hidden flex items-center gap-1">
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
                          className="px-2 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                        >
                          {stoppingId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                          Stop
                        </button>
                      )
                    ) : null}
                  </div>

                  <div className="hidden md:flex items-center gap-2">
                    {(mainTab === "logs" || mainTab === "shell") && (
                      <span className={`text-xs font-medium ${
                        (mainTab === "logs" ? wsStatus : shellStatus) === "connected" ? "text-[#38D39F]" :
                        (mainTab === "logs" ? wsStatus : shellStatus) === "connecting" ? "text-[#f0c56c]" : "text-text-muted"
                      }`}>
                        {mainTab === "logs" ? wsStatus : shellStatus}
                      </span>
                    )}

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
                            className="px-2 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
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
              </div>

              {/* Panel content */}
              <div className="flex-1 min-h-0 overflow-hidden">
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
                  <div className="flex flex-col h-full min-h-0">
                    <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
                      {chat.messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-text-muted">
                          {chat.connecting ? (
                            <>
                              <Loader2 className="w-8 h-8 mb-2 animate-spin" />
                              <p className="text-sm">Connecting to gateway...</p>
                              <p className="text-xs mt-1 text-text-muted/60">Retrying every 5s</p>
                            </>
                          ) : chat.connected ? (
                            <>
                              <MessageSquare className="w-8 h-8 mb-2" />
                              <p className="text-sm">Send a message to start chatting with your agent</p>
                            </>
                          ) : (
                            <>
                              <MessageSquare className="w-8 h-8 mb-2" />
                              <p className="text-sm">
                                {isSelectedRunning ? "Connecting to gateway..." : "Start the agent to begin chatting"}
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {chat.messages.map((msg, i) => {
                        const voicePath = msg.role === "user" ? extractVoicePathFromMessage(msg.content) : null;
                        const inlineAudioUrl = voicePath && selectedAgent
                          ? `${CLAW_API_BASE}/agents/${selectedAgent.id}/files/download/${encodeURIComponent(voicePath)}`
                          : null;
                        return <ChatMessageBubble key={i} message={msg} inlineAudioUrl={inlineAudioUrl} />;
                      })}

                      {chat.sending && chat.messages[chat.messages.length - 1]?.role !== "assistant" && (
                        <ChatThinkingIndicator />
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat input */}
                    <div
                      className="flex-shrink-0 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))] md:p-3"
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer.files?.length) {
                          const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
                          if (imageFiles.length > 0) {
                            const dt = new DataTransfer();
                            imageFiles.forEach(f => dt.items.add(f));
                            chat.addAttachments(dt.files);
                          }
                        }
                      }}
                    >
                      {/* Pending image attachments preview */}
                      {chat.pendingAttachments.length > 0 && (
                        <div className="flex gap-2 mb-2 flex-wrap">
                          {chat.pendingAttachments.map((att, i) => (
                            <div key={i} className="relative group">
                              <img
                                src={`data:${att.mimeType};base64,${att.content}`}
                                alt={att.fileName || "attachment"}
                                className="w-16 h-16 rounded-md object-cover border border-border"
                              />
                              <button
                                onClick={() => chat.removeAttachment(i)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#d05f5f] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 items-center">
                        {recording ? (
                          /* Recording mode: show timer + stop button */
                          <>
                            <div className="flex-1 flex items-center gap-3 bg-surface-low border border-[#d05f5f]/30 rounded-lg px-3 py-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full bg-[#d05f5f] transition-transform duration-75"
                                style={{ transform: `scale(${1 + audioLevel * 1.5})` }}
                              />
                              <span className="text-sm text-[#d05f5f] font-mono">{formatDuration(recordingDuration)}</span>
                              {/* Volume bars */}
                              <div className="flex items-center gap-0.5 flex-1">
                                {Array.from({ length: 20 }).map((_, i) => (
                                  <div
                                    key={i}
                                    className="w-1 rounded-full transition-all duration-75"
                                    style={{
                                      height: `${Math.max(4, Math.min(20, audioLevel * 24 * (0.5 + Math.random() * 0.5)))}px`,
                                      backgroundColor: audioLevel > 0.1 ? `rgba(208, 95, 95, ${0.3 + audioLevel * 0.7})` : "rgba(208, 95, 95, 0.2)",
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={stopRecording}
                              className="px-3 py-2 rounded-lg border border-[#d05f5f] text-[#d05f5f] hover:bg-[#d05f5f]/10 flex items-center justify-center transition-colors"
                            >
                              <Square className="w-4 h-4" />
                            </button>
                          </>
                        ) : audioUrl ? (
                          /* Audio preview: compact custom player */
                          <>
                            <div className="min-w-0 flex-1 flex items-center gap-1 rounded-lg border border-border bg-surface-low px-2 py-1.5">
                              <button
                                onClick={toggleAudioPreviewPlayback}
                                type="button"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:text-foreground hover:bg-background/50"
                                title={audioPreviewPlaying ? "Pause" : "Play"}
                              >
                                {audioPreviewPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                              </button>
                              <span className="min-w-0 truncate text-xs font-mono text-text-secondary">
                                {formatDuration(audioPreviewDuration || recordingDuration)}
                              </span>
                            </div>
                            <button
                              onClick={discardAudio}
                              className="px-2 py-2 rounded-lg border border-border text-text-muted hover:text-[#d05f5f] hover:bg-surface-low flex items-center justify-center transition-colors"
                              title="Discard"
                              type="button"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              onClick={sendAudio}
                              disabled={!chat.connected || chat.sending || sendingAudio}
                              className="btn-primary px-3 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center"
                              type="button"
                            >
                              {sendingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                          </>
                        ) : (
                          /* Normal text mode */
                          <>
                            <input
                              type="text"
                              value={chat.input}
                              onChange={(e) => chat.setInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                              onPaste={(e) => {
                                const items = e.clipboardData?.items;
                                if (!items) return;
                                const imageFiles: File[] = [];
                                for (const item of Array.from(items)) {
                                  if (item.type.startsWith("image/")) {
                                    const file = item.getAsFile();
                                    if (file) imageFiles.push(file);
                                  }
                                }
                                if (imageFiles.length > 0) {
                                  e.preventDefault();
                                  const dt = new DataTransfer();
                                  imageFiles.forEach((f) => dt.items.add(f));
                                  chat.addAttachments(dt.files);
                                }
                              }}
                              placeholder={chat.connected ? "Type a message..." : "Waiting for gateway..."}
                              disabled={!chat.connected || chat.sending}
                              className="flex-1 min-w-0 bg-surface-low border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50"
                            />
                            <label className="flex-shrink-0 px-2 py-2 rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-surface-low cursor-pointer flex items-center justify-center transition-colors">
                              <Paperclip className="w-4 h-4" />
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files?.length) {
                                    chat.addAttachments(e.target.files);
                                    e.target.value = "";
                                  }
                                }}
                              />
                            </label>
                            <button
                              onClick={startRecording}
                              disabled={!chat.connected}
                              className="flex-shrink-0 px-2 py-2 rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-surface-low flex items-center justify-center transition-colors"
                              title="Record audio"
                            >
                              <Mic className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleSendChat}
                              disabled={!chat.connected || chat.sending || (!chat.input.trim() && chat.pendingAttachments.length === 0)}
                              className="flex-shrink-0 btn-primary px-3 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          </>
                        )}
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
                ) : mainTab === "workspace" ? (
                  /* ── Workspace Tab ── */
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
                ) : mainTab === "files" ? (
                  /* ── Files Tab ── */
                  <S3FilesPanel
                    agentId={selectedAgent.id}
                    getToken={getToken}
                  />
                ) : mainTab === "openclaw" ? (
                  /* ── OpenClaw Tab ── */
                  <div className="h-full flex min-h-0">
                    <div className="hidden md:block w-64 border-r border-border overflow-y-auto p-3 space-y-1 bg-surface-low/30">
                      <button
                        onClick={() => setActiveOpenclawSection(null)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          activeOpenclawSection === null
                            ? "bg-surface-low text-foreground"
                            : "text-text-muted hover:text-foreground hover:bg-surface-low/70"
                        }`}
                      >
                        All Sections
                      </button>
                      {openclawSections.map(([sectionKey, sectionSchema]) => (
                        <button
                          key={`nav-${sectionKey}`}
                          onClick={() => setActiveOpenclawSection(sectionKey)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            activeOpenclawSection === sectionKey
                              ? "bg-surface-low text-foreground"
                              : "text-text-muted hover:text-foreground hover:bg-surface-low/70"
                          }`}
                          title={typeof asObject(sectionSchema)?.description === "string" ? String(asObject(sectionSchema)?.description) : sectionKey}
                        >
                          {humanizeKey(sectionKey)}
                        </button>
                      ))}
                    </div>

                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="max-w-5xl mx-auto space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-semibold text-foreground">OpenClaw Config</h3>
                            <p className="text-sm text-text-muted">
                              Schema-driven settings from gateway <span className="font-mono">config.schema</span>, applied over websocket.
                            </p>
                          </div>
                          <button
                            onClick={() => void saveAllOpenclaw()}
                            disabled={openclawSaving || !chat.connected || !openclawDraft}
                            className="btn-primary px-3 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2"
                          >
                            {openclawSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                            Save All
                          </button>
                        </div>

                        {openclawError && (
                          <div className="rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-2 text-sm text-[#d05f5f]">
                            {openclawError}
                          </div>
                        )}
                        {openclawSuccess && !openclawError && (
                          <div className="rounded-lg border border-[#38D39F]/30 bg-[#38D39F]/10 px-3 py-2 text-sm text-[#38D39F]">
                            {openclawSuccess}
                          </div>
                        )}
                        {!chat.connected && (
                          <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                            Connect the agent gateway to edit OpenClaw settings.
                          </div>
                        )}
                        {!openclawSchemaProperties && (
                          <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                            No config schema available from gateway.
                          </div>
                        )}

                        {openclawSchemaProperties && openclawDraft && (
                          <div className="space-y-4">
                            {openclawSections
                              .filter(([sectionKey]) => activeOpenclawSection === null || activeOpenclawSection === sectionKey)
                              .map(([sectionKey, sectionSchema]) => (
                                <div key={`section-${sectionKey}`} className="rounded-xl border border-border bg-surface-low/30 p-4 space-y-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <h4 className="text-base font-semibold text-foreground">{humanizeKey(sectionKey)}</h4>
                                      {typeof asObject(sectionSchema)?.description === "string" && (
                                        <p className="text-xs text-text-muted mt-1">{String(asObject(sectionSchema)?.description)}</p>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => void saveOpenclawSection(sectionKey)}
                                      disabled={openclawSaving || !chat.connected}
                                      className="px-3 py-1.5 rounded-lg text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-50"
                                    >
                                      Save Section
                                    </button>
                                  </div>
                                  {renderOpenclawField(sectionSchema, [sectionKey])}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : mainTab === "settings" && selectedAgent ? (
                  /* ── Settings Tab ── */
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-xl mx-auto space-y-8">
                      {/* Agent Identity Section */}
                      <div>
                        <h3 className="text-lg font-semibold text-foreground mb-4">Agent Identity</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm text-text-secondary mb-1">Name</label>
                            <div className="flex items-center gap-2">
                              <input
                                value={settingsName}
                                onChange={(e) => setSettingsName(e.target.value)}
                                className="flex-1 px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
                                placeholder="Agent name"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm text-text-secondary mb-1">Description</label>
                            <textarea
                              value={settingsDesc}
                              onChange={(e) => setSettingsDesc(e.target.value)}
                              rows={3}
                              className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong resize-none"
                              placeholder="What does this agent do? (optional)"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Info Section */}
                      <div>
                        <h3 className="text-lg font-semibold text-foreground mb-4">Information</h3>
                        <div className="glass-card p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-secondary">Agent ID</span>
                            <span className="text-sm text-text-tertiary font-mono">{selectedAgent.id.slice(0, 12)}...</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-secondary">Status</span>
                            <span className={`text-sm font-medium ${
                              selectedAgent.state === "RUNNING" ? "text-[#38D39F]" :
                              selectedAgent.state === "FAILED" ? "text-[#d05f5f]" :
                              selectedAgent.state === "STOPPED" ? "text-text-muted" :
                              "text-[#f0c56c]"
                            }`}>{selectedAgent.state}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-secondary">Resources</span>
                            <span className="text-sm text-text-tertiary">{formatCpu(selectedAgent.cpu_millicores)} · {formatMemory(selectedAgent.memory_mib)}</span>
                          </div>
                          {selectedAgent.hostname && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-text-secondary">Hostname</span>
                              <span className="text-sm text-text-tertiary font-mono">{selectedAgent.hostname}</span>
                            </div>
                          )}
                          {selectedAgent.created_at && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-text-secondary">Created</span>
                              <span className="text-sm text-text-tertiary">{new Date(selectedAgent.created_at).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Danger Zone */}
                      <div>
                        <h3 className="text-lg font-semibold text-[#d05f5f] mb-4">Danger Zone</h3>
                        <div className="border border-[#d05f5f]/20 rounded-lg p-4 space-y-3">
                          {selectedAgent.state === "RUNNING" && (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-foreground">Stop Agent</p>
                                <p className="text-xs text-text-muted">Stop the running agent container</p>
                              </div>
                              <button
                                onClick={() => handleStop(selectedAgent.id)}
                                disabled={stoppingId === selectedAgent.id}
                                className="px-3 py-1.5 rounded-lg text-sm border border-border text-foreground hover:bg-surface-low disabled:opacity-60"
                              >
                                {stoppingId === selectedAgent.id ? "Stopping..." : "Stop"}
                              </button>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-foreground">Delete Agent</p>
                              <p className="text-xs text-text-muted">Permanently delete this agent and all its data</p>
                            </div>
                            <button
                              onClick={() => handleDelete(selectedAgent.id)}
                              className="px-3 py-1.5 rounded-lg text-sm border border-[#d05f5f]/30 text-[#d05f5f] hover:bg-[#d05f5f]/10"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
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
