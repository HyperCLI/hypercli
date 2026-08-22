export type LauncherAgentType = "openclaw" | "hermes";

export const DEFAULT_LAUNCHER_AGENT_TYPE: LauncherAgentType = "openclaw";

export function normalizeLauncherAgentType(value: unknown): LauncherAgentType {
  return value === "hermes" ? "hermes" : DEFAULT_LAUNCHER_AGENT_TYPE;
}

export function isHermesAgentRuntime(runtime: string | null | undefined): boolean {
  return runtime === "hermes-agent";
}

export function launcherAgentTypeForRuntime(runtime: string | null | undefined): LauncherAgentType {
  return isHermesAgentRuntime(runtime) ? "hermes" : DEFAULT_LAUNCHER_AGENT_TYPE;
}
