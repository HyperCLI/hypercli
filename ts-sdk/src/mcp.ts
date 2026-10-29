import type { McpServer } from '@agentclientprotocol/sdk';

/** Standard session setup. Hyper-ACP supplies only its local hyper-chat entry. */
export function buildSessionMcpServers(productBase: string, apiKey: string, additions: readonly McpServer[] = []): McpServer[] {
  return [
    { type: 'http', name: 'hypercli', url: `${productBase.replace(/\/+$/, '')}/api/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${apiKey}` }] },
    { type: 'http', name: 'hypercli-docs', url: 'https://docs.hypercli.com/mcp', headers: [] },
    ...structuredClone(additions),
  ];
}

/** Serialize explicit selections for storage in the existing launch setting. */
export function buildAdditionalMcpEnv(...groups: readonly McpServer[][]): Record<string, string> {
  return { HYPER_ADDITIONAL_MCP_SERVERS: JSON.stringify(groups.flat()) };
}
