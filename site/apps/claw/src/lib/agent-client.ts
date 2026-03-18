import { Deployments } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "./api";

const DEFAULT_OPENCLAW_IMAGE =
  process.env.NEXT_PUBLIC_OPENCLAW_IMAGE?.trim() || "ghcr.io/hypercli/hypercli-openclaw:prod";

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
  env?: Record<string, string>;
}

export function createAgentClient(apiKey: string): Deployments {
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const http = new HTTPClient(API_BASE_URL, apiKey);
  return new Deployments(http, apiKey, API_BASE_URL, configuredAgentsWsUrl || undefined);
}

function resolveControlUiOrigin(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function withOpenClawDefaults(options: OpenClawAgentOptions = {}): Record<string, unknown> {
  const env = {
    ...(options.env ?? {}),
  };
  const controlUiOrigin = resolveControlUiOrigin(process.env.NEXT_PUBLIC_AGENTS_URL || "");
  if (controlUiOrigin && !env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN) {
    env.OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN = controlUiOrigin;
  }

  const config = {
    ...(options.config ?? {}),
    image: DEFAULT_OPENCLAW_IMAGE,
    routes: DEFAULT_OPENCLAW_ROUTES,
  };

  return {
    ...options,
    env,
    config,
  };
}

export async function createOpenClawAgent(apiKey: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).create(withOpenClawDefaults(options) as any);
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).start(agentId, withOpenClawDefaults(options) as any);
}
