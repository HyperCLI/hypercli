/**
 * Connection failure classification and reporting.
 *
 * The webview swallows the two failures that matter most here. A CORS
 * rejection and a CSP `connect-src` block both surface to JS as an identical,
 * detail-free `TypeError: Failed to fetch` — no status, no body, no reason —
 * and a rejected WebSocket handshake fires a bare `error` event with nothing
 * on it at all. Neither writes anywhere the user can see, so in a packaged
 * build the app simply looks broken.
 *
 * This module turns those into something legible: a classified issue with a
 * plain-English cause and, where we can offer one, an action.
 */

export type ConnectionIssueKind =
  | "offline"
  | "blocked"
  | "socket"
  | "origin-lock"
  | "auth"
  | "server"
  | "unknown";

export interface ConnectionIssueAction {
  label: string;
  /** Resolved by the component that renders the bar. */
  kind: "restart-agent" | "retry" | "open-settings";
  agentId?: string;
}

export interface ConnectionIssue {
  /** Stable per (kind, host, operation) so a reconnect loop reports once. */
  id: string;
  kind: ConnectionIssueKind;
  title: string;
  detail: string;
  /** Shown in smaller type under the detail. */
  hint?: string;
  host?: string | null;
  agentId?: string | null;
  action?: ConnectionIssueAction;
  at: number;
}

export interface ClassifyContext {
  /** Human-readable, e.g. "Load agents" or "Stream agent logs". */
  operation: string;
  /** The URL or host being contacted, when known. */
  url?: string | null;
  agentId?: string | null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The HTTP status an error carries, when it carries one. The SDK's `APIError`
 * carries `statusCode`; ad-hoc throws carry `status`. A 404 is therefore
 * distinguishable from a 401 — callers deciding "not found" from "failed"
 * (api.ts's secret read) must not guess from the catch alone.
 */
export function httpStatusOf(error: unknown): number | null {
  for (const key of ["status", "statusCode"] as const) {
    const value = (error as Record<string, unknown> | null)?.[key];
    if (typeof value === "number") return value;
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/**
 * A fetch that never reached the network. The browser deliberately withholds
 * the reason to avoid leaking cross-origin information, so this is as far as
 * classification can go from JS.
 */
function isOpaqueFetchFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(error.message);
}

export function classifyConnectionError(error: unknown, context: ClassifyContext): ConnectionIssue {
  const host = hostOf(context.url);
  const status = httpStatusOf(error);
  const at = Date.now();
  const base = { host, agentId: context.agentId ?? null, at };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ...base,
      id: "offline",
      kind: "offline",
      title: "You're offline",
      detail: `${context.operation} couldn't run because this machine has no network connection.`,
      hint: "It will work again as soon as you're back online.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      ...base,
      id: `auth:${status}`,
      kind: "auth",
      title: status === 401 ? "Not signed in" : "Not permitted",
      detail: `${context.operation} was rejected by ${host ?? "the API"} (HTTP ${status}).`,
      hint: status === 401 ? "Your API key may have expired or been rotated." : undefined,
      action: { label: "Open settings", kind: "open-settings" },
    };
  }

  if (status !== null && status >= 500) {
    return {
      ...base,
      id: `server:${host ?? "api"}`,
      kind: "server",
      title: "The server had a problem",
      detail: `${context.operation} failed with HTTP ${status} from ${host ?? "the API"}.`,
      action: { label: "Retry", kind: "retry" },
    };
  }

  if (isOpaqueFetchFailure(error)) {
    return {
      ...base,
      id: `blocked:${host ?? "unknown"}`,
      kind: "blocked",
      title: "The app couldn't reach the server",
      detail: host
        ? `${context.operation} was blocked before it left the app. ${host} either did not allow this app's origin, or it is missing from the app's allowed-connections list.`
        : `${context.operation} was blocked before it left the app.`,
      hint: "The browser doesn't say which, by design. This is a packaging or configuration problem, not a network outage.",
      action: { label: "Retry", kind: "retry" },
    };
  }

  return {
    ...base,
    id: `unknown:${context.operation}`,
    kind: "unknown",
    title: `${context.operation} failed`,
    detail: messageOf(error) || "No further detail was reported.",
    action: { label: "Retry", kind: "retry" },
  };
}

/**
 * A WebSocket that never opened. Browsers give no reason here either — the
 * `error` event carries nothing — so the cause is inferred from the target.
 */
export function classifySocketFailure(context: ClassifyContext & { agentName?: string }): ConnectionIssue {
  const host = hostOf(context.url);
  return {
    id: `socket:${host ?? "unknown"}`,
    kind: "socket",
    title: "A live connection was refused",
    detail: `${context.operation} could not open a connection to ${host ?? "the server"}.`,
    hint: "The connection was rejected during the handshake. This is usually the app's allowed-connections list or an expired token.",
    host,
    agentId: context.agentId ?? null,
    at: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Reporting bus. Deliberately tiny: api.ts publishes, the bar subscribes.
// ---------------------------------------------------------------------------

type Listener = (issues: ConnectionIssue[]) => void;

const listeners = new Set<Listener>();
let issues: ConnectionIssue[] = [];

function emit() {
  const snapshot = issues.slice();
  for (const listener of listeners) listener(snapshot);
}

/** Publish an issue. Re-reporting the same `id` refreshes it rather than stacking. */
export function reportConnectionIssue(issue: ConnectionIssue) {
  const existing = issues.findIndex((candidate) => candidate.id === issue.id);
  if (existing === -1) issues = [...issues, issue];
  else issues = issues.map((candidate, index) => (index === existing ? issue : candidate));
  emit();
}

export function reportConnectionError(error: unknown, context: ClassifyContext) {
  reportConnectionIssue(classifyConnectionError(error, context));
}

/** Called when an operation succeeds, so a resolved issue clears itself. */
export function clearConnectionIssue(id: string) {
  if (!issues.some((issue) => issue.id === id)) return;
  issues = issues.filter((issue) => issue.id !== id);
  emit();
}

export function dismissConnectionIssue(id: string) {
  clearConnectionIssue(id);
}

export function clearConnectionIssues() {
  if (issues.length === 0) return;
  issues = [];
  emit();
}

export function subscribeConnectionIssues(listener: Listener): () => void {
  listeners.add(listener);
  listener(issues.slice());
  return () => {
    listeners.delete(listener);
  };
}
