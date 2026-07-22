import { HyperAgent } from "@hypercli.com/sdk/agent";
import type { OpenClawCreateAgentOptions, OpenClawStartAgentOptions } from "@hypercli.com/sdk/agents";
import { Deployments, getSlackInstallStatus } from "@hypercli.com/sdk/agents";
import { buildSlackRelayApiUrl, buildSlackRelayWebSocketUrl } from "@hypercli.com/sdk/channels";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { API_BASE_URL, SLACK_RELAY_BASE_URL } from "./api";

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
type ListedAgent = Awaited<ReturnType<Deployments["list"]>>[number];

const CONTROL_UI_ALLOWED_ORIGIN_ENV = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";
const CONTROL_UI_ORIGIN_LOCK_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK";
const CONTROL_UI_ALLOWED_ORIGINS_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS";
export const AGENT_CLEANUP_START_MESSAGE = "Agent is finishing shutdown. Try again shortly.";
export const AGENT_STOP_CLEANUP_COOLDOWN_MS = 30_000;
const AGENT_CLEANUP_RETRY_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000] as const;
const AGENT_CREATE_RECONCILE_DELAYS_MS = [750, 1_500, 3_000] as const;
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

function isAgentCreateSpecVisibilityError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409 && /backend agent spec not found/i.test(errorText(value));
}

function agentName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.name === "string" ? value.name : null;
}

function agentCreatedAtMs(value: unknown): number {
  if (!isRecord(value)) return 0;
  const createdAt = value.createdAt ?? value.created_at;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt !== "string") return 0;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function reconcileCreatedAgentByName(agentClient: Deployments, name: string | undefined): Promise<ListedAgent | null> {
  const expectedName = name?.trim();
  if (!expectedName) return null;

  for (const delay of AGENT_CREATE_RECONCILE_DELAYS_MS) {
    await sleep(delay);
    const agents = await agentClient.list();
    const matches = agents
      .filter((agent) => agentName(agent) === expectedName)
      .sort((left, right) => agentCreatedAtMs(right) - agentCreatedAtMs(left));
    if (matches.length > 0) {
      return matches[0];
    }
  }
  return null;
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

function openClawSecretEnvRef(id: string): Record<string, string> {
  return { source: "env", provider: "default", id };
}

function hasSelfHostedSlackConfig(slack: Record<string, unknown>): boolean {
  const mode = typeof slack.mode === "string" ? slack.mode : "";
  if (mode === "socket" || mode === "http") return true;
  return ["appToken", "signingSecret", "userToken"].some((field) => slack[field] !== undefined);
}

function withHostedSlackRelayConfig<T extends FrontendOpenClawCreateOptions | FrontendOpenClawStartOptions>(options: T): T {
  const config = isRecord(options.config) ? cloneRecord(options.config) : {};
  const channels = isRecord(config.channels) ? cloneRecord(config.channels) : {};
  const existingSlack = isRecord(channels.slack) ? cloneRecord(channels.slack) : {};
  if (hasSelfHostedSlackConfig(existingSlack)) return options;

  const relay = isRecord(existingSlack.relay) ? cloneRecord(existingSlack.relay) : {};
  const relayUrl = typeof relay.url === "string" && relay.url.trim()
    ? relay.url
    : buildSlackRelayWebSocketUrl(SLACK_RELAY_BASE_URL);
  relay.url = relayUrl;
  relay.authToken = isRecord(relay.authToken) ? relay.authToken : openClawSecretEnvRef("HYPER_AGENTS_API_KEY");

  channels.slack = {
    ...existingSlack,
    enabled: true,
    mode: "relay",
    groupPolicy: existingSlack.groupPolicy ?? "open",
    replyToMode: existingSlack.replyToMode ?? "all",
    replyToModeByChatType: isRecord(existingSlack.replyToModeByChatType) ? existingSlack.replyToModeByChatType : { direct: "off" },
    botToken: isRecord(existingSlack.botToken) ? existingSlack.botToken : openClawSecretEnvRef("SLACK_BOT_TOKEN"),
    relay,
  };
  config.channels = channels;
  return {
    ...options,
    config,
    env: {
      ...(options.env ?? {}),
      HYPER_SLACK_APP_ENABLED: "1",
      HYPER_SLACK_RELAY_URL: relayUrl,
      HYPER_SLACK_API_URL: buildSlackRelayApiUrl(SLACK_RELAY_BASE_URL),
    },
  } as T;
}

async function withUserSlackRelayLaunchConfig<T extends FrontendOpenClawCreateOptions | FrontendOpenClawStartOptions>(apiKey: string, options: T): Promise<T> {
  if (!SLACK_RELAY_BASE_URL) return options;
  try {
    const status = await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token: apiKey });
    if (!status.connected) return options;
  } catch (cause) {
    console.warn("Could not check hosted Slack install status before launch.", cause);
    return options;
  }
  return withHostedSlackRelayConfig(options);
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
  const merged: FrontendOpenClawStartOptions = {
    ...base,
    ...overrides,
  };
  if (base.config !== undefined || overrides.config !== undefined) {
    merged.config = {
      ...(base.config ?? {}),
      ...(overrides.config ?? {}),
    };
  }
  if (base.env !== undefined || overrides.env !== undefined) {
    merged.env = {
      ...(base.env ?? {}),
      ...(overrides.env ?? {}),
    };
  }
  if (base.routes !== undefined || overrides.routes !== undefined) {
    merged.routes = {
      ...(base.routes ?? {}),
      ...(overrides.routes ?? {}),
    };
  }
  return merged;
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

export function createWorkspacesClient(apiKey: string): WorkspacesAPI {
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  return new WorkspacesAPI(apiKey, { agentsApiBase: resolvedApiBaseUrl });
}

export function createPublicHyperAgentClient(): HyperAgent {
  return createHyperAgentClient("");
}

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  const preparedOptions = withConfiguredControlUiOrigins(await withUserSlackRelayLaunchConfig(apiKey, options));
  const agentClient = createAgentClient(apiKey);
  const create = ENABLED_ENV_VALUES.has((preparedOptions.env?.OPENCLAW_DESKTOP_ENABLED ?? "").trim().toLowerCase())
    ? agentClient.createOpenClawPro.bind(agentClient)
    : agentClient.createOpenClaw.bind(agentClient);
  try {
    return await create(preparedOptions);
  } catch (error) {
    if (!isAgentCreateSpecVisibilityError(error)) throw error;
    const reconciled = await reconcileCreatedAgentByName(agentClient, preparedOptions.name);
    if (reconciled) return reconciled;
    throw error;
  }
}

export async function startOpenClawAgent(apiKey: string, agentId: string, options: FrontendOpenClawStartOptions = {}) {
  const agentClient = createAgentClient(apiKey);
  let existingOptions: FrontendOpenClawStartOptions = {};
  try {
    const existingAgent = await agentClient.get(agentId);
    existingOptions = launchConfigStartOptions(existingAgent.launchConfig);
  } catch {}
  const startOptions = withConfiguredControlUiOrigins(await withUserSlackRelayLaunchConfig(apiKey, mergeStartOptions(existingOptions, options)));
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
