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

const CONTROL_UI_ALLOWED_ORIGIN_ENV = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";
const CONTROL_UI_ORIGIN_LOCK_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK";
const CONTROL_UI_ALLOWED_ORIGINS_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS";
export const AGENT_CLEANUP_START_MESSAGE = "Agent is finishing shutdown. Try again shortly.";
export const AGENT_STOP_CLEANUP_COOLDOWN_MS = 30_000;
const AGENT_CLEANUP_RETRY_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000] as const;
const ENABLED_ENV_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

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

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function parseAllowedOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalizeOrigin).filter((origin): origin is string => Boolean(origin));
  }

  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      return parseAllowedOrigins(JSON.parse(trimmed));
    } catch {}
  }

  return trimmed
    .split(/[,\s]+/)
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return [value.message, value.detail, value.error, value.reason]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ");
}

export function isAgentCleanupConflictError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409 && /clean(?:ed|ing) up|cleanup/i.test(errorText(value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentUiOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeOrigin(window.location?.origin);
}

function configuredUiOrigins(): string[] {
  return parseAllowedOrigins(process.env[CONTROL_UI_ALLOWED_ORIGINS_CONFIG_ENV]);
}

function configuredUiOriginLock(): boolean {
  const value = process.env[CONTROL_UI_ORIGIN_LOCK_CONFIG_ENV]?.trim().toLowerCase() ?? "";
  if (DISABLED_ENV_VALUES.has(value)) return false;
  if (ENABLED_ENV_VALUES.has(value)) return true;
  return true;
}

function configAllowedOrigins(config: unknown): string[] {
  if (!isRecord(config) || !isRecord(config.gateway) || !isRecord(config.gateway.controlUi)) return [];
  return parseAllowedOrigins(config.gateway.controlUi.allowedOrigins);
}

function stripConfigAllowedOrigins(config: unknown): Record<string, unknown> {
  const next = isRecord(config) ? cloneRecord(config) : {};
  if (!isRecord(next.gateway)) return next;

  const gateway = cloneRecord(next.gateway);
  if (!isRecord(gateway.controlUi)) return next;

  const controlUi = cloneRecord(gateway.controlUi);
  delete controlUi.allowedOrigins;

  if (Object.keys(controlUi).length > 0) {
    gateway.controlUi = controlUi;
  } else {
    delete gateway.controlUi;
  }

  if (Object.keys(gateway).length > 0) {
    next.gateway = gateway;
  } else {
    delete next.gateway;
  }

  return next;
}

function withConfiguredControlUiOrigins<T extends FrontendOpenClawCreateOptions | FrontendOpenClawStartOptions>(options: T): T {
  const origin = currentUiOrigin();
  const env = { ...(options.env ?? {}) };
  const configuredOrigins = configuredUiOrigins();
  const config = stripConfigAllowedOrigins(options.config);
  const controlUiOriginLock = configuredUiOriginLock();

  if (!controlUiOriginLock) {
    delete env[CONTROL_UI_ALLOWED_ORIGIN_ENV];
    return {
      ...options,
      config,
      env,
      controlUiOriginLock,
    } as T;
  }

  if (configuredOrigins.length === 0) {
    delete env[CONTROL_UI_ALLOWED_ORIGIN_ENV];
    return {
      ...options,
      config,
      env,
      controlUiOriginLock,
    } as T;
  }

  const origins = [
    ...parseAllowedOrigins(env[CONTROL_UI_ALLOWED_ORIGIN_ENV]),
    ...configAllowedOrigins(options.config),
    ...configuredOrigins,
    ...(origin ? [origin] : []),
  ].filter((value, index, list) => list.indexOf(value) === index);
  delete env[CONTROL_UI_ALLOWED_ORIGIN_ENV];

  const gateway = isRecord(config.gateway) ? cloneRecord(config.gateway) : {};
  const controlUi = isRecord(gateway.controlUi) ? cloneRecord(gateway.controlUi) : {};
  controlUi.allowedOrigins = origins;
  gateway.controlUi = controlUi;
  config.gateway = gateway;

  return {
    ...options,
    config,
    env,
    controlUiOriginLock,
  } as T;
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
  return createAgentClient(apiKey).createOpenClaw(withConfiguredControlUiOrigins(options));
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: FrontendOpenClawStartOptions = {}) {
  const agentClient = createAgentClient(apiKey);
  let existingOptions: FrontendOpenClawStartOptions = {};
  try {
    const existingAgent = await agentClient.get(agentId);
    existingOptions = launchConfigStartOptions(existingAgent.launchConfig);
  } catch {}
  const startOptions = withConfiguredControlUiOrigins(mergeStartOptions(existingOptions, options));
  for (let attempt = 0; attempt <= AGENT_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await agentClient.startOpenClaw(agentId, startOptions);
    } catch (error) {
      if (!isAgentCleanupConflictError(error)) throw error;
      const delay = AGENT_CLEANUP_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw new Error(AGENT_CLEANUP_START_MESSAGE);
      await sleep(delay);
    }
  }
  throw new Error(AGENT_CLEANUP_START_MESSAGE);
}
