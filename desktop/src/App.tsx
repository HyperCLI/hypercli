import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  Archive,
  Cpu,
  MemoryStick,
  Pencil,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  agentMetrics,
  archiveAgent,
  deleteAgent,
  type KeyValidation,
  type LauncherAgent,
  listAgents,
  logout,
  mintApiKey,
  openAgentChat,
  openCreateWindow,
  openSettingsWindow,
  saveApiKey,
  setAgentAvatar,
  startAgent,
  startLogin,
  stopAgent,
  validateKey,
} from "./api";
import Logo from "./Logo";

type Phase =
  | { kind: "loading" }
  | { kind: "disconnected"; detail: string | null }
  | { kind: "connected"; auth: KeyValidation };

const POLL_MS = 15_000;
const METRICS_POLL_MS = 2_000;

interface AgentMetricsSummary {
  cpu?: string;
  memory?: string;
  /** Parsed from `cpu` (a k8s quantity) as vCPU cores. */
  cpuCores?: number;
  /** Parsed from `memory` (a k8s quantity) as bytes. */
  memoryBytes?: number;
}

/** Parses a Kubernetes CPU quantity ("250m", "1", "12345678n") into cores. */
function parseCpuQuantity(value: string): number | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(n|u|m)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  switch (match[2]) {
    case "n":
      return amount / 1e9;
    case "u":
      return amount / 1e6;
    case "m":
      return amount / 1e3;
    default:
      return amount;
  }
}

/** Parses a Kubernetes memory quantity ("20Mi", "1Gi", "1048576") into bytes. */
function parseMemoryQuantity(value: string): number | undefined {
  const match = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffixes: Record<string, number> = {
    Ki: 2 ** 10,
    Mi: 2 ** 20,
    Gi: 2 ** 30,
    Ti: 2 ** 40,
    Pi: 2 ** 50,
    Ei: 2 ** 60,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
  };
  return amount * (match[2] === undefined ? 1 : suffixes[match[2]]);
}

/** Depth-limited search for the first string-valued cpu/memory keys in the
 * backend-owned metrics payload (k8s metrics-server shape). */
function summarizeMetrics(payload: unknown): AgentMetricsSummary {
  const found: AgentMetricsSummary = {};
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (typeof entry === "string" && entry.trim()) {
        if (found.cpu === undefined && (lower === "cpu" || lower === "cpu_usage")) {
          found.cpu = entry;
        } else if (
          found.memory === undefined &&
          (lower === "memory" || lower === "memory_usage")
        ) {
          found.memory = entry;
        }
      } else {
        visit(entry, depth + 1);
      }
      if (found.cpu !== undefined && found.memory !== undefined) return;
    }
  };
  visit(payload, 0);
  found.cpuCores =
    found.cpu === undefined ? undefined : parseCpuQuantity(found.cpu);
  found.memoryBytes =
    found.memory === undefined ? undefined : parseMemoryQuantity(found.memory);
  return found;
}

/** Formats vCPU cores for display, trimming noise ("0.52", "1", "2.5"). */
function formatCores(cores: number): string {
  return `${Math.round(cores * 100) / 100}`;
}

/** Formats bytes as GB with one decimal under 10 GB ("1.6", "8", "12"). */
function formatGigabytes(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 10
    ? `${Math.round(gigabytes)}`
    : `${Math.round(gigabytes * 10) / 10}`;
}

/**
 * Fixed-decimal companions for in-row labels. The variable-precision
 * helpers above shift label widths between rows, which makes the bar
 * tracks misalign; these keep every row's label the same shape.
 */
function formatCoresFixed(cores: number): string {
  return cores.toFixed(1);
}

/** Formats bytes as GB with exactly one decimal ("2.6", "8.0"). */
function formatGigabytesFixed(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function loadBarColor(ratio: number): string {
  if (ratio >= 0.85) return "bg-danger";
  if (ratio >= 0.6) return "bg-warning";
  return "bg-success";
}

function LoadBar({
  icon,
  label,
  ratio,
  value,
  unit,
  detail,
  showPercent = true,
}: {
  icon: ReactNode;
  label: string;
  /** Drives the bar fill (0–1). Undefined renders an empty track. */
  ratio?: number;
  /** Absolute usage text, shown when `showPercent` is false. */
  value: string;
  /** Unit suffix for `value` (kept in its own column so numbers align). */
  unit: string;
  detail: string;
  /** When false, the bar fills from `ratio` but the label shows the absolute
   * `value` instead of a percentage (used when no real limit is reported, so
   * the fallback-scaled fill isn't misread as a true utilization %). */
  showPercent?: boolean;
}) {
  const percent =
    ratio === undefined
      ? undefined
      : Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const labelText = showPercent && percent !== undefined ? `${percent}%` : value;
  const unitText = showPercent && percent !== undefined ? "" : unit;
  return (
    <span
      className="flex w-full items-center gap-1.5"
      title={
        showPercent && percent !== undefined
          ? `${label}: ${detail} (${percent}%)`
          : `${label}: ${detail}`
      }
    >
      <span className="shrink-0 text-ink-dim">{icon}</span>
      <span
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-label={`${label} load`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === undefined ? {} : { "aria-valuenow": percent })}
      >
        {percent !== undefined && (
          <span
            className={`block h-full rounded-full transition-[width] duration-500 ${loadBarColor(ratio ?? 0)}`}
            style={{ width: `${percent}%` }}
          />
        )}
      </span>
      <span className="flex w-[4.5rem] shrink-0 items-baseline whitespace-nowrap text-xs tabular-nums text-ink-dim">
        <span className="shrink-0 text-left">{unitText}</span>
        <span className="ml-auto shrink-0 text-right">{labelText}</span>
      </span>
    </span>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case "running":
      return "bg-success";
    case "creating":
    case "starting":
    case "restoring":
      return "bg-warning animate-pulse";
    case "failed":
      return "bg-danger";
    default:
      return "bg-ink-dim";
  }
}

