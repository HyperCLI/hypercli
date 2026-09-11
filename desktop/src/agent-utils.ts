// Agent vocabulary is owned by ts-sdk (FSM.md rule 5): state names, the
// transitional set, and the inactive set are its predicates. The sets below
// are *views* over them for the two call sites that need membership by raw
// string, so no local copy of the vocabulary can drift from the SDK's.
import {
  AGENT_TRANSITIONAL_STATES,
  isAgentRuntimeInactiveState,
  isAgentTransitionalState,
  type ManagedAgentRuntime,
} from "../../ts-sdk/src/agents.ts";

export const RUNNING = "RUNNING";
export type RuntimeFamily = "openclaw" | "hermes" | "acp" | "generic";
const OPENCLAW_SET: ReadonlySet<ManagedAgentRuntime> = new Set(["openclaw", "openclaw-pro"]);
const HERMES_SET: ReadonlySet<ManagedAgentRuntime> = new Set(["hermes-agent"]);
const ACP_SET: ReadonlySet<ManagedAgentRuntime> = new Set(["opencode", "codex", "claude-code", "goose", "kimi-code", "buzz-agent"]);
export const OPENCLAW_RUNTIMES: ReadonlySet<string> = OPENCLAW_SET;
export const HERMES_RUNTIMES: ReadonlySet<string> = HERMES_SET;
export const ACP_RUNTIMES: ReadonlySet<string> = ACP_SET;
// Derived from the family sets above so a runtime only ever appears once; the
// satisfies pin makes an SDK union member missing from those sets a compile
// error instead of a silent omission.
export const MANAGED_RUNTIMES = [
  "generic",
  ...OPENCLAW_SET,
  ...HERMES_SET,
  ...ACP_SET,
] as const satisfies readonly ManagedAgentRuntime[];
export const TRANSITIONAL = AGENT_TRANSITIONAL_STATES;
export { isAgentTransitionalState, isAgentRuntimeInactiveState };

/** True for a deletion tombstone: the agent ceased to exist; the row did not. */
export function isDeletedState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.toUpperCase() === "DELETED";
}

export function runtimeLabel(runtime: string | null): string {
  if (!runtime) return "agent";
  return runtime.replace(/-/g, " ");
}

export function runtimeFamily(runtime: string | null): RuntimeFamily {
  if (!runtime) return "generic";
  if (OPENCLAW_RUNTIMES.has(runtime)) return "openclaw";
  if (HERMES_RUNTIMES.has(runtime)) return "hermes";
  if (ACP_RUNTIMES.has(runtime)) return "acp";
  return "generic";
}

/**
 * The one rendering of a deployment state anywhere it is shown as a label —
 * the lowercased canonical SDK state. Surfaces must not alias it (the sidebar
 * once showed "booting" for STARTING while the chat header said "Starting…").
 */
export function agentStateLabel(state: string): string {
  return state.toLowerCase();
}
