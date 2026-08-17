import { HyperAgent } from "@hypercli.com/sdk/agent";
import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import type { Agent as SdkAgent, OpenClawCreateAgentOptions } from "@hypercli.com/sdk/agents";
import { Deployments, getSlackInstallStatus } from "@hypercli.com/sdk/agents";
import { buildSlackRelayApiUrl, buildSlackRelayWebSocketUrl } from "@hypercli.com/sdk/channels";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { API_BASE_URL, PRODUCT_API_BASE_URL, SLACK_RELAY_BASE_URL } from "./api";
import { generateAgentName, isGeneratedAgentName } from "./agent-name";
import {
  controlUiAllowedOriginsFromLaunchConfig,
  currentControlUiOrigin,
  parseControlUiAllowedOrigins,
} from "./control-ui-origin";

interface AgentUiMeta {
  avatar?: {
    image?: string | null;
    icon_index?: number | null;
  } | null;
}

type OpenClawAgentUiMeta = { ui?: AgentUiMeta | null } | null;
type FrontendOpenClawCreateOptions = Omit<OpenClawCreateAgentOptions, "meta"> & {
  meta?: OpenClawAgentUiMeta;
};
type ListedAgent = Awaited<ReturnType<Deployments["list"]>>[number];
type AgentLifecycleAccepted = (agent: SdkAgent) => void;
type AgentLifecycleObserved = (agent: SdkAgent) => void;

const CONTROL_UI_ALLOWED_ORIGIN_ENV = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";
const CONTROL_UI_ORIGIN_LOCK_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ORIGIN_LOCK";
const CONTROL_UI_ALLOWED_ORIGINS_CONFIG_ENV = "NEXT_PUBLIC_OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS";
export const AGENT_CLEANUP_START_MESSAGE = "Agent is finishing shutdown. Try again shortly.";
const AGENT_CREATE_RECONCILE_DELAYS_MS = [750, 1_500, 3_000] as const;
const AGENT_LIFECYCLE_RECONCILE_DELAYS_MS = [0, 500, 1_500, 3_000] as const;
const AGENT_LIFECYCLE_RECONCILE_REQUEST_TIMEOUT_MS = 2_000;
const AGENT_NAME_CREATE_ATTEMPTS = 32;
const AGENT_LIFECYCLE_TIMEOUT_MS = 300_000;
const ENABLED_ENV_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const DISABLED_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export function hostedSlackLaunchEnv(relayUrl?: string): Record<string, string> | null {
  if (!SLACK_RELAY_BASE_URL) return null;
  return {
    HYPER_SLACK_APP_ENABLED: "1",
    HYPER_SLACK_RELAY_URL: relayUrl || buildSlackRelayWebSocketUrl(SLACK_RELAY_BASE_URL),
    HYPER_SLACK_API_URL: buildSlackRelayApiUrl(SLACK_RELAY_BASE_URL),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  return [value.message, value.detail, value.error, value.reason]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ");
}

function isAgentLifecycleTimeout(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  if (statusCode !== null) return statusCode === 504;

  let current = value;
  for (let depth = 0; depth < 5; depth++) {
    const name = current instanceof Error ? current.name : "";
    const message = errorText(current);
    const code = isRecord(current) && typeof current.code === "string" ? current.code : "";
    if (
      name === "AbortError"
      || name === "TimeoutError"
      || /abort|time(?:d)?\s*out|timeout/i.test(message)
      || code === "ETIMEDOUT"
      || /^UND_ERR_.*TIMEOUT$/.test(code)
    ) return true;
    current = isRecord(current) ? current.cause : null;
  }
  return false;
}

export function isAgentCleanupConflictError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409 && /clean(?:ed|ing) up|cleanup/i.test(errorText(value));
}

export function isAgentLifecycleStateConflictError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409;
}

function isAgentCreateSpecVisibilityError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409 && /backend agent spec not found/i.test(errorText(value));
}

function isAgentNameConflictError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  return statusCode === 409 && /already exists|already in use|name (?:is )?taken|duplicate name|name conflict/i.test(errorText(value));
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

