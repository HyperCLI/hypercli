export type LauncherAgentType = "openclaw" | "hermes";

export const DEFAULT_LAUNCHER_AGENT_TYPE: LauncherAgentType = "openclaw";

export function normalizeLauncherAgentType(value: unknown): LauncherAgentType {
  return value === "hermes" ? "hermes" : DEFAULT_LAUNCHER_AGENT_TYPE;
}

export function isHermesAgentRuntime(runtime: string | null | undefined): boolean {
  return runtime === "hermes-agent";
}

const BUZZ_AGENT_RUNTIMES = new Set([
  "buzz-agent",
  "opencode",
  "codex",
  "claude-code",
  "goose",
  "kimi-code",
]);

export function isBuzzAgentRuntime(runtime: string | null | undefined): boolean {
  return runtime != null && BUZZ_AGENT_RUNTIMES.has(runtime);
}

export function launcherAgentTypeForRuntime(runtime: string | null | undefined): LauncherAgentType {
  return isHermesAgentRuntime(runtime) ? "hermes" : DEFAULT_LAUNCHER_AGENT_TYPE;
}
