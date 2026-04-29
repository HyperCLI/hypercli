//import { HyperAgent } from "@hypercli.com/sdk";
import { HyperAgent } from "@hypercli.com/sdk/agent";
import type { OpenClawCreateAgentOptions, OpenClawStartAgentOptions } from "@hypercli.com/sdk/agents";
import { Deployments } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "./api";

interface AgentUiMeta {
  avatar?: {
    image?: string | null;
    icon_index?: number | null;
  } | null;
  [key: string]: unknown;
}

type OpenClawAgentUiMeta = { ui?: AgentUiMeta | null } | null;
type FrontendOpenClawCreateOptions = Omit<OpenClawCreateAgentOptions, "meta"> & {
  meta?: OpenClawAgentUiMeta;
};
type FrontendOpenClawStartOptions = Omit<OpenClawStartAgentOptions, "meta"> & {
  meta?: OpenClawAgentUiMeta;
};

function resolveAgentApiBaseUrl(rawBaseUrl: string): string {
  if (!rawBaseUrl.startsWith("/")) {
    return rawBaseUrl;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${rawBaseUrl}`;
  }
  return rawBaseUrl;
}

export function createAgentClient(apiKey: string): Deployments {
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  const http = new HTTPClient(resolvedApiBaseUrl, apiKey);
  return new Deployments(http, apiKey, resolvedApiBaseUrl, configuredAgentsWsUrl || undefined);
}

export function createHyperAgentClient(apiKey: string): HyperAgent {
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  const http = new HTTPClient(resolvedApiBaseUrl, apiKey);
  return new HyperAgent(http, apiKey, false, resolvedApiBaseUrl);
}

export function createPublicHyperAgentClient(): HyperAgent {
  return createHyperAgentClient("");
}

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  return createAgentClient(apiKey).createOpenClaw(options);
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: FrontendOpenClawStartOptions = {}) {
  return createAgentClient(apiKey).startOpenClaw(agentId, options);
}
