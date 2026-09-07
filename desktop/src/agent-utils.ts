export const RUNNING = "RUNNING";
export type RuntimeFamily = "openclaw" | "hermes" | "acp" | "generic";
export const OPENCLAW_RUNTIMES = new Set(["openclaw", "openclaw-pro"]);
export const HERMES_RUNTIMES = new Set(["hermes-agent"]);
export const ACP_RUNTIMES = new Set(["opencode", "codex", "claude-code", "goose", "kimi-code", "buzz-agent"]);
export const TRANSITIONAL = new Set([
  "CREATING",
  "STARTING",
  "RESTORING",
  "STOPPING",
  "ARCHIVING",
]);

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
