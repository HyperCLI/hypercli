import { Deployments } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "./api";

export function createAgentClient(apiKey: string): Deployments {
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const http = new HTTPClient(API_BASE_URL, apiKey);
  return new Deployments(http, apiKey, API_BASE_URL, configuredAgentsWsUrl || undefined);
}
