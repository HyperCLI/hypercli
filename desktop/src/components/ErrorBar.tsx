import { useEffect, useState } from "react";
import { AlertTriangle, PlugZap, RotateCw, ShieldAlert, WifiOff, X } from "lucide-react";
import {
  dismissConnectionIssue,
  subscribeConnectionIssues,
  type ConnectionIssue,
  type ConnectionIssueKind,
} from "../lib/connection-errors";
import { originLockStatus } from "../lib/origin-lock";
import type { AgentSummary } from "../api";

const ICONS: Record<ConnectionIssueKind, typeof AlertTriangle> = {
  offline: WifiOff,
  blocked: ShieldAlert,
  socket: PlugZap,
  "origin-lock": ShieldAlert,
  auth: ShieldAlert,
  server: AlertTriangle,
  unknown: AlertTriangle,
};

/** Config problems the user can act on read as warnings; dead ends read as errors. */
const TONE: Record<ConnectionIssueKind, "error" | "warning"> = {
  offline: "warning",
  blocked: "error",
  socket: "error",
  "origin-lock": "warning",
  auth: "warning",
  server: "error",
  unknown: "error",
};

const ORIGIN_LOCK_ID = "origin-lock";

function originLockIssue(agent: AgentSummary | null): ConnectionIssue | null {
  if (!agent) return null;
  const status = originLockStatus(agent.launchConfig ?? null);
  if (!status.locked || status.authorized) return null;

  const allowed = status.allowed.join(", ");
  return status.expressible
    ? {
        id: ORIGIN_LOCK_ID,
        kind: "origin-lock",
        title: `This app isn't authorised to control ${agent.name}`,
        detail:
          `${agent.name} only accepts control from ${allowed}, but this app is running at ${status.current}. ` +
          "That list is written when the agent starts, so it still names whichever app started it last.",
        hint: "Restarting the agent re-authorises it for this app. Anything running inside the agent keeps going.",
        agentId: agent.id,
        at: Date.now(),
        action: { label: "Restart agent", kind: "restart-agent", agentId: agent.id },
      }
    : {
        id: ORIGIN_LOCK_ID,
        kind: "origin-lock",
        title: `This app can't authorise itself to control ${agent.name}`,
        detail:
          `${agent.name} only accepts control from ${allowed}. This app runs at ${status.current}, ` +
          "whose scheme can't be recorded in the agent's allow-list.",
        hint: "Restarting won't help on this platform. Control the agent from the web console, or ask for tauri:// origins to be supported.",
        agentId: agent.id,
        at: Date.now(),
      };
}

export default function ErrorBar({
  agent,
  onRestartAgent,
  onOpenSettings,
  onRetry,
}: {
  agent: AgentSummary | null;
  onRestartAgent?: (agentId: string) => void;
  onOpenSettings?: () => void;
  /**
   * `agentId` is the one the issue named, when it named one — a lifecycle
   * failure retries on that agent's machine, everything else on the session.
   */
  onRetry?: (agentId?: string) => void;
}) {
  const [reported, setReported] = useState<ConnectionIssue[]>([]);
  const [dismissedOriginLock, setDismissedOriginLock] = useState<string | null>(null);

  useEffect(() => subscribeConnectionIssues(setReported), []);

  // A different agent is a different lock; un-dismiss so it can be shown again.
  useEffect(() => {
    setDismissedOriginLock(null);
  }, [agent?.id]);

  const lock = originLockIssue(agent);
  const issues = [
    ...(lock && dismissedOriginLock !== agent?.id ? [lock] : []),
    ...reported,
  ];
  if (issues.length === 0) return null;

  // Cards only — the anchoring surface (absolute overlay below the 44px
  // header) is owned by App.tsx so the update banner shares it.
  return (
    <>
      {issues.map((issue) => {
        const Icon = ICONS[issue.kind];
        const tone = TONE[issue.kind];
        const accent = tone === "error" ? "border-error/40 bg-error-bg" : "border-warning/40 bg-warning-bg";
        const text = tone === "error" ? "text-error" : "text-warning";
        return (
          <div
            key={issue.id}
            role="status"
            className={`error-bar pointer-events-auto flex items-start gap-3 rounded-lg border ${accent} px-3.5 py-2.5 shadow-sm backdrop-blur-sm`}
          >
            <Icon size={15} className={`mt-px shrink-0 ${text}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className={`text-[12px] font-semibold ${text}`}>{issue.title}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-foreground/80">{issue.detail}</div>
              {issue.hint && (
                <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">{issue.hint}</div>
              )}
              {issue.action && (
                <button
                  type="button"
                  onClick={() => {
                    if (issue.action?.kind === "restart-agent" && issue.action.agentId) {
                      onRestartAgent?.(issue.action.agentId);
                    } else if (issue.action?.kind === "open-settings") {
                      onOpenSettings?.();
                    } else if (issue.action?.kind === "retry") {
                      onRetry?.(issue.action.agentId ?? issue.agentId ?? undefined);
                    }
                    if (issue.id === ORIGIN_LOCK_ID) setDismissedOriginLock(agent?.id ?? null);
                    else dismissConnectionIssue(issue.id);
                  }}
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-md border ${
                    tone === "error" ? "border-error/50 hover:bg-error/10" : "border-warning/50 hover:bg-warning/10"
                  } px-2.5 py-1 text-[11px] font-medium transition-colors ${text}`}
                >
                  {issue.action.kind === "retry" && <RotateCw size={11} aria-hidden />}
                  {issue.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                if (issue.id === ORIGIN_LOCK_ID) setDismissedOriginLock(agent?.id ?? null);
                else dismissConnectionIssue(issue.id);
              }}
              className="-mr-1 shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        );
      })}
    </>
  );
}
