// Buzz coding runtimes expose the hyper-acp introspection stream as their
// primary surface; the activity timeline is the natural landing view. Shell
// remains available as a separate tab for these runtimes.
const ACTIVITY_PRIMARY_RUNTIMES = new Set([
  "opencode",
  "codex",
  "claude-code",
  "goose",
  "kimi-code",
]);

export type AgentPrimarySurface = "chat" | "shell" | "activity";

export function agentPrimarySurface(runtime: string | null | undefined): AgentPrimarySurface {
  const normalized = runtime?.trim().toLowerCase() ?? "";
  return ACTIVITY_PRIMARY_RUNTIMES.has(normalized) ? "activity" : "chat";
}
