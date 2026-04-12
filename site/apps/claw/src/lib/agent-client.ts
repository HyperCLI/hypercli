//import { HyperAgent } from "@hypercli.com/sdk";
import { HyperAgent } from "@hypercli.com/sdk/agent";
import type { OpenClawCreateAgentOptions, OpenClawStartAgentOptions } from "@hypercli.com/sdk/agents";
import { Deployments } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { API_BASE_URL } from "./api";

const DEFAULT_OPENCLAW_IMAGE =
  process.env.NEXT_PUBLIC_OPENCLAW_IMAGE?.trim() || "ghcr.io/hypercli/hypercli-openclaw:prod";
const DEFAULT_OPENCLAW_SYNC_ROOT = "/home/node";

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

function withOpenClawDefaults<T extends FrontendOpenClawCreateOptions | FrontendOpenClawStartOptions>(options: T): T {
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
    syncRoot: options.syncRoot ?? DEFAULT_OPENCLAW_SYNC_ROOT,
    syncEnabled: options.syncEnabled ?? true,
  } as T;
}

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  return createAgentClient(apiKey).createOpenClaw(withOpenClawDefaults(options));
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: FrontendOpenClawStartOptions = {}) {
  return createAgentClient(apiKey).startOpenClaw(agentId, withOpenClawDefaults(options));
}