function AgentRow({
  agent,
  metrics,
  showGraphs,
  onChanged,
}: {
  agent: LauncherAgent;
  metrics?: AgentMetricsSummary;
  showGraphs: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bars normalize against the pod's burst limit when one is reported; the
  // paid claim is never used as a denominator. When no limit is reported we
  // fall back to a reference ceiling so usage still renders a visible fill
  // (proportional to that ceiling) instead of an empty track.
  const cpuCapacity = agent.cpu_limit;
  const memoryCapacity = agent.memory_limit;
  const hasCpuUsage = metrics?.cpuCores !== undefined;
  const hasMemoryUsage = metrics?.memoryBytes !== undefined;
  // Reference ceilings only apply when the pod reports no limit. Chosen so a
  // small idle footprint still shows a modest fill rather than an empty bar.
  const CPU_FALLBACK_CORES = 4;
  const MEMORY_FALLBACK_GB = 8;
  const cpuRatio = hasCpuUsage
    ? cpuCapacity
      ? metrics!.cpuCores! / cpuCapacity
      : metrics!.cpuCores! / CPU_FALLBACK_CORES
    : undefined;
  const memoryRatio = hasMemoryUsage
    ? memoryCapacity
      ? metrics!.memoryBytes! / (memoryCapacity * 1024 ** 3)
      : metrics!.memoryBytes! / (MEMORY_FALLBACK_GB * 1024 ** 3)
    : undefined;

  const cpuText =
    metrics?.cpuCores !== undefined
        ? formatCoresFixed(metrics.cpuCores)
      : metrics?.cpu;
  const memoryText =
    metrics?.memoryBytes !== undefined
      ? formatGigabytesFixed(metrics.memoryBytes)
      : metrics?.memory;

  const act = async (fn: (id: string) => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn(agent.id);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await setAgentAvatar(agent.id, bytes, file.type);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const showBars = showGraphs && (hasCpuUsage || hasMemoryUsage);
  const archived = agent.archived;

  return (
    <div
      className={`group flex w-full flex-col rounded-lg px-3 py-2 ${
        archived ? "opacity-50" : "hover:bg-surface"
      }`}
    >
      <div className="flex w-full items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            void pickAvatar(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy || archived}
          title={archived ? "Archived" : "Set profile picture"}
          className="relative h-8 w-8 shrink-0 disabled:cursor-default"
          onClick={() => fileInputRef.current?.click()}
        >
          <span
            className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-raised text-sm font-semibold text-ink-secondary ${archived ? "grayscale" : ""}`}
          >
            {agent.avatar_url ? (
              <img
                src={agent.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (agent.name.trim().charAt(0) || "?").toUpperCase()
            )}
          </span>
          <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-bg/70 text-ink group-hover:flex">
            <Pencil size={12} />
          </span>
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${stateColor(agent.state)}`}
          />
        </button>
        <button
          type="button"
          disabled={archived}
          title={archived ? "Archived" : undefined}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
          onClick={() => {
            void openAgentChat(agent.id).catch(console.error);
          }}
        >
          <span className="block truncate text-sm font-medium text-ink">
            {agent.name || "Untitled agent"}
          </span>
          <span className="block truncate text-xs text-ink-dim">
            {agent.state}
            {agent.runtime ? ` · ${agent.runtime}` : ""}
            {cpuText && !(showBars && hasCpuUsage) ? ` · ${cpuText} CPU` : ""}
            {memoryText && !(showBars && hasMemoryUsage)
              ? ` · ${memoryText} GB`
              : ""}
          </span>
        </button>
        {agent.can_start && (
          <>
            <button
              type="button"
              disabled={busy}
              title="Start"
              className="rounded-md p-1.5 text-ink-dim hover:bg-raised hover:text-success disabled:opacity-40"
              onClick={() => void act(startAgent)}
            >
              <Play size={14} />
            </button>
            <button
              type="button"
              disabled={busy}
              title="Archive"
              className="rounded-md p-1.5 text-ink-dim hover:bg-raised hover:text-warning disabled:opacity-40"
              onClick={() => void act(archiveAgent)}
            >
              <Archive size={14} />
            </button>
            <button
              type="button"
              disabled={busy}
              title={
                confirmDelete ? "Click again to delete permanently" : "Delete"
              }
              className={`rounded-md p-1.5 disabled:opacity-40 ${
                confirmDelete
                  ? "bg-danger/15 text-danger"
                  : "text-ink-dim hover:bg-raised hover:text-danger"
              }`}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                setConfirmDelete(false);
                void act(deleteAgent);
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
        {agent.can_stop && (
          <button
            type="button"
            disabled={busy}
            title="Stop"
            className="rounded-md p-1.5 text-ink-dim hover:bg-raised hover:text-danger disabled:opacity-40"
            onClick={() => void act(stopAgent)}
          >
            <Square size={13} />
          </button>
        )}
      </div>
      {showBars && (
        <div className="mt-1.5 flex flex-col gap-1.5 pb-0.5">
          {hasCpuUsage && (
            <LoadBar
              icon={<Cpu size={10} />}
              label="CPU"
              ratio={cpuRatio}
              value={cpuText ?? "?"}
              unit="CPU"
              showPercent={Boolean(cpuCapacity)}
              detail={
                cpuCapacity
                  ? `${formatCores(metrics?.cpuCores ?? 0)} of ${formatCores(cpuCapacity)} core${cpuCapacity === 1 ? "" : "s"}`
                  : `${formatCores(metrics?.cpuCores ?? 0)} used — no usage limit reported`
              }
            />
          )}
          {hasMemoryUsage && (
            <LoadBar
              icon={<MemoryStick size={10} />}
              label="RAM"
              ratio={memoryRatio}
              value={memoryText ?? "?"}
              unit="GB"
              showPercent={Boolean(memoryCapacity)}
              detail={
                memoryCapacity
                  ? `${formatGigabytes(metrics?.memoryBytes ?? 0)} of ${formatGigabytesFixed(memoryCapacity)} GB`
                  : `${formatGigabytes(metrics?.memoryBytes ?? 0)} used — no usage limit reported`
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [agents, setAgents] = useState<LauncherAgent[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, AgentMetricsSummary>>({});
  const [windowFocused, setWindowFocused] = useState(true);
  const [showGraphs, setShowGraphs] = useState(true);
  const [pasteKey, setPasteKey] = useState("");
  const [busy, setBusy] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const refreshAuth = useCallback(async () => {
    try {
      const auth = await validateKey();
      setPhase(
        auth.valid
          ? { kind: "connected", auth }
          : { kind: "disconnected", detail: auth.detail },
      );
    } catch (error) {
      setPhase({ kind: "disconnected", detail: String(error) });
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    if (phaseRef.current.kind !== "connected") return;
    try {
      setAgents(await listAgents());
      setAgentsError(null);
    } catch (error) {
      setAgentsError(String(error));
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (phase.kind !== "connected") return;
    void refreshAgents();
    const interval = setInterval(() => void refreshAgents(), POLL_MS);
    return () => clearInterval(interval);
  }, [phase.kind, refreshAgents]);

  // Live metrics for running agents. Polls while the window is focused; the
  // WebView suspends timers when hidden, so the interval would otherwise only
  // fire while the app happened to be visible. We drive the cadence off the
  // window's focus state and refresh immediately on focus.
  const fetchMetrics = useCallback(async () => {
    const running = agentsRef.current.filter((agent) => agent.state === "running");
    if (running.length === 0) {
      setMetrics({});
      return;
    }
    const fetched: Record<string, AgentMetricsSummary> = {};
    await Promise.all(
      running.map(async (agent) => {
        try {
          const summary = summarizeMetrics(await agentMetrics(agent.id));
          if (summary.cpu !== undefined || summary.memory !== undefined) {
            fetched[agent.id] = summary;
          }
        } catch {
          // Metrics are best-effort; a starting agent may have none yet.
        }
      }),
    );
    setMetrics((previous) => {
      const next: Record<string, AgentMetricsSummary> = {};
      for (const agent of running) {
        // Retain the last good sample when a poll fails so the graphs do
        // not disappear on a transient metrics-socket error.
        const summary = fetched[agent.id] ?? previous[agent.id];
        if (summary !== undefined) next[agent.id] = summary;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (phase.kind !== "connected" || !windowFocused) return;
    void fetchMetrics();
    const interval = setInterval(() => void fetchMetrics(), METRICS_POLL_MS);
    return () => clearInterval(interval);
  }, [phase.kind, windowFocused, fetchMetrics]);

  useEffect(() => {
    // Sync the initial focus state so the metrics loop starts correctly when
    // the app launches already-focused (or stays stopped if launched hidden).
    void getCurrentWindow()
      .isFocused()
      .then((focused) => setWindowFocused(focused))
      .catch(() => {});
    const unlisteners = [
      listen<string>("auth-token", (event) => {
        void (async () => {
          try {
            await mintApiKey(event.payload);
            await refreshAuth();
          } catch (error) {
            setPhase({ kind: "disconnected", detail: String(error) });
          }
        })();
      }),
      listen("popup-shown", () => {
        void refreshAuth().then(refreshAgents);
      }),
      listen<LauncherAgent[]>("agents-updated", (event) => {
        if (phaseRef.current.kind === "connected") {
          setAgents(event.payload);
          setAgentsError(null);
        }
      }),
      listen("deployments-invalidated", () => {
        void refreshAgents();
      }),
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
          void refreshAgents();
          void fetchMetrics();
        }
      }),
    ];
    return () => {
      for (const pending of unlisteners) {
        void pending.then((unlisten) => unlisten());
      }
    };
  }, [refreshAuth, refreshAgents, fetchMetrics]);

  const handleLogin = async () => {
    setBusy(true);
    try {
      await startLogin();
    } catch (error) {
      setPhase({ kind: "disconnected", detail: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handlePasteKey = async () => {
    setBusy(true);
    try {
      await saveApiKey(pasteKey);
      setPasteKey("");
      await refreshAuth();
    } catch (error) {
      setPhase({ kind: "disconnected", detail: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setAgents([]);
      await refreshAuth();
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-rule-strong bg-bg/95 text-ink shadow-2xl backdrop-blur-xl">
      <header className="flex items-center justify-between px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-ink">
          <Logo size={16} />
          HyperCLI
        </span>
        <span className="flex items-center gap-1">
          {phase.kind === "connected" && (
            <button
              type="button"
              title={showGraphs ? "Hide load graphs" : "Show load graphs"}
              className={`rounded-md p-1.5 hover:bg-surface ${
                showGraphs ? "text-brand" : "text-ink-dim"
              }`}
              onClick={() => setShowGraphs((value) => !value)}
            >
              <Activity size={14} />
            </button>
          )}
          {phase.kind === "connected" && (
            <button
              type="button"
              title="Settings"
              className="rounded-md p-1.5 text-ink-dim hover:bg-surface hover:text-ink-secondary"
              onClick={() => void openSettingsWindow().catch(console.error)}
            >
              <Settings size={14} />
            </button>
          )}
          {phase.kind === "connected" && (
            <button
              type="button"
              className="text-xs text-ink-dim hover:text-ink-secondary"
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          )}
        </span>
      </header>

      {phase.kind === "loading" && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-dim">
          Loading…
        </div>
      )}

      {phase.kind === "disconnected" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-8 text-center">
          <p className="text-sm text-ink-secondary">
            Sign in to launch and manage your agents.
          </p>
          {phase.detail && (
            <p className="text-xs text-danger">{phase.detail}</p>
          )}
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            onClick={() => void handleLogin()}
          >
            Sign in with browser
          </button>
          <details className="w-full text-left">
            <summary className="cursor-pointer text-xs text-ink-dim hover:text-ink-secondary">
              Use an API key instead
            </summary>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={pasteKey}
                onChange={(event) => setPasteKey(event.target.value)}
                placeholder="hyper_…"
                className="min-w-0 flex-1 rounded-md border border-rule-strong bg-raised px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={busy || !pasteKey.trim()}
                className="rounded-md bg-raised px-3 py-1.5 text-xs hover:bg-rule disabled:opacity-40"
                onClick={() => void handlePasteKey()}
              >
                Save
              </button>
            </div>
          </details>
        </div>
      )}

      {phase.kind === "connected" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {agentsError && (
              <p className="px-3 py-2 text-xs text-danger">{agentsError}</p>
            )}
            {!agentsError && agents.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-dim">
                No agents yet. Create one from the dashboard.
              </p>
            )}
            {[...agents]
              .sort((a, b) => Number(a.archived) - Number(b.archived))
              .map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  metrics={metrics[agent.id]}
                  showGraphs={showGraphs}
                  onChanged={() => void refreshAgents()}
                />
              ))}
          </div>
          <footer className="border-t border-rule px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-sm text-ink-secondary hover:bg-raised"
              onClick={() => void openCreateWindow().catch(console.error)}
            >
              <Plus size={15} /> New Agent
            </button>
            {phase.auth.has_active_plan === false && (
              <p className="mt-1.5 text-center text-xs text-warning">
                No active plan — agent launches may fail.
              </p>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
