import { Deployments, resolveAgentsApiBase } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";

function stripApiSuffix(value: string): string {
  return value.endsWith("/api") ? value.slice(0, -4) : value;
}

export function createAgentClient(apiKey: string): Deployments {
  const configuredApiUrl =
    process.env.NEXT_PUBLIC_AGENTS_API_URL ||
    process.env.NEXT_PUBLIC_CLAW_API_URL ||
    "";
  const apiRoot = resolveAgentsApiBase(stripApiSuffix(configuredApiUrl));
  const http = new HTTPClient(apiRoot, apiKey);
  return new Deployments(http, apiKey, apiRoot);
}
