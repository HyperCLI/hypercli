import { createAgentClient } from "@/lib/agent-client";
import { setGatewayToken as storeGatewayToken } from "@/lib/agent-store";

export async function refreshGatewayToken(agentId: string, authToken: string): Promise<string | null> {
  const envResp = await createAgentClient(authToken).env(agentId);
  const gatewayToken = envResp.env?.OPENCLAW_GATEWAY_TOKEN?.trim() || "";
  if (!gatewayToken) {
    return null;
  }
  storeGatewayToken(agentId, gatewayToken);
  return gatewayToken;
}
