"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOpenClawConfigValue,
  describeOpenClawConfigNode,
  normalizeOpenClawConfigSchemaNode,
  resolveOpenClawConfigUiHint,
  type OpenClawConfigSchemaResponse,
  type OpenClawConfigUiHint,
} from "@hypercli.com/sdk/gateway";
import { getGatewayToken, setGatewayToken, removeAgentState } from "@/lib/agent-store";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Key,
  CreditCard,
  Download,
  ExternalLink,
  House,
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
  Plug,
  Upload,
  Paperclip,
  Mic,
  MicOff,
  X,
  Menu,
  Pause,
  ImageIcon,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { API_BASE_URL, agentApiFetch } from "@/lib/api";
import { createAgentClient, startOpenClawAgent } from "@/lib/agent-client";
import { formatCpu, formatMemory, formatTokens, type SlotInventory } from "@/lib/format";
import { AgentHatchAnimation } from "@/components/dashboard/AgentHatchAnimation";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import { useGatewayChat } from "@/hooks/useGatewayChat";
import { agentAvatar, type AgentMeta } from "@/lib/avatar";
import { AgentCreationWizard } from "@/components/dashboard/AgentCreationWizard";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { IntegrationsPage } from "@/components/dashboard/integrations";
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
  gatewayToken?: string | null;
  meta?: AgentMeta | null;
}

