import { Deployments, resolveAgentsApiBase } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";

function stripApiSuffix(value: string): string {
  return value.endsWith("/api") ? value.slice(0, -4) : value;
}

export function createAgentClient(apiKey: string): Deployments {
  const configuredApiUrl =
    process.env.NEXT_PUBLIC_AGENTS_API_BASE_URL ||
    "";
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const apiRoot = resolveAgentsApiBase(stripApiSuffix(configuredApiUrl));
  const http = new HTTPClient(apiRoot, apiKey);
  return new Deployments(http, apiKey, apiRoot, configuredAgentsWsUrl || undefined);
}
