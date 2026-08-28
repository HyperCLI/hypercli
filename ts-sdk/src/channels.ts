export type AgentChannelHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface AgentChannelSummary {
  channelId: string;
  accountId?: string;
  accountDisplayName?: string;
  enabled?: boolean;
  configured: boolean;
  running?: boolean;
  authenticated?: boolean;
  healthState: AgentChannelHealthState;
  lastError?: string;
  lastProbeAt?: string | number;
}

export interface AgentChannelAccountStatus<TRawRuntimeStatus = unknown> {
  accountId?: string;
  accountDisplayName?: string;
  enabled?: boolean;
  configured: boolean;
  running?: boolean;
  authenticated?: boolean;
  healthState: AgentChannelHealthState;
  /** Runtime-specific reason retained alongside the portable health category. */
  healthReason?: string;
  lastError?: string;
  lastProbeAt?: string | number;
  rawRuntimeStatus: TRawRuntimeStatus;
}

export interface AgentChannel<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
> {
  channelId: string;
  label?: string;
  detailLabel?: string;
  systemImage?: string;
  defaultAccountId?: string;
  metadata?: TMetadata;
  rawChannelStatus: TRawChannelStatus;
  accounts: AgentChannelAccountStatus<TRawAccountStatus>[];
}

export type AgentChannelGroup<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
> = AgentChannel<TRawChannelStatus, TRawAccountStatus, TMetadata>;

export interface AgentChannelsSnapshot<
  TRawChannelStatus = unknown,
  TRawAccountStatus = unknown,
  TMetadata = unknown,
  TDiagnostics = unknown,
  TSource = unknown,
> {
  observedAt: string | number;
  channels: AgentChannel<TRawChannelStatus, TRawAccountStatus, TMetadata>[];
  partial?: boolean;
  warnings?: string[];
  diagnostics?: TDiagnostics;
  source?: TSource;
}

export interface AgentChannelsProviderCapabilities {
  configure: boolean;
  logout: boolean;
  removeConfig: boolean;
  probe: boolean;
  multipleAccounts: boolean;
}

export interface AgentChannelListOptions {
  probe?: boolean;
  timeoutMs?: number;
}

export interface AgentChannelReadOptions extends AgentChannelListOptions {
  channelId?: string;
}

export interface AgentChannelConfigurationReadRequest {
  channelId: string;
  accountId?: string;
}

export interface AgentChannelConfigurationReadResult<TConfiguration = unknown> {
  channelId: string;
  accountId?: string;
  config: TConfiguration | undefined;
}

export interface AgentChannelUpdateRequest<TPatch extends Record<string, unknown> = Record<string, unknown>> {
  channelId: string;
  accountId?: string;
  patch: TPatch;
}

export interface AgentChannelsProvider {
  readonly capabilities: AgentChannelsProviderCapabilities;
  list(options?: AgentChannelListOptions): Promise<AgentChannelSummary[]>;
  read?(options?: AgentChannelReadOptions): Promise<AgentChannelsSnapshot>;
  readConfig?(request: AgentChannelConfigurationReadRequest): Promise<AgentChannelConfigurationReadResult>;
  patchConfig?(patch: Record<string, unknown>): Promise<void>;
  update?(request: AgentChannelUpdateRequest): Promise<void>;
  configure?(channelId: string, config: Record<string, unknown>, accountId?: string): Promise<void>;
  logout?(channelId: string, accountId?: string): Promise<void>;
  removeConfig?(channelId: string, accountId?: string): Promise<void>;
}

export interface SlackInstallStatusLike {
  connected: boolean;
  teamId?: string | null;
  teamName?: string | null;
  botUserId?: string | null;
  installerUserId?: string | null;
  updatedAt?: string | null;
}

export interface SlackInstallStatusCheckOptions {
  relayBaseUrl: string;
  token: string;
}

export interface HostedSlackRelayChannelConfigOptions {
  relayBaseUrl: string;
  agentId?: string | null;
  gatewayId?: string | null;
  installerUserId?: string | null;
  botTokenEnv?: string | null;
  authTokenEnv?: string | null;
}

export interface HostedSlackRelayChannelConfig {
  [key: string]: unknown;
  enabled: true;
  mode: 'relay';
  botToken: {
    source: 'env';
    provider: 'default';
    id: string;
  };
  relay: {
    url: string;
    authToken: {
      source: 'env';
      provider: 'default';
      id: string;
    };
    gatewayId: string;
  };
  dmPolicy?: 'allowlist';
  allowFrom?: string[];
}