interface AgentBudget {
  slots: SlotInventory;
  pooled_tpd: number;
  size_presets?: Record<string, { cpu: number; memory: number }>;
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

interface AgentListItem {
  id: string;
  name: string;
  user_id: string;
  pod_id: string | null;
  pod_name: string | null;
  state: AgentState;
  cpu: number;
  memory: number;
  hostname: string | null;
  started_at: string | null;
  stopped_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  openclaw_url?: string | null;
  gatewayToken?: string | null;
  meta?: AgentMeta | null;
}

interface AgentListResponse {
  items?: AgentListItem[];
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

// ── Error Boundary ──

class OpenClawErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-sm text-[#d05f5f]">
          <p className="font-semibold">OpenClaw config render error</p>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} className="mt-2 text-xs underline">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Constants ──

const MAX_LOG_LINES = 1500;
const WS_RETRY_INTERVAL_MS = 15000;
const AGENT_STATE_REFRESH_INTERVAL_MS = 60000;
const AGENT_TRANSITION_REFRESH_MS = 3000;
type MainTab = AgentMainTab;

// ── Utility functions ──

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

function downloadBrowserFile(content: BlobPart | Uint8Array, filename: string, mimeType = "application/octet-stream") {
  const blobContent =
    content instanceof Uint8Array
      ? new Uint8Array(content)
      : content;
  const url = URL.createObjectURL(new Blob([blobContent], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFileSize(size?: number): string {
  if (size === undefined || Number.isNaN(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function titleizeTier(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

const FALLBACK_AGENT_SIZE_PRESETS: Record<string, { cpu: number; memory: number }> = {
  small: { cpu: 1, memory: 1 },
  medium: { cpu: 2, memory: 2 },
  large: { cpu: 4, memory: 4 },
};

interface AgentTierStartGuidance {
  tier: string;
  title: string;
  message: string;
  suggestedTier: string | null;
  availableTiers: Array<{ tier: string; available: number }>;
}

function getAgentSizePresets(
  budget: AgentBudget | null,
): Record<string, { cpu_millicores: number; memory_mib: number }> {
  const source = budget?.size_presets ?? FALLBACK_AGENT_SIZE_PRESETS;
  return Object.fromEntries(
    Object.entries(source).map(([tier, preset]) => [
      tier,
      {
        cpu_millicores: Math.round((preset.cpu || 0) * 1000),
        memory_mib: Math.round((preset.memory || 0) * 1024),
      },
    ]),
  );
}

function inferAgentTier(agent: Pick<Agent, "cpu_millicores" | "memory_mib">, budget: AgentBudget | null): string | null {
  const presets = getAgentSizePresets(budget);
  for (const [tier, preset] of Object.entries(presets)) {
    if (preset.cpu_millicores === agent.cpu_millicores && preset.memory_mib === agent.memory_mib) {
      return tier;
    }
  }
  return null;
}

function describeAgentTierStartGuidance(
  agent: Pick<Agent, "cpu_millicores" | "memory_mib"> | null,
  budget: AgentBudget | null,
): AgentTierStartGuidance | null {
  if (!agent || !budget) return null;
  const tier = inferAgentTier(agent, budget);
  if (!tier) return null;
  const requested = budget.slots?.[tier] ?? { granted: 0, used: 0, available: 0 };
  if (requested.available > 0) return null;

  const requestedLabel = titleizeTier(tier);
  const otherAvailable = Object.entries(budget.slots ?? {})
    .filter(([entryTier, entry]) => entryTier !== tier && (entry?.available ?? 0) > 0)
    .sort(([, left], [, right]) => (right?.available ?? 0) - (left?.available ?? 0));

  if (otherAvailable.length > 0) {
    const [suggestedTier, suggestedEntry] = otherAvailable[0];
    const suggestedLabel = titleizeTier(suggestedTier);
    return {
      tier,
      title: `${requestedLabel} slot required`,
      suggestedTier,
      availableTiers: otherAvailable.map(([entryTier, entry]) => ({
        tier: entryTier,
        available: entry?.available ?? 0,
      })),
      message:
        `This agent was created as a ${requestedLabel} agent. ` +
        `Your account has no free ${requestedLabel} slots, but ${suggestedEntry.available} free ${suggestedLabel} ` +
        `slot${suggestedEntry.available === 1 ? "" : "s"} available. Create a new ${suggestedLabel} agent to use the capacity you already bought.`,
    };
  }

  if (requested.granted > 0) {
    return {
      tier,
      title: `${requestedLabel} slots are fully used`,
      suggestedTier: null,
      availableTiers: [],
      message:
        `This agent was created as a ${requestedLabel} agent. ` +
        `All ${requestedLabel} slots on this account are currently in use. Stop another ${requestedLabel} agent or buy another ${requestedLabel} bundle to launch it.`,
    };
  }

  return {
    tier,
    title: `${requestedLabel} slot required`,
    suggestedTier: null,
    availableTiers: [],
    message:
      `This agent was created as a ${requestedLabel} agent. ` +
      `Your account does not currently include any ${requestedLabel} slots. Buy a ${requestedLabel} bundle to launch it.`,
  };
}

function parseEntitlementSlotTier(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const quotedMatch = message.match(/No available '([^']+)' entitlement slots/i);
  if (quotedMatch?.[1]) return quotedMatch[1].toLowerCase();
  const plainMatch = message.match(/No available ([a-z-]+) entitlement slots/i);
  if (plainMatch?.[1]) return plainMatch[1].toLowerCase();
  return null;
}

function describeAgentsPageError(error: unknown): { message: string; clusterUnavailable: boolean } {
  const fallback = "Failed to load agents";
  const raw = error instanceof Error ? error.message : String(error ?? fallback);
  const normalized = raw.trim();
  if (normalized.includes("Agent cluster is not assigned")) {
    return {
      clusterUnavailable: true,
      message: "Agent cluster assignment is still pending for this account. Try again in a minute.",
    };
  }
  return {
    clusterUnavailable: false,
    message: normalized || fallback,
  };
}

function extractVoicePathFromMessage(content: string): string | null {
  const absoluteMatch = content.match(/\/home\/ubuntu\/workspace\/voice-[\w.-]+\.webm\b/i);
  if (absoluteMatch?.[0]) return absoluteMatch[0];
  const fileMatch = content.match(/\bvoice-[\w.-]+\.webm\b/i);
  if (!fileMatch?.[0]) return null;
  return `/home/ubuntu/workspace/${fileMatch[0]}`;
}

// Shell now routes through backend WebSocket via lagoon → K8s exec

function stateClass(state: AgentState): string {
  switch (state) {
    case "RUNNING": return "bg-[#38D39F]/10 text-[#38D39F]";
    case "FAILED": return "bg-[#d05f5f]/10 text-[#d05f5f]";
    case "STOPPED": return "bg-surface-low text-text-muted";
    default: return "bg-[#f0c56c]/15 text-[#f0c56c]";
  }
}

function AgentStateBadge({
  state,
  pulsing = false,
}: {
  state: AgentState;
  pulsing?: boolean;
}) {
  const badgeClass =
    state === "RUNNING"
      ? "border-[#38D39F] text-[#38D39F] bg-background/90"
      : state === "FAILED"
        ? "border-[#d05f5f] text-[#d05f5f] bg-background/90"
        : state === "STOPPED"
          ? "border-[#f0c56c] text-[#f0c56c] bg-background/90"
          : "border-[#f0c56c] text-[#f0c56c] bg-background/90";

  const Icon =
    state === "RUNNING"
      ? Play
      : state === "FAILED"
        ? X
        : state === "STOPPED"
          ? Square
          : Loader2;

  return (
    <div
      className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-background/40 ${badgeClass} ${
        pulsing ? "animate-pulse" : ""
      }`}
    >
      <Icon className={`h-2.5 w-2.5 ${state === "PENDING" || state === "STARTING" || state === "STOPPING" ? "animate-spin" : ""}`} />
    </div>
  );
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

function AgentLaunchPrompt({
  label,
  launching,
  onLaunch,
  blockedTitle,
  blockedMessage,
  suggestedTierActions,
}: {
  label: string;
  launching: boolean;
  onLaunch: () => void;
  blockedTitle?: string | null;
  blockedMessage?: string | null;
  suggestedTierActions?: Array<{ label: string; onSelect: () => void }> | null;
}) {
  const blocked = Boolean(blockedMessage);
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <button
          onClick={onLaunch}
          disabled={launching || blocked}
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-text-muted transition-colors hover:text-foreground disabled:opacity-60"
          aria-label={`Launch agent to use ${label}`}
          title={blockedTitle || "Launch Agent"}
        >
          {launching ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}
        </button>
        <p className="text-base text-foreground">Launch Agent to Use {label}</p>
        <button
          onClick={onLaunch}
          disabled={launching || blocked}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:text-foreground hover:bg-surface-low disabled:opacity-60"
        >
          {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span>Launch Agent</span>
        </button>
        {blockedMessage && (
          <div className="mt-4 rounded-xl border border-[#f0c56c]/20 bg-[#f0c56c]/10 px-4 py-3 text-left">
            <p className="text-sm font-medium text-[#f0c56c]">{blockedTitle || "Launch blocked"}</p>
            <p className="mt-1 text-sm text-text-secondary">{blockedMessage}</p>
            {suggestedTierActions && suggestedTierActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedTierActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.onSelect}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-sm text-text-muted">Files remain available while stopped.</p>
      </div>
    </div>
  );
}

function ConnectionStatusIndicator({
  status,
}: {
  status: "connected" | "connecting" | "disconnected";
}) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium min-w-[5.25rem] ${
        connected
          ? "text-[#38D39F]"
          : connecting
            ? "text-[#f0c56c]"
            : "text-text-muted"
      }`}
      title={connected ? "Connected" : connecting ? "Connecting" : "Disconnected"}
    >
      {connecting ? (
        <Loader2 className="w-2 h-2 animate-spin" />
      ) : (
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-[#38D39F]" : "bg-text-muted"
          }`}
        />
      )}
      <span>
        {connected ? "Connected" : connecting ? "Connecting" : "Disconnected"}
      </span>
    </span>
  );
}

function TabLoadingState({
  label,
}: {
  label: string;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-[#0c1016] text-[#8b95a6]">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin" />
        <div className="space-y-1">
          <p className="text-sm text-[#d8dde7]">{label}</p>
          <p className="text-xs text-[#8b95a6]">Establishing connection...</p>
        </div>
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

function getOpenClawUiHint(
  schemaBundle: OpenClawConfigSchemaResponse | null,
  path: string[],
): OpenClawConfigUiHint | null {
  return resolveOpenClawConfigUiHint(schemaBundle, path.join("."))?.hint ?? null;
}

function sortOpenClawEntries(
  entries: Array<[string, unknown]>,
  schemaBundle: OpenClawConfigSchemaResponse | null,
  basePath: string[] = [],
): Array<[string, unknown]> {
  return [...entries].sort(([leftKey], [rightKey]) => {
    const leftHint = getOpenClawUiHint(schemaBundle, [...basePath, leftKey]);
    const rightHint = getOpenClawUiHint(schemaBundle, [...basePath, rightKey]);
    const leftOrder = typeof leftHint?.order === "number" ? leftHint.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof rightHint?.order === "number" ? rightHint.order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftLabel = leftHint?.label?.trim() || humanizeKey(leftKey);
    const rightLabel = rightHint?.label?.trim() || humanizeKey(rightKey);
    return leftLabel.localeCompare(rightLabel);
  });
}

function isHiddenEntry(name: string): boolean {
  return name.startsWith(".");
}

function describeFileBrowserError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (message.startsWith("Path is a directory:")) {
    return "Cannot download a directory. Open it in the file browser instead.";
  }
  return message;
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
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const loadFiles = useCallback(async (targetPrefix: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const entries = await createAgentClient(token).filesList(agentId, targetPrefix);
      setPrefix(targetPrefix);
      setDirectories(entries.filter((entry) => entry?.type === "directory"));
      setFiles(entries.filter((entry) => entry?.type !== "directory"));
      setTruncated(false);
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

  const goToPrefix = useCallback((nextPrefix: string, options?: { push?: boolean }) => {
    setPrefix(nextPrefix);
    if (options?.push === false) return;
    setHistory((current) => {
      const head = current.slice(0, historyIndex + 1);
      if (head[head.length - 1] === nextPrefix) return head;
      return [...head, nextPrefix];
    });
    setHistoryIndex((current) => {
      if (history[historyIndex] === nextPrefix) return current;
      return current + 1;
    });
  }, []);

  const goBack = useCallback(() => {
    if (historyIndex === 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setPrefix(history[nextIndex] || "");
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setPrefix(history[nextIndex] || "");
  }, [history, historyIndex]);

  const uploadFiles = useCallback(async (uploadList: FileList) => {
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      for (const file of Array.from(uploadList)) {
        const uploadPath = `${prefix}${file.name}`;
        await agentClient.fileWriteBytes(agentId, uploadPath, await file.arrayBuffer());
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
      const content = await createAgentClient(token).fileReadBytes(agentId, path);
      downloadBrowserFile(content, path.split("/").filter(Boolean).pop() || "download");
    } catch (e: unknown) {
      setError(describeFileBrowserError(e, "Download failed"));
    }
  }, [agentId, getToken]);

  const deleteFile = useCallback(async (path: string) => {
    setError(null);
    try {
      const token = await getToken();
      await createAgentClient(token).fileDelete(agentId, path);
      await loadFiles(prefix);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPendingDelete(null);
    }
  }, [agentId, getToken, loadFiles, prefix]);

  const pathParts = prefix.split("/").filter(Boolean);
  const hiddenDirectoryCount = directories.filter((dir) => isHiddenEntry(dir.name)).length;
  const hiddenFileCount = files.filter((file) => isHiddenEntry(file.name)).length;
  const hiddenEntryCount = hiddenDirectoryCount + hiddenFileCount;

  return (
    <div
      className={`relative h-full flex flex-col ${dragActive ? "bg-surface-low/10" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setDragActive(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setDragActive(false);
        if (event.dataTransfer.files?.length) {
          void uploadFiles(event.dataTransfer.files);
        }
      }}
    >
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete File"
        message={pendingDelete ? `Delete "${pendingDelete.name}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteFile(pendingDelete.path);
        }}
      />
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[#38D39F]/50 bg-[#38D39F]/8">
          <div className="rounded-xl border border-border bg-background/95 px-4 py-3 text-center shadow-lg backdrop-blur">
            <p className="text-sm font-medium text-foreground">Drop files to upload</p>
            <p className="mt-1 text-xs text-text-muted">Files will be uploaded into the current folder.</p>
          </div>
        </div>
      )}
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
        {hiddenEntryCount > 0 && (
          <span className="rounded-full border border-border bg-surface-low px-2 py-1 text-[11px] text-text-muted">
            {hiddenEntryCount} hidden
          </span>
        )}
        <div className="flex-1" />
        <p className="text-xs text-text-muted">Uploaded files sync to workspace on agent restart.</p>
      </div>

      <div className="flex items-center gap-3 border-b border-border bg-surface-low px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto font-mono text-sm text-text-secondary">
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            className="rounded border border-border px-2 py-0.5 text-xs hover:text-foreground disabled:opacity-40 disabled:hover:text-text-muted"
            title="Back"
          >
            {"<"}
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            className="rounded border border-border px-2 py-0.5 text-xs hover:text-foreground disabled:opacity-40 disabled:hover:text-text-muted"
            title="Forward"
          >
            {">"}
          </button>
          <button
            onClick={() => goToPrefix("")}
            className="flex items-center gap-1 whitespace-nowrap text-foreground hover:text-foreground/80"
            title="/home/ubuntu"
          >
            <House className="h-3.5 w-3.5" />
          </button>
          {pathParts.map((part, idx) => {
            const partPrefix = `${pathParts.slice(0, idx + 1).join("/")}/`;
            return (
              <span key={partPrefix} className="flex items-center gap-1 whitespace-nowrap">
                <span className="text-text-muted">/</span>
                <button onClick={() => goToPrefix(partPrefix)} className="text-foreground hover:text-foreground/80">{part}</button>
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void loadFiles(prefix)}
            disabled={loading}
            className="px-3 py-1 rounded text-xs border border-border text-foreground hover:bg-background disabled:opacity-50 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1 rounded text-xs border border-border text-foreground hover:bg-background disabled:opacity-50 flex items-center gap-1"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </button>
        </div>
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
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-low text-left ${
                    isHiddenEntry(dir.name) ? "opacity-80" : ""
                  }`}
                >
                  <FolderOpen className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-foreground font-mono flex-1">{dir.name}</span>
                  {isHiddenEntry(dir.name) && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                      hidden
                    </span>
                  )}
                </button>
              );
            })}

            {files.map((file) => (
              <div
                key={`file-${file.path}`}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-low ${
                  isHiddenEntry(file.name) ? "opacity-80" : ""
                }`}
              >
                <FileText className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-foreground font-mono flex-1">{file.name}</span>
                {isHiddenEntry(file.name) && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    hidden
                  </span>
                )}
                <span className="text-xs text-text-muted w-24 text-right">{formatFileSize(file.size)}</span>
                <button
                  onClick={() => void downloadFile(file.path)}
                  className="text-text-muted hover:text-foreground p-1"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPendingDelete({ path: file.path, name: file.name })}
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

            {hiddenEntryCount > 0 && directories.length + files.length === hiddenEntryCount && (
              <div className="px-2 py-3 text-center text-xs text-text-muted">
                This directory currently only contains hidden entries.
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
  const { getToken } = useAgentAuth();
  const router = useRouter();
  const { setAgentMenu } = useDashboardMobileAgentMenu();
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Agent data
  const [agents, setAgents] = useState<Agent[]>([]);
  const [budget, setBudget] = useState<AgentBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [recentlyStoppedIds, setRecentlyStoppedIds] = useState<Set<string>>(new Set());
  const stoppedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);

  useEffect(() => {
    return () => { stoppedTimersRef.current.forEach((t) => clearTimeout(t)); };
  }, []);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createDialogInitialStep, setCreateDialogInitialStep] = useState(0);
  const [createDialogPreferredTier, setCreateDialogPreferredTier] = useState<string | null>(null);
  const gatewayTokensRef = useRef<Record<string, string>>({});
  const [pendingAgentDelete, setPendingAgentDelete] = useState<{ id: string; name: string } | null>(null);

  // Selection and tabs
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("chat");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [mobileAgentMenuOpen, setMobileAgentMenuOpen] = useState(false);

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

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktopViewport(mediaQuery.matches);
    apply();
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, []);

  // Settings tab state
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [agentClusterUnavailable, setAgentClusterUnavailable] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [openclawDraft, setOpenclawDraft] = useState<JsonObject | null>(null);
  const [openclawSaving, setOpenclawSaving] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);
  const [openclawSuccess, setOpenclawSuccess] = useState<string | null>(null);
  const [activeOpenclawSection, setActiveOpenclawSection] = useState<string | null>(null);
  const [mobileOpenclawMenuOpen, setMobileOpenclawMenuOpen] = useState(true);
  const [openclawMapDraftKeys, setOpenclawMapDraftKeys] = useState<Record<string, string>>({});
  const [chatDragActive, setChatDragActive] = useState(false);
  const openclawPaneRef = useRef<HTMLDivElement | null>(null);
  const chatDragDepthRef = useRef(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch agents ──
  const selectedAgentIdRef = useRef(selectedAgentId);
  useEffect(() => { selectedAgentIdRef.current = selectedAgentId; }, [selectedAgentId]);

  const fetchAgents = useCallback(async () => {
    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const [listedAgents, budgetData] = await Promise.all([
        agentApiFetch<AgentListResponse | AgentListItem[]>("/deployments", token),
        agentClient.budget().catch(() => null),
      ]);
      const rawItems: AgentListItem[] = Array.isArray(listedAgents) ? listedAgents : listedAgents.items || [];
      const items = rawItems.map((agent) => ({
        id: agent.id,
        name: agent.name || agent.id,
        user_id: agent.user_id,
        pod_id: agent.pod_id || null,
        pod_name: agent.pod_name || null,
        state: (agent.state || "STOPPED").toUpperCase() as AgentState,
        cpu_millicores: Math.round((agent.cpu || 0) * 1000),
        memory_mib: Math.round((agent.memory || 0) * 1024),
        hostname: agent.hostname ?? null,
        started_at: agent.started_at ?? null,
        stopped_at: agent.stopped_at ?? null,
        last_error: agent.last_error ?? null,
        created_at: agent.created_at ?? null,
        updated_at: agent.updated_at ?? null,
        openclaw_url: agent.openclaw_url ?? null,
        gatewayToken: agent.gatewayToken ?? null,
        meta: agent.meta ?? null,
      }));
      setAgents(items);
      setBudget((budgetData as AgentBudget | null) || null);
      setAgentClusterUnavailable(false);
      const currentId = selectedAgentIdRef.current;
      if (!currentId && items.length > 0) {
        setSelectedAgentId(items[0].id);
      }
      if (currentId && !items.find((item) => item.id === currentId)) {
        setSelectedAgentId(items[0]?.id || null);
      }
    } catch (err) {
      const described = describeAgentsPageError(err);
      setError(described.message);
      setAgentClusterUnavailable(described.clusterUnavailable);
      setAgents([]);
      setBudget(null);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

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

  const selectedAgent = useMemo(() => {
    const agent = agents.find((item) => item.id === selectedAgentId) || null;
    if (agent && !agent.gatewayToken) {
      const token = gatewayTokensRef.current[agent.id] || getGatewayToken(agent.id);
      if (token) return { ...agent, gatewayToken: token };
    }
    return agent;
  }, [agents, selectedAgentId]);
  const selectedAgentHostname = selectedAgent?.hostname || null;
  const selectedAgentState = selectedAgent?.state ?? null;
  const isSelectedTransitioning = selectedAgent && ["PENDING", "STARTING"].includes(selectedAgent.state);
  const isSelectedRunning = selectedAgent?.state === "RUNNING";
  const selectedAgentTier = useMemo(
    () => (selectedAgent ? inferAgentTier(selectedAgent, budget) : null),
    [selectedAgent, budget],
  );
  const selectedAgentStartGuidance = useMemo(
    () =>
      selectedAgent && (selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED")
        ? describeAgentTierStartGuidance(selectedAgent, budget)
        : null,
    [selectedAgent, budget],
  );
  const stoppedTabLabel: Record<Exclude<MainTab, "files">, string> = {
    chat: "Chat",
    logs: "Logs",
    shell: "Shell",
    workspace: "Workspace",
    openclaw: "OpenClaw",
    integrations: "Integrations",
    settings: "Settings",
  };
  const agentTabItems: Array<{ key: MainTab; label: string; icon: typeof MessageSquare }> = [
    { key: "chat", label: "Chat", icon: MessageSquare },
    { key: "logs", label: "Logs", icon: TerminalSquare },
    { key: "shell", label: "Shell", icon: TerminalSquare },
    { key: "files", label: "Files", icon: HardDrive },
    { key: "workspace", label: "Workspace", icon: FolderOpen },
    { key: "openclaw", label: "OpenClaw", icon: SlidersHorizontal },
    { key: "integrations", label: "Integrations", icon: Plug },
    { key: "settings", label: "Settings", icon: Settings },
  ];
  const dashboardNavItems: Array<{ label: string; href: string; icon: typeof Bot }> = [
    { label: "Overview", href: "/dashboard", icon: Bot },
    { label: "Agents", href: "/agents", icon: Bot },
    { label: "API Keys", href: "/keys", icon: Key },
    { label: "Plans", href: "/plans", icon: CreditCard },
    { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
    { label: "Settings", href: "/dashboard/settings", icon: Settings },
  ];

  // Sync settings fields when selected agent changes
  useEffect(() => {
    if (selectedAgent) {
      setSettingsName(selectedAgent.name || "");
      setSettingsDesc(""); // No description field in Agent type yet
    }
  }, [selectedAgentId]);

  useEffect(() => {
    setMobileAgentMenuOpen(false);
  }, [mainTab, selectedAgentId, isDesktopViewport]);

  // ── Gateway Chat hook ──
  const chat = useGatewayChat(
    selectedAgent && isSelectedRunning ? selectedAgent : null,
    getToken
  );
  const activeConnectionStatus = useMemo(() => {
    if (mainTab === "files") return "connected" as const;
    if (!isSelectedRunning) return null;
    if (mainTab === "logs") return wsStatus;
    if (mainTab === "shell") return shellStatus;
    if (mainTab === "chat" || mainTab === "workspace" || mainTab === "openclaw" || mainTab === "integrations") {
      if (chat.connected) return "connected" as const;
      if (chat.connecting) return "connecting" as const;
      return "disconnected" as const;
    }
    return null;
  }, [chat.connected, chat.connecting, isSelectedRunning, mainTab, shellStatus, wsStatus]);

  const openclawSchemaBundle = chat.configSchema;
  const openclawSchemaRoot = useMemo(
    () => asObject(openclawSchemaBundle?.schema ?? null),
    [openclawSchemaBundle]
  );
  const openclawSchemaProperties = useMemo(
    () => asObject(openclawSchemaRoot?.properties ?? null),
    [openclawSchemaRoot]
  );

  const openclawSections = useMemo(
    () => sortOpenClawEntries(Object.entries(openclawSchemaProperties ?? {}), openclawSchemaBundle),
    [openclawSchemaBundle, openclawSchemaProperties]
  );

  useEffect(() => {
    const cfg = asObject(chat.config);
    setOpenclawDraft(deepCloneJsonObject(cfg ?? {}));
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

  useEffect(() => {
    if (mainTab !== "openclaw") return;
    openclawPaneRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeOpenclawSection, mainTab]);

  const effectiveOpenclawSection = useMemo(
    () => (isDesktopViewport ? (activeOpenclawSection ?? openclawSections[0]?.[0] ?? null) : activeOpenclawSection),
    [activeOpenclawSection, isDesktopViewport, openclawSections]
  );

  const visibleOpenclawSections = useMemo(() => {
    if (!effectiveOpenclawSection) return openclawSections;
    const selected = openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection);
    return selected ? [selected] : openclawSections;
  }, [effectiveOpenclawSection, openclawSections]);

  const activeOpenclawSectionEntry = useMemo(
    () => openclawSections.find(([sectionKey]) => sectionKey === effectiveOpenclawSection) ?? null,
    [effectiveOpenclawSection, openclawSections]
  );

  const activeOpenclawSectionLabel = useMemo(() => {
    if (!activeOpenclawSectionEntry) return null;
    const [sectionKey, sectionSchema] = activeOpenclawSectionEntry;
    return (
      getOpenClawUiHint(openclawSchemaBundle, [sectionKey])?.label?.trim()
      || (typeof asObject(sectionSchema)?.title === "string"
        ? String(asObject(sectionSchema)?.title)
        : humanizeKey(sectionKey))
    );
  }, [activeOpenclawSectionEntry, openclawSchemaBundle]);

  useEffect(() => {
    if (!isDesktopViewport && mainTab === "openclaw") {
      setMobileOpenclawMenuOpen(true);
    }
  }, [isDesktopViewport, mainTab, selectedAgentId]);

  const updateOpenclawPath = useCallback((path: string[], value: unknown) => {
    setOpenclawDraft((prev) => {
      const base = prev ? deepCloneJsonObject(prev) : {};
      return setPathValue(base, path, value);
    });
  }, []);

  const removeOpenclawPath = useCallback((path: string[]) => {
    setOpenclawDraft((prev) => {
      if (!prev || path.length === 0) return prev;
      const base = deepCloneJsonObject(prev);
      const parentPath = path.slice(0, -1);
      const leafKey = path[path.length - 1];
      const parent = parentPath.length === 0 ? base : getPathValue(base, parentPath);
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
        return base;
      }
      delete (parent as JsonObject)[leafKey];
      return base;
    });
  }, []);

  const addOpenclawMapEntry = useCallback((path: string[], schemaRaw: unknown) => {
    const pathKey = path.join(".");
    const nextKey = (openclawMapDraftKeys[pathKey] ?? "").trim();
    if (!nextKey) return;
    updateOpenclawPath([...path, nextKey], createOpenClawConfigValue(schemaRaw));
    setOpenclawMapDraftKeys((prev) => ({ ...prev, [pathKey]: "" }));
  }, [openclawMapDraftKeys, updateOpenclawPath]);

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

  const renderOpenclawField = useCallback((schemaRaw: unknown, path: string[], depth = 0): React.ReactNode => {
    try {
    const schema = normalizeOpenClawConfigSchemaNode(schemaRaw);
    const descriptor = describeOpenClawConfigNode(schemaRaw);
    const hint = getOpenClawUiHint(openclawSchemaBundle, path);
    const title =
      hint?.label?.trim() ||
      (typeof schema.title === "string" ? schema.title : "") ||
      humanizeKey(path[path.length - 1] || "setting");
    const description =
      hint?.help?.trim() ||
      (typeof schema.description === "string" ? schema.description : "");
    const placeholder =
      hint?.placeholder && hint.placeholder.trim() ? hint.placeholder : undefined;
    const typeRaw = schema.type;
    const type = Array.isArray(typeRaw)
      ? (typeRaw.find((entry) => entry !== "null") as string | undefined)
      : (typeof typeRaw === "string" ? typeRaw : undefined);
    const enumValues: unknown[] = Array.isArray(schema.enum) ? schema.enum : [];
    const currentValue = openclawDraft ? getPathValue(openclawDraft, path) : undefined;
    const key = path.join(".");

    const propertyKeys = descriptor.properties;
    const additionalSchema = descriptor.additionalPropertySchema;
    if (type === "object" || Object.keys(propertyKeys).length > 0 || descriptor.additionalProperties) {
      const entries = Object.keys(propertyKeys).length > 0
        ? sortOpenClawEntries(Object.entries(propertyKeys), openclawSchemaBundle, path)
        : [];
      const dynamicEntries = descriptor.additionalProperties && currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
        ? Object.entries(currentValue as JsonObject).filter(([childKey]) => !(childKey in propertyKeys))
        : [];
      if (entries.length === 0 && dynamicEntries.length === 0 && !descriptor.additionalProperties) {
        // Fallback: render JSON editor for object schemas with no resolved properties (e.g. unresolved $ref)
        if (typeof console !== "undefined") {
          console.warn(`[OpenClaw] Section "${key}" has type "object" but no resolved properties. Schema may contain unresolved $ref.`, schema);
        }
        const onFallbackChange = (raw: string) => {
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
            <textarea
              value={typeof currentValue === "undefined" || currentValue === null ? "{}" : JSON.stringify(currentValue, null, 2)}
              onChange={(e) => onFallbackChange(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={placeholder}
              className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong"
            />
          </div>
        );
      }
      return (
        <div key={key} className={depth > 0 ? "rounded-lg border border-border p-3 space-y-3" : "space-y-3"}>
          {depth > 0 && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {hint?.advanced && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    advanced
                  </span>
                )}
              </div>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          )}
          {entries.map(([childKey, childSchema]) => renderOpenclawField(childSchema, [...path, childKey], depth + 1))}
          {descriptor.additionalProperties && (
            <div className="space-y-3">
              {dynamicEntries.map(([childKey]) => (
                <div key={`${key}-dynamic-${childKey}`} className="rounded-lg border border-border/70 bg-surface-low/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">{childKey}</p>
                    <button
                      type="button"
                      onClick={() => removeOpenclawPath([...path, childKey])}
                      className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-[#d05f5f]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                  {renderOpenclawField(additionalSchema ? { ...additionalSchema, title: childKey } : { title: childKey, type: "object" }, [...path, childKey], depth + 1)}
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-3 md:flex-row md:items-center">
                <input
                  type="text"
                  value={openclawMapDraftKeys[key] ?? ""}
                  onChange={(e) => setOpenclawMapDraftKeys((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`Add ${title.toLowerCase()} key`}
                  className="flex-1 rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border-strong"
                />
                <button
                  type="button"
                  onClick={() => addOpenclawMapEntry(path, additionalSchema ?? { type: "object" })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-low"
                >
                  <Plus className="h-4 w-4" />
                  Add Entry
                </button>
              </div>
            </div>
          )}
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
        <div className="flex flex-wrap items-center gap-2">
          <label className="block text-sm text-text-secondary">{title}</label>
          {hint?.sensitive && (
            <span className="rounded-full border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#d05f5f]">
              sensitive
            </span>
          )}
          {hint?.advanced && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
              advanced
            </span>
          )}
        </div>
        {description && <p className="text-xs text-text-muted">{description}</p>}
        {enumValues.length > 0 ? (
          <select
            value={currentValue == null ? "" : JSON.stringify(currentValue)}
            onChange={(e) => {
              if (!e.target.value) {
                updateOpenclawPath(path, null);
                return;
              }
              const nextValue = enumValues.find((value) => JSON.stringify(value) === e.target.value);
              updateOpenclawPath(path, nextValue ?? e.target.value);
            }}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          >
            <option value="">(unset)</option>
            {enumValues.map((value) => (
              <option key={`${key}-enum-${JSON.stringify(value)}`} value={JSON.stringify(value)}>
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
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        ) : type === "array" || type === "object" ? (
          <textarea
            value={typeof currentValue === "undefined" ? "" : JSON.stringify(currentValue, null, 2)}
            onChange={(e) => onJsonValueChange(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-[#0c1016] border border-border text-[#d8dde7] text-xs font-mono focus:outline-none focus:border-border-strong"
          />
        ) : (
          <input
            type={hint?.sensitive ? "password" : "text"}
            value={typeof currentValue === "string" ? currentValue : currentValue == null ? "" : String(currentValue)}
            onChange={(e) => updateOpenclawPath(path, e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong"
          />
        )}
      </div>
    );
    } catch (err) {
      const key = path.join(".");
      console.error(`[OpenClaw] Failed to render field "${key}":`, err);
      return (
        <div key={key} className="text-xs text-[#d05f5f] p-2 rounded border border-[#d05f5f]/30">
          Failed to render {key}: {err instanceof Error ? err.message : String(err)}
        </div>
      );
    }
  }, [addOpenclawMapEntry, openclawDraft, openclawMapDraftKeys, openclawSchemaBundle, removeOpenclawPath, updateOpenclawPath]);

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

  // Scroll to bottom when user switches back to chat tab.
  // useLayoutEffect runs synchronously after DOM commit (refs are set)
  // but before browser paint, so the user never sees the un-scrolled state.
  useLayoutEffect(() => {
    if (mainTab === "chat" && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [mainTab]);

  // ── Desktop launch bootstrap ──
  const issueAgentAccessToken = useCallback(
    async (agentId: string, hostname: string): Promise<string> => {
      const authToken = await getToken();
      const tokenData = await agentApiFetch<AgentDesktopTokenResponse>(`/deployments/${agentId}/token`, authToken);
      return `https://desktop-${hostname}/_jwt_auth?jwt=${encodeURIComponent(tokenData.token)}`;
    },
    [getToken]
  );

  // ── Logs WebSocket ──
  useEffect(() => {
    if (mainTab !== "logs") { setWsStatus("disconnected"); return; }
    if (!selectedAgentId || selectedAgentState !== "RUNNING") { setWsStatus("disconnected"); setLogs([]); return; }
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
        const liveWs = await createAgentClient(token).logsConnect(agentId, { container: "reef", tailLines: 400 });
        ws = liveWs;
        if (cancelled) {
          liveWs.close();
          return;
        }
        reconnectScheduled = false;
        setWsStatus("connected");
        void fetchAgents();
        liveWs.onmessage = (event) => {
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
        liveWs.onclose = () => { if (!cancelled) scheduleReconnect(); };
        liveWs.onerror = () => { if (!cancelled) scheduleReconnect(); };
      } catch { if (!cancelled) scheduleReconnect(); }
    };
    void connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    };
  }, [mainTab, selectedAgentId, selectedAgentState, getToken, reconnectNonce, fetchAgents]);

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
    if (!selectedAgentId || selectedAgentState !== "RUNNING") { setShellStatus("disconnected"); return; }
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
        const ws = await createAgentClient(authToken).shellConnect(agentId);
        if (cancelled) {
          ws.close();
          return;
        }
        shellWsRef.current = ws;
        reconnectScheduled = false;
        setShellStatus("connected");
        shellFitAddonRef.current?.fit();
        shellTerminalRef.current?.focus();
        const dims = shellFitAddonRef.current?.proposeDimensions();
        if (dims) {
          ws.send(`\x1b[8;${dims.rows};${dims.cols}t`);
        }
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
  }, [mainTab, selectedAgentId, selectedAgentState, reconnectNonce, getToken]);

  // ── Actions ──

  const handleStart = async (agentId: string) => {
    const agent = agents.find((entry) => entry.id === agentId) ?? null;
    const guidance = describeAgentTierStartGuidance(agent, budget);
    if (guidance) {
      setError(guidance.message);
      return;
    }
    setStartingId(agentId);
    setError(null);
    delete gatewayTokensRef.current[agentId];
    removeAgentState(agentId);
    try {
      const token = await getToken();
      const started = await startOpenClawAgent(token, agentId);
      const gwToken = started && typeof started === "object" && "gatewayToken" in started
        ? (started.gatewayToken as string | undefined)
        : undefined;
      if (gwToken) {
        gatewayTokensRef.current[agentId] = gwToken;
        setGatewayToken(agentId, gwToken);
      }
      await fetchAgents();
    } catch (err) {
      const requestedTier = parseEntitlementSlotTier(err);
      if (requestedTier) {
        const fallbackPreset = getAgentSizePresets(budget)[requestedTier];
        const tierGuidance = describeAgentTierStartGuidance(
          agent && inferAgentTier(agent, budget) === requestedTier
            ? agent
            : fallbackPreset
              ? {
                  cpu_millicores: fallbackPreset.cpu_millicores,
                  memory_mib: fallbackPreset.memory_mib,
                }
              : null,
          budget,
        );
        setError(tierGuidance?.message ?? (err instanceof Error ? err.message : "Failed to start agent"));
      } else {
        setError(err instanceof Error ? err.message : "Failed to start agent");
      }
    } finally {
      setStartingId(null);
    }
  };

  const openCreateDialog = useCallback((options?: { initialStep?: number; preferredTier?: string | null }) => {
    setCreateDialogInitialStep(options?.initialStep ?? 0);
    setCreateDialogPreferredTier(options?.preferredTier ?? null);
    setShowCreateDialog(true);
  }, []);

  const closeCreateDialog = useCallback(() => {
    setShowCreateDialog(false);
    setCreateDialogInitialStep(0);
    setCreateDialogPreferredTier(null);
  }, []);
  const selectedAgentSuggestedTierActions = useMemo(
    () =>
      (selectedAgentStartGuidance?.availableTiers ?? []).map((entry) => ({
        label: `Use ${titleizeTier(entry.tier)} (${entry.available} free)`,
        onSelect: () =>
          openCreateDialog({
            initialStep: 1,
            preferredTier: entry.tier,
          }),
      })),
    [selectedAgentStartGuidance, openCreateDialog],
  );

  const handleStop = async (agentId: string) => {
    setStoppingId(agentId);
    setError(null);
    try {
      const token = await getToken();
      await createAgentClient(token).stop(agentId);
      delete gatewayTokensRef.current[agentId];
      removeAgentState(agentId);
      // Cooldown: disable Start for 5s while backend cleans up
      setRecentlyStoppedIds((prev) => new Set(prev).add(agentId));
      const existing = stoppedTimersRef.current.get(agentId);
      if (existing) clearTimeout(existing);
      stoppedTimersRef.current.set(agentId, setTimeout(() => {
        setRecentlyStoppedIds((prev) => { const next = new Set(prev); next.delete(agentId); return next; });
        stoppedTimersRef.current.delete(agentId);
      }, 10000));
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
      const agent = agents.find((entry) => entry.id === agentId);
      const token = await getToken();
      await createAgentClient(token).delete(agentId);
      if (selectedAgentId === agentId) setSelectedAgentId(null);
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeletingId(null);
      setPendingAgentDelete(null);
    }
  };

  const handleSaveName = async () => {
    if (!selectedAgent || selectedAgent.state !== "STOPPED") return;
    const trimmed = settingsName.trim();
    if (!trimmed || trimmed === (selectedAgent.name || "")) return;
    setSavingName(true);
    try {
      const token = await getToken();
      await agentApiFetch(`/deployments/${selectedAgent.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename agent");
    } finally {
      setSavingName(false);
    }
  };

  const handleOpenDesktop = async (agent: Agent) => {
    if (!agent.hostname) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpeningDesktopId(agent.id);
    setError(null);
    try {
      const desktopUrl = new URL(await issueAgentAccessToken(agent.id, agent.hostname));
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
      const voiceMessage = `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${agentPath}\``;
      await createAgentClient(token).fileWriteBytes(selectedAgent.id, uploadPath, await audioBlob.arrayBuffer());
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

  const handleChatFileDrop = useCallback(async (fileList: FileList | File[]) => {
    if (!selectedAgent || !chat.connected) return;

    const files = Array.from(fileList);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    try {
      const token = await getToken();
      const agentClient = createAgentClient(token);
      const uploaded: Array<{ name: string; path: string; type: string }> = [];

      for (const file of files) {
        const uploadPath = `workspace/${file.name}`;
        await agentClient.fileWriteBytes(selectedAgent.id, uploadPath, await file.arrayBuffer());
        uploaded.push({
          name: file.name,
          path: `/home/ubuntu/${uploadPath}`,
          type: file.type,
        });
      }

      if (imageFiles.length > 0) {
        const dt = new DataTransfer();
        imageFiles.forEach((file) => dt.items.add(file));
        chat.addAttachments(dt.files);
      }
      chat.addPendingFiles(uploaded);
    } catch (e) {
      console.error("Chat file upload failed:", e);
      setError(e instanceof Error ? e.message : "File upload failed");
    }
  }, [chat, getToken, selectedAgent]);

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
      onDelete: () => {
        setPendingAgentDelete({
          id: selectedAgent.id,
          name: selectedAgent.name || selectedAgent.id,
        });
      },
      deleting: deletingId === selectedAgent.id,
    });
    return () => setAgentMenu(null);
  }, [selectedAgent, mainTab, deletingId, setAgentMenu]);

