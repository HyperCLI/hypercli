//import { HyperAgent } from "@hypercli.com/sdk";
import { HyperAgent } from "@hypercli.com/sdk/agent";
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

interface AgentUiMeta {
  avatar?: {
    image?: string | null;
    icon_index?: number | null;
  } | null;
  [key: string]: unknown;
}

interface OpenClawAgentOptions {
  name?: string;
  start?: boolean;
  size?: string;
  cpu?: number;
  memory?: number;
  config?: Record<string, unknown>;
  meta?: { ui?: AgentUiMeta | null } | null;
  env?: Record<string, string>;
  image?: string;
  routes?: Record<string, unknown>;
  command?: string[];
  entrypoint?: string[];
  sync_root?: string;
  sync_enabled?: boolean;
  registry_url?: string;
  registry_auth?: Record<string, unknown>;
}

function resolveAgentApiBaseUrl(rawBaseUrl: string): string {
  if (!rawBaseUrl.startsWith("/")) {
    return rawBaseUrl;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${rawBaseUrl}`;
  }
  return rawBaseUrl;
}

function randomHexToken(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
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
  if (!env.OPENCLAW_GATEWAY_TOKEN?.trim()) {
    env.OPENCLAW_GATEWAY_TOKEN = randomHexToken(32);
  }

  return {
    ...options,
    env,
    image: options.image ?? DEFAULT_OPENCLAW_IMAGE,
    routes: options.routes ?? DEFAULT_OPENCLAW_ROUTES,
    sync_enabled: options.sync_enabled ?? true,
  };
}

export async function createOpenClawAgent(apiKey: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).create(withOpenClawDefaults(options) as any);
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: OpenClawAgentOptions = {}) {
  return createAgentClient(apiKey).start(agentId, withOpenClawDefaults(options) as any);
}
