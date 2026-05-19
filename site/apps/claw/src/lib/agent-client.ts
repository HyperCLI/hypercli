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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function launchConfigStartOptions(launchConfig: Record<string, unknown> | null | undefined): FrontendOpenClawStartOptions {
  if (!isRecord(launchConfig)) return {};

  const options: FrontendOpenClawStartOptions = {};
  if (isRecord(launchConfig.config)) options.config = cloneRecord(launchConfig.config);
  const env = stringRecord(launchConfig.env);
  if (env) options.env = env;
  if (Array.isArray(launchConfig.ports)) options.ports = cloneRecord(launchConfig.ports as Record<string, unknown>[]);
  if (isRecord(launchConfig.routes)) options.routes = cloneRecord(launchConfig.routes) as FrontendOpenClawStartOptions["routes"];
  if (Array.isArray(launchConfig.command) && launchConfig.command.every((item) => typeof item === "string")) {
    options.command = [...launchConfig.command];
  }
  if (Array.isArray(launchConfig.entrypoint) && launchConfig.entrypoint.every((item) => typeof item === "string")) {
    options.entrypoint = [...launchConfig.entrypoint];
  }
  if (typeof launchConfig.image === "string") options.image = launchConfig.image;
  if (typeof launchConfig.sync_root === "string") options.syncRoot = launchConfig.sync_root;
  if (typeof launchConfig.sync_enabled === "boolean") options.syncEnabled = launchConfig.sync_enabled;
  if (typeof launchConfig.registry_url === "string") options.registryUrl = launchConfig.registry_url;
  if (isRecord(launchConfig.registry_auth)) {
    options.registryAuth = cloneRecord(launchConfig.registry_auth) as FrontendOpenClawStartOptions["registryAuth"];
  }
  return options;
}

function mergeStartOptions(
  base: FrontendOpenClawStartOptions,
  overrides: FrontendOpenClawStartOptions,
): FrontendOpenClawStartOptions {
  return {
    ...base,
    ...overrides,
    config: {
      ...(base.config ?? {}),
      ...(overrides.config ?? {}),
    },
    env: {
      ...(base.env ?? {}),
      ...(overrides.env ?? {}),
    },
  };
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

export function createAgentClient(apiKey: string): Deployments {
  const configuredAgentsWsUrl = process.env.NEXT_PUBLIC_AGENTS_WS_URL || "";
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  const http = new HTTPClient(resolvedApiBaseUrl, apiKey);
  return new Deployments(http, apiKey, resolvedApiBaseUrl, configuredAgentsWsUrl || undefined);
}

export function createHyperAgentClient(apiKey: string): HyperAgent {
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  const productApiBaseUrl = resolvedApiBaseUrl.replace(/\/agents\/?$/, "");
  const http = new HTTPClient(productApiBaseUrl, apiKey);
  return new HyperAgent(http, apiKey, false, resolvedApiBaseUrl);
}

export function createPublicHyperAgentClient(): HyperAgent {
  return createHyperAgentClient("");
}

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  return createAgentClient(apiKey).createOpenClaw(options);
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: FrontendOpenClawStartOptions = {}) {
  const agentClient = createAgentClient(apiKey);
  let existingOptions: FrontendOpenClawStartOptions = {};
  try {
    const existingAgent = await agentClient.get(agentId);
    existingOptions = launchConfigStartOptions(existingAgent.launchConfig);
  } catch {}
  return agentClient.startOpenClaw(agentId, mergeStartOptions(existingOptions, options));
}
