import type { McpServer } from '@agentclientprotocol/sdk';

/** Assemble explicit platform/integration and external selections for the
 * existing launch `env` option. The host owns merging/conflict handling; the
 * runtime owns transport support. No credentials or process env are discovered.
 */
export function buildAdditionalMcpEnv(...groups: readonly McpServer[][]): Record<string, string> {
  return { HYPER_ADDITIONAL_MCP_SERVERS: JSON.stringify(groups.flat()) };
}
