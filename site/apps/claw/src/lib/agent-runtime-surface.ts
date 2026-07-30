const SHELL_PRIMARY_RUNTIMES = new Set([
  "opencode",
  "codex",
  "claude-code",
  "goose",
  "kimi-code",
]);

export type AgentPrimarySurface = "chat" | "shell";

export function agentPrimarySurface(runtime: string | null | undefined): AgentPrimarySurface {
  const normalized = runtime?.trim().toLowerCase() ?? "";
  return SHELL_PRIMARY_RUNTIMES.has(normalized) ? "shell" : "chat";
}
