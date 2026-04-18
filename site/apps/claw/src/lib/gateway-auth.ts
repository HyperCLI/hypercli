import { createAgentClient } from "@/lib/agent-client";
import { setGatewayToken as storeGatewayToken } from "@/lib/agent-store";

export async function refreshGatewayToken(agentId: string, authToken: string): Promise<string | null> {
  const inferenceResp = await createAgentClient(authToken).inferenceToken(agentId);
  const gatewayToken = inferenceResp.gateway_token?.trim() || "";
  if (!gatewayToken) {
    return null;
  }
  storeGatewayToken(agentId, gatewayToken);
  return gatewayToken;
}
