import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Play, Plus, Settings, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentMetrics,
  type KeyValidation,
  type LauncherAgent,
  listAgents,
  logout,
  mintApiKey,
  openAgentChat,
  openCreateWindow,
  openSettingsWindow,
  saveApiKey,
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
const METRICS_POLL_MS = 30_000;

interface AgentMetricsSummary {
  cpu?: string;
  memory?: string;
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
  return found;
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
  onChanged,
}: {
  agent: LauncherAgent;
  metrics?: AgentMetricsSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
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
  return (
    <div className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => {
          void openAgentChat(agent.id).catch(console.error);
        }}
      >
        <span className="relative h-8 w-8 shrink-0">
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-raised text-sm font-semibold text-ink-secondary">
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
          <span
            className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${stateColor(agent.state)}`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {agent.name || "Untitled agent"}
          </span>
          <span className="block truncate text-xs text-ink-dim">
            {agent.state}
            {agent.runtime ? ` · ${agent.runtime}` : ""}
            {metrics?.cpu ? ` · ${metrics.cpu} cpu` : ""}
            {metrics?.memory ? ` · ${metrics.memory}` : ""}
          </span>
        </span>
      </button>
      {agent.can_start && (
        <button
          type="button"
          disabled={busy}
          title="Start"
          className="rounded-md p-1.5 text-ink-dim hover:bg-raised hover:text-success disabled:opacity-40"
          onClick={() => void act(startAgent)}
        >
          <Play size={14} />
        </button>
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
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [agents, setAgents] = useState<LauncherAgent[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, AgentMetricsSummary>>({});
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

  // Live metrics for running agents, refreshed on a slower cadence.
  useEffect(() => {
    if (phase.kind !== "connected") return;
    let cancelled = false;
    const fetchMetrics = async () => {
      const running = agentsRef.current.filter((agent) => agent.state === "running");
      const next: Record<string, AgentMetricsSummary> = {};
      await Promise.all(
        running.map(async (agent) => {
          try {
            const summary = summarizeMetrics(await agentMetrics(agent.id));
            if (summary.cpu !== undefined || summary.memory !== undefined) {
              next[agent.id] = summary;
            }
          } catch {
            // Metrics are best-effort; a starting agent may have none yet.
          }
        }),
      );
      if (!cancelled) setMetrics(next);
    };
    void fetchMetrics();
    const interval = setInterval(() => void fetchMetrics(), METRICS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase.kind, agents]);

  useEffect(() => {
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
        if (focused) void refreshAgents();
      }),
    ];
    return () => {
      for (const pending of unlisteners) {
        void pending.then((unlisten) => unlisten());
      }
    };
  }, [refreshAuth, refreshAgents]);

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
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                metrics={metrics[agent.id]}
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
