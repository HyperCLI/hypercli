import { agentApiFetch } from "@/lib/api";
import { setGatewayToken as storeGatewayToken } from "@/lib/agent-store";

export async function refreshGatewayToken(agentId: string, authToken: string): Promise<string | null> {
  const envResp = await agentApiFetch<{ env: Record<string, string> }>(
    `/deployments/${agentId}/env`,
    authToken,
  );
  const gatewayToken = envResp.env?.OPENCLAW_GATEWAY_TOKEN?.trim() || "";
  if (!gatewayToken) {
    return null;
  }
  storeGatewayToken(agentId, gatewayToken);
  return gatewayToken;
}
