import { HyperAgent } from "@hypercli.com/sdk/agent";
import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import type { Agent as SdkAgent, AgentLaunchConfig, HermesAgentCreateOptions, OpenClawCreateAgentOptions } from "@hypercli.com/sdk/agents";
import { Deployments, getSlackInstallStatus } from "@hypercli.com/sdk/agents";
import { HTTPClient } from "@hypercli.com/sdk/http";
import { WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { API_BASE_URL, PRODUCT_API_BASE_URL, SLACK_RELAY_BASE_URL } from "./api";
import { debugFlow } from "./debug-flow";
import { generateAgentName, isGeneratedAgentName } from "./agent-name";
import { getHermesDefaultImage } from "./hermes-launch";
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
type FrontendHermesAgentCreateOptions = Omit<HermesAgentCreateOptions, "meta"> & {
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
const HERMES_CORS_ORIGINS_ENV = "API_SERVER_CORS_ORIGINS";
const REQUIRED_START_LAUNCH_KEYS = [
  "config",
  "image",
  "env",
  "routes",
  "command",
  "entrypoint",
  "restart",
  "sync_root",
  "sync_uid",
  "sync_gid",
  "registry_url",
  "runtime_scopes",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function cloneStoredStartLaunchConfig(agent: SdkAgent, runtimeLabel: string): AgentLaunchConfig {
  const launchConfig = cloneRecord((agent as { launchConfig?: unknown }).launchConfig ?? {});
  if (!isRecord(launchConfig)) {
    throw new Error(`${runtimeLabel} start requires a stored launch configuration.`);
  }
  const missing = REQUIRED_START_LAUNCH_KEYS.filter((key) => !(key in launchConfig));
  if (missing.length > 0) {
    throw new Error(`${runtimeLabel} start requires a complete launch configuration; missing: ${missing.join(", ")}`);
  }
  if (launchConfig.restart === null) {
    launchConfig.restart = false;
  }
  return launchConfig as unknown as AgentLaunchConfig;
}

function buildOpenClawStartLaunchConfig(agent: SdkAgent, controlUiOrigin: string): AgentLaunchConfig {
  const launchConfig = cloneStoredStartLaunchConfig(agent, "OpenClaw") as unknown as Record<string, unknown>;
  // Hosted contract: nested OpenClaw config never replays into START. Agents
  // created while the frontend coupled starter files to a partial
  // { agents: { defaults: ... } } config carry that partial shape in their
  // stored launch config, and replaying it materializes an openclaw.json that
  // blocks gateway startup (missing gateway.mode). The image owns config.
  if (isRecord(launchConfig.config)) {
    debugFlow("agent-client", "dropping stored nested OpenClaw config from start replay", {
      agentId: agent.id ?? null,
      keys: Object.keys(launchConfig.config).slice(0, 8),
    });
  }
  launchConfig.config = {};
  launchConfig.env = {
    ...(isRecord(launchConfig.env) ? launchConfig.env : {}),
    [CONTROL_UI_ALLOWED_ORIGIN_ENV]: controlUiOrigin,
  };
  return launchConfig as unknown as AgentLaunchConfig;
}

function buildHermesStartLaunchConfig(agent: SdkAgent): AgentLaunchConfig {
  const launchConfig = cloneStoredStartLaunchConfig(agent, "Hermes") as unknown as Record<string, unknown>;
  // Agents created before the launcher sent an image carry image: null; START
  // replays the stored contract verbatim, so repair it with the configured
  // default or the pod keeps resolving a stale image.
  if (typeof launchConfig.image !== "string" || !launchConfig.image.trim()) {
    const defaultImage = getHermesDefaultImage();
    if (defaultImage) launchConfig.image = defaultImage;
  }
  // The Hermes API 403s any browser Origin it does not recognize. Re-seed the
  // allowlist on every start so the current dashboard origin always works —
  // both layers: the pod env gates inside the API server, the launch-config
  // cors drives the route-plane middleware (which alone stamps SSE headers).
  const origins = hermesCorsOriginsList(
    isRecord(launchConfig.env) && typeof launchConfig.env[HERMES_CORS_ORIGINS_ENV] === "string"
      ? launchConfig.env[HERMES_CORS_ORIGINS_ENV]
      : "",
    isRecord(launchConfig.cors) && Array.isArray(launchConfig.cors.allowed_origins)
      ? launchConfig.cors.allowed_origins.filter((origin): origin is string => typeof origin === "string")
      : [],
  );
  const env = isRecord(launchConfig.env) ? { ...launchConfig.env } : {};
  env[HERMES_CORS_ORIGINS_ENV] = origins.join(",");
  launchConfig.env = env;
  launchConfig.cors = {
    ...(isRecord(launchConfig.cors) ? launchConfig.cors : {}),
    allowed_origins: origins,
  };
  return launchConfig as unknown as AgentLaunchConfig;
}

function hermesCorsOriginsList(...sources: Array<string | string[]>): string[] {
  const origins = sources.flatMap((source) => Array.isArray(source) ? source : source.split(","));
  origins.push(...configuredUiOrigins());
  const origin = currentControlUiOrigin();
  if (origin) origins.push(origin);
  return [...new Set(origins.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
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
  options: { name?: string },
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

function hasSelfHostedSlackConfig(slack: Record<string, unknown>): boolean {
  const mode = typeof slack.mode === "string" ? slack.mode : "";
  if (mode === "socket" || mode === "http") return true;
  return ["appToken", "signingSecret", "userToken"].some((field) => slack[field] !== undefined);
}

/**
 * Express hosted Slack intent and let the SDK own the launch contract.
 *
 * The dashboard states only its channel preferences here. `enabled`, `mode`,
 * the bot/relay token references, the relay URL and the complete
 * `HYPER_SLACK_*` launch env — including `HYPER_SLACK_GATEWAY_ID`, which is
 * derived from the Agent id the Backend assigns at create time — are built by
 * `createOpenClaw`. Hand-building that env here is what shipped an Agent whose
 * pod died at boot on a missing gateway id.
 */
function withHostedSlackRelayConfig<T extends FrontendOpenClawCreateOptions>(options: T): T {
  if (!SLACK_RELAY_BASE_URL) return options;
  const config = isRecord(options.config) ? cloneRecord(options.config) : {};
  const channels = isRecord(config.channels) ? cloneRecord(config.channels) : {};
  const existingSlack = isRecord(channels.slack) ? cloneRecord(channels.slack) : {};
  if (hasSelfHostedSlackConfig(existingSlack)) return options;

  channels.slack = {
    ...existingSlack,
    groupPolicy: existingSlack.groupPolicy ?? "open",
    replyToMode: existingSlack.replyToMode ?? "all",
    replyToModeByChatType: isRecord(existingSlack.replyToModeByChatType) ? existingSlack.replyToModeByChatType : { direct: "off" },
  };
  config.channels = channels;
  return {
    ...options,
    config,
    slack: { relayBaseUrl: SLACK_RELAY_BASE_URL },
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

async function createAgentWithNameRetry<T extends { name?: string }>(
  agentClient: Deployments,
  create: (options: T) => Promise<SdkAgent>,
  preparedOptions: T,
): Promise<SdkAgent> {
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

export async function createOpenClawAgent(apiKey: string, options: FrontendOpenClawCreateOptions = {}) {
  const preparedOptions = withConfiguredControlUiOrigins(
    await withUserSlackRelayLaunchConfig(apiKey, options),
  );
  const agentClient = createAgentClient(apiKey);
  const create = ENABLED_ENV_VALUES.has((preparedOptions.env?.OPENCLAW_DESKTOP_ENABLED ?? "").trim().toLowerCase())
    ? agentClient.createOpenClawPro.bind(agentClient)
    : agentClient.createOpenClaw.bind(agentClient);
  return createAgentWithNameRetry(agentClient, create, preparedOptions);
}

export async function createHermesAgentDeployment(apiKey: string, options: FrontendHermesAgentCreateOptions = {}) {
  const agentClient = createAgentClient(apiKey);
  const corsOrigins = hermesCorsOriginsList(options.env?.[HERMES_CORS_ORIGINS_ENV] ?? "", options.corsOrigins ?? []);
  const preparedOptions: FrontendHermesAgentCreateOptions = {
    ...options,
    corsOrigins,
  };
  return createAgentWithNameRetry(agentClient, agentClient.createHermesAgent.bind(agentClient), preparedOptions);
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
  const isHermesRuntime = (current as { runtime?: string | null }).runtime === "hermes-agent";
  let accepted: SdkAgent;
  try {
    if (isHermesRuntime) {
      // Hermes launches carry API_SERVER_KEY in secrets; the SDK rehydrates the
      // redacted projection server-side, so the stored launch config round-trips.
      accepted = await agentClient.startHermesAgent(agentId, {
        launchConfig: buildHermesStartLaunchConfig(current),
      });
    } else {
      const origin = currentControlUiOrigin();
      if (!origin) throw new Error("Could not determine this dashboard address before starting the agent.");
      accepted = await agentClient.startOpenClaw(agentId, {
        launchConfig: buildOpenClawStartLaunchConfig(current, origin),
      });
    }
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

export async function deleteInactiveAgent(apiKey: string, agentId: string): Promise<Record<string, unknown>> {
  const agentClient = createAgentClient(apiKey);
  const current = await agentClient.get(agentId);
  const state = current.state.toUpperCase();
  if (state !== "STOPPED" && state !== "ARCHIVED") {
    throw new Error("Agents can only be deleted after they are stopped or archived.");
  }
  return agentClient.delete(current.id);
}
