// Dev-only debug helpers for the Claw agent bootstrap/launch flow.
// Everything here is a no-op in production builds (see shared-ui debugLog).
import { debugLog } from "@hypercli/shared-ui";

const PREFIX = "[claw]";

/** Log a named state transition: `from -> to` with optional structured detail. */
export function debugTransition(
  scope: string,
  from: string,
  to: string,
  detail?: Record<string, unknown>,
): void {
  debugLog(`${PREFIX}${scope}]`, `${from} -> ${to}`, detail ?? "");
}

/** Log a single observed event inside a scope with optional structured detail. */
export function debugFlow(scope: string, event: string, detail?: Record<string, unknown>): void {
  debugLog(`${PREFIX}${scope}]`, event, detail ?? "");
}

export interface DebugAgentSnapshot {
  id?: string | null;
  name?: string | null;
  handle?: string | null;
  status?: string | null;
  phase?: string | null;
  ready?: boolean | null;
  hostname?: string | null;
}

/**
 * Log the currently observed agent state. Accepts loose shapes on purpose so
 * call sites can pass SDK agents, launch-state rows, or partial views without
 * mapping code that would itself need debugging.
 */
export function debugAgentState(
  scope: string,
  agent: DebugAgentSnapshot | null | undefined,
  extra?: Record<string, unknown>,
): void {
  if (!agent) {
    debugLog(`${PREFIX}${scope}]`, "agent state", { agent: null, ...extra });
    return;
  }
  const source = agent as Record<string, unknown>;
  const hostname =
    agent.hostname ??
    (typeof source.hostname === "string" ? source.hostname : null) ??
    (typeof source.url === "string" ? source.url : null) ??
    (typeof source.gatewayUrl === "string" ? source.gatewayUrl : null) ??
    null;
  debugLog(`${PREFIX}${scope}]`, "agent state", {
    id: agent.id ?? null,
    name: agent.name ?? null,
    handle: agent.handle ?? null,
    status: agent.status ?? null,
    phase: agent.phase ?? null,
    ready: agent.ready ?? null,
    hostname,
    ...extra,
  });
}
