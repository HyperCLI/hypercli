import {
  CONNECTOR_IDS,
  CONNECTOR_WORKFLOW_PROMPT_REVISION,
  parseConnectorWorkflow,
  type ConnectorId,
  type ConnectorWorkflow,
} from "@/lib/connector-workflow";

export const CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const CONNECTOR_WORKFLOW_STORAGE_PREFIX = "openclaw.connectorWorkflows.v1";

export interface StoredConnectorWorkflowEntry {
  workflow: ConnectorWorkflow;
  lastCheckedAt: number;
  source: "preloaded" | "generated";
  revision: number;
}

export type StoredConnectorWorkflows = Partial<Record<ConnectorId, StoredConnectorWorkflowEntry>>;

export function connectorWorkflowStorageKey(scopeKey: string): string {
  return `${CONNECTOR_WORKFLOW_STORAGE_PREFIX}:${scopeKey}`;
}

export function readStoredConnectorWorkflows(scopeKey: string): StoredConnectorWorkflows {
  if (!scopeKey || scopeKey === "disconnected" || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(connectorWorkflowStorageKey(scopeKey));
    const parsed = raw ? JSON.parse(raw) as { entries?: Record<string, unknown> } : null;
    if (!parsed?.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) return {};

    const entries: StoredConnectorWorkflows = {};
    for (const connectorId of CONNECTOR_IDS) {
      try {
        const candidate = parsed.entries[connectorId];
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const record = candidate as Record<string, unknown>;
        const workflowRecord = record.workflow;
        const runtimeFingerprint = workflowRecord && typeof workflowRecord === "object" && !Array.isArray(workflowRecord)
          ? (workflowRecord as Record<string, unknown>).runtimeFingerprint
          : null;
        if (typeof runtimeFingerprint !== "string" || !runtimeFingerprint.trim()) continue;
        const lastCheckedAt = record.lastCheckedAt;
        if (typeof lastCheckedAt !== "number" || !Number.isFinite(lastCheckedAt) || lastCheckedAt < 0) continue;
        const normalizedRecord = workflowRecord as Record<string, unknown>;
        const storedSteps = Array.isArray(normalizedRecord.steps)
          ? normalizedRecord.steps.map((step) => {
              if (!step || typeof step !== "object" || Array.isArray(step)) return step;
              const persistedStep = { ...step as Record<string, unknown> };
              delete persistedStep.approvalRequired;
              return persistedStep;
            })
          : normalizedRecord.steps;
        const workflow = parseConnectorWorkflow(JSON.stringify({ ...normalizedRecord, steps: storedSteps }), {
          connectorId,
          runtimeFingerprint,
        });
        const source = record.source === "preloaded" ? "preloaded" : "generated";
        const revision = typeof record.revision === "number" && Number.isInteger(record.revision)
          ? record.revision
          : 0;
        entries[connectorId] = { workflow, lastCheckedAt, source, revision };
      } catch {
        continue;
      }
    }
    return entries;
  } catch {
    return {};
  }
}

export function writeStoredConnectorWorkflows(scopeKey: string, entries: StoredConnectorWorkflows): void {
  if (!scopeKey || scopeKey === "disconnected" || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(connectorWorkflowStorageKey(scopeKey), JSON.stringify({
      version: 1,
      entries,
    }));
  } catch {}
}

export function connectorWorkflowEntryIsFresh(
  entry: StoredConnectorWorkflowEntry | undefined,
  now = Date.now(),
): boolean {
  return Boolean(
    entry &&
    entry.revision === CONNECTOR_WORKFLOW_PROMPT_REVISION &&
    now - entry.lastCheckedAt < CONNECTOR_WORKFLOW_REFRESH_INTERVAL_MS,
  );
}
