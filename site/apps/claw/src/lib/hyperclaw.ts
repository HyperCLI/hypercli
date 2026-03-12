import { Deployments } from "@hypercli/sdk/agents";
import { HTTPClient } from "@hypercli/sdk/http";

function stripApiSuffix(value: string): string {
  return value.endsWith("/api") ? value.slice(0, -4) : value;
}

export function createClawClient(apiKey: string): { deployments: Deployments } {
  const configuredApiUrl = process.env.NEXT_PUBLIC_CLAW_API_URL || "";
  const agentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || undefined;
  const apiRoot = stripApiSuffix(configuredApiUrl);
  const http = new HTTPClient(apiRoot, apiKey);
  return {
    deployments: new Deployments(http, apiKey, apiRoot, agentsWsUrl),
  };
}
