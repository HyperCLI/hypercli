import { Deployments } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "./api";

const DEFAULT_OPENCLAW_IMAGE = "ghcr.io/hypercli/hypercli-openclaw:prod";

const DEFAULT_OPENCLAW_ROUTES = {
  openclaw: {
    port: 18789,
    auth: false,
    prefix: "",
  },
  desktop: {
    port: 3000,
    auth: true,
    prefix: "desktop",
  },
};

interface OpenClawAgentOptions {
  name?: string;
  start?: boolean;
  size?: string;
  cpu?: number;
  memory?: number;
  config?: Record<string, unknown>;
}

export function createAgentClient(apiKey: string): Deployments {
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const http = new HTTPClient(API_BASE_URL, apiKey);
  return new Deployments(http, apiKey, API_BASE_URL, configuredAgentsWsUrl || undefined);
}

function withOpenClawDefaults(options: OpenClawAgentOptions = {}): Record<string, unknown> {
  const config = {
    ...(options.config ?? {}),
    image: DEFAULT_OPENCLAW_IMAGE,
    routes: DEFAULT_OPENCLAW_ROUTES,
  };

  return {
    ...options,
    config,
  };
}

export async function createOpenClawAgent(apiKey: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).create(withOpenClawDefaults(options) as any);
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).start(agentId, withOpenClawDefaults(options) as any);
}