export function normalizeSlackRelayBaseUrl(relayBaseUrl: string): string {
  const normalized = relayBaseUrl.trim();
  if (!normalized) throw new Error('Slack relay base URL is required');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Slack relay base URL is invalid');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Slack relay base URL must use http or https');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'api.agents.hypercli.com') {
    url.hostname = 'api.hypercli.com';
  } else if (host === 'api.agents.dev.hypercli.com') {
    url.hostname = 'api.dev.hypercli.com';
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function buildSlackRelayWebSocketUrl(relayBaseUrl: string): string {
  const url = new URL(normalizeSlackRelayBaseUrl(relayBaseUrl));
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = '/slack/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function buildSlackRelayApiUrl(relayBaseUrl: string): string {
  const url = new URL(normalizeSlackRelayBaseUrl(relayBaseUrl));
  url.pathname = '/slack/api/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Launch environment keys the OpenClaw entrypoint reads for hosted Slack.
 *
 * The container refuses to boot when `HYPER_SLACK_APP_ENABLED` is truthy and
 * any of the companions is missing: the inline config reconciler throws for
 * `HYPER_SLACK_RELAY_URL` / `HYPER_SLACK_GATEWAY_ID`, and the shell gate exits
 * for `HYPER_SLACK_API_URL`. `HYPER_AGENTS_API_KEY` is also required at boot
 * but is injected by the platform and stripped from caller-supplied env, so it
 * is deliberately not part of this set.
 */
export const HOSTED_SLACK_APP_ENABLED_ENV = 'HYPER_SLACK_APP_ENABLED';
export const HOSTED_SLACK_RELAY_URL_ENV = 'HYPER_SLACK_RELAY_URL';
export const HOSTED_SLACK_API_URL_ENV = 'HYPER_SLACK_API_URL';
export const HOSTED_SLACK_GATEWAY_ID_ENV = 'HYPER_SLACK_GATEWAY_ID';

export const HOSTED_SLACK_LAUNCH_ENV_KEYS = [
  HOSTED_SLACK_APP_ENABLED_ENV,
  HOSTED_SLACK_RELAY_URL_ENV,
  HOSTED_SLACK_API_URL_ENV,
  HOSTED_SLACK_GATEWAY_ID_ENV,
] as const;

/** Companions the entrypoint requires whenever hosted Slack is enabled. */
export const HOSTED_SLACK_REQUIRED_COMPANION_ENV_KEYS = [
  HOSTED_SLACK_RELAY_URL_ENV,
  HOSTED_SLACK_API_URL_ENV,
  HOSTED_SLACK_GATEWAY_ID_ENV,
] as const;

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);

/** Match the container entrypoint's boolean parsing exactly. */
export function hostedSlackEnvEnabled(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase());
}

/** The gateway id the Backend derives for an Agent (`gateway_id_for_agent`). */
export function hostedSlackGatewayIdForAgent(agentId: string): string {
  const id = String(agentId || '').trim();
  if (!id) throw new Error('Slack relay gateway id requires an agent id');
  return id.startsWith('agent:') ? id : `agent:${id}`;
}

export interface HostedSlackLaunchEnvOptions {
  relayBaseUrl: string;
  gatewayId?: string | null;
  agentId?: string | null;
}

export type HostedSlackLaunchEnvMap = Record<typeof HOSTED_SLACK_LAUNCH_ENV_KEYS[number], string>;

export interface HostedSlackLaunchEnvRepairOptions {
  agentId: string;
}

/**
 * SDK mirror of the hosted Slack env contract enforced by the OpenClaw image.
 *
 * There is no partial enabled mode on purpose: a launch env with
 * `HYPER_SLACK_APP_ENABLED` and a missing companion kills the pod at boot.
 */
export class HostedSlackLaunchEnv {
  static readonly appEnabledKey = HOSTED_SLACK_APP_ENABLED_ENV;
  static readonly relayUrlKey = HOSTED_SLACK_RELAY_URL_ENV;
  static readonly apiUrlKey = HOSTED_SLACK_API_URL_ENV;
  static readonly gatewayIdKey = HOSTED_SLACK_GATEWAY_ID_ENV;
  static readonly keys = HOSTED_SLACK_LAUNCH_ENV_KEYS;
  static readonly requiredCompanionKeys = HOSTED_SLACK_REQUIRED_COMPANION_ENV_KEYS;