  // ── Render ──

  return (
    <div className="h-full min-h-0 w-full flex flex-col overflow-hidden">
      {/* Mobile header + menu (hidden on desktop) */}
      {!isDesktopViewport && (
        <div className="relative flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2 text-xl font-bold">
            <span aria-label="HyperClaw brand">
              <span className="text-foreground">Hyper</span>
              <span className="text-primary">Claw</span>
            </span>
            <span className="text-text-muted font-medium">Agents</span>
          </div>
          <button
            onClick={() => setMobileAgentMenuOpen((open) => !open)}
            className="p-2 rounded-lg border border-border text-text-muted hover:text-foreground hover:bg-surface-low transition-colors"
            aria-label={mobileAgentMenuOpen ? "Close agent menu" : "Open agent menu"}
          >
            {mobileAgentMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>

          {mobileAgentMenuOpen && (
            <div className="absolute right-4 top-[calc(100%-0.25rem)] z-30 w-64 rounded-xl border border-border bg-background shadow-2xl">
              <div className="p-2 space-y-1">
                <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                  Dashboard
                </p>
                {dashboardNavItems.map(({ label, href, icon: Icon }) => (
                  <button
                    key={`mobile-nav-${href}`}
                    onClick={() => {
                      router.push(href);
                      setMobileAgentMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
                <button
                  onClick={() => {
                    openCreateDialog();
                    setMobileAgentMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Agent</span>
                </button>
              </div>
              {selectedAgent && (
                <>
                  <div className="border-t border-border p-2 space-y-1">
                    <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                      Agent
                    </p>
                    {agentTabItems.map(({ key, label, icon: Icon }) => (
                      <button
                        key={`mobile-tab-${key}`}
                        onClick={() => {
                          setMainTab(key);
                          setMobileAgentMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          mainTab === key
                            ? "bg-surface-low text-foreground"
                            : "text-text-muted hover:text-foreground hover:bg-surface-low/70"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-border p-2 space-y-1">
                    {(mainTab === "logs" || mainTab === "shell") && (
                      <button
                        onClick={() => {
                          setReconnectNonce((value) => value + 1);
                          setMobileAgentMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Reconnect</span>
                      </button>
                    )}
                    {isSelectedRunning && selectedAgent.hostname && (
                      <button
                        onClick={() => {
                          void handleOpenDesktop(selectedAgent);
                          setMobileAgentMenuOpen(false);
                        }}
                        disabled={openingDesktopId === selectedAgent.id}
                        className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-foreground hover:bg-surface-low/70 disabled:opacity-60"
                      >
                        {openingDesktopId === selectedAgent.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        <span>Desktop</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setPendingAgentDelete({ id: selectedAgent.id, name: selectedAgent.name || selectedAgent.id });
                        setMobileAgentMenuOpen(false);
                      }}
                      disabled={deletingId === selectedAgent.id}
                      className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:text-[#d05f5f] hover:bg-surface-low/70 disabled:opacity-60"
                    >
                      {deletingId === selectedAgent.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      <span>Delete Agent</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

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
        onClose={closeCreateDialog}
        initialStep={createDialogInitialStep}
        preferredTypeId={createDialogPreferredTier}
        onCreated={(agentId, gwToken) => {
          if (agentId && gwToken) {
            gatewayTokensRef.current[agentId] = gwToken;
            setGatewayToken(agentId, gwToken);
          }
          closeCreateDialog();
          fetchAgents();
        }}
        budget={budget}
      />
      <ConfirmDialog
        open={Boolean(pendingAgentDelete)}
        title="Delete Agent"
        message={
          pendingAgentDelete
            ? `Delete agent "${pendingAgentDelete.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={Boolean(pendingAgentDelete && deletingId === pendingAgentDelete.id)}
        onCancel={() => setPendingAgentDelete(null)}
        onConfirm={() => {
          if (pendingAgentDelete) void handleDelete(pendingAgentDelete.id);
        }}
      />

      {/* Main layout: Sidebar + Panel */}
      <div className="flex flex-1 min-h-0">
        {/* ── Agent Sidebar ── */}
        <div className={`border-r border-border bg-background flex-shrink-0 transition-all duration-200 ${
          sidebarCollapsed
            ? (isDesktopViewport ? "w-16 overflow-hidden" : "w-0 overflow-hidden")
            : (isDesktopViewport ? "w-[280px]" : "w-full")
        } ${mobileShowChat && !isDesktopViewport ? "hidden" : "flex"} flex-col`}>

          {/* Sidebar header */}
          <div className="px-3 h-14 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="text-text-muted transition-colors hover:text-foreground"
                aria-label={sidebarCollapsed ? "Expand agents sidebar" : "Collapse agents sidebar"}
              >
                {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
              {!sidebarCollapsed && <span className="text-xs text-text-muted font-medium uppercase tracking-wider">Agents</span>}
            </div>
            {!sidebarCollapsed && (
              <button onClick={fetchAgents} className="text-text-muted hover:text-foreground transition-colors p-1">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
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
                {agentClusterUnavailable ? (
                  <>
                    <p className="text-text-secondary text-sm mb-1">Agent cluster assignment pending</p>
                    <p className="text-xs text-text-muted mb-4">
                      Your account is not attached to an agent cluster yet, so agent creation is temporarily unavailable.
                    </p>
                    <button
                      onClick={() => void fetchAgents()}
                      className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary text-sm mb-1">No agents yet</p>
                    <p className="text-xs text-text-muted mb-4">Deploy a persistent Linux container with AI capabilities</p>
                    <button
                      onClick={() => openCreateDialog()}
                      className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Create Your First Agent
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div>
                {agents.map((agent) => {
                  const isSelected = selectedAgentId === agent.id;
                  const isRunning = agent.state === "RUNNING";
                  const isTransitioning = ["PENDING", "STARTING", "STOPPING"].includes(agent.state);
                  const avatar = agentAvatar(agent.name || agent.id, agent.meta);
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
                            className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden"
                            style={{ backgroundColor: avatar.bgColor }}
                          >
                            {avatar.imageUrl ? (
                              <img src={avatar.imageUrl} alt={`${agent.name} avatar`} className="w-full h-full object-cover" />
                            ) : (
                              <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                            )}
                          </div>
                          <AgentStateBadge state={agent.state} pulsing={isTransitioning} />
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
                          className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden"
                          style={{ backgroundColor: avatar.bgColor }}
                        >
                          {avatar.imageUrl ? (
                            <img src={avatar.imageUrl} alt={`${agent.name} avatar`} className="w-full h-full object-cover" />
                          ) : (
                            <AvatarIcon className="w-4 h-4" style={{ color: avatar.fgColor }} />
                          )}
                        </div>
                        <AgentStateBadge state={agent.state} pulsing={isTransitioning} />
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

                {/* New Agent row */}
                {sidebarCollapsed ? (
                  <button
                    onClick={() => openCreateDialog()}
                    disabled={agentClusterUnavailable}
                    className="w-full p-3 flex flex-col items-center gap-1 transition-colors hover:bg-surface-low/50 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={agentClusterUnavailable ? "Agent cluster assignment pending" : "New Agent"}
                  >
                    <div className="w-9 h-9 rounded-full border border-dashed border-text-muted flex items-center justify-center">
                      <Plus className="w-4 h-4 text-text-muted" />
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={() => openCreateDialog()}
                    disabled={agentClusterUnavailable}
                    className="w-full p-3 flex items-center gap-3 text-left transition-colors hover:bg-surface-low/50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-full border border-dashed border-text-muted flex items-center justify-center">
                      <Plus className="w-4 h-4 text-text-muted" />
                    </div>
                    <span className="text-sm text-text-bright">New Agent</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Budget bars in sidebar footer (when expanded) */}
          {budget && !sidebarCollapsed && (
            <div className="px-3 py-3 border-t border-border flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">Pooled inference</span>
                <span className="text-text-muted">{formatTokens(budget.pooled_tpd)} / day</span>
              </div>
              {Object.entries(budget.slots || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([tier, entry]) => (
                  <BudgetBar key={tier} label={titleizeTier(tier)} used={entry.used} total={entry.granted} />
                ))}
            </div>
          )}
        </div>

        {/* ── Main Panel ── */}
        <div className={`flex-1 flex-col min-w-0 ${!mobileShowChat && !isDesktopViewport ? "hidden" : "flex"}`}>
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
              <div className="relative px-4 h-14 border-b border-border flex items-center gap-3 min-w-0">
                {/* Mobile back button */}
                <button
                  onClick={() => setMobileShowChat(false)}
                  className={`${isDesktopViewport ? "hidden" : "block"} text-text-muted hover:text-foreground`}
                  aria-label="Show agents list"
                >
                  <PanelLeft className="w-5 h-5" />
                </button>

                {/* Agent name + status */}
                <div className="relative z-10 flex items-center gap-2 min-w-0 flex-shrink-0">
                  {(() => {
                    const avatar = agentAvatar(selectedAgent.name || selectedAgent.id, selectedAgent.meta);
                    const AvatarIcon = avatar.icon;
                    return (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ backgroundColor: avatar.bgColor }}>
                        {avatar.imageUrl ? (
                          <img src={avatar.imageUrl} alt={`${selectedAgent.name} avatar`} className="w-full h-full object-cover" />
                        ) : (
                          <AvatarIcon className="w-3.5 h-3.5" style={{ color: avatar.fgColor }} />
                        )}
                      </div>
                    );
                  })()}
                  <span className="hidden xl:inline text-sm font-semibold text-foreground truncate">
                    {selectedAgent.name || selectedAgent.pod_name}
                  </span>
                  {activeConnectionStatus && <ConnectionStatusIndicator status={activeConnectionStatus} />}
                </div>

                {/* Tabs – absolutely centered so left/right content changes don't shift them */}
                <div className={`${isDesktopViewport ? "flex" : "hidden"} absolute inset-0 items-center justify-center overflow-x-auto pointer-events-none`}>
                  <div className="inline-flex min-w-max rounded-lg border border-border overflow-hidden pointer-events-auto">
                    {agentTabItems.map(({ key, label, icon: Icon }, index) => (
                      <button
                        key={key}
                        onClick={() => setMainTab(key)}
                        className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                          mainTab === key
                            ? "bg-surface-low text-foreground"
                            : "bg-transparent text-text-muted hover:text-foreground"
                        } ${index > 0 ? "border-l border-border" : ""}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Spacer to push right actions to the edge */}
                <div className="flex-1 min-w-0" />

                {/* Right actions */}
                <div className="relative z-10 flex items-center gap-2 flex-shrink-0">
                  <div className={`${isDesktopViewport ? "hidden" : "flex"} items-center gap-1`}>
                    {selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED" ? (
                      <button
                        onClick={() => handleStart(selectedAgent.id)}
                        disabled={
                          startingId === selectedAgent.id ||
                          recentlyStoppedIds.has(selectedAgent.id) ||
                          Boolean(selectedAgentStartGuidance)
                        }
                        className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                        aria-label="Start agent"
                        title={
                          selectedAgentStartGuidance?.title ||
                          (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")
                        }
                      >
                        {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        <span className="hidden xl:inline">Start</span>
                      </button>
                    ) : isSelectedRunning || isSelectedTransitioning ? (
                      selectedAgent.state !== "STOPPING" && (
                        <button
                          onClick={() => handleStop(selectedAgent.id)}
                          disabled={stoppingId === selectedAgent.id}
                          className="px-2 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                          aria-label="Stop agent"
                          title="Stop"
                        >
                          {stoppingId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                          <span className="hidden xl:inline">Stop</span>
                        </button>
                      )
                    ) : null}
                  </div>

                  <div className={`${isDesktopViewport ? "flex" : "hidden"} items-center gap-2`}>
                    <div className="flex items-center gap-1">
                      {selectedAgent.state === "STOPPED" || selectedAgent.state === "FAILED" ? (
                        <button
                          onClick={() => handleStart(selectedAgent.id)}
                          disabled={
                            startingId === selectedAgent.id ||
                            recentlyStoppedIds.has(selectedAgent.id) ||
                            Boolean(selectedAgentStartGuidance)
                          }
                          className="px-2 py-1 rounded text-xs border border-border-medium text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                          aria-label="Start agent"
                          title={
                            selectedAgentStartGuidance?.title ||
                            (recentlyStoppedIds.has(selectedAgent.id) ? "Cleaning up…" : "Start")
                          }
                        >
                          {startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          <span className="hidden xl:inline">Start</span>
                        </button>
                      ) : isSelectedRunning || isSelectedTransitioning ? (
                        selectedAgent.state !== "STOPPING" && (
                          <button
                            onClick={() => handleStop(selectedAgent.id)}
                            disabled={stoppingId === selectedAgent.id}
                            className="px-2 py-1 rounded text-xs border border-border text-foreground hover:bg-surface-low disabled:opacity-60 flex items-center gap-1"
                            aria-label="Stop agent"
                            title="Stop"
                          >
                            {stoppingId === selectedAgent.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                            <span className="hidden xl:inline">Stop</span>
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
                ) : !isSelectedRunning && mainTab !== "files" ? (
                  <AgentLaunchPrompt
                    label={stoppedTabLabel[mainTab as Exclude<MainTab, "files">]}
                    launching={startingId === selectedAgent.id || recentlyStoppedIds.has(selectedAgent.id)}
                    onLaunch={() => { void handleStart(selectedAgent.id); }}
                    blockedTitle={selectedAgentStartGuidance?.title}
                    blockedMessage={selectedAgentStartGuidance?.message}
                    suggestedTierActions={selectedAgentSuggestedTierActions}
                  />
                ) : mainTab === "chat" ? (
                  /* ── Chat Tab ── */
                  <div
                    className={`relative flex h-full min-h-0 flex-col ${chatDragActive ? "bg-surface-low/10" : ""}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!e.dataTransfer.types.includes("Files")) return;
                      chatDragDepthRef.current += 1;
                      setChatDragActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      chatDragDepthRef.current = Math.max(0, chatDragDepthRef.current - 1);
                      if (chatDragDepthRef.current === 0) {
                        setChatDragActive(false);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      chatDragDepthRef.current = 0;
                      setChatDragActive(false);
                      if (e.dataTransfer.files?.length) {
                        void handleChatFileDrop(e.dataTransfer.files);
                      }
                    }}
                  >
                    {chatDragActive && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[#38D39F]/50 bg-[#38D39F]/8">
                        <div className="rounded-xl border border-border bg-background/95 px-4 py-3 text-center shadow-lg backdrop-blur">
                          <p className="text-sm font-medium text-foreground">Drop files into chat</p>
                          <p className="mt-1 text-xs text-text-muted">Images attach inline. Other files upload to the workspace and prepare a prompt.</p>
                        </div>
                      </div>
                    )}
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
                          ? `${API_BASE_URL}/deployments/${selectedAgent.id}/files/${encodePath(voicePath)}`
                          : null;
                        return <ChatMessageBubble key={i} message={msg} inlineAudioUrl={inlineAudioUrl} agentId={selectedAgent?.id} />;
                      })}

                      {chat.sending && chat.messages[chat.messages.length - 1]?.role !== "assistant" && (
                        <ChatThinkingIndicator />
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat input */}
                    <div
                      className="flex-shrink-0 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))] md:p-3"
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
                      {chat.pendingFiles.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {chat.pendingFiles.map((file, i) => (
                            <div
                              key={`${file.name}-${i}`}
                              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-1.5 text-xs text-text-secondary"
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{file.name}</span>
                              <button
                                type="button"
                                onClick={() => chat.removePendingFile(i)}
                                className="text-text-muted transition-colors hover:text-[#d05f5f]"
                                title="Remove attachment"
                              >
                                <X className="h-3.5 w-3.5" />
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
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files?.length) {
                                    void handleChatFileDrop(e.target.files);
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
                              disabled={!chat.connected || chat.sending || (!chat.input.trim() && chat.pendingAttachments.length === 0 && chat.pendingFiles.length === 0)}
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
                  wsStatus !== "connected" ? (
                    <TabLoadingState label={wsStatus === "connecting" ? "Connecting logs" : "Preparing logs"} />
                  ) : (
                    <div ref={logBoxRef} className="h-full overflow-auto bg-[#0c1016] p-4 font-mono text-xs leading-5 text-[#d8dde7]">
                      {logs.length === 0 && (
                        <div className="text-[#8b95a6]">Connected. Waiting for log stream...</div>
                      )}
                      {logs.map((line, idx) => (
                        <div key={`${idx}-${line.slice(0, 32)}`} className="whitespace-pre-wrap break-words">{line}</div>
                      ))}
                    </div>
                  )
                ) : mainTab === "shell" ? (
                  /* ── Shell Tab ── */
                  <div className="relative h-full bg-[#0c1016] p-4">
                    <div ref={shellBoxRef} className={`h-full w-full ${shellStatus === "connected" ? "" : "invisible"}`} />
                    {shellStatus !== "connected" && (
                      <div className="absolute inset-0 p-4">
                        <TabLoadingState label={shellStatus === "connecting" ? "Connecting shell" : "Preparing shell"} />
                      </div>
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
                  <div className={`h-full min-h-0 flex ${isDesktopViewport ? "flex-row" : "flex-col"}`}>
                    {isDesktopViewport ? (
                      <>
                        <aside className="w-[200px] shrink-0 border-r border-border bg-surface-low/20" style={{ minWidth: 160, maxWidth: 260 }}>
                          <div className="h-full overflow-y-auto p-3">
                            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                              Sections
                            </p>
                            <div className="space-y-0.5">
                              {openclawSections.map(([sectionKey, sectionSchema]) => {
                                const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                                const sectionLabel =
                                  sectionHint?.label?.trim() ||
                                  (typeof asObject(sectionSchema)?.title === "string"
                                    ? String(asObject(sectionSchema)?.title)
                                    : humanizeKey(sectionKey));
                                const sectionDescription =
                                  sectionHint?.help?.trim() ||
                                  (typeof asObject(sectionSchema)?.description === "string"
                                    ? String(asObject(sectionSchema)?.description)
                                    : sectionKey);
                                return (
                                  <button
                                    key={`nav-${sectionKey}`}
                                    onClick={() => setActiveOpenclawSection(sectionKey)}
                                    className={`block w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors truncate ${
                                      effectiveOpenclawSection === sectionKey
                                        ? "bg-primary/15 text-foreground font-medium border-l-2 border-primary"
                                        : "text-text-muted hover:text-foreground hover:bg-surface-low/40"
                                    }`}
                                    title={sectionDescription}
                                  >
                                    {sectionLabel}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </aside>

                        <div ref={openclawPaneRef} className="flex-1 min-w-0 overflow-y-auto p-6">
                          <OpenClawErrorBoundary>
                          <div className="mx-auto max-w-5xl space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <h3 className="text-lg font-semibold text-foreground">
                                  {activeOpenclawSectionLabel ?? "OpenClaw Config"}
                                </h3>
                                {openclawSchemaBundle?.version && (
                                  <p className="mt-1 text-xs text-text-muted">
                                    Schema version <span className="font-mono">{openclawSchemaBundle.version}</span>
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => void (effectiveOpenclawSection ? saveOpenclawSection(effectiveOpenclawSection) : saveAllOpenclaw())}
                                disabled={openclawSaving || !chat.connected || !openclawDraft}
                                className="btn-primary px-3 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2"
                              >
                                {openclawSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                                {effectiveOpenclawSection ? "Save Section" : "Save All"}
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
                            {!chat.connected && !chat.connecting && (
                              <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                                Connect the agent gateway to edit OpenClaw settings.
                              </div>
                            )}
                            {chat.connecting && !chat.connected && (
                              <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted inline-flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Connecting to gateway…
                              </div>
                            )}
                            {chat.connected && !openclawSchemaProperties && (
                              <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                                No config schema available from gateway.
                              </div>
                            )}

                            {openclawSchemaProperties && openclawDraft && (
                              <div className="space-y-4">
                                {visibleOpenclawSections.map(([sectionKey, sectionSchema]) => {
                                  const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                                  const sectionDescription =
                                    sectionHint?.help?.trim() ||
                                    (typeof asObject(sectionSchema)?.description === "string"
                                      ? String(asObject(sectionSchema)?.description)
                                      : "");
                                  return (
                                    <div key={`section-${sectionKey}`} className="rounded-xl border border-border bg-surface-low/30 p-4 space-y-4">
                                      {sectionDescription && (
                                        <p className="text-xs text-text-muted">{sectionDescription}</p>
                                      )}
                                      {renderOpenclawField(sectionSchema, [sectionKey])}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          </OpenClawErrorBoundary>
                        </div>
                      </>
                    ) : mobileOpenclawMenuOpen ? (
                      <div className="flex-1 overflow-y-auto p-4">
                        <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface-low/20 p-4">
                          <div className="mb-4">
                            <h3 className="text-lg font-semibold text-foreground">OpenClaw Sections</h3>
                            <p className="mt-1 text-sm text-text-muted">
                              Choose a section to edit.
                            </p>
                          </div>
                          <div className="space-y-1">
                            {openclawSections.map(([sectionKey, sectionSchema]) => {
                              const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                              const sectionLabel =
                                sectionHint?.label?.trim() ||
                                (typeof asObject(sectionSchema)?.title === "string"
                                  ? String(asObject(sectionSchema)?.title)
                                  : humanizeKey(sectionKey));
                              const sectionDescription =
                                sectionHint?.help?.trim() ||
                                (typeof asObject(sectionSchema)?.description === "string"
                                  ? String(asObject(sectionSchema)?.description)
                                  : "");
                              return (
                                <button
                                  key={`mobile-openclaw-${sectionKey}`}
                                  onClick={() => {
                                    setActiveOpenclawSection(sectionKey);
                                    setMobileOpenclawMenuOpen(false);
                                  }}
                                  className="block w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-low/60"
                                >
                                  <div className="text-sm font-medium text-foreground">{sectionLabel}</div>
                                  {sectionDescription && (
                                    <div className="mt-1 text-xs text-text-muted">{sectionDescription}</div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0 overflow-y-auto p-4">
                        <OpenClawErrorBoundary>
                        <div className="mx-auto max-w-xl space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <button
                                onClick={() => setMobileOpenclawMenuOpen(true)}
                                className="mb-3 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-foreground"
                              >
                                <ArrowLeft className="h-4 w-4" />
                                Back
                              </button>
                              <h3 className="text-lg font-semibold text-foreground">
                                {activeOpenclawSectionLabel ?? "OpenClaw Config"}
                              </h3>
                            </div>
                            <button
                              onClick={() => void (effectiveOpenclawSection ? saveOpenclawSection(effectiveOpenclawSection) : saveAllOpenclaw())}
                              disabled={openclawSaving || !chat.connected || !openclawDraft}
                              className="btn-primary px-3 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2"
                            >
                              {openclawSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <SlidersHorizontal className="w-4 h-4" />}
                              {effectiveOpenclawSection ? "Save Section" : "Save All"}
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
                          {!chat.connected && !chat.connecting && (
                            <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                              Connect the agent gateway to edit OpenClaw settings.
                            </div>
                          )}
                          {chat.connecting && !chat.connected && (
                            <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted inline-flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Connecting to gateway…
                            </div>
                          )}
                          {chat.connected && !openclawSchemaProperties && (
                            <div className="rounded-lg border border-border bg-surface-low px-3 py-2 text-sm text-text-muted">
                              No config schema available from gateway.
                            </div>
                          )}

                          {openclawSchemaProperties && openclawDraft && (
                            <div className="space-y-4">
                              {visibleOpenclawSections.map(([sectionKey, sectionSchema]) => {
                                const sectionHint = getOpenClawUiHint(openclawSchemaBundle, [sectionKey]);
                                const sectionDescription =
                                  sectionHint?.help?.trim() ||
                                  (typeof asObject(sectionSchema)?.description === "string"
                                    ? String(asObject(sectionSchema)?.description)
                                    : "");
                                return (
                                  <div key={`section-${sectionKey}`} className="rounded-xl border border-border bg-surface-low/30 p-4 space-y-4">
                                    {sectionDescription && (
                                      <p className="text-xs text-text-muted">{sectionDescription}</p>
                                    )}
                                    {renderOpenclawField(sectionSchema, [sectionKey])}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        </OpenClawErrorBoundary>
                      </div>
                    )}
                  </div>
                ) : mainTab === "integrations" && selectedAgent ? (
                  /* ── Integrations Tab ── */
                  <div className="h-full overflow-y-auto">
                    <IntegrationsPage
                      config={chat.config as Record<string, unknown> | null}
                      configSchema={chat.configSchema}
                      connected={chat.connected}
                      onSaveConfig={async (patch) => { await chat.saveConfig(patch); }}
                      onChannelProbe={async () => chat.channelsStatus(true)}
                    />
                  </div>
                ) : mainTab === "settings" && selectedAgent ? (
                  /* ── Settings Tab ── */
                  <div className="h-full overflow-y-auto p-4 sm:p-6 pb-8">
                    <div className="max-w-2xl w-full mx-auto space-y-8">
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
                                disabled={selectedAgent.state !== "STOPPED"}
                                className={`flex-1 px-3 py-2 rounded-lg bg-surface-low border border-border text-foreground text-sm focus:outline-none focus:border-border-strong ${selectedAgent.state !== "STOPPED" ? "opacity-50 cursor-not-allowed" : ""}`}
                                placeholder="Agent name"
                              />
                              {selectedAgent.state === "STOPPED" && settingsName.trim() && settingsName.trim() !== (selectedAgent.name || "") && (
                                <button
                                  onClick={handleSaveName}
                                  disabled={savingName}
                                  className="flex-shrink-0 px-3 py-2 rounded-lg text-sm bg-[#38D39F] text-[#0a0a0b] font-medium hover:bg-[#38D39F]/90 disabled:opacity-60"
                                >
                                  {savingName ? "Saving..." : "Save"}
                                </button>
                              )}
                            </div>
                            {selectedAgent.state !== "STOPPED" && (
                              <p className="text-xs text-text-muted mt-1">Stop the agent to change its name</p>
                            )}
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
                            <span className="text-sm text-text-tertiary font-mono truncate min-w-0">{selectedAgent.id.slice(0, 12)}...</span>
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
                            <span className="text-sm text-text-tertiary truncate min-w-0">{formatCpu(selectedAgent.cpu_millicores)} · {formatMemory(selectedAgent.memory_mib)}</span>
                          </div>
                          {selectedAgentTier && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-text-secondary">Tier</span>
                              <span className="text-sm text-text-tertiary truncate min-w-0">{titleizeTier(selectedAgentTier)}</span>
                            </div>
                          )}
                          {selectedAgent.hostname && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-text-secondary">Hostname</span>
                              <span className="text-sm text-text-tertiary font-mono truncate min-w-0">{selectedAgent.hostname}</span>
                            </div>
                          )}
                          {selectedAgent.created_at && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-text-secondary">Created</span>
                              <span className="text-sm text-text-tertiary">{new Date(selectedAgent.created_at).toLocaleDateString()}</span>
                            </div>
                          )}
                          {selectedAgentStartGuidance && (
                            <div className="rounded-lg border border-[#f0c56c]/20 bg-[#f0c56c]/10 px-3 py-2 text-sm">
                              <p className="font-medium text-[#f0c56c]">{selectedAgentStartGuidance.title}</p>
                              <p className="mt-1 text-text-secondary">{selectedAgentStartGuidance.message}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Danger Zone */}
                      <div>
                        <h3 className="text-lg font-semibold text-[#d05f5f] mb-4">Danger Zone</h3>
                        <div className="border border-[#d05f5f]/20 rounded-lg p-4 space-y-3">
                          {selectedAgent.state === "RUNNING" && (
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">Stop Agent</p>
                                <p className="text-xs text-text-muted">Stop the running agent container</p>
                              </div>
                              <button
                                onClick={() => handleStop(selectedAgent.id)}
                                disabled={stoppingId === selectedAgent.id}
                                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm border border-border text-foreground hover:bg-surface-low disabled:opacity-60"
                              >
                                {stoppingId === selectedAgent.id ? "Stopping..." : "Stop"}
                              </button>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">Delete Agent</p>
                              <p className="text-xs text-text-muted">Permanently delete this agent and all its data</p>
                            </div>
                            <button
                              onClick={() => setPendingAgentDelete({ id: selectedAgent.id, name: selectedAgent.name || selectedAgent.id })}
                              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-sm border border-[#d05f5f]/30 text-[#d05f5f] hover:bg-[#d05f5f]/10"
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
