/**
 * Claw agent UIs should talk to the OpenClaw gateway through the agent-scoped
 * main session, not the bare global "main" session.
 *
 * Examples:
 * - default gateway session: "main"
 * - agent-scoped session: "agent:<agentId>:main"
 *
 * We keep the bare "main" fallback only for the root/default agent case.
 */
export function resolveOpenClawSessionKey(agentId: string | null | undefined): string {
  const raw = (agentId ?? "").trim();
  if (!raw || raw === "main") {
    return "main";
  }
  return `agent:${raw}:main`;
}