  static gatewayIdForAgent(agentId: string): string {
    return hostedSlackGatewayIdForAgent(agentId);
  }

  static isEnabled(envOrValue: Record<string, string | undefined> | string | null | undefined): boolean {
    if (typeof envOrValue === 'string' || envOrValue === null || envOrValue === undefined) {
      return hostedSlackEnvEnabled(envOrValue);
    }
    return hostedSlackEnvEnabled(envOrValue[HOSTED_SLACK_APP_ENABLED_ENV]);
  }

  static build(options: HostedSlackLaunchEnvOptions): HostedSlackLaunchEnvMap {
    const gatewayId = options.gatewayId?.trim()
      || (options.agentId?.trim() ? hostedSlackGatewayIdForAgent(options.agentId) : '');
    if (!gatewayId) throw new Error('Slack relay gateway id requires an agent id');
    return {
      [HOSTED_SLACK_APP_ENABLED_ENV]: '1',
      [HOSTED_SLACK_RELAY_URL_ENV]: buildSlackRelayWebSocketUrl(options.relayBaseUrl),
      [HOSTED_SLACK_API_URL_ENV]: buildSlackRelayApiUrl(options.relayBaseUrl),
      [HOSTED_SLACK_GATEWAY_ID_ENV]: gatewayId,
    };
  }

  static assertComplete(
    env: Record<string, string | undefined> | null | undefined,
    context = 'launch env',
  ): void {
    const values = env ?? {};
    if (!HostedSlackLaunchEnv.isEnabled(values)) return;
    const missing = HOSTED_SLACK_REQUIRED_COMPANION_ENV_KEYS
      .filter((key) => !String(values[key] ?? '').trim());
    if (!missing.length) return;
    throw new Error(
      `${context} sets ${HOSTED_SLACK_APP_ENABLED_ENV} without ${missing.join(', ')}; `
      + 'the OpenClaw entrypoint refuses to boot without the complete hosted Slack set',
    );
  }

  static repairForAgent(
    env: Record<string, string | undefined>,
    options: HostedSlackLaunchEnvRepairOptions,
  ): Record<string, string | undefined> {
    if (
      HostedSlackLaunchEnv.isEnabled(env)
      && !String(env[HOSTED_SLACK_GATEWAY_ID_ENV] ?? '').trim()
    ) {
      env[HOSTED_SLACK_GATEWAY_ID_ENV] = hostedSlackGatewayIdForAgent(options.agentId);
    }
    return env;
  }
}

export function buildHostedSlackLaunchEnv(options: HostedSlackLaunchEnvOptions): HostedSlackLaunchEnvMap {
  return HostedSlackLaunchEnv.build(options);
}

/**
 * Refuse a launch env that enables hosted Slack without every companion.
 *
 * Reports all missing keys at once so one boot-blocking mistake is not
 * discovered one variable per pod restart.
 */
export function assertHostedSlackLaunchEnvComplete(
  env: Record<string, string | undefined> | null | undefined,
  context = 'launch env',
): void {
  HostedSlackLaunchEnv.assertComplete(env, context);
}

export function buildHostedSlackRelayChannelConfig(options: HostedSlackRelayChannelConfigOptions): HostedSlackRelayChannelConfig {
  const gatewayId = options.gatewayId?.trim() || (options.agentId?.trim() ? `agent:${options.agentId.trim()}` : '');
  if (!gatewayId) throw new Error('Slack relay gateway id requires an agent id');
  const config: HostedSlackRelayChannelConfig = {
    enabled: true,
    mode: 'relay',
    botToken: {
      source: 'env',
      provider: 'default',
      id: options.botTokenEnv?.trim() || 'SLACK_BOT_TOKEN',
    },
    relay: {
      url: buildSlackRelayWebSocketUrl(options.relayBaseUrl),
      authToken: {
        source: 'env',
        provider: 'default',
        id: options.authTokenEnv?.trim() || 'HYPER_AGENTS_API_KEY',
      },
      gatewayId,
    },
  };
  const installerUserId = options.installerUserId?.trim();
  if (installerUserId) {
    config.dmPolicy = 'allowlist';
    config.allowFrom = [installerUserId];
  }
  return config;
}
