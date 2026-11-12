import type { McpServer } from '@agentclientprotocol/sdk';

/**
 * Compose the historical product/docs session MCP list.
 *
 * @deprecated Clients no longer compose session MCP lists: connect paths send
 * `[]` (or omit the list) and the Hyper-ACP host hydrates the full session set
 * from pod launch env. Kept only so existing imports keep compiling.
 * Removal plan: once the external migration window closes, delete this
 * helper, `Deployments.sessionMcpServers`, and both re-exports
 * (index.ts, browser.ts) together in one release.
 */
export function buildSessionMcpServers(productBase: string, apiKey: string, additions: readonly McpServer[] = []): McpServer[] {
  return [
    { type: 'http', name: 'hypercli', url: `${productBase.replace(/\/+$/, '')}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${apiKey}` }] },
    { type: 'http', name: 'hypercli-docs', url: 'https://docs.hypercli.com/mcp', headers: [] },
    ...structuredClone(additions),
  ];
}

/** Serialize explicit selections for storage in the existing launch setting. */
export function buildAdditionalMcpEnv(...groups: readonly McpServer[][]): Record<string, string> {
  return { HYPER_ADDITIONAL_MCP_SERVERS: JSON.stringify(groups.flat()) };
}