async function reconcileCreatedAgent(
  agentClient: Deployments,
  options: FrontendOpenClawCreateOptions,
): Promise<ListedAgent | null> {
  const expectedName = options.name?.trim();
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

async function reconcileTimedOutAgentStart(agentClient: Deployments, agentId: string): Promise<SdkAgent> {
  let lastReadError: unknown;
  for (const delay of AGENT_LIFECYCLE_RECONCILE_DELAYS_MS) {
    await sleep(delay);
    let current: SdkAgent;
    try {
      current = await agentClient.get(agentId, {
        retries: 1,
        timeout: AGENT_LIFECYCLE_RECONCILE_REQUEST_TIMEOUT_MS,
      });
      lastReadError = undefined;
    } catch (error) {
      lastReadError = error;
      continue;
    }

    const state = current.state.toUpperCase();
    if (["CREATING", "STARTING", "RESTORING", "RUNNING"].includes(state)) return current;
    if (["FAILED", "DELETED"].includes(state)) {
      throw new Error(`Agent entered ${state} while confirming launch.`);
    }
  }
  if (lastReadError) throw lastReadError;
  throw new Error("The start request timed out before launch was confirmed. Check the agent status and try again.");
}

async function reconcileTimedOutAgentStop(agentClient: Deployments, agentId: string): Promise<SdkAgent> {
  let lastReadError: unknown;
  for (const delay of AGENT_LIFECYCLE_RECONCILE_DELAYS_MS) {
    await sleep(delay);
    let current: SdkAgent;
    try {
      current = await agentClient.get(agentId, {
        retries: 1,
        timeout: AGENT_LIFECYCLE_RECONCILE_REQUEST_TIMEOUT_MS,
      });
      lastReadError = undefined;
    } catch (error) {
      lastReadError = error;
      continue;
    }

    const state = current.state.toUpperCase();
    if (["STOPPING", "STOPPED", "ARCHIVING", "ARCHIVED"].includes(state)) return current;
    if (["FAILED", "DELETED"].includes(state)) {
      throw new Error(`Agent entered ${state} while confirming shutdown.`);
    }
  }
  if (lastReadError) throw lastReadError;
  throw new Error("The stop request timed out before shutdown was confirmed. Check the agent status and try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentUiOrigin(): string | null {
  return currentControlUiOrigin();
}

function configuredUiOrigins(): string[] {
  return parseControlUiAllowedOrigins(process.env[CONTROL_UI_ALLOWED_ORIGINS_CONFIG_ENV]);
}

function configuredUiOriginLock(): boolean {
  const value = process.env[CONTROL_UI_ORIGIN_LOCK_CONFIG_ENV]?.trim().toLowerCase() ?? "";
  if (DISABLED_ENV_VALUES.has(value)) return false;
  if (ENABLED_ENV_VALUES.has(value)) return true;
  return true;
}

function configAllowedOrigins(config: unknown): string[] {
  return controlUiAllowedOriginsFromLaunchConfig({ config });
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

function withHostedSlackRelayConfig<T extends FrontendOpenClawCreateOptions>(options: T): T {
  const config = isRecord(options.config) ? cloneRecord(options.config) : {};
  const channels = isRecord(config.channels) ? cloneRecord(config.channels) : {};
  const existingSlack = isRecord(channels.slack) ? cloneRecord(channels.slack) : {};
  if (hasSelfHostedSlackConfig(existingSlack)) return options;

  const relay = isRecord(existingSlack.relay) ? cloneRecord(existingSlack.relay) : {};
  const relayUrl = typeof relay.url === "string" && relay.url.trim()
    ? relay.url
    : buildSlackRelayWebSocketUrl(SLACK_RELAY_BASE_URL);
  const slackEnv = hostedSlackLaunchEnv(relayUrl);
  if (!slackEnv) return options;
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
      ...slackEnv,
    },
  } as T;
}

async function withUserSlackRelayLaunchConfig<T extends FrontendOpenClawCreateOptions>(apiKey: string, options: T): Promise<T> {
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

function withConfiguredControlUiOrigins<T extends FrontendOpenClawCreateOptions>(options: T): T {
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
    ...parseControlUiAllowedOrigins(env[CONTROL_UI_ALLOWED_ORIGIN_ENV]),
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

function resolveAgentApiBaseUrl(rawBaseUrl: string, origin?: string): string {
  if (!rawBaseUrl.startsWith("/")) {
    return rawBaseUrl;
  }
  if (origin) {
    return `${origin.replace(/\/+$/, "")}${rawBaseUrl}`;
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

export function createBrowserHyperCLIClient(token: string): BrowserHyperCLI {
  return new BrowserHyperCLI({
    apiUrl: PRODUCT_API_BASE_URL,
    agentsApiBaseUrl: API_BASE_URL,
    token,
  });
}

export function createHyperAgentClient(apiKey: string, origin?: string): HyperAgent {
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL, origin);
  const productApiBaseUrl = resolvedApiBaseUrl.replace(/\/agents\/?$/, "");
  const http = new HTTPClient(productApiBaseUrl, apiKey);
  return new HyperAgent(http, apiKey, false, resolvedApiBaseUrl);
}

export function createWorkspacesClient(apiKey: string): WorkspacesAPI {
  const resolvedApiBaseUrl = resolveAgentApiBaseUrl(API_BASE_URL);
  return new WorkspacesAPI(apiKey, { agentsApiBase: resolvedApiBaseUrl });
}

export function createPublicHyperAgentClient(origin?: string): HyperAgent {
  return createHyperAgentClient("", origin);
}

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  const preparedOptions = withConfiguredControlUiOrigins(
    await withUserSlackRelayLaunchConfig(apiKey, options),
  );
  const agentClient = createAgentClient(apiKey);
  const create = ENABLED_ENV_VALUES.has((preparedOptions.env?.OPENCLAW_DESKTOP_ENABLED ?? "").trim().toLowerCase())
    ? agentClient.createOpenClawPro.bind(agentClient)
    : agentClient.createOpenClaw.bind(agentClient);
  const canRegenerateName = isGeneratedAgentName(preparedOptions.name);
  const attemptedNames = new Set<string>();
  let candidateOptions = preparedOptions;

  if (canRegenerateName && candidateOptions.name) attemptedNames.add(candidateOptions.name);

  while (true) {
    try {
      return await create(candidateOptions);
    } catch (initialError) {
      if (isAgentCreateSpecVisibilityError(initialError) || isAgentLifecycleTimeout(initialError)) {
        const reconciled = await reconcileCreatedAgent(agentClient, candidateOptions);
        if (reconciled) return reconciled;
        throw initialError;
      }
      if (!canRegenerateName || !isAgentNameConflictError(initialError) || attemptedNames.size >= AGENT_NAME_CREATE_ATTEMPTS) {
        throw initialError;
      }

      const name = generateAgentName(attemptedNames);
      attemptedNames.add(name);
      candidateOptions = { ...candidateOptions, name };
    }
  }
}

export async function requestAgentStart(
  apiKey: string,
  agentId: string,
  onAccepted?: AgentLifecycleAccepted,
  onObserved?: AgentLifecycleObserved,
): Promise<SdkAgent> {
  const agentClient = createAgentClient(apiKey);
  const current = await agentClient.get(agentId);
  onObserved?.(current);
  if (current.state.toUpperCase() !== "STOPPED") {
    const state = current.state.toUpperCase() || "UNKNOWN";
    throw Object.assign(
      new Error(state === "ARCHIVED"
        ? "Agent is archived. Restore it before starting."
        : `Agent is ${state.toLowerCase()} and cannot be started.`),
      { statusCode: 409 },
    );
  }
  const runtime = current.runtime?.trim().toLowerCase();
  if (current.state.toUpperCase() === "STOPPED" && (runtime === "openclaw" || runtime === "openclaw-pro")) {
    const origin = currentControlUiOrigin();
    if (!origin) throw new Error("Could not determine this dashboard address before starting the agent.");
    // This mutation is deliberately separate from start timeout reconciliation:
    // a failed or ambiguous origin update must never be mistaken for an admitted start.
    await agentClient.setEnv(current.id, CONTROL_UI_ALLOWED_ORIGIN_ENV, origin);
  }
  let accepted: SdkAgent;
  try {
    accepted = await agentClient.start(agentId);
  } catch (error) {
    if (!isAgentLifecycleTimeout(error)) throw error;
    accepted = await reconcileTimedOutAgentStart(agentClient, agentId);
  }
  onAccepted?.(accepted);
  return accepted;
}

export async function waitForAgentRunning(accepted: SdkAgent): Promise<SdkAgent> {
  return accepted.state.toUpperCase() === "RUNNING"
    ? accepted
    : accepted.waitRunning(AGENT_LIFECYCLE_TIMEOUT_MS);
}

export async function waitForCreatedAgentStopped(
  agentClient: Deployments,
  created: { id: string; launchEpoch?: number },
): Promise<SdkAgent> {
  const minimumLaunchEpoch = typeof created.launchEpoch === "number" && created.launchEpoch > 0
    ? created.launchEpoch
    : undefined;
  return agentClient.waitForState(
    created.id,
    ["STOPPED"],
    AGENT_LIFECYCLE_TIMEOUT_MS,
    ["FAILED", "DELETED"],
    minimumLaunchEpoch,
  );
}

export async function startAgent(apiKey: string, agentId: string, onAccepted?: AgentLifecycleAccepted): Promise<SdkAgent> {
  return waitForAgentRunning(await requestAgentStart(apiKey, agentId, onAccepted));
}

export async function stopAgent(apiKey: string, agentId: string, onAccepted?: AgentLifecycleAccepted): Promise<SdkAgent> {
  const agentClient = createAgentClient(apiKey);
  let accepted: SdkAgent;
  try {
    accepted = await agentClient.stop(agentId);
  } catch (error) {
    if (!isAgentLifecycleTimeout(error)) throw error;
    accepted = await reconcileTimedOutAgentStop(agentClient, agentId);
  }
  onAccepted?.(accepted);
  if (["STOPPED", "ARCHIVING", "ARCHIVED"].includes(accepted.state.toUpperCase())) return accepted;
  return agentClient.waitForState(
    accepted.id,
    ["STOPPED", "ARCHIVING", "ARCHIVED"],
    AGENT_LIFECYCLE_TIMEOUT_MS,
    ["FAILED", "DELETED"],
    accepted.launchEpoch,
  );
}

export async function archiveAgent(apiKey: string, agentId: string, onAccepted?: AgentLifecycleAccepted): Promise<SdkAgent> {
  const agentClient = createAgentClient(apiKey);
  const accepted = await agentClient.archive(agentId);
  onAccepted?.(accepted);
  if (accepted.state.toUpperCase() === "ARCHIVED") return accepted;
  return agentClient.waitForState(
    accepted.id,
    ["ARCHIVED"],
    AGENT_LIFECYCLE_TIMEOUT_MS,
    ["FAILED", "DELETED"],
    accepted.launchEpoch,
  );
}

export async function restoreAgent(apiKey: string, agentId: string, onAccepted?: AgentLifecycleAccepted): Promise<SdkAgent> {
  const agentClient = createAgentClient(apiKey);
  const accepted = await agentClient.restore(agentId);
  onAccepted?.(accepted);
  if (accepted.state.toUpperCase() === "STOPPED") return accepted;
  return agentClient.waitForState(
    accepted.id,
    ["STOPPED"],
    AGENT_LIFECYCLE_TIMEOUT_MS,
    ["FAILED", "DELETED"],
    accepted.launchEpoch,
  );
}

export async function deleteStoppedAgent(apiKey: string, agentId: string): Promise<Record<string, unknown>> {
  const agentClient = createAgentClient(apiKey);
  const current = await agentClient.get(agentId);
  if (current.state.toUpperCase() !== "STOPPED") {
    throw new Error("Stop the agent and wait for cleanup to finish before deleting it.");
  }
  return agentClient.delete(current.id);
}
