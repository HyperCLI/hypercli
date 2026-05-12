/**
 * Each HyperCLI deployment connects to its own OpenClaw gateway, so the
 * gateway-local root session is already deployment scoped. Passing
 * "agent:<deploymentId>:main" makes the gateway treat the deployment UUID as an
 * internal OpenClaw agent and can create /workspace/<uuid>.
 */
export function resolveOpenClawSessionKey(_agentId: string | null | undefined): string {
  return "main";
}
